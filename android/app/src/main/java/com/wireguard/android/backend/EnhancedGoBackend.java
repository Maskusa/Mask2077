/*
 * Copyright © 2017-2025 WireGuard LLC. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Derived from GoBackend.java in the official WireGuard Android client.
 */
package com.wireguard.android.backend;

import android.content.Context;
import android.content.Intent;
import android.net.Network;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.system.OsConstants;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.collection.ArraySet;

import com.wireguard.android.backend.BackendException.Reason;
import com.wireguard.android.backend.Tunnel.State;
import com.wireguard.android.util.SharedLibraryLoader;
import com.wireguard.config.Config;
import com.wireguard.config.InetEndpoint;
import com.wireguard.config.InetNetwork;
import com.wireguard.config.Peer;
import com.wireguard.crypto.Key;
import com.wireguard.crypto.KeyFormatException;
import com.wireguard.util.NonNullForAll;

import java.net.InetAddress;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@NonNullForAll
public final class EnhancedGoBackend implements Backend {
    private static final int DNS_RESOLUTION_RETRIES = 10;
    private static final String TAG = "Mask/EnhancedGoBackend";
    @Nullable private static AlwaysOnCallback alwaysOnCallback;
    private static CompletableFuture<VpnService> vpnService = new CompletableFuture<>();
    private final Context context;
    @Nullable private Config currentConfig;
    @Nullable private Tunnel currentTunnel;
    private int currentTunnelHandle = -1;
    @Nullable private volatile Network[] preferredUnderlyingNetworks;

    public EnhancedGoBackend(final Context context) {
        SharedLibraryLoader.loadSharedLibrary(context, "wg-go");
        this.context = context;
    }

    public static void setAlwaysOnCallback(final AlwaysOnCallback cb) {
        alwaysOnCallback = cb;
    }

