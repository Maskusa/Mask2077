package com.subtit.player.vpn.service;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.VpnService;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.subtit.player.R;
import com.subtit.player.vpn.core.V2rayCoreManager;
import com.subtit.player.vpn.core.VpnServiceControl;
import com.subtit.player.vpn.model.VpnLaunchConfig;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground VPN service that mirrors the core responsibilities of the VpnService implementation
 * from v2rayNG. At this stage it wires up the Android {@link VpnService.Builder}, exposes helper
 * start/stop intents, and connects to a {@link HevSocksBridge}.
 */
public class V2rayVpnService extends VpnService implements VpnServiceControl {

    private static final String TAG = "V2rayVpnService";
    private static final String FALLBACK_TUN_ADDRESS = "26.26.26.2";
    private static final int FALLBACK_TUN_PREFIX_LENGTH = 32;
    private static final int FALLBACK_TUN_MTU = 1500;
    private static final String[] FALLBACK_DNS = new String[]{"1.1.1.1", "8.8.8.8"};

    public static final String ACTION_START = "com.subtit.player.vpn.action.START";
    public static final String ACTION_STOP = "com.subtit.player.vpn.action.STOP";
    public static final String EXTRA_LAUNCH_CONFIG = "com.subtit.player.vpn.extra.LAUNCH_CONFIG";
    public static final String ACTION_STATUS = "com.subtit.player.vpn.action.STATUS";
    public static final String EXTRA_STATUS = "status";
    public static final String EXTRA_REASON = "reason";
    public static final String EXTRA_SESSION = "session";

    private static final int NOTIFICATION_ID = 9772;
    private static final String NOTIFICATION_CHANNEL_ID = "mask-vpn-channel";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private ParcelFileDescriptor tunInterface;
    private VpnLaunchConfig currentConfig;
    private final HevSocksBridge socksBridge = HevSocksBridge.getInstance();
    @Nullable
    private ConnectivityManager connectivityManager;
    @Nullable
    private ConnectivityManager.NetworkCallback underlyingNetworkCallback;
    @Nullable
    private NetworkRequest defaultNetworkRequest;
    @Nullable
    private Network boundProcessNetwork;

    @Override
    public void onCreate() {
        super.onCreate();
        V2rayCoreManager.registerService(this);
    }

