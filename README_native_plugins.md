# Native plugins & Capacitor (Android)

## Зачем нужен патч
- Capacitor генерирует `native-bridge.js` только по списку из `android/app/src/main/assets/capacitor.plugins.json`.
- Если там нет `NativeVpn`, `NativeTTS`, `NativeUtilities`, `NativePurchases` и `NativeWebOverlay`, то JS не увидит нативный API и вы получите `"<PluginName>" plugin is not implemented on android`.

## Как синхронизировать
1. После любого `npx cap sync android` или обновления `node_modules` запускайте:
   ```bash
   npm run cap:sync:android
   ```
2. Скрипт `scripts/patch-capacitor-plugins.mjs` дописывает все кастомные плагины в исходный `capacitor.plugins.json`, а при наличии — и в собранные `build/intermediates/.../capacitor.plugins.json`.
3. При необходимости его можно дернуть вручную:
   ```bash
   node scripts/patch-capacitor-plugins.mjs
   ```

## Диагностика
- Если на устройстве снова видно `"<PluginName>" plugin is not implemented on android`, проверьте, что файл `android/app/src/main/assets/capacitor.plugins.json` содержит наши классы и перезапустите билд (`./gradlew assembleDebug`).
- В `android/app/build/intermediates/assets/*/native-bridge.js` должен появиться блок с `window.Capacitor.PluginHeaders = ... "NativeVpn" ...`.
