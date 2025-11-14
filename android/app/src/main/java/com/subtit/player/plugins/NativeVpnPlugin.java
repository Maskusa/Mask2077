package com.subtit.player.plugins;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import libv2ray.CoreCallbackHandler;
import libv2ray.CoreController;
import libv2ray.Libv2ray;
import com.subtit.player.vpn.core.V2rayCoreManager;
import com.subtit.player.vpn.core.VpnServiceControl;
import com.subtit.player.vpn.model.HevOptions;
import com.subtit.player.vpn.model.VpnLaunchConfig;
import com.subtit.player.vpn.service.V2rayVpnService;

import java.io.BufferedReader;
import java.io.FileDescriptor;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;

import javax.net.SocketFactory;

import okhttp3.Dns;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeVpn")
public class NativeVpnPlugin extends Plugin {

    private static final String TAG = "NativeVpnPlugin";
    private static final String PERMISSION_TAG = "vpnPermission";
    private static final int DEFAULT_SOCKS_PORT = 10808;
    private static final Object SOCKET_FD_LOCK = new Object();
    @Nullable
    private static Method socketGetFileDescriptor;
    private final ExecutorService diagnosticsExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "vpn-diagnostics");
        t.setDaemon(true);
        return t;
    });
    private final Object apiClientLock = new Object();
    @Nullable
    private OkHttpClient apiHttpClient;
    private volatile boolean debugModeEnabled = false;
    private volatile boolean running = false;
    private volatile boolean requestedStart = false;
    private final Object vlessLock = new Object();
    @Nullable
    private CoreController coreController;
    @Nullable
    private VlessSession activeSession;
    private final CoreEvents coreEvents = new CoreEvents();
    private volatile long vpnStartedRealtime = 0L;
    private volatile long vpnStartedEpochMs = 0L;
    @Nullable
    private VpnLaunchConfig activeLaunchConfig;
    @Nullable
    private ConnectivityManager connectivityManager;
    @Nullable
    private volatile Network baselineNetwork;
    @Nullable
    private BroadcastReceiver vpnStatusReceiver;

    static {
        Log.i(TAG, "[lifecycle] class loaded");
    }

    public NativeVpnPlugin() {
        super();
        Log.i(TAG, "[lifecycle] ctor invoked");
    }

    @Override
    public void load() {
        Log.i(TAG, "[lifecycle] load() start");
        try {
            super.load();
            connectivityManager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            refreshBaselineNetwork();
            registerStatusReceiver();
            Log.i(TAG, "[lifecycle] load() completed");
        } catch (Throwable loadError) {
            Log.e(TAG, "[lifecycle] load() failed", loadError);
            throw loadError;
        }
    }

    private ConnectivityManager ensureConnectivityManager() {
        if (connectivityManager == null) {
            connectivityManager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        }
        return connectivityManager;
    }

    private void refreshBaselineNetwork() {
        ConnectivityManager cm = ensureConnectivityManager();
        if (cm == null) {
            baselineNetwork = null;
            return;
        }
        Network[] networks = cm.getAllNetworks();
        Network candidate = null;
        if (networks != null) {
            for (Network network : networks) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(network);
                if (caps == null) {
                    continue;
                }
                if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    continue;
                }
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                    continue;
                }
                candidate = network;
                break;
            }
        }
        if (candidate == null) {
            candidate = cm.getActiveNetwork();
        }
        Network previous = baselineNetwork;
        baselineNetwork = candidate;
        if (previous != candidate) {
            resetApiClient();
        }
    }

    private void resetApiClient() {
        synchronized (apiClientLock) {
            apiHttpClient = null;
        }
    }

    private OkHttpClient getApiHttpClient() {
        synchronized (apiClientLock) {
            Network networkForBypass = null;
            if (running) {
                networkForBypass = baselineNetwork;
                if (networkForBypass == null) {
                    refreshBaselineNetwork();
                    networkForBypass = baselineNetwork;
                }
            }
            if (apiHttpClient == null) {
                OkHttpClient.Builder builder = new OkHttpClient.Builder()
                        .callTimeout(20, TimeUnit.SECONDS)
                        .connectTimeout(10, TimeUnit.SECONDS)
                        .readTimeout(10, TimeUnit.SECONDS)
                        .writeTimeout(10, TimeUnit.SECONDS)
                        .retryOnConnectionFailure(true)
                        .proxy(Proxy.NO_PROXY);
                SocketFactory delegateFactory = SocketFactory.getDefault();
                if (networkForBypass != null) {
                    Network finalNetwork = networkForBypass;
                    SocketFactory networkFactory = finalNetwork.getSocketFactory();
                    if (networkFactory != null) {
                        delegateFactory = networkFactory;
                    }
                    builder.dns(hostname -> {
                        try {
                            InetAddress[] addresses = finalNetwork.getAllByName(hostname);
                            return Arrays.asList(addresses);
                        } catch (UnknownHostException e) {
                            return Dns.SYSTEM.lookup(hostname);
                        }
                    });
                }
                builder.socketFactory(new ProtectingSocketFactory(delegateFactory));
                apiHttpClient = builder.build();
            }
            return apiHttpClient;
        }
    }

    private boolean protectSocketIfNeeded(@Nullable Socket socket) {
        if (socket == null) {
            return false;
        }
        VpnServiceControl control = V2rayCoreManager.getActiveService();
        if (control == null) {
            return false;
        }
        try {
            FileDescriptor descriptor = resolveSocketFileDescriptor(socket);
            if (descriptor == null) {
                Log.w(TAG, "[protect] socket descriptor unavailable");
                return false;
            }
            ParcelFileDescriptor duplicate = ParcelFileDescriptor.dup(descriptor);
            try {
                boolean result = control.protectSocket(duplicate.getFd());
                if (!result) {
                    Log.w(TAG, "[protect] VpnService refused to protect socket");
                }
                return result;
            } finally {
                duplicate.close();
            }
        } catch (ReflectiveOperationException | IOException e) {
            Log.w(TAG, "[protect] failed to protect socket", e);
            return false;
        }
    }

    @Nullable
    private static FileDescriptor resolveSocketFileDescriptor(Socket socket) throws ReflectiveOperationException {
        if (socket == null) {
            return null;
        }
        Method method;
        synchronized (SOCKET_FD_LOCK) {
            if (socketGetFileDescriptor == null) {
                socketGetFileDescriptor = Socket.class.getDeclaredMethod("getFileDescriptor$");
                socketGetFileDescriptor.setAccessible(true);
            }
            method = socketGetFileDescriptor;
        }
        Object descriptor = method.invoke(socket);
        if (descriptor instanceof FileDescriptor) {
            return (FileDescriptor) descriptor;
        }
        return null;
    }

    private final class ProtectingSocketFactory extends SocketFactory {
        private final SocketFactory delegate;

        ProtectingSocketFactory(@Nullable SocketFactory delegate) {
            this.delegate = delegate != null ? delegate : SocketFactory.getDefault();
        }

        private Socket protect(Socket socket) throws IOException {
            protectSocketIfNeeded(socket);
            return socket;
        }

        @Override
        public Socket createSocket() throws IOException {
            return protect(delegate.createSocket());
        }

        @Override
        public Socket createSocket(String host, int port) throws IOException {
            return protect(delegate.createSocket(host, port));
        }

        @Override
        public Socket createSocket(String host, int port, InetAddress localAddress, int localPort) throws IOException {
            return protect(delegate.createSocket(host, port, localAddress, localPort));
        }

        @Override
        public Socket createSocket(InetAddress host, int port) throws IOException {
            return protect(delegate.createSocket(host, port));
        }

        @Override
        public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
            return protect(delegate.createSocket(address, port, localAddress, localPort));
        }
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        Context context = getContext();
        boolean granted = context != null && VpnService.prepare(context) == null;
        Log.i(TAG, "[checkPermission] granted=" + granted);
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activity_unavailable");
            return;
        }
        Intent intent = VpnService.prepare(activity);
        if (intent == null) {
            Log.i(TAG, "[requestPermission] already granted (intent=null)");
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        Log.i(TAG, "[requestPermission] launching permission activity");
        saveCall(call);
        startActivityForResult(call, intent, PERMISSION_TAG);
    }

    @PluginMethod
    public void getDeviceFingerprint(PluginCall call) {
        try {
            Context context = getContext();
            if (context == null) {
                call.reject("context_unavailable");
                return;
            }
            String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId == null || androidId.trim().isEmpty()) {
                androidId = "unknown";
            }
            String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "unknown";
            String model = Build.MODEL != null ? Build.MODEL : "unknown";
            String hardware = Build.HARDWARE != null ? Build.HARDWARE : "unknown";
            String brand = Build.BRAND != null ? Build.BRAND : "unknown";
            String payload = androidId + "|" + manufacturer + "|" + model + "|" + hardware + "|" + brand + "|" + Build.VERSION.SDK_INT;
            String fingerprint = sha256(payload);
            JSObject ret = new JSObject();
            ret.put("fingerprint", fingerprint);
            ret.put("source", "android_hardware");
            call.resolve(ret);
        } catch (Exception ex) {
            Log.e(TAG, "[getDeviceFingerprint] failed", ex);
            call.reject("fingerprint_error: " + ex.getMessage());
        }
    }

    @ActivityCallback
    private void vpnPermission(PluginCall call, @Nullable ActivityResult result) {
        boolean granted = result != null && result.getResultCode() == Activity.RESULT_OK;
        Log.i(TAG, "[vpnPermission] resultCode="
                + (result != null ? result.getResultCode() : "null")
                + " granted=" + granted);
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String configJson = call.getString("configJson");
        if (configJson == null || configJson.trim().isEmpty()) {
            call.reject("configJson is required");
            return;
        }
        String outboundTag = call.getString("outboundTag", "proxy-out");
        String profileLabel = call.getString("profileLabel", "VLESS session");
        JSObject launchOptions = call.getObject("launchOptions", null);
        Context context = getContext();
        if (context == null) {
            call.reject("context_unavailable");
            return;
        }
        if (VpnService.prepare(context) != null) {
            call.reject("vpn permission not granted");
            return;
        }
        int configLength = configJson.length();
        Log.i(TAG, "[start] request accepted label=" + profileLabel
                + " outboundTag=" + outboundTag + " configLength=" + configLength);
        try {
            refreshBaselineNetwork();
            Log.i(TAG, "[start] baselineNetwork=" + (baselineNetwork != null ? baselineNetwork.toString() : "none"));
            CoreController controller = ensureCoreController(context);
            Log.i(TAG, "[start] core controller ready=" + (controller != null));
            requestedStart = true;
            Log.i(TAG, "[start] requestedStart=true");
            String resolvedOutboundTag = outboundTag != null && !outboundTag.trim().isEmpty()
                    ? outboundTag.trim()
                    : "proxy-out";
            Log.i(TAG, "[start] resolvedOutboundTag=" + resolvedOutboundTag + " launching core loop");
            controller.startLoop(configJson);
            Log.i(TAG, "[start] startLoop finished, querying running state");
            running = controller.getIsRunning();
            if (!running) {
                Log.w(TAG, "[start] controller reported non-running state");
                call.reject("VLESS core reported non-running state after start");
                return;
            }
            vpnStartedRealtime = SystemClock.elapsedRealtime();
            vpnStartedEpochMs = System.currentTimeMillis();
            synchronized (vlessLock) {
                activeSession = new VlessSession(profileLabel, resolvedOutboundTag);
            }
            Log.i(TAG, "[start] active session created label=" + profileLabel);
            resetApiClient();
            Log.i(TAG, "[start] api client cache reset");
            VpnLaunchConfig launchConfig = buildLaunchConfig(profileLabel, configJson, launchOptions);
            activeLaunchConfig = launchConfig;
            V2rayVpnService.start(context, launchConfig);
            Log.i(TAG, "[start] vpn service launch requested");
            JSObject state = buildState();
            Log.i(TAG, "[start] flow complete running=" + running + " outboundTag=" + resolvedOutboundTag);
            call.resolve(state);
        } catch (Exception e) {
            running = false;
            Log.e(TAG, "Failed to start VLESS core label=" + profileLabel, e);
            call.reject("Failed to start VLESS core: " + e.getMessage(), e);
        } finally {
            requestedStart = false;
            Log.i(TAG, "[start] cleanup requestedStart=false");
        }
    }

    @PluginMethod
    public void setDebugMode(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        debugModeEnabled = enabled;
        Log.i(TAG, "[setDebugMode] enabled=" + enabled);
        JSObject response = new JSObject();
        response.put("enabled", enabled);
        call.resolve(response);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Log.i(TAG, "[stop] requested");
        try {
            CoreController controller;
            synchronized (vlessLock) {
                controller = coreController;
            }
            Context context = getContext();
            if (context != null) {
                V2rayVpnService.stop(context);
                Log.i(TAG, "[stop] vpn service stop requested");
            }
            if (controller != null && controller.getIsRunning()) {
                controller.stopLoop();
            }
            running = false;
            requestedStart = false;
            synchronized (vlessLock) {
                activeSession = null;
            }
            activeLaunchConfig = null;
            resetApiClient();
            refreshBaselineNetwork();
            call.resolve(buildState());
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop VLESS core", e);
            call.reject("Failed to stop VLESS session: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getState(PluginCall call) {
        Log.d(TAG, "[getState] returning latest snapshot");
        call.resolve(buildState());
    }

    @PluginMethod
    public void apiRequest(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String methodRaw = call.getString("method", "GET");
        final String method = methodRaw != null ? methodRaw.trim().toUpperCase(Locale.US) : "GET";
        final JSObject headers = call.getObject("headers", new JSObject());
        final String body = call.getString("body");
        diagnosticsExecutor.execute(() -> executeApiRequest(call, url, method, headers, body));
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        diagnosticsExecutor.shutdownNow();
        Context context = getContext();
        if (context != null && vpnStatusReceiver != null) {
            context.unregisterReceiver(vpnStatusReceiver);
            vpnStatusReceiver = null;
        }
    }

    private VpnLaunchConfig buildLaunchConfig(String profileLabel,
                                              String configJson,
                                              @Nullable JSObject overridesObject) {
        JSONObject overrides = overridesObject;
        String fallbackSession = !TextUtils.isEmpty(profileLabel)
                ? profileLabel.trim()
                : "Mask2077 Tunnel";
        String session = optString(overrides, "sessionName", fallbackSession);
        String socksHost = optString(overrides, "socksHost", "127.0.0.1");
        int socksPort = optInt(overrides, "socksPort", DEFAULT_SOCKS_PORT);
        int mtu = optInt(overrides, "mtu", 8500);
        boolean forwardUdp = optBoolean(overrides, "forwardUdp", true);
        String socksUser = optString(overrides, "socksUsername", "");
        String socksPass = optString(overrides, "socksPassword", "");

        VpnLaunchConfig.Builder builder = VpnLaunchConfig.builder()
                .sessionName(session)
                .socksHost(socksHost)
                .socksPort(socksPort)
                .socksUsername(socksUser)
                .socksPassword(socksPass)
                .mtu(mtu)
                .tunIpv4("198.18.0.1", 24)
                .tunIpv6("fc00::1", 128)
                .forwardUdp(forwardUdp)
                .configJson(configJson);
        builder.dnsServers(Arrays.asList("1.1.1.1", "8.8.8.8"));

        List<String> dnsOverride = parseStringArray(overrides != null ? overrides.optJSONArray("dns") : null);
        if (!dnsOverride.isEmpty()) {
            builder.dnsServers(dnsOverride);
        }

        List<String> allowedApps = parseStringArray(overrides != null ? overrides.optJSONArray("allowedApps") : null);
        if (!allowedApps.isEmpty()) {
            builder.allowedApplications(allowedApps);
        }
        List<String> disallowedApps = parseStringArray(overrides != null ? overrides.optJSONArray("disallowedApps") : null);
        if (!disallowedApps.isEmpty()) {
            builder.disallowedApplications(disallowedApps);
        }

        JSONObject tun4 = overrides != null ? overrides.optJSONObject("tunIpv4") : null;
        if (tun4 != null) {
            String addr = optString(tun4, "address", null);
            int prefix = optInt(tun4, "prefix", -1);
            if (!TextUtils.isEmpty(addr) && prefix > 0) {
                builder.tunIpv4(addr, prefix);
            }
            String netmask = optString(tun4, "netmask", null);
            if (!TextUtils.isEmpty(netmask)) {
                builder.tunNetmask(netmask);
            }
        }
        JSONObject tun6 = overrides != null ? overrides.optJSONObject("tunIpv6") : null;
        if (tun6 != null) {
            String addr6 = optString(tun6, "address", null);
            int prefix6 = optInt(tun6, "prefix", -1);
            if (!TextUtils.isEmpty(addr6) && prefix6 > 0) {
                builder.tunIpv6(addr6, prefix6);
            }
        }

        JSONObject hevOverride = overrides != null ? overrides.optJSONObject("hev") : null;
        builder.hevOptions(mergeHevOverrides(defaultHevOptions(), hevOverride));

        return builder.build();
    }

    private void registerStatusReceiver() {
        Context context = getContext();
        if (context == null || vpnStatusReceiver != null) {
            return;
        }
        vpnStatusReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                String status = intent.getStringExtra(V2rayVpnService.EXTRA_STATUS);
                if (status == null) {
                    status = "unknown";
                }
                String reason = intent.getStringExtra(V2rayVpnService.EXTRA_REASON);
                String session = intent.getStringExtra(V2rayVpnService.EXTRA_SESSION);
                JSObject payload = new JSObject();
                payload.put("status", status);
                payload.put("reason", reason);
                payload.put("session", session);
                payload.put("timestamp", System.currentTimeMillis());
                if ("running".equals(status)) {
                    running = true;
                } else {
                    running = false;
                    requestedStart = false;
                    synchronized (vlessLock) {
                        activeSession = null;
                    }
                    activeLaunchConfig = null;
                }
                notifyListeners("vpnStatusChanged", payload, true);
            }
        };
        IntentFilter filter = new IntentFilter(V2rayVpnService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(vpnStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(vpnStatusReceiver, filter);
        }
    }

    private void executeApiRequest(PluginCall call, String url, String method, JSObject headers, @Nullable String body) {
        try {
            Request.Builder requestBuilder = new Request.Builder().url(url);
            Headers.Builder headersBuilder = new Headers.Builder();
            if (headers != null) {
                Iterator<String> iterator = headers.keys();
                while (iterator.hasNext()) {
                    String key = iterator.next();
                    if (key == null) {
                        continue;
                    }
                    try {
                        Object value = headers.get(key);
                        if (value != null) {
                            headersBuilder.add(key, String.valueOf(value));
                        }
                    } catch (JSONException jsonException) {
                        Log.w(TAG, "[apiRequest] invalid header value for " + key, jsonException);
                    }
                }
            }
            requestBuilder.headers(headersBuilder.build());
            RequestBody requestBody = null;
            if (methodAllowsBody(method)) {
                MediaType mediaType = MediaType.parse(headersBuilder.get("Content-Type") != null
                        ? headersBuilder.get("Content-Type")
                        : "application/json; charset=utf-8");
                if (body != null) {
                    requestBody = RequestBody.create(body, mediaType);
                } else {
                    requestBody = RequestBody.create(new byte[0], mediaType);
                }
            }
            requestBuilder.method(method, requestBody);
            if (debugModeEnabled) {
                Log.d(TAG, "[apiRequest][debug] " + method + " " + url + " body="
                        + (body != null ? body : "<empty>"));
            }
            try (Response response = getApiHttpClient().newCall(requestBuilder.build()).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                 if (debugModeEnabled) {
                     Log.d(TAG, "[apiRequest][debug] status=" + response.code()
                             + " url=" + response.request().url()
                             + " bodyLength=" + responseBody.length());
                 }
                JSObject result = new JSObject();
                result.put("status", response.code());
                result.put("body", responseBody);
                result.put("url", response.request().url().toString());
                JSObject responseHeaders = new JSObject();
                for (String name : response.headers().names()) {
                    responseHeaders.put(name, response.header(name));
                }
                result.put("headers", responseHeaders);
                call.resolve(result);
            }
        } catch (Exception networkError) {
            Log.w(TAG, "[apiRequest] failed for " + url, networkError);
            call.reject(networkError.getMessage(), networkError);
        }
    }

    private boolean methodAllowsBody(String method) {
        return !"GET".equals(method) && !"HEAD".equals(method);
    }

    @PluginMethod
    public void diagnose(PluginCall call) {
        String requestedHost = call.getString("host");
        if (requestedHost == null || requestedHost.trim().isEmpty()) {
            call.reject("host is required");
            return;
        }
        int port = Math.max(1, call.getInt("port", 1080));
        int timeoutMs = Math.max(1000, call.getInt("timeoutMs", 7000));
        String url = call.getString("url", "https://api.ipify.org?format=json");

        JSArray testsArray = call.getArray("tests");
        List<String> tests = new ArrayList<>();
        if (testsArray != null) {
            try {
                for (Object value : testsArray.toList()) {
                    if (value != null) {
                        tests.add(String.valueOf(value));
                    }
                }
            } catch (org.json.JSONException jsonException) {
                Log.w(TAG, "[diagnose] invalid tests array", jsonException);
                call.reject("Invalid tests array: " + jsonException.getMessage());
                return;
            }
        }
        if (tests.isEmpty()) {
            tests = Arrays.asList("ping", "dns", "tcp", "https");
        }

        final String resolvedHost = requestedHost.trim();
        final int resolvedPort = port;
        final int resolvedTimeout = timeoutMs;
        final String resolvedUrl = url;
        final List<String> resolvedTests = new ArrayList<>(tests);

        Log.i(TAG, "[diagnose] host=" + resolvedHost + " port=" + resolvedPort + " tests=" + resolvedTests);
        diagnosticsExecutor.execute(() -> {
            long startedAt = System.currentTimeMillis();
            JSArray resultsArray = new JSArray();
            for (String test : resolvedTests) {
                DiagnosticEntry entry = runDiagnostic(test, resolvedHost, resolvedPort, resolvedTimeout, resolvedUrl);
                resultsArray.put(entry.toJson());
            }
            long finishedAt = System.currentTimeMillis();
            JSObject ret = new JSObject();
            ret.put("startedAt", startedAt);
            ret.put("finishedAt", finishedAt);
            ret.put("results", resultsArray);
            call.resolve(ret);
        });
    }

    private JSObject buildState() {
        JSObject state = new JSObject();
        state.put("running", running);
        state.put("exitCode", 0);
        state.put("requestedStart", requestedStart);
        JSObject statsJson = collectStatsSnapshot();
        if (statsJson != null) {
            state.put("stats", statsJson);
        }
        return state;
    }

    private JSObject collectStatsSnapshot() {
        CoreController controller;
        VlessSession session;
        synchronized (vlessLock) {
            controller = coreController;
            session = activeSession;
        }
        if (controller == null || session == null || !running) {
            return null;
        }
        long txDelta = safeQueryStats(controller, session.outboundTag, "uplink");
        long rxDelta = safeQueryStats(controller, session.outboundTag, "downlink");
        long txTotal = session.txBytes.addAndGet(Math.max(0, txDelta));
        long rxTotal = session.rxBytes.addAndGet(Math.max(0, rxDelta));

        JSObject statsJson = new JSObject();
        statsJson.put("rxBytes", rxTotal);
        statsJson.put("txBytes", txTotal);
        statsJson.put("rxPackets", 0);
        statsJson.put("txPackets", 0);
        statsJson.put("startedAt", vpnStartedEpochMs);
        long uptime = Math.max(0, SystemClock.elapsedRealtime() - vpnStartedRealtime);
        statsJson.put("uptimeMs", running ? uptime : 0);
        statsJson.put("exitCode", 0);
        statsJson.put("nativeRunning", running);
        statsJson.put("restartAttempts", 0);
        statsJson.put("lastRestartAt", vpnStartedEpochMs);
        statsJson.put("lastRestartReason", null);
        return statsJson;
    }

    private long safeQueryStats(CoreController controller, String tag, String direct) {
        if (controller == null || tag == null) {
            return 0;
        }
        try {
            return Math.max(0, controller.queryStats(tag, direct));
        } catch (Exception e) {
            Log.w(TAG, "[stats] failed to query " + direct + " for tag=" + tag, e);
            return 0;
        }
    }

    private List<String> parseStringArray(@Nullable JSONArray array) {
        if (array == null || array.length() == 0) {
            return Collections.emptyList();
        }
        List<String> values = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            String entry = array.optString(i, null);
            if (!TextUtils.isEmpty(entry)) {
                values.add(entry.trim());
            }
        }
        return values;
    }

    private HevOptions defaultHevOptions() {
        return HevOptions.builder()
                .taskStackSize(81920)
                .udpInTcp(false)
                .socksUdpAddress("")
                .mapDnsEnabled(true)
                .mapDnsAddress("198.18.0.2")
                .mapDnsPort(53)
                .mapDnsNetwork("240.0.0.0")
                .mapDnsNetmask("240.0.0.0")
                .mapDnsCacheSize(10_000)
                .build();
    }

    private HevOptions mergeHevOverrides(HevOptions defaults, @Nullable JSONObject override) {
        if (override == null) {
            return defaults;
        }
        return HevOptions.builder()
                .taskStackSize(optInt(override, "taskStackSize", defaults.getTaskStackSize()))
                .udpInTcp(optBoolean(override, "udpInTcp", defaults.isUdpInTcp()))
                .socksUdpAddress(optString(override, "socksUdpAddress", defaults.getSocksUdpAddress()))
                .mapDnsEnabled(optBoolean(override, "mapDnsEnabled", defaults.isMapDnsEnabled()))
                .mapDnsAddress(optString(override, "mapDnsAddress", defaults.getMapDnsAddress()))
                .mapDnsPort(optInt(override, "mapDnsPort", defaults.getMapDnsPort()))
                .mapDnsNetwork(optString(override, "mapDnsNetwork", defaults.getMapDnsNetwork()))
                .mapDnsNetmask(optString(override, "mapDnsNetmask", defaults.getMapDnsNetmask()))
                .mapDnsCacheSize(optInt(override, "mapDnsCacheSize", defaults.getMapDnsCacheSize()))
                .build();
    }

    private int optInt(@Nullable JSONObject source, String key, int defaultValue) {
        if (source == null || TextUtils.isEmpty(key) || !source.has(key)) {
            return defaultValue;
        }
        try {
            return source.getInt(key);
        } catch (JSONException e) {
            Log.w(TAG, "[launchOptions] invalid integer for " + key, e);
            return defaultValue;
        }
    }

    private boolean optBoolean(@Nullable JSONObject source, String key, boolean defaultValue) {
        if (source == null || TextUtils.isEmpty(key) || !source.has(key)) {
            return defaultValue;
        }
        try {
            return source.getBoolean(key);
        } catch (JSONException e) {
            Log.w(TAG, "[launchOptions] invalid boolean for " + key, e);
            return defaultValue;
        }
    }

    private String optString(@Nullable JSONObject source, String key, @Nullable String defaultValue) {
        if (source == null || TextUtils.isEmpty(key) || !source.has(key)) {
            return defaultValue;
        }
        try {
            String value = source.getString(key);
            return value != null ? value : defaultValue;
        } catch (JSONException e) {
            Log.w(TAG, "[launchOptions] invalid string for " + key, e);
            return defaultValue;
        }
    }

    private CoreController ensureCoreController(Context context) {
        synchronized (vlessLock) {
            if (coreController == null) {
                String fingerprint = resolveDeviceFingerprint(context);
                Log.i(TAG, "[libv2ray] derived basekey length=" + fingerprint.length());
                V2rayCoreManager.ensureEnvironment(context, fingerprint);
                coreController = Libv2ray.newCoreController(coreEvents);
                Log.i(TAG, "[libv2ray] initialized version=" + Libv2ray.checkVersionX());
            }
            return coreController;
        }
    }

    private String resolveDeviceFingerprint(Context context) {
        String seed;
        try {
            seed = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception e) {
            Log.w(TAG, "[libv2ray] failed to access ANDROID_ID", e);
            seed = null;
        }
        if (seed == null || seed.trim().isEmpty()) {
            seed = "mask-device";
        }
        return deriveBaseKey(seed);
    }

    private String deriveBaseKey(String seed) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(seed.getBytes(StandardCharsets.UTF_8));
            // Xray expects Base64 URL-safe without padding (RawURLEncoding).
            final int flags = Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP;
            String encoded = Base64.encodeToString(hash, flags);
            if (encoded == null || encoded.length() == 0) {
                throw new IllegalStateException("Failed to encode XUDP base key");
            }
            byte[] decoded = Base64.decode(encoded, flags);
            if (decoded.length != 32) {
                throw new IllegalStateException(
                        "Derived XUDP base key has invalid length=" + decoded.length + ", expected 32");
            }
            Log.i(TAG, "[libv2ray] basekey encodedLen=" + encoded.length() + " decodedLen=" + decoded.length);
            return encoded;
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static final class VlessSession {
        private final String label;
        private final String outboundTag;
        private final AtomicLong txBytes = new AtomicLong(0);
        private final AtomicLong rxBytes = new AtomicLong(0);

        VlessSession(String label, String outboundTag) {
            this.label = label;
            this.outboundTag = outboundTag;
        }
    }

    private final class CoreEvents implements CoreCallbackHandler {
        @Override
        public long onEmitStatus(long code, String status) {
            Log.d(TAG, "[libv2ray][status] code=" + code + " message=" + status);
            return 0;
        }

        @Override
        public long shutdown() {
            Log.i(TAG, "[libv2ray] shutdown callback");
            running = false;
            Context context = getContext();
            if (context != null) {
                try {
                    V2rayVpnService.stop(context);
                } catch (Exception stopError) {
                    Log.w(TAG, "[libv2ray] failed to stop vpn service on shutdown", stopError);
                }
            }
            return 0;
        }

        @Override
        public long startup() {
            Log.i(TAG, "[libv2ray] startup callback");
            running = true;
            return 0;
        }
    }


    private DiagnosticEntry runDiagnostic(String rawType,
                                          String host,
                                          int port,
                                          int timeoutMs,
                                          String url) {
        if (rawType == null) {
            return DiagnosticEntry.failure("unknown", 0, "type=null");
        }
        String type = rawType.toLowerCase(Locale.US);
        switch (type) {
            case "ping":
                return runPing(host, timeoutMs);
            case "dns":
                return runDns(host);
            case "tcp":
                return runTcp(host, port, timeoutMs);
            case "http":
            case "https":
                return runHttp(type, url, host, timeoutMs);
            default:
                Log.w(TAG, "[diagnose] unknown test type=" + rawType);
                return DiagnosticEntry.failure(type, 0, "unknown_test");
        }
    }

    private DiagnosticEntry runPing(String host, int timeoutMs) {
        long started = SystemClock.elapsedRealtime();
        int waitSeconds = Math.max(1, timeoutMs / 1000);
        ProcessBuilder builder = new ProcessBuilder("/system/bin/ping", "-c", "1", "-W", String.valueOf(waitSeconds), host);
        builder.redirectErrorStream(true);
        try {
            Process process = builder.start();
            String output = readStream(process.getInputStream());
            int exit = process.waitFor();
            long latency = SystemClock.elapsedRealtime() - started;
            boolean success = exit == 0;
            String message = success ? extractPingLatency(output) : "exit=" + exit;
            DiagnosticEntry entry = new DiagnosticEntry("ping", success, latency, null,
                    success ? message : (message + " output=" + truncate(output, 200)));
            Log.i(TAG, "[diagnose] ping success=" + success + " latency=" + latency + "ms message=" + message);
            return entry;
        } catch (Exception e) {
            long latency = SystemClock.elapsedRealtime() - started;
            Log.w(TAG, "[diagnose] ping failed host=" + host, e);
            return DiagnosticEntry.failure("ping", latency, e.getMessage());
        }
    }

    private InetAddress[] resolveDnsAddresses(String host) throws UnknownHostException {
        Network network = baselineNetwork;
        if (network != null) {
            return network.getAllByName(host);
        }
        return InetAddress.getAllByName(host);
    }

    private String normalizeUrl(String type, @Nullable String url, String host) {
        String effectiveUrl = url != null ? url.trim() : "";
        if (effectiveUrl.isEmpty()) {
            return ("https".equals(type) ? "https://" : "http://") + host;
        }
        if (!effectiveUrl.startsWith("http://") && !effectiveUrl.startsWith("https://")) {
            return ("https".equals(type) ? "https://" : "http://") + effectiveUrl;
        }
        return effectiveUrl;
    }

    private DiagnosticEntry runDns(String host) {
        long started = SystemClock.elapsedRealtime();
        try {
            InetAddress[] addresses = resolveDnsAddresses(host);
            long latency = SystemClock.elapsedRealtime() - started;
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < addresses.length; i++) {
                if (i > 0) {
                    builder.append(',');
                }
                builder.append(addresses[i].getHostAddress());
            }
            DiagnosticEntry entry = new DiagnosticEntry("dns", true, latency, null,
                    "resolved=" + builder);
            Log.i(TAG, "[diagnose] dns success latency=" + latency + "ms " + builder);
            return entry;
        } catch (Exception e) {
            long latency = SystemClock.elapsedRealtime() - started;
            Log.w(TAG, "[diagnose] dns failed host=" + host, e);
            return DiagnosticEntry.failure("dns", latency, e.getMessage());
        }
    }

    private DiagnosticEntry runTcp(String host, int port, int timeoutMs) {
        long started = SystemClock.elapsedRealtime();
        try (Socket socket = new Socket()) {
            protectSocketIfNeeded(socket);
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            long latency = SystemClock.elapsedRealtime() - started;
            DiagnosticEntry entry = new DiagnosticEntry("tcp", true, latency, null,
                    "connected " + host + ":" + port);
            Log.i(TAG, "[diagnose] tcp success latency=" + latency + "ms host=" + host + " port=" + port);
            return entry;
        } catch (Exception e) {
            long latency = SystemClock.elapsedRealtime() - started;
            Log.w(TAG, "[diagnose] tcp failed host=" + host + " port=" + port, e);
            return DiagnosticEntry.failure("tcp", latency, e.getMessage());
        }
    }

    private DiagnosticEntry runHttp(String type, String url, String host, int timeoutMs) {
        long started = SystemClock.elapsedRealtime();
        String effectiveUrl = normalizeUrl(type, url, host);
        try {
            OkHttpClient base = getApiHttpClient();
            OkHttpClient client = base.newBuilder()
                    .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .build();
            Request request = new Request.Builder().url(effectiveUrl).get().build();
            try (Response response = client.newCall(request).execute()) {
                int status = response.code();
                long latency = SystemClock.elapsedRealtime() - started;
                boolean success = status >= 200 && status < 400;
                String message = "status=" + status + " url=" + effectiveUrl;
                DiagnosticEntry entry = new DiagnosticEntry(type, success, latency, status, message);
                Log.i(TAG, "[diagnose] " + type + " success=" + success + " latency=" + latency + "ms status=" + status);
                return entry;
            }
        } catch (Exception e) {
            long latency = SystemClock.elapsedRealtime() - started;
            Log.w(TAG, "[diagnose] " + type + " failed url=" + effectiveUrl, e);
            return DiagnosticEntry.failure(type, latency, e.getMessage());
        }
    }

    private static String readStream(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    private static String extractPingLatency(String output) {
        if (output == null || output.isEmpty()) {
            return "no_output";
        }
        String[] lines = output.split("\\n");
        for (String line : lines) {
            int idx = line.indexOf("time=");
            if (idx >= 0) {
                return line.substring(idx).trim();
            }
        }
        return truncate(output, 120);
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        String sanitized = value.replace('\n', ' ').replace('\r', ' ').trim();
        if (sanitized.length() <= max) {
            return sanitized;
        }
        return sanitized.substring(0, max) + "...";
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                String part = Integer.toHexString(b & 0xFF);
                if (part.length() == 1) {
                    hex.append('0');
                }
                hex.append(part);
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static final class DiagnosticEntry {
        private final String type;
        private final boolean success;
        private final long latencyMs;
        @Nullable
        private final Integer status;
        @Nullable
        private final String message;

        private DiagnosticEntry(String type, boolean success, long latencyMs,
                                @Nullable Integer status,
                                @Nullable String message) {
            this.type = type;
            this.success = success;
            this.latencyMs = latencyMs;
            this.status = status;
            this.message = message;
        }

        static DiagnosticEntry failure(String type, long latencyMs, @Nullable String message) {
            return new DiagnosticEntry(type, false, latencyMs, null, message);
        }

        JSObject toJson() {
            JSObject object = new JSObject();
            object.put("type", type);
            object.put("success", success);
            object.put("latencyMs", latencyMs);
            if (status != null) {
                object.put("status", status);
            }
            object.put("message", message);
            object.put("timestamp", System.currentTimeMillis());
            return object;
        }
    }

    
}

