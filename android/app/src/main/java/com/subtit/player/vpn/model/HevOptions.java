package com.subtit.player.vpn.model;

import java.io.Serializable;
import java.util.Objects;

/**
 * Набор опций для генерации конфигурации hev-socks5-tunnel.
 * Позволяет гибко управлять маршурутизацией DNS, размерами стека и режимами UDP.
 */
public final class HevOptions implements Serializable {

    private final int taskStackSize;
    private final boolean udpInTcp;
    private final String socksUdpAddress;
    private final boolean mapDnsEnabled;
    private final String mapDnsAddress;
    private final int mapDnsPort;
    private final String mapDnsNetwork;
    private final String mapDnsNetmask;
    private final int mapDnsCacheSize;

    private HevOptions(Builder builder) {
        this.taskStackSize = builder.taskStackSize;
        this.udpInTcp = builder.udpInTcp;
        this.socksUdpAddress = builder.socksUdpAddress;
        this.mapDnsEnabled = builder.mapDnsEnabled;
        this.mapDnsAddress = builder.mapDnsAddress;
        this.mapDnsPort = builder.mapDnsPort;
        this.mapDnsNetwork = builder.mapDnsNetwork;
        this.mapDnsNetmask = builder.mapDnsNetmask;
        this.mapDnsCacheSize = builder.mapDnsCacheSize;
    }

    public int getTaskStackSize() {
        return taskStackSize;
    }

    public boolean isUdpInTcp() {
        return udpInTcp;
    }

    public String getSocksUdpAddress() {
        return socksUdpAddress;
    }

    public boolean isMapDnsEnabled() {
        return mapDnsEnabled;
    }

    public String getMapDnsAddress() {
        return mapDnsAddress;
    }

    public int getMapDnsPort() {
        return mapDnsPort;
    }

    public String getMapDnsNetwork() {
        return mapDnsNetwork;
    }

    public String getMapDnsNetmask() {
        return mapDnsNetmask;
    }

    public int getMapDnsCacheSize() {
        return mapDnsCacheSize;
    }

    public static Builder builder() {
        return new Builder();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        HevOptions that = (HevOptions) o;
        return taskStackSize == that.taskStackSize
                && udpInTcp == that.udpInTcp
                && mapDnsEnabled == that.mapDnsEnabled
                && mapDnsPort == that.mapDnsPort
                && mapDnsCacheSize == that.mapDnsCacheSize
                && Objects.equals(socksUdpAddress, that.socksUdpAddress)
                && Objects.equals(mapDnsAddress, that.mapDnsAddress)
                && Objects.equals(mapDnsNetwork, that.mapDnsNetwork)
                && Objects.equals(mapDnsNetmask, that.mapDnsNetmask);
    }

    @Override
    public int hashCode() {
        return Objects.hash(taskStackSize, udpInTcp, socksUdpAddress, mapDnsEnabled, mapDnsAddress,
                mapDnsPort, mapDnsNetwork, mapDnsNetmask, mapDnsCacheSize);
    }

    @Override
    public String toString() {
        return "HevOptions{"
                + "taskStackSize=" + taskStackSize
                + ", udpInTcp=" + udpInTcp
                + ", socksUdpAddress='" + socksUdpAddress + '\''
                + ", mapDnsEnabled=" + mapDnsEnabled
                + ", mapDnsAddress='" + mapDnsAddress + '\''
                + ", mapDnsPort=" + mapDnsPort
                + ", mapDnsNetwork='" + mapDnsNetwork + '\''
                + ", mapDnsNetmask='" + mapDnsNetmask + '\''
                + ", mapDnsCacheSize=" + mapDnsCacheSize
                + '}';
    }

    public static final class Builder {
        private int taskStackSize = 81920;
        private boolean udpInTcp = false;
        private String socksUdpAddress = "";
        private boolean mapDnsEnabled = true;
        private String mapDnsAddress = "198.18.0.2";
        private int mapDnsPort = 53;
        private String mapDnsNetwork = "240.0.0.0";
        private String mapDnsNetmask = "240.0.0.0";
        private int mapDnsCacheSize = 10_000;

        private Builder() {
        }

        public Builder taskStackSize(int value) {
            this.taskStackSize = value;
            return this;
        }

        public Builder udpInTcp(boolean value) {
            this.udpInTcp = value;
            return this;
        }

        public Builder socksUdpAddress(String value) {
            this.socksUdpAddress = value != null ? value : "";
            return this;
        }

        public Builder mapDnsEnabled(boolean value) {
            this.mapDnsEnabled = value;
            return this;
        }

        public Builder mapDnsAddress(String value) {
            this.mapDnsAddress = value != null ? value : "198.18.0.2";
            return this;
        }

        public Builder mapDnsPort(int value) {
            this.mapDnsPort = value;
            return this;
        }

        public Builder mapDnsNetwork(String value) {
            this.mapDnsNetwork = value != null ? value : "240.0.0.0";
            return this;
        }

        public Builder mapDnsNetmask(String value) {
            this.mapDnsNetmask = value != null ? value : "240.0.0.0";
            return this;
        }

        public Builder mapDnsCacheSize(int value) {
            this.mapDnsCacheSize = value;
            return this;
        }

        public HevOptions build() {
            return new HevOptions(this);
        }
    }
}

