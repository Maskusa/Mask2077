# Android VPN Integration Plan

## Goal
Route all in-app traffic (including WebView) through 3proxy (`45.151.183.153`) using SOCKS5 or HTTP CONNECT, keeping native footprint minimal while providing metrics, automatic recovery, and a rich diagnostics surface.

## Architecture Snapshot
1. **VpnService (Kotlin/Java)** вЂ” creates TUN, requests permission, runs foreground notification, monitors tunnel health, and triggers exponential restart on crashes.  
2. **Tun2Socks (C/C++)** вЂ” vendored `heiher/hev-socks5-tunnel` + deps. JNI start/stop returns stats, exit codes, and error strings.  
3. **HTTP Bridge (Java)** вЂ” `HttpProxySocksBridge` exposes a local SOCKS5в†’HTTP CONNECT bridge with connection limits, timeouts, metrics counters, and listener callbacks.  
4. **Capacitor & UI** вЂ” `NativeVpnPlugin` and `ServerSettings.tsx` surface tunnel state, bytes/packets, exit code, restart attempts, and last restart reason to the user.

## Roadmap
1. **Project setup**: [x] NDK/CMake, Capacitor plugin, TS wrapper.  
2. **Tun2Socks integration**: [x] vendored sources, CMake, JNI glue, stats forwarding.  
3. **Proxy transports**: [x] SOCKS5 (native); [x] HTTP CONNECT via Java bridge; [ ] optional JNI callbacks for custom transports.  
4. **VpnService lifecycle**: [x] TUN + notification; [x] crash monitor + backoff restart; [ ] per-app/exclusion lists.  
5. **Error handling**: [x] exit codes/errors surfaced to plugin; [x] auto-restart with logging and telemetry; [ ] history/persisted diagnostics.  
6. **UI**: [x] VPN card with metrics, exit code, native state, retries, last reason/time; [ ] UX hints for modes.  
7. **Testing**: [ ] JVM tests for HTTP bridge; [ ] integration checks (traffic routing, DNS leaks, QUIC fallback).  
8. **Packaging**: [ ] Strip & licenses; [ ] ProGuard rules; [ ] document 3proxy server-side configuration.

## Current Status (20251106)
- Foreground `ProxyVpnService` handles monitoring, exponential restarts, bridge metrics logging, and rich notifications.  
- `HttpProxySocksBridge` supports listeners, counters (accepted/rejected/failures, up/down bytes), configurable timeouts, connection limits, and graceful shutdown.  
- UI displays bytes, packets, exit code, native state, restart count, last restart timestamp/reason, and logs diagnostic messages.  
- `./gradlew.bat :app:assembleDebug` and `:app:testDebugUnitTest` pass.

## Next Steps
1. Implement JVM test coverage for `HttpProxySocksBridge` diagnostics, verifying counters and failure paths.  
2. Persist restart history and expose it in UI if needed.  
3. Harden credential storage and document 3proxy configuration/use cases.

## WireGuard Peer Assignment Cheatsheet

