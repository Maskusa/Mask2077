package com.subtit.player.vpn;

import android.os.Build;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLog;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * JVM-level tests for HttpProxySocksBridge covering upstream CONNECT interactions.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.S)
public class HttpProxySocksBridgeTest {

    private TestUpstreamProxy upstream;
    private HttpProxySocksBridge bridge;

    @Before
    public void setUp() throws Exception {
        ShadowLog.setupLogging();

        upstream = new TestUpstreamProxy();
        upstream.start();

        bridge = new HttpProxySocksBridge(
                "127.0.0.1",
                upstream.getPort(),
                null,
                null,
                5_000,
                5_000,
                5_000,
                4
        );
        assertTrue("Bridge failed to start", bridge.start());
    }

    @After
    public void tearDown() {
        if (bridge != null) {
            bridge.stop();
        }
        if (upstream != null) {
            upstream.stop();
        }
    }

    @Test
    public void testSuccessfulConnectUpdatesMetrics() throws Exception {
        BridgeProbe probe = new BridgeProbe();
        bridge.setListener(probe);

        try (Socket client = new Socket()) {
            client.connect(new InetSocketAddress("127.0.0.1", bridge.getLocalPort()), 5_000);
            performSocksConnect(client, "example.com", 443);
        }

        assertTrue("Expected CONNECT to reach upstream", upstream.awaitConnect());

        HttpProxySocksBridge.BridgeSnapshot snapshot = bridge.getSnapshot();
        assertEquals(1, snapshot.accepted);
        assertEquals(0, snapshot.rejected);
        assertEquals(0, snapshot.httpFailures);
        assertEquals(0, snapshot.socksFailures);
        // Поскольку данных немного, bytes >= 0 — просто проверяем доступность поля.
        assertTrue(snapshot.upBytes >= 0);
        assertTrue(snapshot.downBytes >= 0);

        assertTrue("Listener should receive success", probe.awaitSuccess());
        assertEquals(1, probe.accepted);
        assertEquals(0, probe.rejected);
    }

    @Test
    public void testRejectedWhenUpstreamDown() throws Exception {
        bridge.stop();
        upstream.stop();

        BridgeProbe probe = new BridgeProbe();

        bridge = new HttpProxySocksBridge(
                "127.0.0.1",
                upstream.getPort(), // порт уже не слушает
                null,
                null,
                500,
                500,
                500,
                2
        );
        bridge.setListener(probe);
        assertTrue(bridge.start());

        try (Socket client = new Socket()) {
            client.connect(new InetSocketAddress("127.0.0.1", bridge.getLocalPort()), 1_000);
            boolean ok = performSocksConnect(client, "dead.host", 80);
            assertFalse("CONNECT should fail when upstream is down", ok);
        }

        assertTrue("Listener should observe rejection", probe.awaitFailure());
        assertTrue("Expected rejection callback count", probe.rejected >= 1);

        HttpProxySocksBridge.BridgeSnapshot snapshot = bridge.getSnapshot();
        assertEquals(1, snapshot.accepted);
    }

    @Test
    public void testFallbackToHttp10OnEarlyClose() throws Exception {
        bridge.stop();
        upstream.stop();

        upstream = new TestUpstreamProxy(true);
        upstream.start();

        BridgeProbe probe = new BridgeProbe();

        bridge = new HttpProxySocksBridge(
                "127.0.0.1",
                upstream.getPort(),
                null,
                null,
                1_000,
                4_000,
                4_000,
                2
        );
        bridge.setListener(probe);
        assertTrue("Fallback bridge should start", bridge.start());

        try (Socket client = new Socket()) {
            client.connect(new InetSocketAddress("127.0.0.1", bridge.getLocalPort()), 1_000);
            assertTrue("CONNECT should succeed after HTTP/1.0 fallback",
                    performSocksConnect(client, "fallback.test", 443));
        }

        assertTrue("Upstream should see successful CONNECT after fallback", upstream.awaitSuccess());
        assertTrue("Listener should report CONNECT success", probe.awaitSuccess());

        String firstLine = upstream.awaitRequestLine();
        String secondLine = upstream.awaitRequestLine();
        assertNotNull("Expected first CONNECT request line", firstLine);
        assertNotNull("Expected fallback CONNECT request line", secondLine);
        assertEquals("CONNECT fallback.test:443 HTTP/1.1", firstLine);
        assertEquals("CONNECT fallback.test:443 HTTP/1.0", secondLine);
    }

