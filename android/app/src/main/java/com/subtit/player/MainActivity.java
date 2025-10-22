package com.subtit.player;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.subtit.player.plugins.NativeTTSPlugin;
import com.subtit.player.plugins.NativeWebOverlayPlugin;
import com.subtit.player.plugins.NativeUtilitiesPlugin;
import com.subtit.player.plugins.NativePurchasesPlugin;
import com.getcapacitor.community.admob.AdMob;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeTTSPlugin.class);
        registerPlugin(NativeWebOverlayPlugin.class);
        registerPlugin(NativeUtilitiesPlugin.class);
        registerPlugin(NativePurchasesPlugin.class);
        registerPlugin(AdMob.class);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