    public static void start(Context context, VpnLaunchConfig config) {
        Intent intent = new Intent(context, V2rayVpnService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_LAUNCH_CONFIG, config);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, V2rayVpnService.class);
        intent.setAction(ACTION_STOP);
        ContextCompat.startForegroundService(context, intent);
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null) {
            Log.w(TAG, "onStartCommand called with null intent");
            return Service.START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            Log.i(TAG, "Stop intent received");
            stopVpn("stop_intent");
            return Service.START_NOT_STICKY;
        }
        VpnLaunchConfig config = (VpnLaunchConfig) intent.getSerializableExtra(EXTRA_LAUNCH_CONFIG);
        if (config == null) {
            Log.w(TAG, "Launch intent missing config payload");
            return Service.START_NOT_STICKY;
        }
        executor.execute(() -> startVpnInternal(config));
        return Service.START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return super.onBind(intent);
    }

    @Override
    public void onRevoke() {
        Log.w(TAG, "VPN permission revoked by the system");
        stopVpn("permission_revoked");
        super.onRevoke();
    }

    @Override
    public void onDestroy() {
        stopVpn("service_destroyed");
        executor.shutdown();
        V2rayCoreManager.unregisterService(this);
        super.onDestroy();
    }

    private void startVpnInternal(VpnLaunchConfig config) {
        if (isRunning.get()) {
            Log.i(TAG, "Tunnel already running, restarting with new config");
            stopTunnelInternal();
        }
        try {
            ParcelFileDescriptor descriptor = establishInterface(config);
            if (descriptor == null) {
                Log.e(TAG, "Builder.establish() returned null, aborting");
                return;
            }
            tunInterface = descriptor;
            currentConfig = config;
            promoteToForeground(config);
            boolean bridgeStarted = socksBridge.start(getApplicationContext(), descriptor, config);
            if (!bridgeStarted) {
                Log.w(TAG, "HevSocks bridge rejected start request");
                broadcastStatus("error", "bridge_failure", config.getSessionName());
                stopVpn("bridge_failure");
                return;
            }
            isRunning.set(true);
            Log.i(TAG, "VPN session established");
            broadcastStatus("running", null, config.getSessionName());
        } catch (Exception ex) {
            Log.e(TAG, "Failed to start VPN", ex);
            String sessionName = config != null ? config.getSessionName() : null;
            broadcastStatus("error", "exception", sessionName);
            stopVpn("exception");
        }
    }

    private ParcelFileDescriptor establishInterface(VpnLaunchConfig config) throws IOException {
        Builder builder = new Builder();
        builder.setSession(!TextUtils.isEmpty(config.getSessionName())
                ? config.getSessionName()
                : "Mask2077 Tunnel");
        int mtu = config.getMtu() > 0 ? config.getMtu() : FALLBACK_TUN_MTU;
        builder.setMtu(mtu);
        String ipv4 = !TextUtils.isEmpty(config.getTunIpv4Address())
                ? config.getTunIpv4Address()
                : FALLBACK_TUN_ADDRESS;
        int ipv4Prefix = config.getTunIpv4PrefixLength() > 0
                ? config.getTunIpv4PrefixLength()
                : FALLBACK_TUN_PREFIX_LENGTH;
        builder.addAddress(ipv4, ipv4Prefix);
        if (!TextUtils.isEmpty(config.getTunIpv6Address()) && config.getTunIpv6PrefixLength() != null) {
            builder.addAddress(config.getTunIpv6Address(), config.getTunIpv6PrefixLength());
        }
        builder.addRoute("0.0.0.0", 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.addRoute("::", 0);
        }
        List<String> dnsServers = config.getDnsServers();
        if (dnsServers != null && !dnsServers.isEmpty()) {
            addDnsServers(builder, dnsServers);
        } else {
            addDnsServers(builder, Arrays.asList(FALLBACK_DNS));
        }
        applyPerAppRules(builder, config);
        configurePlatformFeatures(builder);
        return builder.establish();
    }

    private void addDnsServers(Builder builder, List<String> addresses) {
        for (String dns : addresses) {
            if (TextUtils.isEmpty(dns)) {
                continue;
            }
            try {
                builder.addDnsServer(dns);
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "Ignoring invalid DNS address " + dns, e);
            }
        }
    }

    private void applyPerAppRules(Builder builder, VpnLaunchConfig config) {
        List<String> allowed = config.getAllowedApplications();
        List<String> disallowed = config.getDisallowedApplications();
        if (!allowed.isEmpty()) {
            Log.i(TAG, "Applying allowed application list size=" + allowed.size());
            for (String packageName : allowed) {
                addAllowedApplication(builder, packageName);
            }
            return;
        }
        if (!disallowed.isEmpty()) {
            Log.i(TAG, "Applying disallowed application list size=" + disallowed.size());
            for (String packageName : disallowed) {
                addDisallowedApplication(builder, packageName);
            }
            return;
        }
        Log.i(TAG, "No per-app rules configured; VPN will cover all applications");
    }

    private void addAllowedApplication(Builder builder, String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return;
        }
        try {
            builder.addAllowedApplication(packageName);
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(TAG, "Allowed application not found: " + packageName, e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to add allowed application: " + packageName, e);
        }
    }

    private void addDisallowedApplication(Builder builder, String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return;
        }
        try {
            builder.addDisallowedApplication(packageName);
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(TAG, "Disallowed application not found: " + packageName, e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to add disallowed application: " + packageName, e);
        }
    }

    private void configurePlatformFeatures(Builder builder) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return;
        }
        ConnectivityManager cm = ensureConnectivityManager();
        if (cm == null) {
            Log.w(TAG, "ConnectivityManager unavailable, cannot set underlying network");
            return;
        }
        if (defaultNetworkRequest == null) {
            defaultNetworkRequest = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
                    .build();
        }
        if (underlyingNetworkCallback == null) {
            underlyingNetworkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    setUnderlyingNetworksSafe(new Network[]{network});
                    bindServiceProcessNetwork(network);
                }

                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities networkCapabilities) {
                    setUnderlyingNetworksSafe(new Network[]{network});
                    bindServiceProcessNetwork(network);
                }

                @Override
                public void onLost(Network network) {
                    setUnderlyingNetworksSafe(null);
                    bindServiceProcessNetwork(null);
                }
            };
        }
        try {
            cm.requestNetwork(defaultNetworkRequest, underlyingNetworkCallback);
        } catch (SecurityException | IllegalArgumentException e) {
            Log.e(TAG, "Failed to request default network", e);
        }
    }

    private void bindServiceProcessNetwork(@Nullable Network network) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }
        if (Objects.equals(boundProcessNetwork, network)) {
            return;
        }
        ConnectivityManager cm = ensureConnectivityManager();
        if (cm == null) {
            Log.w(TAG, "Cannot bind process network: ConnectivityManager unavailable");
            return;
        }
        boolean result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            result = cm.bindProcessToNetwork(network);
        } else {
            ConnectivityManager.setProcessDefaultNetwork(network);
            result = true;
        }
        boundProcessNetwork = network;
        Log.i(TAG, "Process network bound to "
                + (network != null ? network.toString() : "null")
                + " result=" + result);
    }

    private void promoteToForeground(VpnLaunchConfig config) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannelHelper.ensureChannel(this, NOTIFICATION_CHANNEL_ID);
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                0,
                getPackageManager().getLaunchIntentForPackage(getPackageName()),
                PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(getString(R.string.vpn_notification_title))
                .setContentText(getString(R.string.vpn_notification_text, config.getSessionName()))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(contentIntent)
                .build();
        startForeground(NOTIFICATION_ID, notification);
    }

    private void stopVpn(String reason) {
        Log.i(TAG, "Stopping VPN: " + reason);
        String sessionName = currentConfig != null ? currentConfig.getSessionName() : null;
        stopTunnelInternal();
        stopForeground(true);
        broadcastStatus("stopped", reason, sessionName);
        stopSelf();
    }

    private void stopTunnelInternal() {
        isRunning.set(false);
        socksBridge.stop();
        releasePlatformFeatures();
        if (tunInterface != null) {
            try {
                tunInterface.close();
            } catch (IOException e) {
                Log.w(TAG, "Unable to close TUN interface", e);
            }
            tunInterface = null;
        }
        currentConfig = null;
    }

    private void broadcastStatus(String status, @Nullable String reason, @Nullable String sessionName) {
        Intent intent = new Intent(ACTION_STATUS);
        intent.putExtra(EXTRA_STATUS, status);
        if (reason != null) {
            intent.putExtra(EXTRA_REASON, reason);
        }
        if (sessionName != null) {
            intent.putExtra(EXTRA_SESSION, sessionName);
        }
        sendBroadcast(intent);
    }

    /**
     * Helper that ensures the notification channel exists on Android O+.
     */
    private static final class NotificationChannelHelper {
        private static void ensureChannel(Context context, String channelId) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                return;
            }
            android.app.NotificationManager nm =
                    ContextCompat.getSystemService(context, android.app.NotificationManager.class);
            if (nm == null) {
                return;
            }
            if (nm.getNotificationChannel(channelId) != null) {
                return;
            }
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    channelId,
                    context.getString(R.string.vpn_notification_title),
                    android.app.NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(context.getString(R.string.vpn_notification_description));
            nm.createNotificationChannel(channel);
        }
    }

    private ConnectivityManager ensureConnectivityManager() {
        if (connectivityManager == null) {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        }
        return connectivityManager;
    }

    private void releasePlatformFeatures() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ConnectivityManager cm = connectivityManager;
            if (cm != null && underlyingNetworkCallback != null) {
                try {
                    cm.unregisterNetworkCallback(underlyingNetworkCallback);
                } catch (Exception e) {
                    Log.w(TAG, "Failed to unregister network callback", e);
                }
            }
            underlyingNetworkCallback = null;
            setUnderlyingNetworksSafe(null);
        }
        bindServiceProcessNetwork(null);
    }

    private void setUnderlyingNetworksSafe(@Nullable Network[] networks) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                setUnderlyingNetworks(networks);
            } catch (Exception e) {
                Log.w(TAG, "Unable to set underlying networks", e);
            }
        }
    }

    @Override
    public Service getServiceInstance() {
        return this;
    }

    @Override
    public void requestStop() {
        stopVpn("service_control_request");
    }

    @Override
    public boolean protectSocket(int socketFd) {
        return protect(socketFd);
    }
}
