package com.subtit.player.vpn;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.VpnService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.system.Os;
import android.system.OsConstants;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.subtit.player.MainActivity;
import com.subtit.player.R;

import java.io.FileDescriptor;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class ProxyVpnService extends VpnService {

    private static final String TAG = "ProxyVpnService";
    public static final String ACTION_START = "com.subtit.player.vpn.START";
    public static final String ACTION_STOP = "com.subtit.player.vpn.STOP";
    public static final String ACTION_RESET_RESTARTS = "com.subtit.player.vpn.RESET_RESTARTS";

    private static final String NOTIFICATION_CHANNEL_ID = "proxy_vpn_channel";
    private static final int NOTIFICATION_ID = 2077;

    private static final long MONITOR_INTERVAL_MS = 5_000L;
    private static final long BASE_RESTART_DELAY_MS = 5_000L;
    private static final long MAX_RESTART_DELAY_MS = 60_000L;
    private static final int MAX_RESTART_ATTEMPTS = 5;

    private static final int VPN_INTERFACE_MTU = 9_000;
    private static final String LOCAL_IPV4 = "172.20.2.13";
    private static final int LOCAL_IPV4_PREFIX = 32;
    private static final String LOCAL_IPV6 = "fdff:92b5:a2c1::2";
    private static final int LOCAL_IPV6_PREFIX = 64;
    private static final String[] VPN_DNS_SERVERS = new String[]{"1.1.1.1", "8.8.8.8"};
    private static final String[] VPN_IPV4_ROUTES = new String[]{"0.0.0.0/1", "128.0.0.0/1"};
    private static final String[] VPN_IPV6_ROUTES = new String[]{"2000::/3", "fc00::/7"};
    private static final String TUN_INTERFACE_NAME = "tun0";

    private static volatile ProxyVpnService instance;
    private static volatile boolean running = false;
    private static ProxyVpnConfig activeConfig;
    private static volatile long connectedAtMillis = 0L;
    private static volatile int lastExitCode = 0;
    @Nullable
    private static volatile String lastErrorMessage = null;
    private static volatile int restartAttempts = 0;
    private static volatile long lastRestartAt = 0L;
    @Nullable
    private static volatile String lastRestartReason = null;
    private static volatile boolean globalDebugLogging = false;

    private ParcelFileDescriptor currentInterface;
    @Nullable
    private HttpProxySocksBridge httpBridge;
    private boolean foregroundActive = false;
    @Nullable
    private PolicyRoutingController routingController;
    private volatile boolean policyRoutingActive = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService monitorExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "vpn-monitor");
                t.setDaemon(true);
                return t;
            });
    private final ExecutorService routingExecutor =
            Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "vpn-routing");
                t.setDaemon(true);
                return t;
            });
    @Nullable
    private ScheduledFuture<?> monitorFuture;
    private final Object monitorLock = new Object();

    private volatile boolean manualStopRequested = false;
    private volatile boolean restartScheduled = false;
    private final HttpProxySocksBridge.BridgeListener bridgeListener = new HttpProxySocksBridge.BridgeListener() {
        @Override
        public void onClientAccepted(HttpProxySocksBridge.SocksRequest request) {
            debugLog("Bridge accepted " + request);
        }

        @Override
        public void onClientRejected(String reason) {
            debugLog("Bridge rejected: " + reason);
        }

        @Override
        public void onHttpConnectSuccess(HttpProxySocksBridge.SocksRequest request) {
            debugLog("HTTP CONNECT success " + request);
        }

        @Override
        public void onHttpConnectFailure(HttpProxySocksBridge.SocksRequest request, String reason) {
            Log.w(TAG, "HTTP CONNECT failure " + request + " reason=" + reason);
        }

        @Override
        public void onClientClosed(HttpProxySocksBridge.SocksRequest request, long durationMs, long upBytes, long downBytes) {
            debugLog("Bridge closed " + request + " duration=" + durationMs + "ms up=" + upBytes + " down=" + downBytes);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        routingController = new PolicyRoutingController(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            Log.w(TAG, "Received empty intent");
            return START_NOT_STICKY;
        }
        switch (intent.getAction()) {
            case ACTION_START:
                mainHandler.post(this::startVpn);
                break;
            case ACTION_STOP:
                mainHandler.post(this::stopVpn);
                break;
            case ACTION_RESET_RESTARTS:
                restartAttempts = 0;
                lastRestartReason = null;
                lastRestartAt = 0L;
                break;
            default:
                Log.w(TAG, "Unknown action " + intent.getAction());
                break;
        }
        return START_STICKY;
    }

    @Override
    public void onRevoke() {
        super.onRevoke();
        stopVpn();
    }

    @Override
    public void onDestroy() {
        stopVpn();
        cancelMonitor();
        monitorExecutor.shutdownNow();
        if (instance == this) {
            instance = null;
        }
        routingExecutor.shutdownNow();
        super.onDestroy();
    }

    private void startVpn() {
        if (currentInterface != null) {
            Log.i(TAG, "VPN already running");
            return;
        }
        ProxyVpnConfig config = ProxyVpnManager.getConfig();
        if (config == null) {
            Log.e(TAG, "No VPN config provided");
            stopSelf();
            return;
        }
        Log.i(TAG, "Starting VPN config host=" + config.proxyHost
                + " mode=" + config.mode
                + " httpPort=" + config.httpPort
                + " socksPort=" + config.socksPort
                + " udp=" + config.enableUdp
                + " debug=" + config.debugMode
                + " globalDebug=" + globalDebugLogging);
        debugLog("startVpn invoked manualStop=" + manualStopRequested);

        manualStopRequested = false;
        restartScheduled = false;
        lastExitCode = 0;
        lastErrorMessage = null;

        showOrUpdateNotification(
                "VPN: connecting " + config.proxyHost + ":" +
                        (config.mode == Tun2SocksBridge.ProxyMode.HTTP ? config.httpPort : config.socksPort),
                true
        );

        Builder builder = new Builder();
        applyInterfaceProfile(builder);
        try {
            currentInterface = builder.establish();
        } catch (Exception e) {
            Log.e(TAG, "Failed to establish VPN interface", e);
            currentInterface = null;
        }
        if (currentInterface == null) {
            showOrUpdateNotification("VPN error: cannot open TUN", false);
            stopSelf();
            return;
        }
        Log.i(TAG, "VPN interface established fd=" + currentInterface.getFd());
        applyPolicyRoutingAsync();

        Tun2SocksBridge.init();

        String targetHost = config.proxyHost;
        int targetPort = config.mode == Tun2SocksBridge.ProxyMode.HTTP ? config.httpPort : config.socksPort;
        boolean enableUdp = config.enableUdp;
        String socksUsername = config.username;
        String socksPassword = config.password;

        if (config.mode == Tun2SocksBridge.ProxyMode.HTTP) {
            HttpProxySocksBridge bridge = new HttpProxySocksBridge(
                    config.proxyHost,
                    config.httpPort,
                    config.username,
                    config.password
            );
            bridge.setSocketProtector(socket -> {
                debugLog("Protecting upstream HTTP bridge socket");
                boolean protectedOk = false;
                try {
                    protectedOk = protect(socket);
                } catch (Throwable t) {
                    Log.w(TAG, "protect(Socket) threw", t);
                }
                if (!protectedOk) {
                    try {
                        int rawFd = resolveSocketFd(socket);
                        if (rawFd >= 0) {
                            protectedOk = protect(rawFd);
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "protect(fd) failed", t);
                    }
                }
                if (!protectedOk) {
                    Log.w(TAG, "Socket protector could not exclude upstream socket from VPN");
                }
                return protectedOk;
            });
            bridge.setListener(bridgeListener);
            if (!bridge.start()) {
                Log.e(TAG, "Failed to start HTTP bridge");
                lastExitCode = -10;
                lastErrorMessage = "HTTP bridge start failed";
                cleanupVpn(false);
                scheduleRestart(lastExitCode, lastErrorMessage);
                return;
            }
            httpBridge = bridge;
            targetHost = "127.0.0.1";
            targetPort = bridge.getLocalPort();
            enableUdp = false;
            socksUsername = null;
            socksPassword = null;
            Log.i(TAG, "HTTP bridge active on port " + targetPort);
            debugLog("HTTP bridge rewired targetHost=127.0.0.1 port=" + targetPort);
        }

        boolean started = Tun2SocksBridge.start(
                currentInterface.getFd(),
                targetHost,
                targetPort,
                config.mode,
                socksUsername,
                socksPassword,
                enableUdp
        );
        Log.i(TAG, "tun2socks start result=" + started);
        debugLog("Tun2SocksBridge.start fd=" + currentInterface.getFd()
                + " target=" + targetHost + ":" + targetPort
                + " mode=" + config.mode
                + " udp=" + enableUdp);
        if (!started) {
            Log.e(TAG, "Unable to start tunnel");
            captureExitStatus();
            cleanupVpn(false);
            scheduleRestart(lastExitCode, lastErrorMessage);
            return;
        }

        activeConfig = config;
        running = true;
        connectedAtMillis = System.currentTimeMillis();
        restartAttempts = 0;
        startMonitor();
        showOrUpdateNotification(
                "VPN active: " + config.proxyHost + ":" + targetPort + " (" + config.mode.name() + ")",
                true
        );
        Log.i(TAG, "VPN started host=" + config.proxyHost
                + " mode=" + config.mode
                + " http=" + config.httpPort
                + " socks=" + config.socksPort);
        debugLog("running=true connectedAt=" + connectedAtMillis);
    }

    private static int resolveSocketFd(java.net.Socket socket) throws Exception {
        Method getFdMethod = socket.getClass().getDeclaredMethod("getFileDescriptor$");
        getFdMethod.setAccessible(true);
        FileDescriptor fdObj = (FileDescriptor) getFdMethod.invoke(socket);
        if (fdObj == null) {
            return -1;
        }
        Field descriptorField = FileDescriptor.class.getDeclaredField("descriptor");
        descriptorField.setAccessible(true);
        return descriptorField.getInt(fdObj);
    }

    private void applyInterfaceProfile(Builder builder) {
        builder.setSession("3proxy-vpn")
                .setMtu(VPN_INTERFACE_MTU);

        try {
            builder.addAddress(LOCAL_IPV4, LOCAL_IPV4_PREFIX);
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "Failed to add IPv4 address", e);
        }
        try {
            builder.addAddress(LOCAL_IPV6, LOCAL_IPV6_PREFIX);
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "Failed to add IPv6 address", e);
        }

        for (String dns : VPN_DNS_SERVERS) {
            try {
                builder.addDnsServer(dns);
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "Failed to add DNS server " + dns, e);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                builder.allowFamily(OsConstants.AF_INET);
                builder.allowFamily(OsConstants.AF_INET6);
            } catch (IllegalArgumentException | UnsupportedOperationException e) {
                Log.w(TAG, "allowFamily not supported on this API level", e);
            }
        }

        addRoutes(builder, VPN_IPV4_ROUTES);
        addRoutes(builder, VPN_IPV6_ROUTES);
        debugLog("Interface profile mtu=" + VPN_INTERFACE_MTU
                + " v4=" + LOCAL_IPV4 + "/" + LOCAL_IPV4_PREFIX
                + " v6=" + LOCAL_IPV6 + "/" + LOCAL_IPV6_PREFIX);
    }

    private void addRoutes(Builder builder, String[] routes) {
        for (String descriptor : routes) {
            if (descriptor == null || !descriptor.contains("/")) {
                continue;
            }
            String[] parts = descriptor.split("/");
            if (parts.length != 2) {
                continue;
            }
            try {
                int prefix = Integer.parseInt(parts[1]);
                builder.addRoute(parts[0], prefix);
            } catch (Exception e) {
                Log.w(TAG, "Failed to add route " + descriptor, e);
            }
        }
    }

    private void stopVpn() {
        Log.i(TAG, "stopVpn requested running=" + running);
        HttpProxySocksBridge bridge = httpBridge;
        if (bridge != null) {
            bridge.markStopping();
        }
        manualStopRequested = true;
        restartScheduled = false;
        Tun2SocksBridge.stop();
        captureExitStatus();
        cleanupVpn(true);
        restartAttempts = 0;
        manualStopRequested = false;
        Log.i(TAG, "stopVpn completed");
        stopSelf();
    }

    private void startMonitor() {
        synchronized (monitorLock) {
            if (monitorFuture != null && !monitorFuture.isCancelled()) {
                return;
            }
            monitorFuture = monitorExecutor.scheduleAtFixedRate(() -> {
                try {
                    monitorTunnel();
                } catch (Exception e) {
                    Log.w(TAG, "Tunnel monitor failed", e);
                }
            }, MONITOR_INTERVAL_MS, MONITOR_INTERVAL_MS, TimeUnit.MILLISECONDS);
            Log.d(TAG, "Monitor scheduled every " + MONITOR_INTERVAL_MS + "ms");
        }
    }

    private void cancelMonitor() {
        synchronized (monitorLock) {
            if (monitorFuture != null) {
                monitorFuture.cancel(true);
                monitorFuture = null;
            }
        }
    }

    private void monitorTunnel() {
        if (!running) {
            return;
        }
        long[] stats = Tun2SocksBridge.getStats();
        if (stats == null || stats.length < 8) {
            return;
        }
        boolean nativeRunning = stats[6] == 1;
        if (!nativeRunning) {
            int exitCode = (int) stats[7];
            String error = Tun2SocksBridge.getLastError();
            handleTunnelCrash(exitCode, error);
        }
    }

    private void handleTunnelCrash(int exitCode, String error) {
        if (!running) {
            return;
        }
        Log.e(TAG, "Tunnel crashed exitCode=" + exitCode + " error=" + error);
        captureExitStatus();
        cleanupVpn(false);
        if (manualStopRequested) {
            stopForegroundSafe();
            return;
        }
        scheduleRestart(exitCode, error);
    }

    private void cleanupVpn(boolean stopForeground) {
        Log.i(TAG, "cleanupVpn stopForeground=" + stopForeground);
        debugLog("cleanupVpn begin running=" + running + " stopForeground=" + stopForeground);
        running = false;
        cancelMonitor();

        if (httpBridge != null) {
            HttpProxySocksBridge.BridgeSnapshot snapshot = httpBridge.getSnapshot();
            Log.i(TAG, "Bridge stats accepted=" + snapshot.accepted
                    + " rejected=" + snapshot.rejected
                    + " httpFailures=" + snapshot.httpFailures
                    + " socksFailures=" + snapshot.socksFailures
                    + " upBytes=" + snapshot.upBytes
                    + " downBytes=" + snapshot.downBytes);
            httpBridge.stop();
            httpBridge = null;
        }

        if (currentInterface != null) {
            try {
                currentInterface.close();
            } catch (IOException e) {
                Log.w(TAG, "Failed to close interface", e);
            }
            currentInterface = null;
        }
        teardownPolicyRoutingAsync();

        activeConfig = null;
        connectedAtMillis = 0L;

        if (stopForeground) {
            stopForegroundSafe();
        }
        Log.i(TAG, "cleanupVpn complete");
        debugLog("cleanupVpn finished");
    }

    private void scheduleRestart(int exitCode, @Nullable String error) {
        debugLog("scheduleRestart requested exitCode=" + exitCode + " error=" + error);
        if (manualStopRequested) {
            return;
        }
        if (!ProxyVpnManager.wasStartRequested()) {
            showOrUpdateNotification("VPN stopped (code " + exitCode + ")", false);
            return;
        }
        if (restartScheduled) {
            return;
        }
        if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
            showOrUpdateNotification("VPN stopped (code " + exitCode + "). Attempts exhausted.", false);
            restartScheduled = false;
            return;
        }

        long delay = (long) (BASE_RESTART_DELAY_MS * Math.pow(2, restartAttempts));
        delay = Math.min(delay, MAX_RESTART_DELAY_MS);
        restartAttempts++;
        restartScheduled = true;

        long seconds = Math.max(1, TimeUnit.MILLISECONDS.toSeconds(delay));
        String reason = (error != null && !error.isEmpty()) ? error : ("code " + exitCode);
        showOrUpdateNotification("VPN reconnect in " + seconds + "s (" + reason + ")", true);
        Log.w(TAG, "Scheduling restart attempt=" + restartAttempts + " delayMs=" + delay + " reason=" + reason);

        long scheduledAt = System.currentTimeMillis() + delay;
        lastRestartAt = scheduledAt;
        lastRestartReason = reason;
        monitorExecutor.schedule(() -> {
            restartScheduled = false;
            if (!ProxyVpnManager.wasStartRequested()) {
                debugLog("Restart aborted because start not requested anymore");
                return;
            }
            mainHandler.post(this::startVpn);
        }, delay, TimeUnit.MILLISECONDS);
    }

    public static boolean isRunning() {
        return running;
    }

    public static boolean protectSocket(Socket socket) {
        if (socket == null) {
            return true;
        }
        ProxyVpnService service = instance;
        if (service == null) {
            // Сервис ещё не поднят – защищать нечего
            return true;
        }
        try {
            boolean result = service.protect(socket);
            if (!result) {
                Log.w(TAG, "protectSocket returned false");
            } else if (isDebugLoggingEnabled()) {
                Log.d(TAG, "protectSocket succeeded for " + socket);
            }
            return result || !running;
        } catch (Throwable t) {
            Log.w(TAG, "protectSocket failed", t);
            return !running;
        }
    }

    @Nullable
    public static ProxyVpnConfig getActiveConfig() {
        return activeConfig;
    }

    @Nullable
    public static VpnStats getStats() {
        if (!running) {
            return null;
        }

        long[] raw = Tun2SocksBridge.getStats();
        if (raw == null || raw.length < 8) {
            raw = new long[]{0, 0, 0, 0, 0, connectedAtMillis, running ? 1 : 0, lastExitCode};
        }

        long txPackets = raw[0];
        long txBytes = raw[1];
        long rxPackets = raw[2];
        long rxBytes = raw[3];
        long uptimeMs = raw[4];
        long startedAt = raw[5] > 0 ? raw[5] : connectedAtMillis;
        boolean nativeRunning = raw[6] == 1;
        int exitCode = (int) raw[7];

        if (!nativeRunning) {
            lastExitCode = exitCode;
            String err = Tun2SocksBridge.getLastError();
            lastErrorMessage = err.isEmpty() ? lastErrorMessage : err;
        }

        if (startedAt <= 0) {
            startedAt = connectedAtMillis > 0 ? connectedAtMillis : System.currentTimeMillis();
        }
        if (uptimeMs <= 0 && startedAt > 0) {
            uptimeMs = Math.max(0, System.currentTimeMillis() - startedAt);
        }

        return new VpnStats(txPackets, txBytes, rxPackets, rxBytes, startedAt, uptimeMs, exitCode, nativeRunning,
                restartAttempts, lastRestartAt, lastRestartReason);
    }

    public static int getLastExitCode() {
        return lastExitCode;
    }

    @Nullable
    public static String getLastError() {
        return lastErrorMessage;
    }

    public static void setGlobalDebugLogging(boolean enabled) {
        globalDebugLogging = enabled;
        Log.i(TAG, "Global debug logging " + (enabled ? "enabled" : "disabled"));
    }

    private static boolean isDebugLoggingEnabled() {
        ProxyVpnConfig config = activeConfig;
        return globalDebugLogging || (config != null && config.debugMode);
    }

    private static void debugLog(String message) {
        if (isDebugLoggingEnabled()) {
            Log.d(TAG, "[debug] " + message);
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) {
                return;
            }
            NotificationChannel existing = manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                        NOTIFICATION_CHANNEL_ID,
                        "Proxy VPN",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Notifications about VPN tunnel state");
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String message, boolean ongoing) {
        ensureNotificationChannel();
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT
        );

        int icon = getApplicationInfo().icon != 0
                ? getApplicationInfo().icon
                : android.R.drawable.sym_def_app_icon;

        return new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(icon)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(message)
                .setOngoing(ongoing)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pendingIntent)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void showOrUpdateNotification(String message, boolean ongoing) {
        Notification notification = buildNotification(message, ongoing);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (!foregroundActive) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foregroundActive = true;
        } else if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    private void stopForegroundSafe() {
        if (!foregroundActive) {
            return;
        }
        stopForeground(true);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }
        foregroundActive = false;
    }

    private void applyPolicyRoutingAsync() {
        PolicyRoutingController controller = routingController;
        if (controller == null) {
            return;
        }
        routingExecutor.execute(() -> {
            boolean ok = controller.apply(TUN_INTERFACE_NAME);
            policyRoutingActive = ok;
            if (ok) {
                Log.i(TAG, "Policy routing applied to " + TUN_INTERFACE_NAME);
            } else {
                Log.w(TAG, "Failed to apply policy routing");
                if (controller.hasFatalPermissionIssue()) {
                    Log.w(TAG, "SELinux заблокировал команды ip (нет root). Policy routing отключен до получения привилегий.");
                }
            }
        });
    }

    private void teardownPolicyRoutingAsync() {
        PolicyRoutingController controller = routingController;
        if (controller == null) {
            return;
        }
        routingExecutor.execute(() -> {
            boolean cleared = controller.clear();
            policyRoutingActive = !cleared;
            if (cleared) {
                Log.i(TAG, "Policy routing cleared");
            } else {
                Log.w(TAG, "Failed to clear policy routing");
            }
        });
    }

    private void captureExitStatus() {
        int code = Tun2SocksBridge.getLastExitCode();
        if (code != 0 || lastExitCode == 0) {
            lastExitCode = code;
        }
        String err = Tun2SocksBridge.getLastError();
        if (!err.isEmpty()) {
            lastErrorMessage = err;
        } else if (lastExitCode == 0) {
            lastErrorMessage = null;
        }
    }

    public static final class VpnStats {
        public final long txPackets;
        public final long txBytes;
        public final long rxPackets;
        public final long rxBytes;
        public final long startedAt;
        public final long uptimeMs;
        public final int exitCode;
        public final boolean nativeRunning;
        public final int restartAttempts;
        public final long lastRestartAt;
        @Nullable
        public final String lastRestartReason;

        private VpnStats(long txPackets,
                         long txBytes,
                         long rxPackets,
                         long rxBytes,
                         long startedAt,
                         long uptimeMs,
                         int exitCode,
                         boolean nativeRunning,
                         int restartAttempts,
                         long lastRestartAt,
                         @Nullable String lastRestartReason) {
            this.txPackets = txPackets;
            this.txBytes = txBytes;
            this.rxPackets = rxPackets;
            this.rxBytes = rxBytes;
            this.startedAt = startedAt;
            this.uptimeMs = uptimeMs;
            this.exitCode = exitCode;
            this.nativeRunning = nativeRunning;
            this.restartAttempts = restartAttempts;
            this.lastRestartAt = lastRestartAt;
            this.lastRestartReason = lastRestartReason;
        }
    }
}
