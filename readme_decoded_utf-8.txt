# WireGuard: установка сервера и веб-управление

Этот проект содержит:

- `server/setup_wireguard.sh` — скрипт установки и базовой настройки WireGuard на Ubuntu 22.04 (wg0, NAT, UFW, автозапуск). Устанавливает вспомогательный API-скрипт `wg-api.sh` для управления peers.
- `web/wg_manager.php` — простая страница (PHP + ssh2), позволяющая удалённо добавить/получить/удалить peer, посмотреть статус и сгенерировать QR-код для клиента.
- `web/wg_qr.html` — офлайн-страница генерации QR из готового конфигурационного файла клиента WireGuard.
- `web/oneclick_qr.php` — кнопка «Получить QR»: создаёт нового peer на сервере и мгновенно показывает QR и конфиг (настройки подключения — в `web/config.php`).
- `web/tcpdump.php` — страница управления tcpdump (старт/стоп, просмотр логов через HTTP API).
- `serve.ps1` — локальный запуск веб-страниц (через встроенный сервер PHP, если доступен).

## Интеграция прокси в Android-приложение (Capacitor)

Ниже приведён пошаговый план, как повторить текущую серверную механику (HTTP/HTTPS прокси с Basic Auth + SOCKS5 и API-метрики) внутри Android-приложения на стеке Capacitor + нативные Java-плагины.

### 1. Подготовка окружения

1. Убедитесь, что `android/app/build.gradle` уже подключает:
   - Play Services Ads / Billing;
   - Firebase BOM;
   - Capacitor (`implementation project(':capacitor-android')`).
2. Добавьте зависимости сетевого стека, который умеет работать с кастомными прокси:
   ```gradle
   implementation platform('com.squareup.okhttp3:okhttp-bom:4.12.0')
   implementation 'com.squareup.okhttp3:okhttp'
   implementation 'com.squareup.okhttp3:logging-interceptor'
   implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
   ```
3. Создайте `.env` (или аналог в `capacitor.config.ts`) с параметрами:
   - `PROXY_HOST=45.151.183.153`
   - `PROXY_HTTP_PORT=8080`
   - `PROXY_SOCKS_PORT=1080`
   - `PROXY_USER=masku`
   - `PROXY_PASSWORD=superproxy123`
   - `PROXY_API_BASE=https://open.server:8787`

### 2. Нативный плагин Capacitor

1. В каталоге `android/app/src/main/java/<package>/` создайте пакет `proxy`.
2. Добавьте класс `ProxyController.java`:
   - Наследуйте его от `Plugin` (Capacitor).
   - Экспортируйте методы `enableProxy`, `disableProxy`, `getStatus`.
   - Для авторизации используйте `java.net.Authenticator.setDefault`.
   - Для HTTP-прокси создайте `Proxy proxy = new Proxy(Proxy.Type.HTTP, new InetSocketAddress(host, port));`.
   - Для SOCKS-прокси используйте `Proxy.Type.SOCKS`.
   - Настройте `ProxySelector.setDefault` с кастомной реализацией, возвращающей ваш `Proxy` для нужных схем (`http`, `https`).
   - Возвращайте результат в `JSObject` (время включения, статистика, ошибки).
3. Зарегистрируйте плагин в `MainActivity.java`:
   ```java
   this.init(savedInstanceState, new ArrayList<Class<? extends Plugin>>() {{
       add(ProxyController.class);
   }});
   ```
4. Сторона TypeScript:
   - Создайте обёртку `proxy-controller.ts` c `registerPlugin`.
   - Опишите типы `enableProxy(options?: { socks?: boolean }): Promise<ProxyState>`.
   - Используйте плагин в UI (кнопки «Включить прокси», «Выключить», «Обновить»).

### 3. Настройка сетевого стека приложения

1. OkHttp:
   - Создайте синглтон `OkHttpClient` с `proxy`, `proxyAuthenticator`.
   - Подключите `logging-interceptor` для отладки.
   - Прокидывайте клиента в Retrofit/Volley/кастомные запросы.
2. WebView (Capacitor Bridge):
   - Для Capacitor 5+ можно переопределить `shouldInterceptRequest` и использовать `WebResourceRequest` вместе с `Proxy` (через `ProxySelector`).
   - Альтернативно — прогонять сетевые вызовы через нативный слой (JS вызывает `ProxyController.fetch`).
3. Play Services / Firebase:
   - Эти SDK используют системный `HttpURLConnection` → будут уважать глобальный `ProxySelector`.
   - Для gRPC (Firebase Remote Config/Firestore) добавьте conditional routing (используют HTTP/2 поверх TLS, проверьте целевые API).

### 4. Работа с серверным API

HTTP API (порт 8787):

| Метод             | Назначение                       |
|-------------------|----------------------------------|
| `GET /proxy/status` | Статус прокси-серверов, аптайм. |
| `POST /proxy/toggle` | Управление 3proxy (вкл/выкл).  |
| `GET /wg/status`     | Статистика WireGuard.           |
| `GET /system/info`   | Общие сведения о сервере.       |

Рекомендации:

1. В нативном плагине создайте функцию `fetchJson(path, method = "GET")`, использующую OkHttp + proxy.
2. Используйте корутины (`Dispatchers.IO`) для фоновых запросов.
3. Сохраняйте результат в `SharedPreferences`/Capacitor Storage.
4. Для графика трафика подтягивайте данные от `ProxyControl.exe` или `/proxy/status` (включает счётчики).

### 5. UI и управление состоянием

1. Создайте модуль `ProxyStore` (Pinia/Redux или обычный State) с состояниями:
   - `enabled`, `connecting`, `error`, `stats`, `latency`.
2. При нажатии «Enable»:
   - Вызовите `plugin.enableProxy`.
   - После успеха запросите `/proxy/status`.
   - Включите периодический `setInterval` (30–60 с) для обновления.
3. Для «Disable» — вызов `plugin.disableProxy`, остановка таймеров.
4. Показывайте:
   - Трафик (`sent/received`).
   - Скорость (`bw_up/down`).
   - Время подключения.
   - Пинг (`pingValue`), можно запрашивать через нативный `InetAddress.isReachable` или `ProcessBuilder("ping")`.

### 6. Тестирование

1. Unit:
   - Моки для `ProxySelector`, `Authenticator`.
   - Тестирование сериализации ответов `/proxy/status`.
2. Инструментальные:
   - UI-тесты включения/выключения прокси (Espresso).
   - Проверка, что запросы через `OkHttp` уходят по нужному хосту (`tcpdump` на сервере).
3. QA-чеклист:
   - Включение прокси на Wi-Fi/4G.
   - Работа после перезапуска приложения.
   - Работа при отключённом сервере (корректные ошибки).
   - Совместимость с Play Store (в особенности политика VPN/прокси).

### 7. Доставка и legal

1. Не храните открытые логины/пароли в репозитории — используйте Remote Config / Secrets.
2. Добавьте экран «О прокси» и пользовательское соглашение (Google Play Safety).
3. Перед публикацией пройдите внутреннее тестирование (Internal App Sharing) с реальным сервером.

Следуя этим шагам, разработчик Android сможет встроить управление текущим прокси-сервером в приложение на Capacitor, сохранив все ключевые функции (вкл/выкл, статистика, пинг, интеграция с API).

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
