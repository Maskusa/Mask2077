# WireGuard: установка сервера и веб-управление

Этот проект содержит:

- `server/setup_wireguard.sh` — скрипт установки и базовой настройки WireGuard на Ubuntu 22.04 (wg0, NAT, UFW, автозапуск). Устанавливает вспомогательный API-скрипт `wg-api.sh` для управления peers.
- `web/wg_manager.php` — простая страница (PHP + ssh2), позволяющая удалённо добавить/получить/удалить peer, посмотреть статус и сгенерировать QR-код для клиента.
- `web/wg_qr.html` — офлайн-страница генерации QR из готового конфигурационного файла клиента WireGuard.
- `web/oneclick_qr.php` — кнопка «Получить QR»: создаёт нового peer на сервере и мгновенно показывает QR и конфиг (настройки подключения — в `web/config.php`).
- `web/tcpdump.php` — страница управления tcpdump (старт/стоп, просмотр логов через HTTP API).
- `serve.ps1` — локальный запуск веб-страниц (через встроенный сервер PHP, если доступен).

## Интеграция прокси в Android-приложение (Capacitor)

Актуальные сборки Mask2077 больше не используют ProxyController/WebView-интерсепторы. Все сетевые подключения приложения заворачиваются в полноценный VPN через `NativeVpnPlugin`, поэтому достаточно передать корректные параметры сервера и API.

### Что входит в Android-часть
- `android/app/src/main/java/com/subtit/player/plugins/NativeVpnPlugin.java` — обёртка Capacitor над `ProxyVpnService`.
- `android/app/src/main/java/com/subtit/player/vpn/` + `android/app/src/main/cpp/` — сервис, notification, tun2socks и SOCKS→HTTP bridge.
- `components/ServerSettings.tsx` — экран «Настройка сервера», который управляет VPN, показывает статистику, форму авторизации и диагностику.
- `constants/proxy.ts` + `.env` — значения по умолчанию для host/портов/токена.

### Мини-чек-лист
1. В `.env` (или `capacitor.config.ts`) задайте `VITE_PROXY_HOST`, `VITE_PROXY_HTTP_PORT`, `VITE_PROXY_SOCKS_PORT`, `VITE_PROXY_API_BASE` и `VITE_PROXY_API_TOKEN`. Эти же значения подставляются в форму на экране. Для усиленного режима расследований включите `VITE_PROXY_TESTING_DEBUG=1` (клиент и сервер перейдут в verbose-логирование).
2. В `AndroidManifest.xml` уже прописан `android:networkSecurityConfig="@xml/network_security_config"`, который разрешает HTTP к `45.151.183.153` и `open.server`. При смене домена не забудьте обновить XML.
3. Соберите VPN-модуль (`./gradlew :app:assembleDebug`). При первом запуске приложение попросит разрешение VPN — без него туннель не стартует.
4. Для ручного запроса статуса используйте `CapacitorHttp` — он отправляет `X-Auth-Token` и в случае ошибки пишет в лог `[Proxy] api_request_failed ...`.

### SSH-доступ и выполнение команд
- Для любых операций на сервере (чтение логов, рестарт сервисов, получение токена) используйте Python-скрипт `OpenServer/tools/ssh_exec.py`.
- Запуск: `python OpenServer/tools/ssh_exec.py 45.151.183.153 root 760RBeSbt57T "systemctl status wg-api-http"`.
- Скрипт сам управляет ключами и повторными подключениями, поэтому **plink.exe не используем** — он зависает в batch-режиме и оставляет зомби-сессии.
- Примеры:  
  - получить токен API — `python OpenServer/tools/ssh_exec.py ... "cat /etc/wireguard/api_token"`;  
  - проверить лог VPN — `python OpenServer/tools/ssh_exec.py ... "tail -n 200 /var/log/vpn_connection_server_log"`.

