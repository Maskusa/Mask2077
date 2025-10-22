package com.subtit.player.plugins;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeWebOverlay")
public class NativeWebOverlayPlugin extends Plugin {
    private FrameLayout overlayContainer;
    private LinearLayout overlayContent;
    private WebView webView;
    private boolean overlayVisible = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String lastReportedUrl = null;
    private boolean trackingInjected = false;

    @PluginMethod
    public void show(final PluginCall call) {
        final String url = call.getString("url");
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
            overlayContainer.setVisibility(View.VISIBLE);
            overlayContainer.bringToFront();
            overlayVisible = true;
            enterImmersiveMode(getActivity());
            webView.onResume();
            trackingInjected = false;
            lastReportedUrl = null;
            webView.animate().cancel();
            webView.setAlpha(0f);
            webView.loadUrl(url);
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
            overlayVisible = false;
        });
    }

    private void ensureOverlay(@Nullable Activity activity) {
        if (activity == null) {
            return;
        }
        if (overlayContainer != null && webView != null) {
            return;
        }

        FrameLayout root = activity.findViewById(android.R.id.content);
        if (root == null) {
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

        overlayContainer.setOnKeyListener((v, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                handleBackPress();
                return true;
            }
            return false;
        });

        ViewCompat.setOnApplyWindowInsetsListener(overlayContainer, (view, insets) -> {
            Insets system = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            overlayContent.setPadding(system.left, system.top, system.right, system.bottom);
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
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView wv, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    notifyUrlChanged(request.getUrl().toString());
                }
                trackingInjected = false;
                return false;
            }

            @Override
            public void onPageFinished(WebView wv, String url) {
                super.onPageFinished(wv, url);
                notifyUrlChanged(url);
                injectTrackingScript();
                revealWebContent();
            }

            @Override
            public void onPageCommitVisible(WebView wv, String url) {
                super.onPageCommitVisible(wv, url);
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

    private int dp(@NonNull Activity activity, int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics()));
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
    }
}


















