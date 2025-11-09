package com.subtit.player.vpn;

import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Локальный SOCKS5-сервер, который преобразует запросы CONNECT в HTTP CONNECT к удалённому прокси.
 * Используется, чтобы tun2socks (ожидающий SOCKS5) мог работать поверх HTTP-прокси 3proxy.
 */
final class HttpProxySocksBridge {

    private static final String TAG = "HttpProxySocksBridge";
    // Многие публичные прокси отвечают на CONNECT заметно дольше 15 секунд,
    // поэтому заводим более щедрые таймауты по умолчанию.
    private static final int DEFAULT_CONNECT_TIMEOUT_MS = 45_000;
    private static final int DEFAULT_READ_TIMEOUT_MS = 60_000;
    private static final int DEFAULT_IDLE_TIMEOUT_MS = 90_000;
    private static final int MAX_CLIENTS = 64;

    private final String upstreamHost;
    private final int upstreamPort;
    private final String basicAuthHeader;
    private final ThreadPoolExecutor workerPool;
    private final Semaphore connectionLimiter;
    private final ConcurrentLinkedQueue<Future<?>> activeFutures = new ConcurrentLinkedQueue<>();
    private final int connectTimeoutMs;
    private final int readTimeoutMs;
    private final int idleTimeoutMs;
    private final AtomicLong acceptedClients = new AtomicLong();
    private final AtomicLong rejectedClients = new AtomicLong();
    private final AtomicLong httpFailures = new AtomicLong();
    private final AtomicLong socksFailures = new AtomicLong();
    private final AtomicLong totalUpBytes = new AtomicLong();
    private final AtomicLong totalDownBytes = new AtomicLong();
    @Nullable
    private volatile BridgeListener listener;
    @Nullable
    private volatile SocketProtector socketProtector;
    private volatile boolean running;
    @Nullable
    private ServerSocket serverSocket;
    @Nullable
    private Thread acceptThread;

    HttpProxySocksBridge(String upstreamHost,
                         int upstreamPort,
                         @Nullable String username,
                         @Nullable String password) {
        this(upstreamHost, upstreamPort, username, password,
                DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_READ_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS, MAX_CLIENTS);
    }

