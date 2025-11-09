<?php
// РћРґРЅРѕРєРЅРѕРїРѕС‡РЅР°СЏ РіРµРЅРµСЂР°С†РёСЏ QR РґР»СЏ РЅРѕРІРѕРіРѕ WireGuard peer.
// РўСЂРµР±СѓРµС‚СЃСЏ: Р»РёР±Рѕ PHP-СЂР°СЃС€РёСЂРµРЅРёРµ ssh2, Р»РёР±Рѕ РІРЅРµС€РЅРёР№ HTTP API РЅР° РІР°С€РµРј СЃРµСЂРІРµСЂРµ.

header('Content-Type: text/html; charset=utf-8');

function cfg() {
    $path = __DIR__ . '/config.php';
    if (!file_exists($path)) return null;
    return require $path;
}

function have_ssh2() { return function_exists('ssh2_connect'); }

function have_ssh_cli() {
    if (!function_exists('shell_exec')) return false;
    $which = stripos(PHP_OS_FAMILY, 'Windows') === 0 ? 'where' : 'which';
    $out = @shell_exec($which . ' ssh');
    return is_string($out) && trim($out) !== '';
}

function http_api_create(array $cfg): array {
    if (!isset($cfg['api']['url'], $cfg['api']['token'])) {
        throw new RuntimeException('API РЅРµ РЅР°СЃС‚СЂРѕРµРЅ');
    }
    $url = rtrim($cfg['api']['url'], '/').'/oneclick';
    $headers = [
        'Content-Type: application/json',
        'X-Auth-Token: '.$cfg['api']['token']
    ];
    $resp = false; $code = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 20,
        ]);
        $resp = curl_exec($ch);
        if ($resp === false) throw new RuntimeException('API: '.curl_error($ch));
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
    } else {
        $opts = ['http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers),
            'content' => '',
            'timeout' => 20,
        ]];
        $context = stream_context_create($opts);
        $resp = @file_get_contents($url, false, $context);
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $h) {
                if (preg_match('~^HTTP/\S+\s+(\d+)~', $h, $m)) { $code = (int)$m[1]; break; }
            }
        }
    }
    $j = json_decode($resp, true);
    if ($code !== 200 || !is_array($j) || empty($j['ok'])) {
        throw new RuntimeException('API: РЅРµРІРµСЂРЅС‹Р№ РѕС‚РІРµС‚');
    }
    return $j;
}

function ssh_exec_cfg(array $cfg, string $cmd): string {
    $host = $cfg['host']; $user = $cfg['user']; $auth = $cfg['auth'] ?? [];
    if (have_ssh2()) {
        $conn = @ssh2_connect($host, 22, ['hostkey' => 'ssh-rsa']);
        if (!$conn) throw new RuntimeException('SSH: РЅРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ');
        $ok = false;
        if (isset($auth['password'])) {
            $ok = @ssh2_auth_password($conn, $user, $auth['password']);
        } elseif (isset($auth['pubkey'], $auth['privkey'])) {
            $ok = @ssh2_auth_pubkey_file($conn, $user, $auth['pubkey'], $auth['privkey'], $auth['passphrase'] ?? null);
        }
        if (!$ok) throw new RuntimeException('SSH: РѕС€РёР±РєР° Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёРё');
        $stream = ssh2_exec($conn, $cmd);
        if (!$stream) throw new RuntimeException('SSH: РЅРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РєРѕРјР°РЅРґСѓ');
        stream_set_blocking($stream, true);
        $out = stream_get_contents($stream);
        fclose($stream);
        return $out;
    }
    if (have_ssh_cli() && isset($auth['cli_key'])) {
        $key = escapeshellarg($auth['cli_key']);
        $remote = $user . '@' . $host;
        $full = 'ssh -o StrictHostKeyChecking=no -i ' . $key . ' ' . escapeshellarg($remote) . ' ' . escapeshellarg($cmd);
        $out = shell_exec($full);
        if (!is_string($out) || $out === '') {
            throw new RuntimeException('SSH CLI: РєРѕРјР°РЅРґР° РЅРµ РІС‹РїРѕР»РЅРёР»Р°СЃСЊ');
        }
        return $out;
    }
    throw new RuntimeException('РќРµС‚ ssh2 Рё РЅРµ РЅР°СЃС‚СЂРѕРµРЅ СЃРёСЃС‚РµРјРЅС‹Р№ ssh (auth.cli_key)');
}

