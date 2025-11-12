package com.subtit.player.vpn.service;

import android.util.Log;

import com.subtit.player.vpn.model.VpnLaunchConfig;

import java.io.FileDescriptor;
import java.lang.reflect.Field;

/**
 * Thin wrapper around the tun2socks native bridge. For now the implementation is a placeholder
 * that logs intent and returns false when the native library is missing.
 *
 * The contract mimics the helpers used in v2rayNG, so wiring-in the actual JNI layer later will
 * require only replacing the internals of {@link #start(FileDescriptor, VpnLaunchConfig)}.
 */
public final class Tun2SocksBridge {

    private static final String TAG = "Tun2SocksBridge";
    private static final String LIB_NAME = "tun2socks";

    private static final Tun2SocksBridge INSTANCE = new Tun2SocksBridge();
    private final boolean nativeAvailable;

    private Tun2SocksBridge() {
        boolean loaded;
        try {
            System.loadLibrary(LIB_NAME);
            loaded = true;
            Log.i(TAG, "Loaded native library " + LIB_NAME);
        } catch (UnsatisfiedLinkError error) {
            loaded = false;
            Log.w(TAG, "Native library '" + LIB_NAME + "' is not bundled yet. " +
                    "VPN traffic will not be proxied until the binary is provided.", error);
        }
        nativeAvailable = loaded;
    }

    public static Tun2SocksBridge getInstance() {
        return INSTANCE;
    }

    public boolean start(FileDescriptor tunDescriptor, VpnLaunchConfig config) {
        if (!nativeAvailable) {
            Log.w(TAG, "start() ignored because native bridge is unavailable");
            return false;
        }
        final int fdInt = extractIntFd(tunDescriptor);
        Log.i(TAG, "Starting tun2socks with fd=" + fdInt + " socks=" + config.getSocksHost() + ":" + config.getSocksPort());
        return nativeStart(
                fdInt,
                config.getSocksHost(),
                config.getSocksPort(),
                config.getSocksUsername(),
                config.getSocksPassword());
    }

    public void stop() {
        if (!nativeAvailable) {
            Log.w(TAG, "stop() ignored because native bridge is unavailable");
            return;
        }
        nativeStop();
    }

    private static int extractIntFd(FileDescriptor descriptor) {
        try {
            Field descriptorField = FileDescriptor.class.getDeclaredField("descriptor");
            descriptorField.setAccessible(true);
            return descriptorField.getInt(descriptor);
        } catch (Exception e) {
            Log.w(TAG, "Failed to extract file descriptor int value", e);
            return -1;
        }
    }

    private native boolean nativeStart(int tunFd, String socksHost, int socksPort, String username, String password);

    private native void nativeStop();
}
