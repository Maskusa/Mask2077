package com.subtit.player.vpn.model;

import androidx.annotation.Nullable;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Immutable configuration payload describing how the native VPN stack should be launched.
 * Mirrors a subset of the data models used in v2rayNG, but trimmed to the needs of this project.
 */
public final class VpnLaunchConfig implements Serializable {

    private final String sessionName;
    private final String socksHost;
    private final int socksPort;
    private final String socksUsername;
    private final String socksPassword;
    private final int mtu;
    private final List<String> dnsServers;
    private final List<String> allowedApplications;
    private final List<String> disallowedApplications;
    private final String configJson;
    private final String tunIpv4Address;
    private final int tunIpv4PrefixLength;
    private final String tunNetmask;
    @Nullable
    private final String tunIpv6Address;
    @Nullable
    private final Integer tunIpv6PrefixLength;
    private final boolean forwardUdp;
    private final HevOptions hevOptions;

    private VpnLaunchConfig(Builder builder) {
        this.sessionName = builder.sessionName;
        this.socksHost = builder.socksHost;
        this.socksPort = builder.socksPort;
        this.socksUsername = builder.socksUsername;
        this.socksPassword = builder.socksPassword;
        this.mtu = builder.mtu;
        this.dnsServers = Collections.unmodifiableList(new ArrayList<>(builder.dnsServers));
        this.allowedApplications = Collections.unmodifiableList(new ArrayList<>(builder.allowedApplications));
        this.disallowedApplications = Collections.unmodifiableList(new ArrayList<>(builder.disallowedApplications));
        this.configJson = builder.configJson;
        this.tunIpv4Address = builder.tunIpv4Address;
        this.tunIpv4PrefixLength = builder.tunIpv4PrefixLength;
        this.tunNetmask = builder.tunNetmask;
        this.tunIpv6Address = builder.tunIpv6Address;
        this.tunIpv6PrefixLength = builder.tunIpv6PrefixLength;
        this.forwardUdp = builder.forwardUdp;
        this.hevOptions = builder.hevOptions;
    }

    public String getSessionName() {
        return sessionName;
    }

    public String getSocksHost() {
        return socksHost;
    }

    public int getSocksPort() {
        return socksPort;
    }

    public String getSocksUsername() {
        return socksUsername;
    }

    public String getSocksPassword() {
        return socksPassword;
    }

    public int getMtu() {
        return mtu;
    }

    public List<String> getDnsServers() {
        return dnsServers;
    }

    public List<String> getAllowedApplications() {
        return allowedApplications;
    }

    public List<String> getDisallowedApplications() {
        return disallowedApplications;
    }

    public String getConfigJson() {
        return configJson;
    }

    public String getTunIpv4Address() {
        return tunIpv4Address;
    }

    public int getTunIpv4PrefixLength() {
        return tunIpv4PrefixLength;
    }

    public String getTunNetmask() {
        return tunNetmask;
    }

    @Nullable
    public String getTunIpv6Address() {
        return tunIpv6Address;
    }

    @Nullable
    public Integer getTunIpv6PrefixLength() {
        return tunIpv6PrefixLength;
    }

    public boolean isForwardUdp() {
        return forwardUdp;
    }

