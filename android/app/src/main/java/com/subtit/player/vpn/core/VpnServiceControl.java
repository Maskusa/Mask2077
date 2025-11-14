package com.subtit.player.vpn.core;

import android.app.Service;

/**
 * Minimal contract shared between the VPN service and the libv2ray host.
 * Mirrors the behavior of v2rayNG's ServiceControl so libv2ray can resolve
 * a stable application context and request service shutdowns when needed.
 */
public interface VpnServiceControl {

    /**
     * @return the concrete {@link Service} instance that hosts the VPN stack.
     */
    Service getServiceInstance();

    /**
     * Requests a graceful stop of the running tunnel.
     */
    void requestStop();

    /**
     * Protects a socket descriptor from being captured by the VPN tunnel.
     *
     * @param socketFd native socket descriptor.
     * @return true if the socket was successfully protected.
     */
    boolean protectSocket(int socketFd);

}
