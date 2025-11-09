package com.subtit.player.vpn;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;

import androidx.annotation.Nullable;

public class ProxyVpnManager {

    private static ProxyVpnConfig currentConfig;
    private static boolean requestedStart = false;

    private ProxyVpnManager() {
    }

    public static boolean isPermissionGranted(Context context) {
        return VpnService.prepare(context) == null;
    }

    @Nullable
    public static Intent buildPermissionIntent(Context context) {
        return VpnService.prepare(context);
    }

    public static Intent buildStartIntent(Context context) {
        Intent intent = new Intent(context, ProxyVpnService.class);
        intent.setAction(ProxyVpnService.ACTION_START);
        return intent;
    }

    public static Intent buildStopIntent(Context context) {
        Intent intent = new Intent(context, ProxyVpnService.class);
        intent.setAction(ProxyVpnService.ACTION_STOP);
        return intent;
    }

    public static void requestPermission(Activity activity, int requestCode) {
        Intent intent = buildPermissionIntent(activity);
        if (intent != null) {
            activity.startActivityForResult(intent, requestCode);
        }
    }

    public static void setConfig(ProxyVpnConfig config) {
        currentConfig = config;
    }

    @Nullable
    public static ProxyVpnConfig getConfig() {
        return currentConfig;
    }

    public static void markRequestedStart(boolean value) {
        requestedStart = value;
    }

    public static boolean wasStartRequested() {
        return requestedStart;
    }
}