    public HevOptions getHevOptions() {
        return hevOptions;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VpnLaunchConfig that = (VpnLaunchConfig) o;
        return socksPort == that.socksPort &&
                mtu == that.mtu &&
                forwardUdp == that.forwardUdp &&
                Objects.equals(sessionName, that.sessionName) &&
                Objects.equals(socksHost, that.socksHost) &&
                Objects.equals(socksUsername, that.socksUsername) &&
                Objects.equals(socksPassword, that.socksPassword) &&
                Objects.equals(dnsServers, that.dnsServers) &&
                Objects.equals(allowedApplications, that.allowedApplications) &&
                Objects.equals(disallowedApplications, that.disallowedApplications) &&
                Objects.equals(configJson, that.configJson) &&
                Objects.equals(tunIpv4Address, that.tunIpv4Address) &&
                Objects.equals(tunNetmask, that.tunNetmask) &&
                Objects.equals(tunIpv6Address, that.tunIpv6Address) &&
                Objects.equals(tunIpv6PrefixLength, that.tunIpv6PrefixLength) &&
                Objects.equals(hevOptions, that.hevOptions);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sessionName, socksHost, socksPort, socksUsername, socksPassword, mtu,
                dnsServers, allowedApplications, disallowedApplications, configJson,
                tunIpv4Address, tunIpv4PrefixLength, tunNetmask, tunIpv6Address, tunIpv6PrefixLength,
                forwardUdp, hevOptions);
    }

    @Override
    public String toString() {
        return "VpnLaunchConfig{" +
                "sessionName='" + sessionName + '\'' +
                ", socksHost='" + socksHost + '\'' +
                ", socksPort=" + socksPort +
                ", mtu=" + mtu +
                '}';
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String sessionName = "Mask2077";
        private String socksHost = "127.0.0.1";
        private int socksPort = 10808;
        private String socksUsername = "";
        private String socksPassword = "";
        private int mtu = 1500;
        private final List<String> dnsServers = new ArrayList<>();
        private final List<String> allowedApplications = new ArrayList<>();
        private final List<String> disallowedApplications = new ArrayList<>();
        private String configJson = "";
        private String tunIpv4Address = "26.26.26.2";
        private int tunIpv4PrefixLength = 32;
        private String tunNetmask = "255.255.255.255";
        @Nullable
        private String tunIpv6Address = null;
        @Nullable
        private Integer tunIpv6PrefixLength = null;
        private boolean forwardUdp = true;
        private HevOptions hevOptions = HevOptions.builder().build();

        private Builder() {
            dnsServers.add("1.1.1.1");
            dnsServers.add("8.8.8.8");
        }

        public Builder sessionName(String value) {
            this.sessionName = value;
            return this;
        }

        public Builder socksHost(String value) {
            this.socksHost = value;
            return this;
        }

        public Builder socksPort(int value) {
            this.socksPort = value;
            return this;
        }

        public Builder socksUsername(String value) {
            this.socksUsername = value;
            return this;
        }

        public Builder socksPassword(String value) {
            this.socksPassword = value;
            return this;
        }

        public Builder mtu(int value) {
            this.mtu = value;
            return this;
        }

        public Builder dnsServers(List<String> values) {
            this.dnsServers.clear();
            if (values != null) {
                this.dnsServers.addAll(values);
            }
            return this;
        }

        public Builder allowedApplications(List<String> values) {
            this.allowedApplications.clear();
            if (values != null) {
                this.allowedApplications.addAll(values);
            }
            return this;
        }

        public Builder disallowedApplications(List<String> values) {
            this.disallowedApplications.clear();
            if (values != null) {
                this.disallowedApplications.addAll(values);
            }
            return this;
        }

        public Builder configJson(String value) {
            this.configJson = value;
            return this;
        }

        public Builder tunIpv4(String address, int prefixLength) {
            this.tunIpv4Address = address;
            this.tunIpv4PrefixLength = prefixLength;
            this.tunNetmask = prefixToNetmask(prefixLength);
            return this;
        }

        public Builder tunNetmask(String netmask) {
            this.tunNetmask = netmask;
            return this;
        }

        public Builder tunIpv6(@Nullable String address, @Nullable Integer prefixLength) {
            this.tunIpv6Address = address;
            this.tunIpv6PrefixLength = prefixLength;
            return this;
        }

        public Builder forwardUdp(boolean value) {
            this.forwardUdp = value;
            return this;
        }

        public Builder hevOptions(HevOptions value) {
            if (value != null) {
                this.hevOptions = value;
            }
            return this;
        }

        public VpnLaunchConfig build() {
            return new VpnLaunchConfig(this);
        }

        private static String prefixToNetmask(int prefixLength) {
            if (prefixLength <= 0) {
                return "0.0.0.0";
            }
            int mask = (int) (0xFFFFFFFFL << (32 - prefixLength));
            int a = (mask >>> 24) & 0xFF;
            int b = (mask >>> 16) & 0xFF;
            int c = (mask >>> 8) & 0xFF;
            int d = mask & 0xFF;
            return a + "." + b + "." + c + "." + d;
        }
    }
}
