package com.subtit.player.plugins;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "NativeUtilities")
public class NativeUtilitiesPlugin extends Plugin {

    private static final AtomicBoolean reviewFlowConsumed = new AtomicBoolean(false);

    @PluginMethod
    public void rateApp(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        if (reviewFlowConsumed.get()) {
            openStoreFallback(activity);
            JSObject result = new JSObject();
            result.put("fallback", true);
            result.put("reason", "already_consumed");
            call.resolve(result);
            return;
        }

        ReviewManager manager = ReviewManagerFactory.create(activity);
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            reviewFlowConsumed.set(true);
            if (task.isSuccessful()) {
                ReviewInfo reviewInfo = task.getResult();
                manager.launchReviewFlow(activity, reviewInfo).addOnCompleteListener(flowTask -> {
                    boolean fallbackUsed = !flowTask.isSuccessful();
                    if (fallbackUsed) {
                        openStoreFallback(activity);
                    }
                    JSObject result = new JSObject();
                    result.put("fallback", fallbackUsed);
                    result.put("reason", fallbackUsed ? "launch_failed" : "launched");
                    call.resolve(result);
                });
            } else {
                openStoreFallback(activity);
                JSObject result = new JSObject();
                result.put("fallback", true);
                result.put("reason", "request_failed");
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void shareApp(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("text is required");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }
        Intent sendIntent = new Intent(Intent.ACTION_SEND);
        sendIntent.putExtra(Intent.EXTRA_TEXT, text);
        sendIntent.setType("text/plain");
        Intent shareIntent = Intent.createChooser(sendIntent, null);
        activity.startActivity(shareIntent);
        call.resolve();
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        Activity activity = getActivity();
        Context context = getContext();
        if (activity == null || context == null) {
            call.reject("Context not available");
            return;
        }

        try {
            clearDirectory(context.getCacheDir());
            clearDirectory(context.getExternalCacheDir());
        } catch (Exception ex) {
            call.reject("Failed to clear cache directories: " + ex.getMessage());
            return;
        }

        Handler mainHandler = new Handler(Looper.getMainLooper());
        mainHandler.post(() -> {
            try {
                WebStorage.getInstance().deleteAllData();
            } catch (Exception ignored) {
                // ignore WebStorage cleanup errors
            }
            try {
                CookieManager cookieManager = CookieManager.getInstance();
                cookieManager.removeAllCookies(null);
                cookieManager.flush();
            } catch (Exception ignored) {
                // ignore CookieManager cleanup errors
            }
            try {
                WebView webView = new WebView(activity);
                webView.clearCache(true);
                webView.clearHistory();
                webView.destroy();
            } catch (Exception ignored) {
                // ignore WebView cleanup errors
            }
            call.resolve();
        });
    }

    private void openStoreFallback(Activity activity) {
        String packageName = activity.getPackageName();
        Uri uri = Uri.parse("market://details?id=" + packageName);
        Intent goToMarket = new Intent(Intent.ACTION_VIEW, uri);
        goToMarket.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY | Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        try {
            activity.startActivity(goToMarket);
        } catch (ActivityNotFoundException e) {
            Uri webUri = Uri.parse("https://play.google.com/store/apps/details?id=" + packageName);
            activity.startActivity(new Intent(Intent.ACTION_VIEW, webUri));
        }
    }

    private void clearDirectory(File dir) {
        if (dir == null || !dir.exists()) {
            return;
        }
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (file.isDirectory()) {
                clearDirectory(file);
            }
            if (!file.delete()) {
                file.deleteOnExit();
            }
        }
    }
}