    public void setPreferredUnderlyingNetworks(@Nullable final Network[] networks) {
        if (networks == null || networks.length == 0) {
            preferredUnderlyingNetworks = null;
        } else {
            preferredUnderlyingNetworks = networks.clone();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && vpnService.isDone()) {
            try {
                final VpnService service = vpnService.getNow(null);
                if (service != null) {
                    service.setUnderlyingNetworks(preferredUnderlyingNetworks);
                }
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public Set<String> getRunningTunnelNames() {
        if (currentTunnel != null) {
            final Set<String> runningTunnels = new ArraySet<>();
            runningTunnels.add(currentTunnel.getName());
            return runningTunnels;
        }
        return Collections.emptySet();
    }

    @Override
    public State getState(final Tunnel tunnel) {
        return currentTunnel == tunnel ? State.UP : State.DOWN;
    }

    @Override
    public Statistics getStatistics(final Tunnel tunnel) {
        final Statistics stats = new Statistics();
        if (tunnel != currentTunnel || currentTunnelHandle == -1)
            return stats;
        final String config = wgGetConfig(currentTunnelHandle);
        if (config == null)
            return stats;
        Key key = null;
        long rx = 0;
        long tx = 0;
        long latestHandshakeMSec = 0;
        for (final String line : config.split("\\n")) {
            if (line.startsWith("public_key=")) {
                try {
                    key = Key.fromBase64(line.substring(11));
                } catch (final KeyFormatException ignored) {
                }
            } else if (line.startsWith("rx_bytes=")) {
                rx += Long.parseLong(line.substring(9));
            } else if (line.startsWith("tx_bytes=")) {
                tx += Long.parseLong(line.substring(9));
            } else if (line.startsWith("latest_handshake_time_sec=")) {
                latestHandshakeMSec = Long.parseLong(line.substring(26)) * 1000;
            }
        }
        stats.add(key, rx, tx, latestHandshakeMSec);
        return stats;
    }

    @Override
    public String getVersion() throws Exception {
        return wgVersion();
    }

    public boolean isAlwaysOn() throws ExecutionException, InterruptedException, TimeoutException {
        return vpnService.get(0, TimeUnit.NANOSECONDS).isAlwaysOn();
    }

    public boolean isLockdownEnabled() throws ExecutionException, InterruptedException, TimeoutException {
        return vpnService.get(0, TimeUnit.NANOSECONDS).isLockdownEnabled();
    }

    @Override
    public State setState(final Tunnel tunnel, State state, @Nullable final Config config) throws Exception {
        final State originalState = getState(tunnel);

        if (state == State.TOGGLE)
            state = originalState == State.UP ? State.DOWN : State.UP;
        if (state == originalState && tunnel == currentTunnel && config == currentConfig)
            return originalState;
        if (state == State.UP) {
            final Config originalConfig = currentConfig;
            final Tunnel originalTunnel = currentTunnel;
            if (currentTunnel != null)
                setStateInternal(currentTunnel, null, State.DOWN);
            try {
                setStateInternal(tunnel, config, state);
            } catch (final Exception e) {
                if (originalTunnel != null)
                    setStateInternal(originalTunnel, originalConfig, State.UP);
                throw e;
            }
        } else if (state == State.DOWN && tunnel == currentTunnel) {
            setStateInternal(tunnel, null, State.DOWN);
        }
        return getState(tunnel);
    }

    private void setStateInternal(final Tunnel tunnel, @Nullable final Config config, final State state)
            throws Exception {
        Log.i(TAG, "Bringing tunnel " + tunnel.getName() + ' ' + state);

        if (state == State.UP) {
            if (config == null)
                throw new BackendException(Reason.TUNNEL_MISSING_CONFIG);

            if (android.net.VpnService.prepare(context) != null)
                throw new BackendException(Reason.VPN_NOT_AUTHORIZED);

            final VpnService service;
            if (!vpnService.isDone()) {
                Log.d(TAG, "Requesting to start VpnService");
                context.startService(new Intent(context, VpnService.class));
            }

            try {
                service = vpnService.get(2, TimeUnit.SECONDS);
            } catch (final TimeoutException e) {
                final Exception be = new BackendException(Reason.UNABLE_TO_START_VPN);
                be.initCause(e);
                throw be;
            }
            service.setOwner(this);

            if (currentTunnelHandle != -1) {
                Log.w(TAG, "Tunnel already up");
                return;
            }

            dnsRetry:
            for (int i = 0; i < DNS_RESOLUTION_RETRIES; ++i) {
                for (final Peer peer : config.getPeers()) {
                    final InetEndpoint ep = peer.getEndpoint().orElse(null);
                    if (ep == null)
                        continue;
                    if (ep.getResolved().orElse(null) == null) {
                        if (i < DNS_RESOLUTION_RETRIES - 1) {
                            Log.w(TAG, "DNS host \"" + ep.getHost() + "\" failed to resolve; trying again");
                            Thread.sleep(1000);
                            continue dnsRetry;
                        } else
                            throw new BackendException(Reason.DNS_RESOLUTION_FAILURE, ep.getHost());
                    }
                }
                break;
            }

            final String goConfig = config.toWgUserspaceString();

            final VpnService.Builder builder = service.getBuilder();
            builder.setSession(tunnel.getName());

            for (final String excludedApplication : config.getInterface().getExcludedApplications())
                builder.addDisallowedApplication(excludedApplication);

            for (final String includedApplication : config.getInterface().getIncludedApplications())
                builder.addAllowedApplication(includedApplication);

            for (final InetNetwork addr : config.getInterface().getAddresses())
                builder.addAddress(addr.getAddress(), addr.getMask());

            for (final InetAddress addr : config.getInterface().getDnsServers())
                builder.addDnsServer(addr.getHostAddress());

            for (final String dnsSearchDomain : config.getInterface().getDnsSearchDomains())
                builder.addSearchDomain(dnsSearchDomain);

            boolean sawDefaultRoute = false;
            for (final Peer peer : config.getPeers()) {
                for (final InetNetwork addr : peer.getAllowedIps()) {
                    if (addr.getMask() == 0)
                        sawDefaultRoute = true;
                    builder.addRoute(addr.getAddress(), addr.getMask());
                }
            }

            if (!(sawDefaultRoute && config.getPeers().size() == 1)) {
                builder.allowFamily(OsConstants.AF_INET);
                builder.allowFamily(OsConstants.AF_INET6);
            }

            builder.setMtu(config.getInterface().getMtu().orElse(1280));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                builder.setMetered(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                final Network[] networks = preferredUnderlyingNetworks;
                service.setUnderlyingNetworks(
                        networks == null || networks.length == 0 ? null : networks);
            }

            builder.setBlocking(true);
            try (final ParcelFileDescriptor tun = builder.establish()) {
                if (tun == null)
                    throw new BackendException(Reason.TUN_CREATION_ERROR);
                Log.d(TAG, "Go backend " + wgVersion());
                currentTunnelHandle = wgTurnOn(tunnel.getName(), tun.detachFd(), goConfig);
            }
            if (currentTunnelHandle < 0)
                throw new BackendException(Reason.GO_ACTIVATION_ERROR_CODE, currentTunnelHandle);

            currentTunnel = tunnel;
            currentConfig = config;

            service.protect(wgGetSocketV4(currentTunnelHandle));
            service.protect(wgGetSocketV6(currentTunnelHandle));
        } else {
            if (currentTunnelHandle == -1) {
                Log.w(TAG, "Tunnel already down");
                return;
            }
            int handleToClose = currentTunnelHandle;
            currentTunnel = null;
            currentTunnelHandle = -1;
            currentConfig = null;
            wgTurnOff(handleToClose);
            try {
                vpnService.get(0, TimeUnit.NANOSECONDS).stopSelf();
            } catch (final TimeoutException ignored) { }
        }

        tunnel.onStateChange(state);
    }

    private static native String wgGetConfig(int handle);
    private static native int wgGetSocketV4(int handle);
    private static native int wgGetSocketV6(int handle);
    private static native void wgTurnOff(int handle);
    private static native int wgTurnOn(String ifName, int tunFd, String settings);
    private static native String wgVersion();

    public interface AlwaysOnCallback {
        void alwaysOnTriggered();
    }

    public static class VpnService extends android.net.VpnService {
        @Nullable private EnhancedGoBackend owner;

        public Builder getBuilder() {
            return new Builder();
        }

        @Override
        public void onCreate() {
            vpnService.complete(this);
            super.onCreate();
        }

        @Override
        public void onDestroy() {
            if (owner != null) {
                final Tunnel tunnel = owner.currentTunnel;
                if (tunnel != null) {
                    if (owner.currentTunnelHandle != -1)
                        wgTurnOff(owner.currentTunnelHandle);
                    owner.currentTunnel = null;
                    owner.currentTunnelHandle = -1;
                    owner.currentConfig = null;
                    tunnel.onStateChange(State.DOWN);
                }
            }
            vpnService = vpnService.newIncompleteFuture();
            super.onDestroy();
        }

        @Override
        public int onStartCommand(@Nullable final Intent intent, final int flags, final int startId) {
            vpnService.complete(this);
            if (intent == null || intent.getComponent() == null || !intent.getComponent().getPackageName().equals(getPackageName())) {
                Log.d(TAG, "Service started by Always-on VPN feature");
                if (alwaysOnCallback != null)
                    alwaysOnCallback.alwaysOnTriggered();
            }
            return super.onStartCommand(intent, flags, startId);
        }

        public void setOwner(final EnhancedGoBackend owner) {
            this.owner = owner;
        }
    }
}
