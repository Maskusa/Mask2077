package com.subtit.player.vpn;

public class ProxyVpnConfig {
    public final String proxyHost;
    public final int httpPort;
    public final int socksPort;
    public final String username;
    public final String password;
    public final Tun2SocksBridge.ProxyMode mode;
    public final boolean enableUdp;
    public final boolean debugMode;

    public ProxyVpnConfig(String proxyHost, int httpPort, int socksPort,
                          String username, String password,
                          Tun2SocksBridge.ProxyMode mode,
                          boolean enableUdp,
                          boolean debugMode) {
        this.proxyHost = proxyHost;
        this.httpPort = httpPort;
        this.socksPort = socksPort;
        this.username = username;
        this.password = password;
        this.mode = mode;
        this.enableUdp = enableUdp;
        this.debugMode = debugMode;
    }
}
