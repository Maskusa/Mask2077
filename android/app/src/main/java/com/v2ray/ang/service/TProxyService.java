package com.v2ray.ang.service;

/**
 * Заглушка для JNI-обёртки из оригинального v2rayNG.
 * Hev-socks5-tunnel при загрузке пытается зарегистрировать нативные методы
 * именно на классе {@code com.v2ray.ang.service.TProxyService}. Без реального
 * определения приложение падает при {@code System.loadLibrary}, поэтому
 * держим минимальный класс с теми же сигнатурами.
 */
public final class TProxyService {

    private TProxyService() {
        throw new AssertionError("No instances");
    }

    private static native void TProxyStartService(String configPath, int fd);

    private static native void TProxyStopService();

    private static native long[] TProxyGetStats();

    public static void startService(String configPath, int fd) {
        TProxyStartService(configPath, fd);
    }

    public static void stopService() {
        TProxyStopService();
    }

    public static long[] getStats() {
        return TProxyGetStats();
    }
}