### API-токен
- Сам 3proxy по-прежнему авторизует трафик через `masku/superproxy123`, но HTTP API на `:8787` принимает **только** `X-Auth-Token`.
- Токен лежит в `/etc/wireguard/api_token`. Быстрее всего получить его командой `python OpenServer/tools/ssh_exec.py 45.151.183.153 root 760RBeSbt57T "cat /etc/wireguard/api_token"`.
- Значение надо вписать в `.env` и/или в поле «API token» на экране. При ошибке 401 проверьте, что токен совпадает.

### Экран «Настройка сервера»
- Кнопка «Включить VPN» вызывает `NativeVpn.start`, который форсирует SOCKS5 и ведёт статистику (байты/пакеты/uptime).
- «Обновить статус» дергает `/proxy/status`, `/wg/status`, `/system/info`. Если HTTPS не работает (self-signed), компонент автоматически откатывается на HTTP и пишет об этом в лог.
- «Проверить пинг» просто делает ручной статус-запрос (без постоянных таймеров) и логирует причину `reason=ping`.
- Внизу страницы есть блок «Сырые данные» — туда выводится всё, что пришло от API, чтобы можно было сравнить с `curl`.

### Диагностика
- `[Diag] ...` события появляются, когда пользователь запускает встроенную проверку (ping/dns/tcp/http/https). Результаты показываются на экране и в логах.

### Режим testing_and_debug
- Активируется переменной `VITE_PROXY_TESTING_DEBUG=1`. Клиент начинает логировать каждый шаг подключения в `vpn_connection_client_log` и включает расширенные записи в `NativeVpn`.
- Сразу после запроса «Включить VPN» приложение вызывает `POST /debug/logging` (см. API ниже), что запускает `tcpdump_ctrl.sh start` и фиксирует событие в `vpn_connection_server_log`. После выключения VPN отправляется `enabled:false`, и tcpdump останавливается.
- API сервера:
  - `GET /debug/logging` → `{ ok, state }`, где `state` содержит текущий статус, отметку времени, tail из `/tmp/tcpdump_wg0.log` и состояние tcpdump.
  - `POST /debug/logging` `{ "enabled": true|false, "reason": "...", "source": "android-testing" }` — включает/отключает захват. Требуется тот же `X-Auth-Token`.
- Если нужно включить логирование вручную: `curl -H "X-Auth-Token: <TOKEN>" -d '{"enabled":true,"reason":"manual"}' https://HOST:8787/debug/logging`.
- Дополнительно к основному `vpn_connection_server_log` tcpdump пишет `/tmp/tcpdump_wg0.log`. Скачайте его командой `python OpenServer/tools/ssh_exec.py ... "tail -n 200 /tmp/tcpdump_wg0.log"`.
- Кнопка «Логи» открывает общий LogOverlay, так что при репортах достаточно приложить скрин с `[Proxy] status_*` и `[VPN] ...`.
- «Отчёт в поддержку» (кнопка «Скопировать сводку») формируется функцией `buildEnvironmentReport` и включает текущие host/порт/токен/последние ответы API.

### Журналы подключения
- `vpn_connection_client_log` — отдельный журнал внутри приложения (экран «Настройка сервера», блок «Журнал VPN-соединения»). Кнопки «Копировать» и «Сохранить» формируют файл для отправки в поддержку.
- `vpn_connection_server_log` — серверный файл `/var/log/vpn_connection_server_log`. Каждое обращение к `/proxy/status`, `/wg/status`, `/system/info`, `/tests/*`, а также управление прокси и WireGuard фиксируются с меткой времени. Для расследования проблем сравните клиентский и серверный журналы по таймстемпам.

## 1. Настройка удалённого сервера (Ubuntu 22.04)

Данные сервера:

- Домен/IP: `open.server` / `45.151.183.153`
- Пользователь: `root`
- Пароль: `760RBeSbt57T`
- ОС: Ubuntu 22.04

Пошагово:

1) Подключитесь по SSH:

```
ssh root@45.151.183.153
```

2) Передайте скрипт и запустите установку:

