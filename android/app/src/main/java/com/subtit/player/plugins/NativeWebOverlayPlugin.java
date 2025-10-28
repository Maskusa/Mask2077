package com.subtit.player.plugins;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.widget.AppCompatButton;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginLoadException;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "NativeWebOverlay")
public class NativeWebOverlayPlugin extends Plugin {
    private FrameLayout overlayContainer;
    private LinearLayout overlayContent;
    private LinearLayout controlBar;
    private FrameLayout webWrapper;
    private WebView webView;
    private boolean overlayVisible = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String lastReportedUrl = null;
    private boolean trackingInjected = false;
    private boolean minimalMode = false;
    private int insetLeft = 0;
    private int insetTop = 0;
    private int insetRight = 0;
    private int insetBottom = 0;
    private boolean runtimeInjected = false;
    private final Map<String, NativeTTSPlugin.ExternalListener> ttsListenerMap = new ConcurrentHashMap<>();

    @PluginMethod
    public void show(final PluginCall call) {
        final String url = call.getString("url");
        final String mode = call.getString("mode", "default");
        final boolean minimal = mode != null && mode.equalsIgnoreCase("minimal");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }
        runOnUiThread(() -> {
            ensureOverlay(getActivity());
            if (overlayContainer == null || webView == null) {
                call.reject("Overlay not available");
                return;
            }
            emitDebug("show url=" + url + " mode=" + mode + " minimal=" + minimal + " hasControlBar=" + (controlBar != null));
            applyPresentation(minimal);
            overlayContainer.setVisibility(View.VISIBLE);
            overlayContainer.bringToFront();
            overlayVisible = true;
            enterImmersiveMode(getActivity());
            webView.onResume();
            trackingInjected = false;
            lastReportedUrl = null;
            runtimeInjected = false;
            webView.animate().cancel();
            webView.setAlpha(0f);
            webView.loadUrl(url);
            webView.post(this::injectRuntimeScript);
            notifyUrlChanged(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(final PluginCall call) {
        runOnUiThread(() -> {
            boolean changed = hideOverlayInternal(true);
            call.resolve();
            if (changed) {
                notifyClosed();
            }
        });
    }

    @PluginMethod
    public void goBack(final PluginCall call) {
        runOnUiThread(() -> {
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
            } else {
                boolean changed = hideOverlayInternal(true);
                if (changed) {
                    notifyClosed();
                }
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        runOnUiThread(() -> {
            if (webView != null) {
                webView.onPause();
                webView.stopLoading();
                webView.setWebChromeClient(null);
                webView.setWebViewClient(null);
                webView.destroy();
                webView = null;
            }
            if (overlayContainer != null) {
                ViewGroup parent = (ViewGroup) overlayContainer.getParent();
                if (parent != null) {
                    parent.removeView(overlayContainer);
                }
                overlayContainer.removeAllViews();
                overlayContainer = null;
            }
            overlayContent = null;
            controlBar = null;
            webWrapper = null;
            overlayVisible = false;
            clearAllExternalListeners();
        });
    }

    private void ensureOverlay(@Nullable Activity activity) {
        if (activity == null) {
            emitDebug("ensureOverlay skipped: activity null");
            return;
        }
        if (overlayContainer != null && webView != null) {
            emitDebug("ensureOverlay reused existing overlay");
            return;
        }

        FrameLayout root = activity.findViewById(android.R.id.content);
        if (root == null) {
            emitDebug("ensureOverlay skipped: root null");
            return;
        }

        overlayContainer = new FrameLayout(activity);
        overlayContainer.setLayoutParams(
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
        overlayContainer.setBackgroundColor(Color.parseColor("#0B1220"));
        overlayContainer.setClickable(true);
        overlayContainer.setFocusableInTouchMode(true);

        overlayContent = new LinearLayout(activity);
        overlayContent.setOrientation(LinearLayout.VERTICAL);
        overlayContent.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        overlayContainer.addView(overlayContent);

        LinearLayout controls = buildControlBar(activity);
        controlBar = controls;
        overlayContent.addView(controls);

        FrameLayout webWrapper = new FrameLayout(activity);
        LinearLayout.LayoutParams webWrapperParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f);
        webWrapperParams.topMargin = dp(activity, 12);
        webWrapper.setLayoutParams(webWrapperParams);
        webWrapper.setBackgroundColor(Color.BLACK);

        webView = new WebView(activity);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        configureWebView(webView);
        webWrapper.addView(webView);

        overlayContent.addView(webWrapper);
        this.webWrapper = webWrapper;
        emitDebug("ensureOverlay created views controlBar=" + (controlBar != null) + " webWrapper=" + (webWrapper != null));
        applyPresentation(minimalMode);

        overlayContainer.setOnKeyListener((v, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                handleBackPress();
                return true;
            }
            return false;
        });

        ViewCompat.setOnApplyWindowInsetsListener(overlayContainer, (view, insets) -> {
            Insets system = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            insetLeft = system.left;
            insetTop = system.top;
            insetRight = system.right;
            insetBottom = system.bottom;
            applyInsets();
            return insets;
        });

        root.addView(overlayContainer);
        overlayContainer.setVisibility(View.GONE);
    }

    private LinearLayout buildControlBar(@NonNull Activity activity) {
        LinearLayout controls = new LinearLayout(activity);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setBackgroundColor(Color.parseColor("#141C2F"));
        controls.setPadding(dp(activity, 16), dp(activity, 12), dp(activity, 16), dp(activity, 12));
        controls.setElevation(dp(activity, 6));

        AppCompatButton backButton = createControlButton(activity, "\u043D\u0430\u0437\u0430\u0434");
        backButton.setOnClickListener(v -> runOnUiThread(this::handleBackPress));

        AppCompatButton logButton = createControlButton(activity, "Show log");
        logButton.setOnClickListener(v -> notifyListeners("showLogRequested", new JSObject()));

        LinearLayout.LayoutParams backParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        backParams.setMargins(0, 0, dp(activity, 12), 0);
        backButton.setLayoutParams(backParams);

        LinearLayout.LayoutParams logParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        logButton.setLayoutParams(logParams);

        controls.addView(backButton);
        controls.addView(logButton);

        return controls;
    }

    private void applyPresentation(boolean minimal) {
        minimalMode = minimal;
        Activity activity = getActivity();
        emitDebug("applyPresentation minimal=" + minimal + " controlBar=" + (controlBar != null) + " webWrapper=" + (webWrapper != null));
        if (controlBar != null) {
            controlBar.setVisibility(minimal ? View.GONE : View.VISIBLE);
        }
        if (webWrapper != null) {
            LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) webWrapper.getLayoutParams();
            if (params != null) {
                int margin = 0;
                if (!minimal) {
                    margin = activity != null ? dp(activity, 12) : params.topMargin;
                }
                params.topMargin = margin;
                webWrapper.setLayoutParams(params);
            }
        }
        applyInsets();
    }

    private void applyInsets() {
        if (overlayContent == null) {
            return;
        }
        int top = minimalMode ? 0 : insetTop;
        int bottom = minimalMode ? 0 : insetBottom;
        overlayContent.setPadding(insetLeft, top, insetRight, bottom);
        emitDebug("applyInsets minimal=" + minimalMode + " padding=(" + insetLeft + "," + top + "," + insetRight + "," + bottom + ")");
    }

    private AppCompatButton createControlButton(@NonNull Activity activity, @NonNull String text) {
        AppCompatButton button = new AppCompatButton(activity);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(Color.parseColor("#1E293B"));
        button.setPadding(dp(activity, 20), dp(activity, 12), dp(activity, 20), dp(activity, 12));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            button.setElevation(dp(activity, 2));
        }
        return button;
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView(@NonNull WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        view.addJavascriptInterface(new LocationBridge(), "NativeOverlayBridge");
        view.setBackgroundColor(Color.BLACK);
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView wv, String url) {
                notifyUrlChanged(url);
                trackingInjected = false;
                runtimeInjected = false;
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView wv, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    notifyUrlChanged(request.getUrl().toString());
                }
                trackingInjected = false;
                runtimeInjected = false;
                return false;
            }

            @Override
            public void onPageFinished(WebView wv, String url) {
                super.onPageFinished(wv, url);
                notifyUrlChanged(url);
                injectRuntimeScript();
                injectTrackingScript();
                revealWebContent();
            }

            @Override
            public void onPageCommitVisible(WebView wv, String url) {
                super.onPageCommitVisible(wv, url);
                injectRuntimeScript();
                injectTrackingScript();
                revealWebContent();
            }
        });
    }

    private void handleBackPress() {
        if (hideOverlayInternal(true)) {
            notifyClosed();
        }
    }

    private boolean hideOverlayInternal(boolean pauseWebView) {
        if (!overlayVisible) {
            return false;
        }
        overlayVisible = false;
        clearAllExternalListeners();
        if (overlayContainer != null) {
            overlayContainer.setVisibility(View.GONE);
        }
        if (pauseWebView && webView != null) {
            webView.onPause();
            webView.stopLoading();
        }
        if (webView != null) {
            webView.animate().cancel();
            webView.setAlpha(1f);
        }
        trackingInjected = false;
        return true;
    }

    private void notifyUrlChanged(@Nullable String url) {
        if (url == null) {
            return;
        }
        if (lastReportedUrl != null && lastReportedUrl.equals(url)) {
            return;
        }
        lastReportedUrl = url;
        JSObject data = new JSObject();
        data.put("url", url);
        notifyListeners("urlChange", data);
    }

    private void notifyClosed() {
        notifyListeners("closed", new JSObject());
    }

    private void runOnUiThread(@NonNull Runnable runnable) {
        Activity activity = getActivity();
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(runnable);
    }

    private void enterImmersiveMode(@Nullable Activity activity) {
        if (activity == null) {
            return;
        }
        WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(activity.getWindow(), activity.getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }


    private void revealWebContent() {
        if (webView == null) {
            return;
        }
        if (webView.getAlpha() >= 1f) {
            return;
        }
        webView.animate().cancel();
        webView.animate().alpha(1f).setDuration(150).start();
    }

    private void handleBridgeMessage(String rawMessage) {
        if (rawMessage == null || rawMessage.trim().isEmpty()) {
            return;
        }
        try {
            JSONObject payload = new JSONObject(rawMessage);
            String type = payload.optString("type", "request");
            emitDebug("[Bridge] message type=" + type + " plugin=" + payload.optString("plugin") + " method=" + payload.optString("method"));
            switch (type) {
                case "request":
                    handleBridgeRequest(payload);
                    break;
                case "addListener":
                    handleBridgeAddListener(payload);
                    break;
                case "removeListener":
                    handleBridgeRemoveListener(payload);
                    break;
                default:
                    emitDebug("Unknown bridge message type=" + type);
            }
        } catch (JSONException ex) {
            emitDebug("Bridge message parse error: " + ex.getMessage());
        }
    }

    private void handleBridgeRequest(JSONObject payload) throws JSONException {
        String requestId = payload.optString("id", "");
        String plugin = payload.optString("plugin", "");
        String method = payload.optString("method", "");
        JSONObject params = payload.optJSONObject("params");
        emitDebug("[Bridge] request id=" + requestId + " plugin=" + plugin + " method=" + method);
        if (plugin.isEmpty()) {
            sendError(requestId, "Plugin not specified");
            return;
        }
        if (method.isEmpty()) {
            sendError(requestId, "Method not specified");
            return;
        }
        if ("NativeTTS".equals(plugin)) {
            handleTtsRequest(requestId, method, params);
            return;
        }
        sendError(requestId, "Unsupported plugin " + plugin);
    }

    private void handleBridgeAddListener(JSONObject payload) {
        String plugin = payload.optString("plugin", "");
        String event = payload.optString("event", "");
        String listenerId = payload.optString("listenerId", "");
        emitDebug("[Bridge] addListener plugin=" + plugin + " event=" + event + " id=" + listenerId);
        if (plugin.isEmpty() || event.isEmpty() || listenerId.isEmpty()) {
            emitDebug("Invalid listener payload: " + payload.toString());
            return;
        }
        if (!"NativeTTS".equals(plugin)) {
            emitDebug("Unsupported listener plugin=" + plugin);
            return;
        }
        NativeTTSPlugin ttsPlugin = getNativeTtsPlugin();
        if (ttsPlugin == null) {
            emitDebug("NativeTTS unavailable for listener");
            return;
        }
        if (ttsListenerMap.containsKey(listenerId)) {
            return;
        }
        NativeTTSPlugin.ExternalListener externalListener = (eventName, data) -> {
            if (!event.equals(eventName)) {
                return;
            }
            sendEventToWeb("NativeTTS", eventName, data);
        };
        ttsListenerMap.put(listenerId, externalListener);
        ttsPlugin.addExternalListener(externalListener);
    }

    private void handleBridgeRemoveListener(JSONObject payload) {
        String listenerId = payload.optString("listenerId", "");
        if (listenerId.isEmpty()) {
            return;
        }
        emitDebug("[Bridge] removeListener id=" + listenerId);
        NativeTTSPlugin.ExternalListener listener = ttsListenerMap.remove(listenerId);
        NativeTTSPlugin ttsPlugin = getNativeTtsPlugin();
        if (listener != null && ttsPlugin != null) {
            ttsPlugin.removeExternalListener(listener);
        }
    }

    private void handleTtsRequest(String requestId, String method, @Nullable JSONObject params) {
        NativeTTSPlugin ttsPlugin = getNativeTtsPlugin();
        if (ttsPlugin == null) {
            sendError(requestId, "NativeTTS unavailable");
            return;
        }
        emitDebug("[Bridge] TTS call method=" + method + " id=" + requestId);
        try {
            JSObject result;
            switch (method) {
                case "isAvailable":
                    result = ttsPlugin.isAvailableSync();
                    break;
                case "getEngines":
                    result = ttsPlugin.getEnginesSync();
                    break;
                case "getAvailableLanguages":
                    result = ttsPlugin.getAvailableLanguagesSync();
                    break;
                case "getVoices":
                    result = ttsPlugin.getVoicesSync();
                    break;
                case "selectEngine":
                    result = ttsPlugin.selectEngineSync(params != null ? params.optString("engineId", null) : null);
                    break;
                case "speak":
                    result = ttsPlugin.speakSync(
                            params != null ? params.optString("text", null) : null,
                            params != null ? params.optString("voiceId", null) : null,
                            (params != null && params.has("rate")) ? params.optDouble("rate") : null,
                            (params != null && params.has("pitch")) ? params.optDouble("pitch") : null
                    );
                    break;
                case "stop":
                    ttsPlugin.stopSync();
                    result = new JSObject();
                    break;
                case "setPitch":
                    result = ttsPlugin.setPitchSync((params != null && params.has("pitch")) ? params.optDouble("pitch") : null);
                    break;
                case "setSpeechRate":
                    result = ttsPlugin.setSpeechRateSync((params != null && params.has("rate")) ? params.optDouble("rate") : null);
                    break;
                default:
                    sendError(requestId, "Unsupported method " + method);
                    return;
            }
            sendSuccess(requestId, result);
        } catch (IllegalArgumentException | IllegalStateException ex) {
            sendError(requestId, ex.getMessage());
        }
    }

    private void sendSuccess(@Nullable String requestId, @Nullable JSObject result) {
        if (requestId == null || requestId.isEmpty()) {
            return;
        }
        try {
            emitDebug("[Bridge] sendSuccess id=" + requestId);
            JSONObject message = new JSONObject();
            message.put("type", "response");
            message.put("id", requestId);
            message.put("result", result != null ? new JSONObject(result.toString()) : new JSONObject());
            dispatchToWeb(message);
        } catch (JSONException ex) {
            emitDebug("sendSuccess failed: " + ex.getMessage());
        }
    }

    private void sendError(@Nullable String requestId, @Nullable String errorMessage) {
        try {
            emitDebug("[Bridge] sendError id=" + requestId + " message=" + errorMessage);
            JSONObject message = new JSONObject();
            message.put("type", "response");
            if (requestId != null && !requestId.isEmpty()) {
                message.put("id", requestId);
            }
            JSONObject error = new JSONObject();
            error.put("message", errorMessage != null ? errorMessage : "Unknown error");
            message.put("error", error);
            dispatchToWeb(message);
        } catch (JSONException ex) {
            emitDebug("sendError failed: " + ex.getMessage());
        }
    }

    private void sendEventToWeb(@NonNull String pluginName, @NonNull String eventName, @NonNull JSObject data) {
        try {
            emitDebug("[Bridge] sendEvent plugin=" + pluginName + " event=" + eventName);
            JSONObject payload = new JSONObject();
            payload.put("type", "event");
            payload.put("plugin", pluginName);
            payload.put("event", eventName);
            payload.put("data", new JSONObject(data.toString()));
            dispatchToWeb(payload);
        } catch (JSONException ex) {
            emitDebug("sendEvent failed: " + ex.getMessage());
        }
    }

    private void dispatchToWeb(@NonNull JSONObject message) {
        if (webView == null) {
            return;
        }
        emitDebug("[Bridge] dispatchToWeb type=" + message.optString("type") + " plugin=" + message.optString("plugin") + " id=" + message.optString("id"));
        final String script = "window.__nativeOverlayDispatch && window.__nativeOverlayDispatch(" + message.toString() + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void injectRuntimeScript() {
        if (webView == null || runtimeInjected) {
            return;
        }
        emitDebug("[Bridge] Injecting runtime script");
        final String script = buildRuntimeScript();
        runtimeInjected = true;
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private String buildRuntimeScript() {
        return "(function(){"
                + "if(window.__nativeOverlayRuntime){return;}window.__nativeOverlayRuntime=true;"
                + "console.log('[NativeOverlay] runtime:init');"
                + "const pending=new Map();const listeners=new Map();let reqId=0;"
                + "const key=(plugin,event)=>plugin+':'+event;"
                + "const ensureListeners=(k)=>{if(!listeners.has(k)){listeners.set(k,new Map());}return listeners.get(k);};"
                + "const postMessage=(msg)=>{try{console.log('[NativeOverlay] runtime:post',msg.type,msg.plugin,msg.method);window.NativeOverlayBridge&&window.NativeOverlayBridge.postMessage(JSON.stringify(msg));}catch(err){console.error('[NativeOverlay] runtime:post error',err);}};"
                + "window.__nativeOverlayDispatch=function(message){if(!message){return;}console.log('[NativeOverlay] runtime:dispatch',message.type,message.plugin,message.event||message.id);if(message.type==='response'){const entry=pending.get(message.id);if(!entry){return;}pending.delete(message.id);if(message.error){entry.reject(new Error(message.error.message||message.error));}else{entry.resolve(message.result);}}else if(message.type==='event'){const k=key(message.plugin,message.event);const map=listeners.get(k);if(!map){return;}map.forEach((cb)=>{try{cb(message.data||{});}catch(err){console.error('[NativeOverlay] runtime:event error',err);}});}else if(message.type==='log'){console.log('[NativeOverlay]',message.message);}};"
                + "const invoke=(plugin,method,params)=>{const id=String(++reqId);console.log('[NativeOverlay] runtime:invoke',plugin,method,id);return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});postMessage({type:'request',id,plugin,method,params:params||{}});});};"
                + "const registerListener=(plugin,eventName,callback)=>{const k=key(plugin,eventName);const map=ensureListeners(k);const existing=[...map.values()].find((entry)=>entry===callback);if(existing){return{remove:async()=>{}};}const listenerId='L'+(++reqId);map.set(listenerId,callback);postMessage({type:'addListener',plugin,event:eventName,listenerId});return{remove:async()=>{const current=listeners.get(k);if(current&&current.has(listenerId)){current.delete(listenerId);postMessage({type:'removeListener',plugin,event:eventName,listenerId});}}};};"
                + "const cap=window.Capacitor||{};cap.getPlatform=()=> 'android';cap.isNativePlatform=()=>true;cap.Plugins=cap.Plugins||{};"
                + "cap.nativePromise=(plugin,method,options)=>invoke(plugin,method,options||{});"
                + "cap.nativeCallback=(plugin,method,options,callback)=>{if(method==='addListener'){const eventName=options&&options.eventName;if(!eventName||typeof callback!=='function'){return Promise.reject(new Error('addListener requires eventName and callback'));}const reg=registerListener(plugin,eventName,callback);return Promise.resolve({remove:reg.remove});}return cap.nativePromise(plugin,method,options).then((result)=>{if(typeof callback==='function'){callback(result);}return result;});};"
                + "const createPluginProxy=(plugin)=>new Proxy({}, {get(_,prop){if(prop==='addListener'){return (eventName,callback)=>registerListener(plugin,eventName,callback);}return (params)=>cap.nativePromise(plugin,String(prop),params||{});}});"
                + "cap.Plugins.NativeTTS=createPluginProxy('NativeTTS');"
                + "window.Capacitor=cap;window.CapacitorPlugins=cap.Plugins;"
                + "})();";
    }

    private NativeTTSPlugin getNativeTtsPlugin() {
        if (getBridge() == null) {
            return null;
        }
        try {
            PluginHandle handle = getBridge().getPlugin("NativeTTS");
            if (handle == null) {
                return null;
            }
            Plugin pluginInstance = handle.getInstance();
            if (pluginInstance == null) {
                pluginInstance = handle.load();
            }
            if (pluginInstance instanceof NativeTTSPlugin) {
                return (NativeTTSPlugin) pluginInstance;
            }
        } catch (PluginLoadException ex) {
            emitDebug("Failed to load NativeTTS plugin: " + ex.getMessage());
        }
        return null;
    }

    private void clearAllExternalListeners() {
        NativeTTSPlugin ttsPlugin = getNativeTtsPlugin();
        if (ttsPlugin != null) {
            for (NativeTTSPlugin.ExternalListener listener : ttsListenerMap.values()) {
                ttsPlugin.removeExternalListener(listener);
            }
        }
        ttsListenerMap.clear();
    }

    private int dp(@NonNull Activity activity, int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics()));
    }

    private void emitDebug(@NonNull String message) {
        Log.i("NativeWebOverlay", message);
        JSObject payload = new JSObject();
        payload.put("message", message);
        notifyListeners("debug", payload);
    }

    private void injectTrackingScript() {
        if (webView == null || trackingInjected) {
            return;
        }
        trackingInjected = true;
        final String script = "(function(){"
                + "if(window.__nativeOverlayTracking){return;}window.__nativeOverlayTracking=true;"
                + "const bridge=window.NativeOverlayBridge;"
                + "const notify=()=>{try{bridge&&bridge.notifyLocation&&bridge.notifyLocation(window.location.href);}catch(e){}};"
                + "let lastHref='';"
                + "const trigger=()=>{const href=window.location.href;if(href===lastHref){return;}lastHref=href;notify();};"
                + "const wrap=method=>{const original=history[method];if(!original)return;history[method]=function(){const result=original.apply(this,arguments);setTimeout(trigger,0);return result;};};"
                + "wrap('pushState');wrap('replaceState');"
                + "window.addEventListener('popstate',trigger,true);"
                + "window.addEventListener('hashchange',trigger,true);"
                + "window.addEventListener('yt-navigation-finish',trigger,true);"
                + "document.addEventListener('yt-navigate-finish',trigger,true);"
                + "document.addEventListener('yt-page-data-updated',trigger,true);"
                + "const observer=new MutationObserver(()=>trigger());"
                + "if(document.body){observer.observe(document.body,{childList:true,subtree:true});}"
                + "setInterval(trigger,2000);"
                + "trigger();"
                + "})();";
        webView.evaluateJavascript(script, null);
    }

    private class LocationBridge {
        @JavascriptInterface
        public void notifyLocation(final String url) {
            mainHandler.post(() -> notifyUrlChanged(url));
        }

        @JavascriptInterface
        public void postMessage(final String message) {
            mainHandler.post(() -> handleBridgeMessage(message));
        }
    }
}