| Р§С‚Рѕ РЅСѓР¶РЅРѕ | РџРѕС‡РµРјСѓ РІР°Р¶РЅРѕ |
|-----------|--------------|
| **РџСЂРѕС„РёР»СЊ Р±РµСЂС‘Рј С‚РѕР»СЊРєРѕ РёР· `/oneclick`.** РљР»РёРµРЅС‚ РїРѕР»СѓС‡Р°РµС‚ РіРѕС‚РѕРІС‹Р№ `wg`вЂ‘РєРѕРЅС„РёРі РѕС‚ API Рё РЅРµ РјРµРЅСЏРµС‚ `Address`, `AllowedIPs`, `PublicKey`. Р­С‚Рё РїРѕР»СЏ СЃРѕР·РґР°С‘С‚ СЃРµСЂРІРµСЂ, Рё РѕРЅРё СѓР¶Рµ РїСЂРёРІСЏР·Р°РЅС‹ Рє РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ РїРёСЂСѓ. | Р•СЃР»Рё РІСЂСѓС‡РЅСѓСЋ РёР·РјРµРЅРёС‚СЊ `Address` (РЅР°РїСЂРёРјРµСЂ, СЃ `10.66.66.24/32` РЅР° `10.66.66.26/32`), СЃРµСЂРІРµСЂ РЅРµ РЅР°Р№РґС‘С‚ С‚Р°РєРѕРіРѕ РїРёСЂР° в†’ РЅРµ Р±СѓРґРµС‚ СЂСѓРєРѕРїРѕР¶Р°С‚РёСЏ, Р»РѕРі `tcpdump` РїРѕРєР°Р¶РµС‚ `0 packets captured`, Р° РєР»РёРµРЅС‚ СѓРІРёРґРёС‚ `Unable to resolve host вЂ¦`. |
| **РљР°Р¶РґС‹Р№ РїРёСЂ РЅР° СЃРµСЂРІРµСЂРµ РёРјРµРµС‚ СѓРЅРёРєР°Р»СЊРЅС‹Р№ `/32`.** РџСЂРёРјРµСЂ РёР· `wg show`: `allowed ips: 10.66.66.24/32`. Р”Р»СЏ РЅРѕРІРѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° РґРѕР±Р°РІР»СЏРµРј РЅРѕРІСѓСЋ СЃС‚СЂРѕРєСѓ РІ `wg0.conf`. | Р”СѓР±Р»РёСЂРѕРІР°РЅРёРµ `/32` РёР»Рё РѕС‚СЃСѓС‚СЃС‚РІРёРµ Р·Р°РїРёСЃРё (РєР°Рє РІ СЃР»СѓС‡Р°Рµ СЃ `10.66.66.26/32`) РїСЂРёРІРѕРґРёС‚ Рє В«Р·Р°РїСѓСЃС‚РёР»СЃСЏ, РЅРѕ РЅРµС‚ РёРЅС‚РµСЂРЅРµС‚Р°В». |
| **Endpoint Рё РїРѕСЂС‚ РґРѕР»Р¶РЅС‹ СЃРѕРІРїР°РґР°С‚СЊ.** РЎРµР№С‡Р°СЃ СЃРµСЂРІРµСЂ СЃР»СѓС€Р°РµС‚ `45.151.183.153:443/udp`. | РќРµСЃРѕРІРїР°РґРµРЅРёРµ РїСЂРёРІРѕРґРёС‚ Рє РѕС‚СЃСѓС‚СЃС‚РІРёСЋ СЂСѓРєРѕРїРѕР¶Р°С‚РёР№; tcpdump РЅР° РІРЅРµС€РЅРµРј РёРЅС‚РµСЂС„РµР№СЃРµ РЅРёС‡РµРіРѕ РЅРµ СѓРІРёРґРёС‚. |
| **NAT/С„РѕСЂРІР°СЂРґРёРЅРі РЅР° СЃРµСЂРІРµСЂРµ:**<br>`sysctl -w net.ipv4.ip_forward=1`<br>`iptables -t nat -A POSTROUTING -o ens3 -j MASQUERADE`<br>`iptables -A FORWARD -i wg0 -o ens3 -j ACCEPT`<br>`iptables -A FORWARD -m state --state ESTABLISHED,RELATED -i ens3 -o wg0 -j ACCEPT` | Р‘РµР· СЌС‚РёС… РїСЂР°РІРёР» С‚СЂР°С„РёРє РєР»РёРµРЅС‚РѕРІ РЅРµ РІС‹Р№РґРµС‚ РІ РёРЅС‚РµСЂРЅРµС‚ РґР°Р¶Рµ РїСЂРё СѓСЃРїРµС€РЅРѕРј WGвЂ‘СЂСѓРєРѕРїРѕР¶Р°С‚РёРё. |
| **РљР»РёРµРЅС‚ РїСЂРѕРІРµСЂСЏРµРј С‚Р°Рє:**<br>`ping 1.1.1.1`<br>`curl https://api.ipify.org` | Р Р°Р±РѕС‚Р°РµС‚ в†’ С‚СѓРЅРЅРµР»СЊ Рё DNS РѕРє. |
| **РЎРµСЂРІРµСЂ РїСЂРѕРІРµСЂСЏРµРј С‚Р°Рє:**<br>`watch -n1 wg show` в†’ СЂР°СЃС‚СѓС‚ `transfer` Рё РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ `latest handshake`. | РњРіРЅРѕРІРµРЅРЅР°СЏ РїСЂРѕРІРµСЂРєР°, С‡С‚Рѕ РїРёСЂ Р°РєС‚РёРІРµРЅ Рё С‚СЂР°С„РёРє РёРґС‘С‚. |

