package com.subtit.player.vpn.service;

import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;
import android.util.Log;

import com.subtit.player.vpn.model.HevOptions;
import com.subtit.player.vpn.model.VpnLaunchConfig;
import com.v2ray.ang.service.TProxyService;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Wrapper around the hev-socks5-tunnel native runtime.
 */
final class HevSocksBridge {

    private static final String TAG = "HevSocksBridge";
    private static final HevSocksBridge INSTANCE = new HevSocksBridge();
    private static final AtomicBoolean LIB_LOADED = new AtomicBoolean(false);
    private static final String CONFIG_FILE_NAME = "hev-socks5-tunnel.yaml";
    private static final String DEFAULT_RW_TIMEOUT_MS = "300000";
    private static final String DEFAULT_LOG_LEVEL = "none";

    private final AtomicBoolean running = new AtomicBoolean(false);

    private HevSocksBridge() {
    }

    static HevSocksBridge getInstance() {
        return INSTANCE;
    }

    boolean start(Context context, ParcelFileDescriptor descriptor, VpnLaunchConfig config) {
        if (!ensureLibraryLoaded()) {
            Log.e(TAG, "hev-socks5-tunnel native library is unavailable");
            return false;
        }
        String configContent = buildConfig(config);
        File configFile = new File(context.getFilesDir(), CONFIG_FILE_NAME);
        try {
            persistConfig(configFile, configContent);
        } catch (IOException writeError) {
            Log.e(TAG, "Failed to write Hev config", writeError);
            return false;
        }
        try {
            Log.i(TAG, "Starting hev-socks5-tunnel via JNI");
            TProxyService.startService(configFile.getAbsolutePath(), descriptor.getFd());
            running.set(true);
            return true;
        } catch (Throwable startError) {
            Log.e(TAG, "Failed to start hev-socks5-tunnel", startError);
            return false;
        }
    }

    void stop() {
        if (!running.get()) {
            return;
        }
        try {
            TProxyService.stopService();
        } catch (Throwable stopError) {
            Log.w(TAG, "Failed to stop hev-socks5-tunnel", stopError);
        } finally {
            running.set(false);
        }
    }

    private static boolean ensureLibraryLoaded() {
        if (LIB_LOADED.get()) {
            return true;
        }
        if (!LIB_LOADED.compareAndSet(false, true)) {
            return true;
        }
        try {
            System.loadLibrary("hev-socks5-tunnel");
            Log.i(TAG, "hev-socks5-tunnel native library loaded");
            return true;
        } catch (UnsatisfiedLinkError error) {
            Log.e(TAG, "Unable to load hev-socks5-tunnel native library", error);
            LIB_LOADED.set(false);
            return false;
        }
    }

    private static String buildConfig(VpnLaunchConfig config) {
        HevOptions hev = config.getHevOptions();
        StringBuilder builder = new StringBuilder();
        builder.append("tunnel:\n");
        builder.append("  mtu: ").append(config.getMtu()).append('\n');
        builder.append("  ipv4: ").append(config.getTunIpv4Address()).append('\n');
        if (!TextUtils.isEmpty(config.getTunIpv6Address())) {
            builder.append("  ipv6: '").append(config.getTunIpv6Address()).append("'\n");
        }
        builder.append('\n');
        builder.append("socks5:\n");
        builder.append("  port: ").append(config.getSocksPort()).append('\n');
        builder.append("  address: ").append(config.getSocksHost()).append('\n');
        String udpMode = (!config.isForwardUdp() || hev.isUdpInTcp()) ? "tcp" : "udp";
        builder.append("  udp: '").append(udpMode).append("'\n");
        if (!TextUtils.isEmpty(hev.getSocksUdpAddress())) {
            builder.append("  udp-address: '").append(hev.getSocksUdpAddress()).append("'\n");
        }
        if (!TextUtils.isEmpty(config.getSocksUsername()) && !TextUtils.isEmpty(config.getSocksPassword())) {
            builder.append("  username: '").append(config.getSocksUsername()).append("'\n");
            builder.append("  password: '").append(config.getSocksPassword()).append("'\n");
        }
        builder.append('\n');
        builder.append("misc:\n");
        builder.append("  task-stack-size: ").append(hev.getTaskStackSize()).append('\n');
        builder.append("  read-write-timeout: ").append(DEFAULT_RW_TIMEOUT_MS).append('\n');
        builder.append("  log-level: ").append(DEFAULT_LOG_LEVEL).append('\n');
        if (hev.isMapDnsEnabled()) {
            builder.append('\n');
            builder.append("mapdns:\n");
            builder.append("  address: ").append(hev.getMapDnsAddress()).append('\n');
            builder.append("  port: ").append(hev.getMapDnsPort()).append('\n');
            builder.append("  network: ").append(hev.getMapDnsNetwork()).append('\n');
            builder.append("  netmask: ").append(hev.getMapDnsNetmask()).append('\n');
            builder.append("  cache-size: ").append(hev.getMapDnsCacheSize()).append('\n');
        }
        return builder.toString();
    }

    private static void persistConfig(File target, String content) throws IOException {
        if (!target.exists()) {
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("Unable to create directory " + parent);
            }
        }
        try (FileOutputStream stream = new FileOutputStream(target, false)) {
            stream.write(content.getBytes(StandardCharsets.UTF_8));
            stream.flush();
        }
    }
}
