# README Import V2ray Guide

## Overview
This document guides you through importing the `com.v2ray.ang` stack from the v2rayNG project into this repository. The goal is to replicate the working VPN functionality (via VpnService and tun2socks) within the project.

## Pre-requisites
1. **Development environment:**
   - Android Studio (latest stable release)
   - Java Development Kit (JDK 17+)
   - Android NDK (matching the version used by v2rayNG, typically r23+)
   - Gradle (use Android Studio’s wrapper)
2. **Repository access:**
   - This repository checked out locally
   - Permissions to clone v2rayNG (`https://github.com/2dust/v2rayNG`)
3. **Device for testing:** Android 8.0+ with developer mode enabled

## High-Level Tasks
1. Clone v2rayNG and inspect the service layer:
   - Files under `V2rayNG/app/src/main/java/com/v2ray/ang/service`
   - Native build scripts `compile-tun2socks.sh`, `tun2socks.mk`
2. Copy over required Java/Kotlin packages and resources into this project:
   - `com.v2ray.ang.service` (VpnService, Tun2SocksService, etc.)
   - Utility classes they depend on (NotificationManager, SettingsManager, etc.)
   - Foreground notification resources (layout, drawable, strings)
   - AndroidManifest entries (service declarations, permissions)
3. Integrate the NDK components:
   - Copy tun2socks sources (or binaries) into `app/src/main/jniLibs`
   - Configure `build.gradle` for NDK module building (or include pre-built `.so`)
   - Ensure `classpath`/`externalNativeBuild` entries mirror v2rayNG’s
4. Wiring with this project’s plugin/UI:
   - Update `NativeVpnPlugin` to start/stop the Foreground service instead of directly invoking libv2ray
   - Provide state callbacks back to Capacitor (running/stats/errors)
   - Adjust JS (`ServerSettings.tsx`) to handle service-based lifecycle
5. Test end-to-end:
   - Build `./gradlew :app:assembleDebug`
   - Install on device, grant VPN permissions, start tunnel
   - Verify system VPN key icon appears and traffic flows through xray

## Detailed Steps
### Step 1 – Clone v2rayNG
```bash
git clone https://github.com/2dust/v2rayNG.git ../v2rayNG
```
Key directories:
- `V2rayNG/app/src/main/java/com/v2ray/ang/service`
- `V2rayNG/app/src/main/java/com/v2ray/ang/ui` (for notification)
- `V2rayNG/app/src/main/res/*` (strings, layouts, drawables)

### Step 2 – Copy Service Layer
Create matching packages in this repo under `android/app/src/main/java`:
```
com/subtit/player/vpn/service/
com/subtit/player/vpn/handler/
...
```
Copy the following core files from v2rayNG:
- `V2RayVpnService.kt`
- `Tun2SocksService.kt`, `Tun2SocksControl.kt`, `TProxyService.kt`
- `ProcessService.kt`, `ServiceControl.kt`
- Dependencies like `NotificationManager`, `SettingsManager`, `MmkvManager` (or stub if not used)
Update package names to `com.subtit.player`.

### Step 3 – Foreground Notification
Copy notification-related assets:
- Layouts (`res/layout/notification_vpn.xml`)
- Drawables (`res/drawable/ic_vpn_notification.xml`, icons)
- Strings (notification channels, status messages)
Add notification channel creation if targeting Android 8+.

### Step 4 – Native (tun2socks)
Option A – Prebuilt `.so`:
1. Build tun2socks via v2rayNG script (`compile-tun2socks.sh`), or download from its releases.
2. Place resulting `.so` for each ABI in `android/app/src/main/jniLibs/{arm64-v8a,armeabi-v7a,...}`.

Option B – Build within this project:
1. Copy `tun2socks.mk`, `compile-tun2socks.sh`, and dependencies (`hev-socks5-tunnel`, `badvpn`, `libancillary`).
2. Configure `externalNativeBuild` in `build.gradle` to build tun2socks during Gradle sync.

### Step 5 – Manifest & Permissions
Update `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

<application ...>
    <service
        android:name=".vpn.service.V2RayVpnService"
        android:permission="android.permission.BIND_VPN_SERVICE"
        android:exported="false" />
    <service
        android:name=".vpn.service.Tun2SocksService"
        android:exported="false" />
    <!-- any additional services from v2rayNG -->
</application>
```
Ensure `<uses-feature android:name="android.software.leanback" android:required="false" />` remains unaffected.

### Step 6 – Integrate with NativeVpnPlugin
1. Modify `NativeVpnPlugin` to:
   - Request VPN permission
   - Start `V2RayVpnService` via `Context.startForegroundService`
   - Pass config (JSON, outboundTag, profileLabel) via Intent extras or bound service
   - Listen for status broadcasts (running state, errors)
2. Update `stop()` to send stop intent to the service.
3. Provide callbacks to JS so UI reflects the Foreground service state.

### Step 7 – JavaScript Updates
`ServerSettings.tsx` already logs flow. Ensure it:
- Awaits service state (listeners) instead of immediate `NativeVpn.start` return.
- Handles new error codes (e.g., permission revoked via `onRevoke`).

### Step 8 – Build & Test
1. `npm run build`
2. `./gradlew :app:assembleDebug`
3. Install APK, grant VPN permission prompt
4. Start tunnel: verify notification + system key icon
5. Test browsing or `curl https://ipinfo.io` to confirm IP change

## Notes
- Keep licenses: v2rayNG is GPLv3; merging its code may impose license requirements.
- Consider modularizing imported code to simplify future updates.
- Ensure tun2socks binary matches device architectures; otherwise, runtime crashes will occur.
- Watch logcat (`adb logcat | grep -E "NativeVpn|V2Ray|tun2socks"`) for debugging.

## Next Steps
After successful import:
1. Clean up unused utilities from v2rayNG to reduce APK size.
2. Add telemetry/log forwarding for VPN state to existing UI.
3. Consider abstracting backend to support alternate tunneling options in the future.