    HttpProxySocksBridge(String upstreamHost,
                         int upstreamPort,
                         @Nullable String username,
                         @Nullable String password,
                         int connectTimeoutMs,
                         int readTimeoutMs,
                         int idleTimeoutMs,
                         int maxClients) {
        this.upstreamHost = upstreamHost;
        this.upstreamPort = upstreamPort;
        if (username != null && !username.isEmpty() && password != null) {
            String creds = username + ":" + password;
            String encoded = Base64.encodeToString(creds.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            this.basicAuthHeader = "Proxy-Authorization: Basic " + encoded + "\r\n";
        } else {
            this.basicAuthHeader = null;
        }
        this.connectTimeoutMs = Math.max(1_000, connectTimeoutMs);
        this.readTimeoutMs = Math.max(1_000, readTimeoutMs);
        this.idleTimeoutMs = Math.max(5_000, idleTimeoutMs);
        int safeMaxClients = Math.max(4, maxClients);
        this.connectionLimiter = new Semaphore(safeMaxClients);
        this.workerPool = new ThreadPoolExecutor(
                0,
                safeMaxClients,
                30L,
                TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(),
                runnable -> {
                    Thread thread = new Thread(runnable, "http-socks-bridge-worker");
                    thread.setDaemon(true);
                    return thread;
                }
        );
        this.workerPool.allowCoreThreadTimeOut(true);
    }

    synchronized boolean start() {
        if (running) {
            return true;
        }
        try {
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            running = true;
            resetMetrics();
            acceptThread = new Thread(this::acceptLoop, "http-socks-bridge");
            acceptThread.start();
            Log.i(TAG, "Bridge started on port " + serverSocket.getLocalPort()
                    + " upstream=" + upstreamHost + ":" + upstreamPort
                    + " auth=" + (basicAuthHeader != null));
            return true;
        } catch (IOException e) {
            Log.e(TAG, "Failed to start bridge", e);
            stop();
            return false;
        }
    }

    synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
            }
            serverSocket = null;
        }
        if (acceptThread != null) {
            acceptThread.interrupt();
            acceptThread = null;
        }
        workerPool.shutdownNow();
        try {
            workerPool.awaitTermination(3, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        Future<?> future;
        while ((future = activeFutures.poll()) != null) {
            future.cancel(true);
        }
        Log.i(TAG, "Bridge stopped");
    }

    synchronized void markStopping() {
        if (!running) {
            return;
        }
        running = false;
        ServerSocket socket = serverSocket;
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException e) {
                Log.w(TAG, "Failed to close server socket during markStopping", e);
            }
        }
        Log.i(TAG, "Bridge stop signal issued");
    }

    int getLocalPort() {
        ServerSocket socket = serverSocket;
        if (socket == null) {
            throw new IllegalStateException("Bridge not started");
        }
        return socket.getLocalPort();
    }

    private void acceptLoop() {
        Log.d(TAG, "Accept loop started");
        while (running) {
            try {
                ServerSocket socket = serverSocket;
                if (socket == null) {
                    break;
                }
                Socket client = socket.accept();
                 SocketAddress remote = client.getRemoteSocketAddress();
                 Log.d(TAG, "Accepted client " + remote);
                client.setTcpNoDelay(true);
                if (!connectionLimiter.tryAcquire(idleTimeoutMs, TimeUnit.MILLISECONDS)) {
                    Log.w(TAG, "Reject connection: bridge overloaded");
                    client.close();
                    rejectedClients.incrementAndGet();
                    notifyRejected("capacity");
                    continue;
                }
                Future<?> future = workerPool.submit(() -> handleClient(client));
                activeFutures.offer(future);
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "Accept failed", e);
                }
                break;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        Log.d(TAG, "Accept loop finished running=" + running);
    }

    private void handleClient(Socket client) {
        long handlingBegan = SystemClock.elapsedRealtime();
        SocketAddress remoteAddress = client.getRemoteSocketAddress();
        try (Socket local = client) {
            local.setSoTimeout(readTimeoutMs);
            InputStream in = local.getInputStream();
            OutputStream out = local.getOutputStream();
            Log.d(TAG, "Client handling started remote=" + remoteAddress);

            if (!performSocksHandshake(in, out)) {
                Log.w(TAG, "SOCKS handshake failed remote=" + remoteAddress);
                socksFailures.incrementAndGet();
                notifyRejected("socks_handshake");
                return;
            }

            SocksRequest request = readSocksRequest(in);
            if (request == null) {
                Log.w(TAG, "SOCKS request parse failed remote=" + remoteAddress);
                writeFailure(out, (byte) 0x01);
                socksFailures.incrementAndGet();
                notifyRejected("socks_request");
                return;
            }
            Log.d(TAG, "SOCKS request " + request + " remote=" + remoteAddress);

            long connectionStart = System.currentTimeMillis();
            acceptedClients.incrementAndGet();
            notifyAccepted(request);

            ProxyConnection proxyConnection = openProxyConnection(request);
            if (proxyConnection == null) {
                writeFailure(out, (byte) 0x05);
                httpFailures.incrementAndGet();
                notifyHttpFailure(request, "HTTP CONNECT failed");
                return;
            }

            try (Socket remote = proxyConnection.socket) {
                notifyHttpSuccess(request);
                if (proxyConnection.http10) {
                    Log.d(TAG, "HTTP CONNECT established via HTTP/1.0 for request=" + request);
                } else {
                    Log.d(TAG, "HTTP CONNECT established request=" + request);
                }
                completeProxyPipe(local, remote, out, request, connectionStart);
            }
        } catch (IOException e) {
            if (running) {
                Log.w(TAG, "Client handling failed", e);
                notifyHttpFailure(null, e.getMessage());
            }
        } finally {
            connectionLimiter.release();
            Future<?> finished;
            while ((finished = activeFutures.poll()) != null) {
                if (!finished.isDone()) {
                    activeFutures.offer(finished);
                    break;
                }
            }
            Log.d(TAG, "Client handling completed remote=" + remoteAddress + " duration="
                    + (SystemClock.elapsedRealtime() - handlingBegan) + "ms");
        }
    }

    @Nullable
    private ProxyConnection openProxyConnection(SocksRequest request) throws IOException {
        Socket primary = null;
        try {
            primary = createUpstreamSocket();
            ConnectOutcome outcome = performHttpConnect(primary, request, false);
            if (outcome == ConnectOutcome.SUCCESS) {
                return new ProxyConnection(primary, false);
            }
            closeQuietly(primary);
            primary = null;
            Log.w(TAG, "HTTP CONNECT failed outcome=" + outcome + " request=" + request + ", retrying HTTP/1.0");
            Socket fallback = createUpstreamSocket();
            outcome = performHttpConnect(fallback, request, true);
            if (outcome == ConnectOutcome.SUCCESS) {
                return new ProxyConnection(fallback, true);
            }
            closeQuietly(fallback);
            Log.w(TAG, "HTTP CONNECT fallback failed outcome=" + outcome + " request=" + request);
            return null;
        } catch (IOException e) {
            closeQuietly(primary);
            throw e;
        }
    }

    private Socket createUpstreamSocket() throws IOException {
        Socket remote = new Socket();
        if (!remote.isBound()) {
            remote.bind(new InetSocketAddress(0));
        }
        SocketProtector protector = socketProtector;
        if (protector != null) {
            try {
                if (!protector.protect(remote)) {
                    Log.w(TAG, "Socket protector rejected upstream socket");
                }
            } catch (Exception protectError) {
                Log.w(TAG, "Socket protector threw", protectError);
            }
        }
        remote.connect(new InetSocketAddress(upstreamHost, upstreamPort), connectTimeoutMs);
        remote.setTcpNoDelay(true);
        remote.setSoTimeout(connectTimeoutMs);
        return remote;
    }

    private void completeProxyPipe(Socket local,
                                   Socket remote,
                                   OutputStream out,
                                   SocksRequest request,
                                   long connectionStart) throws IOException {
        writeSuccess(out);
        remote.setSoTimeout(idleTimeoutMs);
        local.setSoTimeout(idleTimeoutMs);

        final InputStream localIn = local.getInputStream();
        final OutputStream localOut = local.getOutputStream();
        final InputStream remoteIn = remote.getInputStream();
        final OutputStream remoteOut = remote.getOutputStream();

        Future<Long> up = workerPool.submit(() -> pump(localIn, remoteOut));
        Future<Long> down = workerPool.submit(() -> pump(remoteIn, localOut));

        long upBytes = safeGet(up);
        totalUpBytes.addAndGet(upBytes);
        Log.d(TAG, "Upstream finished request=" + request + " bytes=" + upBytes);
        remote.shutdownOutput();
        local.shutdownInput();
        long downBytes = safeGet(down);
        totalDownBytes.addAndGet(downBytes);
        notifyClosed(request, System.currentTimeMillis() - connectionStart, upBytes, downBytes);
        Log.d(TAG, "Downstream finished request=" + request + " bytes=" + downBytes);
    }

    private enum ConnectOutcome {
        SUCCESS,
        TIMEOUT,
        FAILURE
    }

    private static final class ProxyConnection {
        final Socket socket;
        final boolean http10;

        ProxyConnection(Socket socket, boolean http10) {
            this.socket = socket;
            this.http10 = http10;
        }
    }

    private static void closeQuietly(@Nullable Socket socket) {
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private boolean performSocksHandshake(InputStream in, OutputStream out) throws IOException {
        int version = in.read();
        if (version != 0x05) {
            Log.w(TAG, "Unsupported SOCKS version " + version);
            return false;
        }
        int nMethods = in.read();
        if (nMethods < 0) {
            Log.w(TAG, "SOCKS handshake invalid method count");
            return false;
        }
        byte[] methods = readExact(in, nMethods);
        if (methods == null) {
            Log.w(TAG, "SOCKS handshake failed to read methods");
            return false;
        }
        Log.d(TAG, "SOCKS handshake methods=" + Arrays.toString(methods));

        boolean supportsNoAuth = false;
        for (byte method : methods) {
            if (method == 0x00) {
                supportsNoAuth = true;
                break;
            }
        }
        if (!supportsNoAuth) {
            out.write(new byte[]{0x05, (byte) 0xFF});
            out.flush();
            Log.w(TAG, "SOCKS handshake no supported auth method");
            return false;
        }
        out.write(new byte[]{0x05, 0x00});
        out.flush();
        Log.d(TAG, "SOCKS handshake success");
        return true;
    }

    @Nullable
    private SocksRequest readSocksRequest(InputStream in) throws IOException {
        byte[] header = readExact(in, 4);
        if (header == null || header[0] != 0x05) {
            Log.w(TAG, "SOCKS request invalid header " + Arrays.toString(header));
            return null;
        }
        byte cmd = header[1];
        if (cmd != 0x01) {
            Log.w(TAG, "SOCKS request unsupported cmd=" + cmd);
            return null;
        }
        byte addressType = header[3];
        String host;
        if (addressType == 0x01) { // IPv4
            byte[] addr = readExact(in, 4);
            if (addr == null) {
                Log.w(TAG, "SOCKS request missing IPv4 bytes");
                return null;
            }
            host = (addr[0] & 0xFF) + "." + (addr[1] & 0xFF) + "." + (addr[2] & 0xFF) + "." + (addr[3] & 0xFF);
        } else if (addressType == 0x03) { // domain
            int length = in.read();
            if (length < 0) {
                Log.w(TAG, "SOCKS request domain length < 0");
                return null;
            }
            byte[] domainBytes = readExact(in, length);
            if (domainBytes == null) {
                Log.w(TAG, "SOCKS request failed to read domain");
                return null;
            }
            host = new String(domainBytes, StandardCharsets.UTF_8);
        } else if (addressType == 0x04) { // IPv6
            byte[] addr = readExact(in, 16);
            if (addr == null) {
                Log.w(TAG, "SOCKS request missing IPv6 bytes");
                return null;
            }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 16; i += 2) {
                if (i > 0) {
                    sb.append(':');
                }
                sb.append(String.format("%02x%02x", addr[i] & 0xFF, addr[i + 1] & 0xFF));
            }
            host = sb.toString();
        } else {
            return null;
        }
        byte[] portBytes = readExact(in, 2);
        if (portBytes == null) {
            Log.w(TAG, "SOCKS request missing port bytes");
            return null;
        }
        int port = ((portBytes[0] & 0xFF) << 8) | (portBytes[1] & 0xFF);
        Log.d(TAG, "SOCKS destination " + host + ":" + port);
        return new SocksRequest(host, port);
    }

    private ConnectOutcome performHttpConnect(Socket upstream, SocksRequest request, boolean http10) throws IOException {
        OutputStream upstreamOut = upstream.getOutputStream();
        String httpVersion = http10 ? "HTTP/1.0" : "HTTP/1.1";
        StringBuilder builder = new StringBuilder();
        builder.append("CONNECT ")
                .append(request.host)
                .append(':')
                .append(request.port)
                .append(' ')
                .append(httpVersion)
                .append("\r\n");
        builder.append("Host: ").append(request.host).append(':').append(request.port).append("\r\n");
        builder.append("Proxy-Connection: keep-alive\r\n");
        builder.append("Connection: keep-alive\r\n");
        if (basicAuthHeader != null) {
            builder.append(basicAuthHeader);
        }
        builder.append("\r\n");

        String payload = builder.toString();
        String sanitized = (basicAuthHeader != null)
                ? payload.replace(basicAuthHeader, "Proxy-Authorization: Basic ***\r\n")
                : payload;
        Log.v(TAG, "HTTP CONNECT payload (" + httpVersion + "):\n" + sanitized);

        upstreamOut.write(payload.getBytes(StandardCharsets.UTF_8));
        upstreamOut.flush();
        Log.d(TAG, "HTTP CONNECT dispatched target=" + request + " auth=" + (basicAuthHeader != null) + " ver=" + httpVersion);

        BufferedReader reader = new BufferedReader(
                new InputStreamReader(upstream.getInputStream(), StandardCharsets.ISO_8859_1));
        final String statusLine;
        try {
            statusLine = reader.readLine();
        } catch (java.net.SocketTimeoutException timeout) {
            Log.w(TAG, "HTTP CONNECT timed out waiting for response");
            return ConnectOutcome.TIMEOUT;
        }
        if (statusLine == null) {
            Log.w(TAG, "HTTP CONNECT empty response");
            return ConnectOutcome.FAILURE;
        }
        Log.d(TAG, "HTTP CONNECT statusLine=" + statusLine);
        boolean ok = statusLine.contains("200");
        String line;
        while ((line = reader.readLine()) != null && !line.isEmpty()) {
            // consume headers
            Log.v(TAG, "HTTP CONNECT header: " + line);
        }
        if (!ok) {
            Log.w(TAG, "HTTP CONNECT non-200 status " + statusLine);
            return ConnectOutcome.FAILURE;
        }
        Log.i(TAG, "HTTP CONNECT success status=" + statusLine);
        return ConnectOutcome.SUCCESS;
    }

    private void writeSuccess(OutputStream out) throws IOException {
        out.write(new byte[]{
                0x05, 0x00, 0x00, 0x01,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00
        });
        out.flush();
    }

    private void writeFailure(OutputStream out, byte code) throws IOException {
        out.write(new byte[]{
                0x05, code, 0x00, 0x01,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00
        });
        out.flush();
    }

    @Nullable
    private byte[] readExact(InputStream in, int length) throws IOException {
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = in.read(buffer, offset, length - offset);
            if (read < 0) {
                return null;
            }
            offset += read;
        }
        return buffer;
    }

    private long pump(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[8192];
        long total = 0;
        int read;
        long started = SystemClock.elapsedRealtime();
        while ((read = input.read(buffer)) >= 0) {
            if (read == 0) {
                continue;
            }
            output.write(buffer, 0, read);
            output.flush();
            total += read;
        }
        Log.v(TAG, "Pump finished bytes=" + total + " duration="
                + (SystemClock.elapsedRealtime() - started) + "ms");
        return total;
    }

    static final class SocksRequest {
        final String host;
        final int port;

        SocksRequest(String host, int port) {
            this.host = Objects.requireNonNull(host, "host");
            this.port = port;
        }

        @Override
        public String toString() {
            return "SocksRequest{" +
                    "host='" + host + '\'' +
                    ", port=" + port +
                    '}';
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof SocksRequest)) return false;
            SocksRequest that = (SocksRequest) o;
            return port == that.port && host.equals(that.host);
        }

        @Override
        public int hashCode() {
            return Objects.hash(host, port);
        }
    }

    public interface BridgeListener {
        void onClientAccepted(SocksRequest request);

        void onClientRejected(String reason);

        void onHttpConnectSuccess(SocksRequest request);

        void onHttpConnectFailure(SocksRequest request, String reason);

        void onClientClosed(SocksRequest request, long durationMs, long upBytes, long downBytes);
    }

    public interface SocketProtector {
        boolean protect(Socket socket);
    }

    public static final class BridgeSnapshot {
        public final long accepted;
        public final long rejected;
        public final long httpFailures;
        public final long socksFailures;
        public final long upBytes;
        public final long downBytes;

        BridgeSnapshot(long accepted,
                       long rejected,
                       long httpFailures,
                       long socksFailures,
                       long upBytes,
                       long downBytes) {
            this.accepted = accepted;
            this.rejected = rejected;
            this.httpFailures = httpFailures;
            this.socksFailures = socksFailures;
            this.upBytes = upBytes;
            this.downBytes = downBytes;
        }
    }

    void setListener(@Nullable BridgeListener listener) {
        this.listener = listener;
    }

    void setSocketProtector(@Nullable SocketProtector protector) {
        this.socketProtector = protector;
    }

    BridgeSnapshot getSnapshot() {
        return new BridgeSnapshot(
                acceptedClients.get(),
                rejectedClients.get(),
                httpFailures.get(),
                socksFailures.get(),
                totalUpBytes.get(),
                totalDownBytes.get()
        );
    }

    private void notifyAccepted(SocksRequest request) {
        BridgeListener l = listener;
        if (l != null) {
            l.onClientAccepted(request);
        }
    }

    private void notifyRejected(String reason) {
        BridgeListener l = listener;
        if (l != null) {
            l.onClientRejected(reason);
        }
    }

    private void notifyHttpSuccess(SocksRequest request) {
        BridgeListener l = listener;
        if (l != null) {
            l.onHttpConnectSuccess(request);
        }
    }

    private void notifyHttpFailure(@Nullable SocksRequest request, String reason) {
        BridgeListener l = listener;
        if (l == null) {
            return;
        }
        if (request != null) {
            l.onHttpConnectFailure(request, reason);
        } else {
            l.onClientRejected(reason);
        }
    }

    private void notifyClosed(SocksRequest request, long durationMs, long upBytes, long downBytes) {
        BridgeListener l = listener;
        if (l != null) {
            l.onClientClosed(request, durationMs, upBytes, downBytes);
        }
    }

    private void resetMetrics() {
        acceptedClients.set(0);
        rejectedClients.set(0);
        httpFailures.set(0);
        socksFailures.set(0);
        totalUpBytes.set(0);
        totalDownBytes.set(0);
    }

    private long safeGet(Future<Long> future) {
        try {
            Long result = future.get();
            return result != null ? result : 0L;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return 0L;
        } catch (ExecutionException e) {
            return 0L;
        }
    }
}
