package com.subtit.player.vpn.core;

import android.content.Context;

import androidx.annotation.Nullable;

import java.io.File;
import java.lang.ref.SoftReference;

import go.Seq;
import libv2ray.Libv2ray;

/**
 * Small helper that mirrors how v2rayNG wires libv2ray into Android.
 * It keeps a soft reference to the currently running {@link VpnServiceControl}
 * so we can provide libv2ray with a stable application context (needed for
 * gomobile/asset file readers) and ensures that {@link Libv2ray#initCoreEnv}
 * is invoked exactly once per derived base key.
 */
public final class V2rayCoreManager {

    private static final Object LOCK = new Object();
    @Nullable
    private static SoftReference<VpnServiceControl> serviceRef;
    private static boolean envInitialized;
    @Nullable
    private static String lastBaseKey;

    private V2rayCoreManager() {
        // no-op
    }

    public static void registerService(VpnServiceControl control) {
        synchronized (LOCK) {
            serviceRef = new SoftReference<>(control);
            Context context = control.getServiceInstance().getApplicationContext();
            Seq.setContext(context);
            // ensure initCoreEnv will run again for this service
            envInitialized = false;
        }
    }

    public static void unregisterService(VpnServiceControl control) {
        synchronized (LOCK) {
            if (serviceRef != null) {
                VpnServiceControl current = serviceRef.get();
                if (current == control) {
                    serviceRef.clear();
                    serviceRef = null;
                }
            }
        }
    }

    public static void ensureEnvironment(Context fallbackContext, String baseKey) {
        synchronized (LOCK) {
            if (envInitialized && baseKey.equals(lastBaseKey)) {
                return;
            }
            Context context = resolveContext(fallbackContext);
            if (context == null) {
                throw new IllegalStateException("Unable to resolve context for libv2ray");
            }
            Seq.setContext(context);
            File envDir = new File(context.getFilesDir(), "xray-runtime");
            if (!envDir.exists() && !envDir.mkdirs()) {
                // best effort; libv2ray will log failure
            }
            Libv2ray.initCoreEnv(envDir.getAbsolutePath(), baseKey);
            envInitialized = true;
            lastBaseKey = baseKey;
        }
    }

    @Nullable
    public static VpnServiceControl getActiveService() {
        synchronized (LOCK) {
            return serviceRef != null ? serviceRef.get() : null;
        }
    }

    @Nullable
    private static Context resolveContext(@Nullable Context fallback) {
        VpnServiceControl control = serviceRef != null ? serviceRef.get() : null;
        if (control != null) {
            return control.getServiceInstance().getApplicationContext();
        }
        return fallback != null ? fallback.getApplicationContext() : null;
    }
}
