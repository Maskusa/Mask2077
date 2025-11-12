<?php
header('Content-Type: text/html; charset=windows-1251');

function cfg() {
     = __DIR__ . '/config.php';
    if (!file_exists()) return null;
    return require ;
}

function have_ssh2() { return function_exists('ssh2_connect'); }

function have_ssh_cli() {
    if (!function_exists('shell_exec')) return false;
     = stripos(PHP_OS_FAMILY, 'Windows') === 0 ? 'where' : 'which';
     = @shell_exec( . ' ssh');
    return is_string() && trim() !== '';
}

function sanitize_device_id() {
    if (!is_string()) return null;
     = preg_replace('~[^a-zA-Z0-9_-]+~', '-', trim());
     = trim((string), '-_');
    if ( === '') return null;
    return strtolower();
}

function generate_device_id() {
    try {
         = bin2hex(random_bytes(4));
    } catch (Throwable ) {
         = bin2hex(openssl_random_pseudo_bytes(4));
    }
    return sprintf('web-%s-%s', date('YmdHis'), );
}

function resolve_device_id() {
    foreach (['device_id', 'deviceId'] as ) {
        if (isset([])) {
             = sanitize_device_id([]);
            if () return ;
        }
        if (isset([])) {
             = sanitize_device_id([]);
            if () return ;
        }
    }
    return generate_device_id();
}

function http_api_create(array ): array {
    if (!isset(['api']['url'], ['api']['token'])) {
        throw new RuntimeException('API не настроен');
    }
     = rtrim(['api']['url'], '/') . '/oneclick';
     = [
        'Content-Type: application/json',
        'X-Auth-Token: ' . ['api']['token'],
    ];
     = resolve_device_id();
     = json_encode(['device_id' => ], JSON_UNESCAPED_UNICODE);
     = false;
     = 0;
    if (function_exists('curl_init')) {
         = curl_init();
        curl_setopt_array(, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_POSTFIELDS => ,
        ]);
         = curl_exec();
        if ( === false) throw new RuntimeException('API: ' . curl_error());
         = curl_getinfo(, CURLINFO_RESPONSE_CODE);
        curl_close();
    } else {
         = ['http' => [
            'method' => 'POST',
            'header' => implode("\r\n", ),
            'content' => ,
            'timeout' => 20,
        ]];
         = stream_context_create();
         = @file_get_contents(, false, );
        if (isset() && is_array()) {
            foreach ( as ) {
                if (preg_match('~^HTTP/\S+\s+(\d+)~', , )) {
                     = (int)[1];
                    break;
                }
            }
        }
    }
     = json_decode(, true);
    if ( !== 200 || !is_array() || empty(['ok'])) {
        throw new RuntimeException('API: неверный ответ');
    }
    ['device_id'] = ;
    return ;
}

function ssh_exec_cfg(array , string ): string {
     = ['host'];
     = ['user'];
     = ['auth'] ?? [];
    if (have_ssh2()) {
         = @ssh2_connect(, 22, ['hostkey' => 'ssh-rsa']);
        if (!) throw new RuntimeException('SSH: не удалось подключиться');
         = false;
        if (isset(['password'])) {
             = @ssh2_auth_password(, , ['password']);
        } elseif (isset(['pubkey'], ['privkey'])) {
             = @ssh2_auth_pubkey_file(, , ['pubkey'], ['privkey'], ['passphrase'] ?? null);
        }
        if (!) throw new RuntimeException('SSH: ошибка авторизации');
         = ssh2_exec(, );
        if (!) throw new RuntimeException('SSH: невозможно выполнить команду');
        stream_set_blocking(, true);
         = stream_get_contents();
        fclose();
        return ;
    }
    if (have_ssh_cli() && isset(['cli_key'])) {
         = escapeshellarg(['cli_key']);
         =  . '@' . ;
         = 'ssh -o StrictHostKeyChecking=no -i ' .  . ' ' . escapeshellarg() . ' ' . escapeshellarg();
         = shell_exec();
        if (!is_string() ||  === '') {
            throw new RuntimeException('SSH CLI: команда не вернула результат');
        }
        return ;
    }
    throw new RuntimeException('Нет ssh2 и нет настроенного CLI-ключа');
}