> TL;DR: СЂРµС€РµРЅРёРµ В«РєР»РёРµРЅС‚ Р·Р°РїСѓСЃС‚РёР»СЃСЏ, Р° С‚СЂР°С„РёРєР° РЅРµС‚В» РїРѕС‡С‚Рё РІСЃРµРіРґР° РІ С‚РѕРј, С‡С‚РѕР±С‹ СѓР±РµРґРёС‚СЊСЃСЏ, С‡С‚Рѕ РµРіРѕ `/32` Рё РєР»СЋС‡ РїСЂРѕРїРёСЃР°РЅС‹ РЅР° СЃРµСЂРІРµСЂРµ. РљР»РёРµРЅС‚ РЅРёС‡РµРіРѕ РЅРµ В«РіРµРЅРµСЂРёСЂСѓРµС‚В» СЃР°Рј вЂ” РѕРЅ РїРѕР»СЊР·СѓРµС‚СЃСЏ РєРѕРЅС„РёРіРѕРј, РєРѕС‚РѕСЂС‹Р№ РІС‹РґР°С‘С‚ `/oneclick`. Р•СЃР»Рё РЅСѓР¶РµРЅ РЅРѕРІС‹Р№ РїРёСЂ, РґРѕР±Р°РІР»СЏРµРј РµРіРѕ РЅР° СЃРµСЂРІРµСЂ Рё РїРµСЂРµР·Р°РїСѓСЃРєР°РµРј РєР»РёРµРЅС‚Р°.
## Device-bound WireGuard provisioning

1. **Источник истины — `device_id`.** Клиент передаёт `device_id` (используем `DeviceInfo.deviceId`). Значение нормализуется (`[a-z0-9_-]`, длина ? 80) и служит ключом.
2. **Первое обращение.** `POST /oneclick` создаёт пира через `/usr/local/bin/wg-api.sh add-peer`, вытягивает `PublicKey`/`AllowedIPs`, выдаёт proxy-user и сохраняет всё в `/etc/wireguard/device_profiles/<device_id>.json` (права `600`).
3. **Повторные обращения.** API проверяет JSON и:
   - убеждается, что пир с сохранённым `PublicKey` и `/32` есть в `wg show`; при необходимости выполняет `wg set wg0 peer ... allowed-ips ...` и дописывает блок в `wg0.conf`;
   - восстанавливает ту же proxy-учётку (если записи в `users.lst` нет — пересоздаёт с теми же логином/паролем);
   - возвращает исходный WireGuard-конфиг и проставляет `reused:true`.
4. **Привязка к железу.** Один `device_id` ? один `/32` и одна proxy-учётка. Новый телефон = новый `device_id` ? новый JSON ? новый пир.
5. **Сброс.** Удалить `/etc/wireguard/device_profiles/<device_id>.json` и выполнить `/usr/local/bin/wg-api.sh remove-peer <public_key>`. Следующий `/oneclick` создаст профиль заново.
6. **Логи.** События `device_profile_created` / `device_profile_issued` пишутся в `/var/log/vpn_connection_server_log` (приватный ключ маскируется до `PrivateKey = ***`).

Итог: оператор больше не создаёт пиров вручную — клиент один раз авторизуется, и дальше всегда подключается к своему статическому `/32`.
## Full-tunnel WireGuard baseline (reference profile parity)

Сверили логи с рабочим профилем в com.wireguard.android: там полноценный фулл-туннель (AllowedIPs 0.0.0.0/0, ::/0), рабочий DNS и стабильные рукопожатия. Ниже чек-лист, чтобы наш сервер/клиент вел себя точно так же, но с дополнительными «дверями» (порт-хоппинг) и TCP-фолбэком.

### Сервер (Ubuntu 22.04 + wg-quick)

