package com.subtit.player.vpn;

import androidx.annotation.Nullable;

public final class Tun2SocksBridge {

    static {
        System.loadLibrary("vpnbridge");
    }

    private Tun2SocksBridge() {
        // no-op
    }

    public static void init() {
        nativeInit();
    }

    public enum ProxyMode {
        HTTP,
        SOCKS5
    }

    public static boolean start(int tunFd,
                                String proxyHost,
                                int proxyPort,
                                ProxyMode mode,
                                @Nullable String username,
                                @Nullable String password,
                                boolean udpEnabled) {
        return nativeStart(
                tunFd,
                proxyHost,
                proxyPort,
                mode.ordinal(),
                username,
                password,
                udpEnabled
        );
    }

    public static void stop() {
        nativeStop();
    }

    public static long[] getStats() {
        long[] values = nativeGetStats();
        if (values == null || values.length < 8) {
            return new long[]{0, 0, 0, 0, 0, 0, 0, 0};
        }
        return values;
    }

    public static int getLastExitCode() {
        return nativeGetExitCode();
    }

    public static String getLastError() {
        String value = nativeGetLastError();
        return value == null ? "" : value;
    }

    private static native void nativeInit();

    private static native boolean nativeStart(int tunFd,
                                              String proxyHost,
                                              int proxyPort,
                                              int modeOrdinal,
                                              @Nullable String username,
                                              @Nullable String password,
                                              boolean enableUdp);

    private static native void nativeStop();

    private static native long[] nativeGetStats();

    private static native int nativeGetExitCode();

    @Nullable
    private static native String nativeGetLastError();
}