    private boolean performSocksConnect(Socket socket, String host, int port) throws IOException {
        byte[] connectRequest = buildSocksRequest(host, port);

        socket.getOutputStream().write(new byte[]{0x05, 0x01, 0x00});
        byte[] response = new byte[2];
        socket.getInputStream().read(response);
        if (response[1] == (byte) 0xFF) {
            return false;
        }

        socket.getOutputStream().write(connectRequest);
        byte[] reply = new byte[10 + Math.max(0, host.length() - 4)];
        int read = socket.getInputStream().read(reply);
        return read >= 2 && reply[1] == 0x00;
    }

    private byte[] buildSocksRequest(String host, int port) {
        byte[] hostBytes = host.getBytes(StandardCharsets.UTF_8);
        byte[] request = new byte[7 + hostBytes.length];
        request[0] = 0x05;
        request[1] = 0x01;
        request[2] = 0x00;
        request[3] = 0x03;
        request[4] = (byte) hostBytes.length;
        System.arraycopy(hostBytes, 0, request, 5, hostBytes.length);
        request[5 + hostBytes.length] = (byte) ((port >> 8) & 0xFF);
        request[6 + hostBytes.length] = (byte) (port & 0xFF);
        return request;
    }

    private static final class BridgeProbe implements HttpProxySocksBridge.BridgeListener {
        int accepted;
        int rejected;
        final CountDownLatch successLatch = new CountDownLatch(1);
        final CountDownLatch failureLatch = new CountDownLatch(1);
        volatile String lastFailure;

        @Override
        public void onClientAccepted(HttpProxySocksBridge.SocksRequest request) {
            accepted++;
        }

        @Override
        public void onClientRejected(String reason) {
            rejected++;
            lastFailure = reason;
            failureLatch.countDown();
        }

        @Override
        public void onHttpConnectSuccess(HttpProxySocksBridge.SocksRequest request) {
            successLatch.countDown();
        }

        @Override
        public void onHttpConnectFailure(HttpProxySocksBridge.SocksRequest request, String reason) {
            lastFailure = reason;
            failureLatch.countDown();
        }

        @Override
        public void onClientClosed(HttpProxySocksBridge.SocksRequest request, long durationMs, long upBytes, long downBytes) {
            // no-op
        }

        boolean awaitSuccess() throws InterruptedException {
            return successLatch.await(2, TimeUnit.SECONDS);
        }

        boolean awaitFailure() throws InterruptedException {
            return failureLatch.await(2, TimeUnit.SECONDS);
        }
    }

    private static final class TestUpstreamProxy {
        private final boolean dropFirstResponse;
        private final CountDownLatch firstConnectLatch = new CountDownLatch(1);
        private final CountDownLatch successLatch = new CountDownLatch(1);
        private final LinkedBlockingQueue<String> requestLines = new LinkedBlockingQueue<>();
        private volatile boolean firstResponseDropped = false;
        private java.net.ServerSocket serverSocket;
        private volatile boolean running = false;

        TestUpstreamProxy() {
            this(false);
        }

        TestUpstreamProxy(boolean dropFirstResponse) {
            this.dropFirstResponse = dropFirstResponse;
        }

        void start() throws IOException {
            serverSocket = new java.net.ServerSocket(0);
            running = true;
            Thread t = new Thread(this::acceptLoop, "test-upstream");
            t.setDaemon(true);
            t.start();
        }

        void stop() {
            running = false;
            if (serverSocket != null) {
                try {
                    serverSocket.close();
                } catch (IOException ignored) {
                }
            }
        }

        int getPort() {
            return serverSocket.getLocalPort();
        }

        boolean awaitConnect() throws InterruptedException {
            return firstConnectLatch.await(2, TimeUnit.SECONDS);
        }

        boolean awaitSuccess() throws InterruptedException {
            return successLatch.await(2, TimeUnit.SECONDS);
        }

        String awaitRequestLine() throws InterruptedException {
            return requestLines.poll(2, TimeUnit.SECONDS);
        }

        private void acceptLoop() {
            while (running) {
                try (Socket socket = serverSocket.accept()) {
                    firstConnectLatch.countDown();

                    InputStream upstreamIn = socket.getInputStream();
                    BufferedReader reader = new BufferedReader(
                            new InputStreamReader(upstreamIn, StandardCharsets.ISO_8859_1));
                    String firstLine = reader.readLine();
                    if (firstLine != null) {
                        requestLines.offer(firstLine);
                    }

                    if (dropFirstResponse && !firstResponseDropped) {
                        firstResponseDropped = true;
                        continue;
                    }

                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) {
                        // consume remaining headers
                    }

                    socket.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n"
                            .getBytes(StandardCharsets.ISO_8859_1));
                    successLatch.countDown();

                    byte[] buffer = new byte[256];
                    while (upstreamIn.read(buffer) >= 0) {
                        // discard client data
                    }
                } catch (IOException ignored) {
                }
            }
        }
    }
}