// AJAX-РѕР±СЂР°Р±РѕС‚С‡РёРє: СЃРѕР·РґР°С‚СЊ peer Рё РІРµСЂРЅСѓС‚СЊ JSON-РєРѕРЅС„РёРі
if (($_GET['ajax'] ?? '') === '1') {
    header('Content-Type: application/json; charset=utf-8');
    try {
        $config = cfg();
        if ($config === null) throw new RuntimeException('РЎРѕР·РґР°Р№С‚Рµ web/config.php РёР· config.php.example');
        if (isset($config['api'])) {
            $j = http_api_create($config);
            echo json_encode(['ok'=>true,'name'=>$j['name'],'config'=>$j['config']], JSON_UNESCAPED_UNICODE);
        } else {
            $prefix = $config['peer_prefix'] ?? 'user';
            $rnd = bin2hex(random_bytes(2));
            $name = sprintf('%s-%s-%s', $prefix, date('Ymd-His'), $rnd);
            $output = ssh_exec_cfg($config, 'wg-api.sh add-peer --name ' . escapeshellarg($name));
            echo json_encode(['ok' => true, 'name' => $name, 'config' => $output], JSON_UNESCAPED_UNICODE);
        }
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }
    exit;
}
?>
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WireGuard вЂ” РџРѕР»СѓС‡РёС‚СЊ QR</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;}
    button{padding:10px 16px;font-size:16px}
    #qr{margin-top:16px}
    #cfg{white-space:pre-wrap;background:#f6f8fa;padding:12px;margin-top:12px}
    .muted{color:#555}
  </style>
  <script>
    function renderQRTo(element, text){
      if (window.QRCode) {
        const canvas = document.createElement('canvas');
        element.appendChild(canvas);
        QRCode.toCanvas(canvas, text, {width:256, margin:1}, (err)=>{ if(err) element.textContent='РћС€РёР±РєР° QR: '+err; });
      } else {
        const img = document.createElement('img');
        img.width=256; img.height=256;
        img.alt='QR';
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=' + encodeURIComponent(text);
        element.appendChild(img);
      }
    }
  </script>
</head>
<body>
  <h1>РџРѕР»СѓС‡РёС‚СЊ QR-РєРѕРґ WireGuard</h1>
  <?php $hasCfg = is_file(__DIR__ . '/config.php'); if (!$hasCfg): ?>
    <p style="color:#b00">РЎРѕР·РґР°Р№С‚Рµ С„Р°Р№Р» <code>web/config.php</code> РёР· <code>web/config.php.example</code> СЃ РґРѕСЃС‚СѓРїР°РјРё Рє РІР°С€РµРјСѓ СЃРµСЂРІРµСЂСѓ.</p>
  <?php endif; ?>

  <button id="btn">РџРѕР»СѓС‡РёС‚СЊ QR</button>
  <div id="status" class="muted"></div>
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

    async function getQR(){
      btn.disabled = true;
      status.textContent = 'Generating...';
      box.innerHTML = '';
      pre.style.display = 'none';
      proxyPre.style.display = 'none';
      proxyPre.textContent = '';
      dl.style.display = 'none';
      try {
        const r = await fetch('?ajax=1');
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'API error');
        pre.textContent = j.config;
        pre.style.display = 'block';
        renderQRTo(box, j.config);
        status.textContent = 'Ready: ' + j.name;
        if (j.proxy) {
          const socks = j.proxy.socks || {};
          const http = j.proxy.http || {};
          const lines = [
            'Login: ' + j.proxy.username,
            'Password: ' + j.proxy.password,
            'SOCKS5: ' + (socks.scheme || 'socks5') + '://' + j.proxy.username + ':' + j.proxy.password + '@' + (socks.host || '-') + ':' + (socks.port || ''),
            'HTTP: ' + (http.scheme || 'http') + '://' + j.proxy.username + ':' + j.proxy.password + '@' + (http.host || '-') + ':' + (http.port || '')
          ].join('\n');
          proxyPre.textContent = lines;
          proxyPre.style.display = 'block';
        }
        const blob = new Blob([j.config], {type:'text/plain'});
        const url = URL.createObjectURL(blob);
        dl.innerHTML = '';
        const a = document.createElement('a');
        a.href = url;
        a.download = j.name + '.conf';
        a.textContent = 'Download config';
        dl.appendChild(a);
        dl.style.display = 'block';
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }
    btn.addEventListener('click', getQR);
  </script>
</body>
</html>


