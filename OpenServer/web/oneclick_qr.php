<?php
declare(strict_types=1);
header('Content-Type: text/html; charset=utf-8');

function cfg(): array
{
    $path = __DIR__ . '/config.php';
    if (!file_exists($path)) {
        throw new RuntimeException('Создайте web/config.php на основе config.php.example');
    }
    return require $path;
}

function sanitize_device_id(?string $raw): ?string
{
    if (!is_string($raw)) {
        return null;
    }
    $clean = preg_replace('~[^a-zA-Z0-9_-]+~', '-', trim($raw));
    $clean = trim((string) $clean, '-_');
    if ($clean === '') {
        return null;
    }
    return strtolower($clean);
}

function generate_device_id(): string
{
    try {
        $suffix = bin2hex(random_bytes(4));
    } catch (Throwable $e) {
        $suffix = bin2hex(openssl_random_pseudo_bytes(4));
    }
    return sprintf('web-%s-%s', date('YmdHis'), $suffix);
}

function resolve_device_id(): string
{
    foreach (['device_id', 'deviceId'] as $key) {
        if (isset($_POST[$key])) {
            $san = sanitize_device_id($_POST[$key]);
            if ($san) {
                return $san;
            }
        }
        if (isset($_GET[$key])) {
            $san = sanitize_device_id($_GET[$key]);
            if ($san) {
                return $san;
            }
        }
    }
    return generate_device_id();
}

function http_api_create(array $cfg): array
{
    if (!isset($cfg['api']['url'], $cfg['api']['token'])) {
        throw new RuntimeException('API: не задан URL или токен');
    }
    $url = rtrim($cfg['api']['url'], '/') . '/oneclick';
    $headers = [
        'Content-Type: application/json',
        'X-Auth-Token: ' . $cfg['api']['token'],
    ];
    $deviceId = resolve_device_id();
    $payload = json_encode(['device_id' => $deviceId], JSON_UNESCAPED_UNICODE);
    $response = false;
    $code = 0;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_POSTFIELDS => $payload,
        ]);
        $response = curl_exec($ch);
        if ($response === false) {
            throw new RuntimeException('API: ' . curl_error($ch));
        }
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", $headers),
                'content' => $payload,
                'timeout' => 20,
            ],
        ]);
        $response = @file_get_contents($url, false, $context);
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $header) {
                if (preg_match('~^HTTP/\S+\s+(\d+)~', $header, $matches)) {
                    $code = (int) $matches[1];
                    break;
                }
            }
        }
    }

    $parsed = json_decode($response ?: '', true);
    if ($code !== 200 || !is_array($parsed) || empty($parsed['ok'])) {
        throw new RuntimeException('API: неверный ответ');
    }
    $parsed['device_id'] = $deviceId;
    return $parsed;
}