1. **Форвардинг включен:**
```
sudo bash -c 'cat >/etc/sysctl.d/99-wg.conf <<EOF
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF'
sudo sysctl --system
```
2. **/etc/wireguard/wg0.conf** (порт по умолчанию 1024/udp, подсеть 10.7.0.0/24):
```
[Interface]
Address = 10.7.0.1/24
ListenPort = 1024
PrivateKey = <SERVER_PRIVATE_KEY>
PostUp   = iptables -t nat -A POSTROUTING -s 10.7.0.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s 10.7.0.0/24 -o eth0 -j MASQUERADE
```
(если используем nftables — подставляем эквивалентные nft add table/chain правила).
3. **Фаервол:** открыть основной порт и запасные входы под редирект сразу (UDP).
```
sudo iptables -A INPUT -p udp --dport 1024 -j ACCEPT
for p in 53 123 443 500 51820 8443 3389; do
  sudo iptables -A INPUT -p udp --dport $p -j ACCEPT
done
```
4. **Запуск:** sudo systemctl enable --now wg-quick@wg0.
5. **Мультипорт (быстрый способ):** оставить WireGuard слушать 51820/udp и редиректить внешние «двери».
```
# wg0.conf -> ListenPort = 51820
for p in 1024 53 123 443 500 8443 3389; do
  sudo iptables -t nat -A PREROUTING -p udp --dport $p -j REDIRECT --to-ports 51820
done
```
Альтернатива — поднять несколько интерфейсов wg1024, wg53, wg443 с одинаковыми ключами/AllowedIPs и разными ListenPort.
6. **Peer (клиент):**
```
[Peer]
PublicKey = <CLIENT_PUBLIC_KEY>
AllowedIPs = 10.7.0.2/32
PersistentKeepalive = 25
```

### Клиент (com.subtit.player)

WireGuard ядро берём из com.wireguard.android, но профиль строим сами внутри приложения.
```
[Interface]
PrivateKey = <CLIENT_PRIVATE_KEY>
Address = 10.7.0.2/32
DNS = 1.1.1.1, 8.8.8.8
MTU = 1280

[Peer]
PublicKey = <SERVER_PUBLIC_KEY>
Endpoint = <SERVER_HOST_OR_IP>:1024
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```
- Все диагностические PowerShell/ADB скрипты должны использовать $PKG = "com.subtit.player" (a не com.wireguard.android).
- /oneclick API по-прежнему отдаёт /32 и Endpoint > DNS и AllowedIPs заменяем на клиенте.

### Авто порт-хоппинг

1. Список попыток: 1024 > 53 > 123 > 443 > 500 > 51820 > 8443 > 3389.
2. Для каждого порта: включаем туннель, в течение 10–12 секунд следим, что wg фиксирует latest handshake < 15 секунд, curl http://1.1.1.1 и https://1.1.1.1 проходят, dns имя (api.ipify.org) резолвится.
3. Если любой чек не прошёл — выключаем туннель, пробуем следующий порт.
4. Запоминаем последний успешный порт как стартовый для следующего цикла.
5. WireGuard держит один Endpoint > или переключаем конфиги, или вызываем wg set/wg setconf перед startTunnel().

### Фолбэк, если UDP умер

- На сервере запускаем udp2raw/аналог в fakeTCP (443/tcp) и прокидываем на локальный UDP-порт WireGuard.
- На клиенте держим второй профиль «WG-over-TCP» (локальный udp2raw слушает UDP и держит TCP-сессию).
- Автоматика: если все UDP-порты упали > пробуем TCP-профиль, позже возвращаемся к UDP.

### Быстрый тест-план

1. Сервер: watch -n1 wg show + ss -lun | grep -E "1024|51820".
2. Клиент: рукопожатие обновляется каждые 25–30 секунд, RX/TX растут, curl http://1.1.1.1 и https://api.ipify.org работают.
3. Если DNS/HTTP не доступны — автоматика перескакивает на следующий порт и логирует причину.

### Диагностика

- Нет пакетов на нескольких udp-портах > tcpdump показывает тишину > вероятно блокировка UDP > сразу TCP-профиль.
- Пакеты есть, рукопожатий нет > проверяем ключи/AllowedIPs/маскарадинг.
- Рукопожатия идут, трафика нет > почти всегда NAT/DNS (верифицируем PostUp/PostDown и DNS внутри туннеля).
- Перед ручным запуском VPN всегда включаем /debug/logging (reason=manual_pre_vpn) и делаем /diag/server-snapshot, чтобы tcpdump успел зафиксировать wg0.

Эти шаги полностью повторяют «эталонный» профиль com.wireguard.android, так что любые расхождения теперь видны по diff конфигов и логам wireguard_local_snapshot_*.txt.