if ((['ajax'] ?? '') === '1') {
    header('Content-Type: application/json; charset=utf-8');
    try {
         = cfg();
        if ( === null) {
            throw new RuntimeException('Создайте web/config.php на основе config.php.example');
        }
        if (isset(['api'])) {
             = http_api_create();
            echo json_encode([
                'ok' => true,
                'name' => ['name'],
                'config' => ['config'],
                'device_id' => ['device_id'] ?? null,
                'proxy' => ['proxy'] ?? null,
            ], JSON_UNESCAPED_UNICODE);
        } else {
             = ['peer_prefix'] ?? 'user';
             = bin2hex(random_bytes(2));
             = sprintf('%s-%s-%s', , date('Ymd-His'), );
             = ssh_exec_cfg(, 'wg-api.sh add-peer --name ' . escapeshellarg());
            echo json_encode(['ok' => true, 'name' => , 'config' => ], JSON_UNESCAPED_UNICODE);
        }
    } catch (Throwable ) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => ->getMessage()], JSON_UNESCAPED_UNICODE);
    }
    exit;
}
?>
<!doctype html>
<html lang="ru">
<head>
  <meta charset="windows-1251">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WireGuard — получить QR-код</title>
  <style>
    body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin: 24px; }
    button { padding: 10px 16px; font-size: 16px; }
    #qr { margin-top: 16px; }
    #cfg { white-space: pre-wrap; background: #f6f8fa; padding: 12px; margin-top: 12px; }
    .muted { color: #555; }
    .card { margin-top: 18px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fafafa; }
    .card h2 { margin: 0 0 8px 0; font-size: 16px; }
    .card ul { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.6; }
  </style>
  <script>
    function renderQRTo(element, text) {
      if (window.QRCode) {
        const canvas = document.createElement('canvas');
        element.appendChild(canvas);
        QRCode.toCanvas(canvas, text, { width: 256, margin: 1 }, (err) => {
          if (err) {
            element.textContent = 'Ошибка QR: ' + err;
          }
        });
      } else {
        const img = document.createElement('img');
        img.width = 256;
        img.height = 256;
        img.alt = 'QR';
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' + encodeURIComponent(text);
        element.appendChild(img);
      }
    }
  </script>
</head>
<body>
  <h1>Получить QR-код WireGuard</h1>
  <?php  = is_file(__DIR__ . '/config.php'); if (!): ?>
    <p style="color:#b00">Создайте файл <code>web/config.php</code> из <code>web/config.php.example</code>.</p>
  <?php endif; ?>

  <button id="btn">Получить QR</button>
  <div id="status" class="muted"></div>

  <div class="card">
    <h2>Параметры, которые попадут в конфиг</h2>
    <ul>
      <li>Подсеть: 10.6.0.0/24, сервер: 10.6.0.1</li>
      <li>Endpoint: 45.151.183.153:443 (UDP)</li>
      <li>DNS: 10.6.0.1 (dnsmasq), MTU = 1280</li>
      <li>AllowedIPs = 0.0.0.0/0, ::/0 — полный туннель</li>
      <li>PersistentKeepalive = 25</li>
    </ul>
  </div>

  <div id="qr"></div>
  <pre id="cfg" style="display:none"></pre>
  <pre id="proxy" style="display:none"></pre>
  <p id="download" style="display:none"></p>

  <script>
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    const box = document.getElementById('qr');
    const pre = document.getElementById('cfg');
    const proxyPre = document.getElementById('proxy');
    const dl = document.getElementById('download');

    async function getQR() {
      btn.disabled = true;
      status.textContent = 'Генерируем QR...';
      box.innerHTML = '';
      pre.style.display = 'none';
      proxyPre.style.display = 'none';
      proxyPre.textContent = '';
      dl.style.display = 'none';
      try {
        const response = await fetch('?ajax=1');
        const data = await response.json();
        if (!data.ok) {
          throw new Error(data.error || 'API вернул неверный ответ');
        }
        pre.textContent = data.config;
        pre.style.display = 'block';
        renderQRTo(box, data.config);
        const deviceHint = data.device_id ?  : '';
        status.textContent = 'Готово: ' + data.name + deviceHint;
        if (data.proxy) {
          const socks = data.proxy.socks || {};
          const http = data.proxy.http || {};
          const lines = [
            'Login: ' + data.proxy.username,
            'Password: ' + data.proxy.password,
            'SOCKS5: ' + (socks.scheme || 'socks5') + '://' + data.proxy.username + ':' + data.proxy.password + '@' + (socks.host || '-') + ':' + (socks.port || ''),
            'HTTP: ' + (http.scheme || 'http') + '://' + data.proxy.username + ':' + data.proxy.password + '@' + (http.host || '-') + ':' + (http.port || ''),
          ].join('\n');
          proxyPre.textContent = lines;
          proxyPre.style.display = 'block';
        }
        const blob = new Blob([data.config], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        dl.innerHTML = '';
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = data.name + '.conf';
        anchor.textContent = 'Скачать конфиг';
        dl.appendChild(anchor);
        dl.style.display = 'block';
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