function handle_ajax(): void
{
    header('Content-Type: application/json; charset=utf-8');
    try {
        $config = cfg();
        $result = http_api_create($config);
        echo json_encode([
            'ok' => true,
            'name' => $result['name'] ?? 'wireguard-client',
            'config' => $result['config'] ?? '',
            'device_id' => $result['device_id'] ?? null,
            'proxy' => $result['proxy'] ?? null,
        ], JSON_UNESCAPED_UNICODE);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

if (($_GET['ajax'] ?? '') === '1') {
    handle_ajax();
}
?>
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WireGuard — Получить QR</title>
  <style>
    body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin: 24px; }
    button { padding: 10px 16px; font-size: 16px; }
    #qr { margin-top: 16px; }
    #cfg { white-space: pre-wrap; background: #f6f8fa; padding: 12px; margin-top: 12px; }
    .muted { color: #555; }
    .card { margin-top: 18px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fafafa; }
    .card h2 { margin: 0 0 8px 0; font-size: 16px; }
    .card ul { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.6; }
    .status-line { margin: 0; font-size: 14px; }
  </style>
  <script>
    function renderQRTo(target, text) {
      if (window.QRCode) {
        const canvas = document.createElement('canvas');
        target.appendChild(canvas);
        QRCode.toCanvas(canvas, text, { width: 256, margin: 1 }, (err) => {
          if (err) {
            target.textContent = 'Ошибка QR: ' + err;
          }
        });
      } else {
        const img = document.createElement('img');
        img.width = 256;
        img.height = 256;
        img.alt = 'QR';
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' + encodeURIComponent(text);
        target.appendChild(img);
      }
    }
  </script>
</head>
<body>
  <h1>Получить QR-код WireGuard</h1>
  <button id="btn">Получить QR</button>
  <div id="status" class="muted">Нажмите «Получить QR», чтобы запросить профиль.</div>

  <div class="card">
    <h2>Параметры туннеля</h2>
    <ul>
      <li>Подсеть: 10.6.0.0/24, сервер: 10.6.0.1</li>
      <li>Endpoint: 45.151.183.153:443 (UDP)</li>
      <li>DNS: 10.6.0.1 (dnsmasq), MTU = 1280</li>
      <li>AllowedIPs = 0.0.0.0/0, ::/0 — полный туннель</li>
      <li>PersistentKeepalive = 25</li>
    </ul>
  </div>

  <div class="card">
    <h2>Что происходит</h2>
    <p class="status-line">Запрос отправляется в API сервера, генерируется конфиг и QR-код.</p>
    <p class="status-line">Если сервер отвечает прокси, вы увидите логин/пароль для SOCKS5 и HTTP.</p>
  </div>

  <div id="qr"></div>
  <pre id="cfg" style="display:none"></pre>
  <pre id="proxy" style="display:none"></pre>
  <p id="download" style="display:none"></p>

  <script>
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    const qrBox = document.getElementById('qr');
    const cfgPre = document.getElementById('cfg');
    const proxyPre = document.getElementById('proxy');
    const downloadHolder = document.getElementById('download');

    async function getQR() {
      btn.disabled = true;
      status.textContent = 'Генерируем QR...';
      qrBox.innerHTML = '';
      cfgPre.style.display = 'none';
      proxyPre.style.display = 'none';
      proxyPre.textContent = '';
      downloadHolder.style.display = 'none';
      try {
        const response = await fetch('?ajax=1');
        const data = await response.json();
        if (!data.ok) {
          throw new Error(data.error || 'API вернул неверный ответ');
        }
        cfgPre.textContent = data.config;
        cfgPre.style.display = 'block';
        renderQRTo(qrBox, data.config);
        const deviceHint = data.device_id ? ` (устройство ${data.device_id})` : '';
        status.textContent = 'Готово: ' + (data.name || 'WireGuard') + deviceHint;
        if (data.proxy) {
          const socks = data.proxy.socks || {};
          const http = data.proxy.http || {};
          const lines = [
            'Login: ' + data.proxy.username,
            'Password: ' + data.proxy.password,
            'SOCKS5: ' + (socks.scheme || 'socks5') + '://' + data.proxy.username + ':' + data.proxy.password + '@' + (socks.host || '-') + ':' + (socks.port || ''),
            'HTTP: ' + (http.scheme || 'http') + '://' + data.proxy.username + ':' + data.proxy.password + '@' + (http.host || '-') + ':' + (http.port || '')
          ].join('\n');
          proxyPre.textContent = lines;
          proxyPre.style.display = 'block';
        }
        const blob = new Blob([data.config], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        downloadHolder.innerHTML = '';
        const link = document.createElement('a');
        link.href = url;
        const rawName = data.name || 'wireguard';
        const fileName = (rawName.replace(/[^a-zA-Z0-9_]/g, '_') || 'wireguard').slice(0, 30);
        link.download = fileName + '.conf';
        link.textContent = 'Скачать конфиг';
        downloadHolder.appendChild(link);
        downloadHolder.style.display = 'block';
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (error) {
        status.textContent = 'Ошибка: ' + (error.message || 'неизвестная ошибка');
      } finally {
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', getQR);
  </script>
</body>
</html>
