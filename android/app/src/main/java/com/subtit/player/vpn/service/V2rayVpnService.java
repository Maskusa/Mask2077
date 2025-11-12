package com.subtit.player.vpn.service;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import com.subtit.player.vpn.model.VpnLaunchConfig;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground VPN service that mirrors the core responsibilities of the VpnService implementation
 * from v2rayNG. At this stage it wires up the Android {@link VpnService.Builder}, exposes helper
 * start/stop intents, and connects to a {@link Tun2SocksBridge}. The actual native bridge still
 * needs to be bundled (see Tun2SocksBridge notes).
 */
public class V2rayVpnService extends VpnService {

    private static final String TAG = "V2rayVpnService";

    public static final String ACTION_START = "com.subtit.player.vpn.action.START";
    public static final String ACTION_STOP = "com.subtit.player.vpn.action.STOP";
    public static final String EXTRA_LAUNCH_CONFIG = "com.subtit.player.vpn.extra.LAUNCH_CONFIG";

    private static final int NOTIFICATION_ID = 9772;
    private static final String NOTIFICATION_CHANNEL_ID = "mask-vpn-channel";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private ParcelFileDescriptor tunInterface;
    private VpnLaunchConfig currentConfig;
    private final Tun2SocksBridge tunBridge = Tun2SocksBridge.getInstance();

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
            boolean bridgeStarted = tunBridge.start(descriptor.getFileDescriptor(), config);
            if (!bridgeStarted) {
                Log.w(TAG, "tun2socks bridge rejected start request");
                stopVpn("bridge_failure");
                return;
            }
            isRunning.set(true);
            Log.i(TAG, "VPN session established");
        } catch (Exception ex) {
            Log.e(TAG, "Failed to start VPN", ex);
            stopVpn("exception");
        }
    }

    private ParcelFileDescriptor establishInterface(VpnLaunchConfig config) throws IOException {
        Builder builder = new Builder();
        builder.setSession(!TextUtils.isEmpty(config.getSessionName())
                ? config.getSessionName()
                : "Mask2077 Tunnel");
        builder.setMtu(config.getMtu());
        builder.addAddress("10.10.10.2", 32);
        builder.addRoute("0.0.0.0", 0);
        builder.addRoute("::", 0);
        List<String> dnsServers = config.getDnsServers();
        if (dnsServers.isEmpty()) {
            builder.addDnsServer("1.1.1.1");
            builder.addDnsServer("8.8.8.8");
        } else {
            for (String dns : dnsServers) {
                try {
                    builder.addDnsServer(dns);
                } catch (IllegalArgumentException e) {
                    Log.w(TAG, "Ignoring invalid DNS address " + dns, e);
                }
            }
        }
        applyPackageRules(builder, config);
        return builder.establish();
    }

    private void applyPackageRules(Builder builder, VpnLaunchConfig config) {
        PackageManager pm = getPackageManager();
        for (String pkg : config.getAllowedApplications()) {
            try {
                pm.getPackageInfo(pkg, 0);
                builder.addAllowedApplication(pkg);
            } catch (Exception ignored) {
                Log.w(TAG, "Unable to allow package " + pkg);
            }
        }
        for (String pkg : config.getDisallowedApplications()) {
            try {
                pm.getPackageInfo(pkg, 0);
                builder.addDisallowedApplication(pkg);
            } catch (Exception ignored) {
                Log.w(TAG, "Unable to disallow package " + pkg);
            }
        }
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
        stopTunnelInternal();
        stopForeground(true);
        stopSelf();
    }

    private void stopTunnelInternal() {
        isRunning.set(false);
        tunBridge.stop();
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
}
