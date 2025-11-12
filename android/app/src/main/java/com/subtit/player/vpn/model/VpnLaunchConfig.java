package com.subtit.player.vpn.model;

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

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VpnLaunchConfig that = (VpnLaunchConfig) o;
        return socksPort == that.socksPort &&
                mtu == that.mtu &&
                Objects.equals(sessionName, that.sessionName) &&
                Objects.equals(socksHost, that.socksHost) &&
                Objects.equals(socksUsername, that.socksUsername) &&
                Objects.equals(socksPassword, that.socksPassword) &&
                Objects.equals(dnsServers, that.dnsServers) &&
                Objects.equals(allowedApplications, that.allowedApplications) &&
                Objects.equals(disallowedApplications, that.disallowedApplications) &&
                Objects.equals(configJson, that.configJson);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sessionName, socksHost, socksPort, socksUsername, socksPassword, mtu,
                dnsServers, allowedApplications, disallowedApplications, configJson);
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

        public VpnLaunchConfig build() {
            return new VpnLaunchConfig(this);
        }
    }
}