```
scp server/setup_wireguard.sh root@45.151.183.153:/root/
ssh root@45.151.183.153
chmod +x /root/setup_wireguard.sh
PUB_ENDPOINT=45.151.183.153 bash /root/setup_wireguard.sh
```

Скрипт выполнит:

- Установку пакетов: `wireguard`, `qrencode`, `ufw`.
- Включение IP forwarding (`sysctl`).
- Настройку `wg0` (по умолчанию: `10.66.66.1/24`, порт `443/udp`).
- NAT через `iptables`, открытие порта в `ufw`, включение `ufw`.
- Автозапуск `wg-quick@wg0`.
- Установку утилиты `/usr/local/bin/wg-api.sh` для управления peers.

Проверка:

```
wg show
ss -ulpn | grep 443
```

Добавление первого клиента (пример):

```
wg-api.sh add-peer --name phone
```

Команда выведет готовый клиентский конфиг. Его можно отсканировать в приложении WireGuard через QR (см. раздел 3).

Примечания по переменным окружения (можно передавать при запуске):

- `PUB_ENDPOINT` — внешний IP/домен сервера (например, `45.151.183.153`).
- `WG_IF` — интерфейс WireGuard, по умолчанию `wg0`.
- `WG_PORT` — порт UDP (по умолчанию `443`).
- `WG_SUBNET` — подсеть (по умолчанию `10.66.66.0/24`).
- `WG_SERVER_IP` — адрес сервера в подсети (по умолчанию `10.66.66.1`).
- `WG_DNS` — DNS для клиентов (по умолчанию `1.1.1.1,1.0.0.1`).

## 2. Веб-страница управления и QR

Файлы:

- `web/wg_manager.php` — управление сервером по SSH из браузера.
- `web/wg_qr.html` — офлайн генератор QR по вставленному конфигу.
- `web/oneclick_qr.php` — «одна кнопка» для выдачи нового клиента и QR (без ввода данных пользователем).

Размещение на вашем хостинге:

1) Скопируйте файлы из `web/` в папку сайта на хостинге.
2) Для `wg_manager.php` и `oneclick_qr.php` требуется PHP-расширение `ssh2` (обратитесь в поддержку хостинга при необходимости).
3) Создайте `web/config.php` на основе `web/config.php.example` и укажите доступ к вашему серверу (пароль или ключи SSH). Этот файл НЕ храните в репозитории.
3) Ограничьте доступ к `wg_manager.php` (HTTP Basic Auth, ограничение по IP).

Использование `oneclick_qr.php` (без ввода):

- Откройте страницу и нажмите «Получить QR». Скрипт подключится к серверу, создаст нового клиента (`peer-YYYYMMDD-HHMMSS-XXXX`), покажет QR и предложит скачать `.conf`.

Использование `wg_manager.php`:

- Введите хост `45.151.183.153`, логин `root`, пароль сервера.
- Доступны действия: статус, up/down, список peers, add (по имени), get (получить конфиг), remove (по публичному ключу).
- После получения конфига нажмите «Показать QR» — появится QR для сканирования приложением WireGuard.

Использование `wg_qr.html`:

- Откройте страницу, вставьте конфиг клиента WireGuard, нажмите «Сгенерировать QR».

## 3. Локальное тестирование через serve.ps1 / F5

Для быстрого локального просмотра страниц `web/` подготовлен скрипт `serve.ps1`. Он пытается запустить встроенный веб-сервер PHP. Если PHP недоступен, предупредит, что `wg_manager.php` работать не будет (но `wg_qr.html` доступен). 

Вариант A — F5 в VS Code (настроено в `.vscode/`):

- Откройте папку проекта в VS Code
- Нажмите F5 и выберите профиль: «Open in Edge (F5)» или «Open in Chrome (F5)»
- Перед запуском откроется задача `serve`, которая поднимет локальный сервер на `http://localhost:4173/`

Вариант B — вручную из PowerShell (в корне проекта):

```
./serve.ps1 -Hostname localhost -Port 4173
```

Примечания:

- Если PHP установлен — будет работать `web/wg_manager.php`. Если нет, запустится Python http.server или минимальный .NET сервер для статических файлов (используйте `web/wg_qr.html`).
- Для корректного вывода Юникода в терминале: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.

## 4. Безопасность

- После начальной настройки перейдите на SSH-ключи и запретите вход по паролю для root (`/etc/ssh/sshd_config`: `PermitRootLogin prohibit-password` или `no`).
- Оставляйте включённым `ufw`, открыты только необходимые порты (`22/tcp`, `443/udp`, `443/tcp`, `8787/tcp`).
- Ограничьте доступ к веб-странице управления.

## 5. Типичные команды wg-api.sh

```
wg-api.sh status           # Статус WireGuard
wg-api.sh up               # Поднять интерфейс
wg-api.sh down             # Опустить интерфейс
wg-api.sh add-peer --name laptop
wg-api.sh get-config laptop > /root/laptop.conf
wg-api.sh remove-peer <pubkey>
wg-api.sh list-peers
```


## 6. TCP fallback (udp2raw)

Для сетей, где блокируется UDP, на сервере запущен [udp2raw](https://github.com/wangyu-/udp2raw-tunnel), который принимает TCP на порту `443` и транслирует его в локальный WireGuard.

- пароль (ключ) udp2raw: **ff8b747e8d9bca60a2e744f3**
- сервис: `systemctl status udp2raw.service`
- скрипт запуска: `/usr/local/bin/udp2raw-wrapper.sh`

Пример запуска клиента на ПК (порт 15443 свободный):

```bash
udp2raw -c -l 127.0.0.1:15443 -r 45.151.183.153:443 --raw-mode faketcp --cipher-mode xor --auth-mode simple --seq-mode 0 --sock-buf 10240 -k ff8b747e8d9bca60a2e744f3
```

После старта клиента измените в конфигурации WireGuard `Endpoint = 127.0.0.1:15443` (сам туннель будет обращаться по TCP). На Android можно запускать udp2raw через Termux. Для обычных условий достаточно стандартного UDP-подключения на `443`.

## 7. Частые вопросы

- Порт не виден снаружи: проверьте, что у провайдера открыт UDP 443, а `ufw status` содержит `443/udp ALLOW`.
- Приложение не подключается извне: убедитесь, что endpoint и порт в клиентском конфиге верны (совпадают с внешним IP и портом сервера).
## 8. SOCKS5/HTTP прокси (3proxy)

- Сервис слушает на `45.151.183.153:1080` (SOCKS5) и `45.151.183.153:8080` (HTTP CONNECT).
- Конфигурация: `/etc/3proxy/3proxy.cfg`, база логинов `/etc/3proxy/conf/users.lst`.
- Перезапуск: `systemctl restart 3proxy`, статус: `systemctl status 3proxy`.
- Стартовый пользователь: `masku / superproxy123`.

HTTP API (порт 8787) дополнен методами:

```
GET  /proxy/status       # состояние сервиса, список логинов
GET  /proxy/users        # только список пользователей
POST /proxy/add-user     # {"username":?, "password":?}
POST /proxy/remove-user  # {"username":...}
POST /proxy/restart
```

Эти же действия доступны из `web/localVpnSandBox.html`: появился отдельный блок с метриками, выдачей новых логинов и управлением 3proxy.

### Windows-скрипты

В каталоге `windows/` добавлены утилиты:

- `setup_proxy.bat` — включает системный прокси, прописывает WinHTTP/WinINet и переменные окружения. Запускается из повышенного PowerShell/cmd.
- `test_proxy.bat` — собирает диагностику (curl, Invoke-WebRequest, Test-NetConnection) и сохраняет отчёт в `%TEMP%\proxy-test.log`.

Оба скрипта принимают параметры `[host] [socks_port] [http_port]`, по умолчанию используют `45.151.183.153 1080 8080`.
