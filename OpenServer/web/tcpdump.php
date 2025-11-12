<?php
function cfg() {
    $path = __DIR__ . '/config.php';
    if (!file_exists($path)) return null;
    return require $path;
}

function api_call(array $cfg, string $endpoint, string $method = 'GET', ?array $payload = null, bool $expectJson = true) {
    if (!isset($cfg['api']['url'], $cfg['api']['token'])) {
        throw new RuntimeException('API не настроен в config.php');
    }
    $url = rtrim($cfg['api']['url'], '/') . $endpoint;
    $headers = [
        'X-Auth-Token: ' . $cfg['api']['token'],
    ];
    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException('curl_init недоступен');
    }
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    if ($method !== 'GET') {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload ?? new stdClass(), JSON_UNESCAPED_UNICODE));
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('API: ' . $err);
    }
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($code !== 200) {
        throw new RuntimeException('API вернул код ' . $code . ': ' . $resp);
    }
    if ($expectJson) {
        $data = json_decode($resp, true);
        if (!is_array($data)) {
            throw new RuntimeException('Не удалось разобрать JSON');
        }
        return $data;
    }
    return $resp;
}

$cfg = cfg();

if (($_GET['ajax'] ?? '') === '1') {
    header('Content-Type: application/json; charset=utf-8');
    try {
        if ($cfg === null || !isset($cfg['api'])) throw new RuntimeException('API не настроен');
        $action = $_GET['action'] ?? 'status';
        switch ($action) {
            case 'status':
                $data = api_call($cfg, '/tcpdump/status');
                echo json_encode($data, JSON_UNESCAPED_UNICODE);
                break;
            case 'start':
                $data = api_call($cfg, '/tcpdump/start', 'POST', []);
                echo json_encode($data, JSON_UNESCAPED_UNICODE);
                break;
            case 'stop':
                $data = api_call($cfg, '/tcpdump/stop', 'POST', []);
                echo json_encode($data, JSON_UNESCAPED_UNICODE);
                break;
            case 'log':
                $text = api_call($cfg, '/tcpdump/log', 'GET', null, false);
                echo json_encode(['ok' => true, 'log' => $text], JSON_UNESCAPED_UNICODE);
                break;
            case 'wg-latest':
                $latest = api_call($cfg, '/wg/latest-handshakes');
                echo json_encode(['ok' => true, 'latest' => $latest['latest'] ?? ''], JSON_UNESCAPED_UNICODE);
                break;
            case 'ens3-443':
                $duration = max(1, min(30, (int) ($_GET['duration'] ?? 5)));
                $data = api_call($cfg, '/tcpdump/ens3-443?duration=' . $duration);
                echo json_encode(['ok' => true, 'output' => $data['output'] ?? ''], JSON_UNESCAPED_UNICODE);
                break;
            case 'wg-icmp':
                $host = urlencode($_GET['host'] ?? '10.6.0.6');
                $data = api_call($cfg, '/tcpdump/wg0-icmp?host=' . $host);
                echo json_encode(['ok' => true, 'output' => $data['output'] ?? ''], JSON_UNESCAPED_UNICODE);
                break;
            default:
                throw new RuntimeException('Неизвестное действие');
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
  <title>WireGuard tcpdump</title>
  <style>
    body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin: 24px; background: #f4f6fb; color: #111; }
    h1 { margin-bottom: 8px; }
    .block { margin-top: 24px; padding: 18px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; box-shadow: 0 2px 6px rgba(15,23,42,.07); }
    .controls { margin: 16px 0 12px; display:flex; flex-wrap:wrap; gap:8px; }
    .controls button, .controls input { padding: 8px 14px; font-size: 14px; border-radius: 6px; border: 1px solid #94a3b8; background: #f8fafc; }
    .copy-btn { background:#e2e8f0; border-color:#cbd5f5; cursor:pointer; }
    .status { margin-bottom: 12px; font-weight: 600; }
    pre { background: #0b1021; color: #e6eaf0; padding: 12px; border-radius: 8px; overflow:auto; max-height: 360px; }
    .handshake-output { background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5f5; min-height: 120px; }
    .error-text { color: #b00; margin-top: 12px; min-height: 1.5em; font-size: 14px; }
    label.inline { display:flex; align-items:center; gap:8px; margin-right:12px; }
  </style>
</head>
<body>
  <h1>tcpdump на сервере WireGuard</h1>
  <?php if ($cfg === null || !isset($cfg['api'])): ?>
    <p style="color:#b00;">Настройте <code>web/config.php</code>, указав раздел <code>api</code> (url и token).</p>
  <?php else: ?>
    <div class="block">
      <h2>WireGuard handshakes</h2>
      <div class="status" id="handshake-status">Ожидание запроса...</div>
      <div class="controls">
        <button onclick="loadHandshakes()">Обновить</button>
        <button class="copy-btn" onclick="copyText('handshake-main')">Копировать</button>
      </div>
      <pre id="handshake-main" class="handshake-output" data-handshake>–</pre>
    </div>
    <div class="block">
      <h2>Общий tcpdump (wg0)</h2>
      <div class="status" id="status">Статус: загрузка...</div>
      <div class="controls">
        <button onclick="sendAction('start')">Запустить tcpdump</button>
        <button onclick="sendAction('stop')">Остановить</button>
        <button onclick="loadStatus()">Обновить</button>
        <button onclick="loadLog()">Показать лог</button>
        <button class="copy-btn" onclick="copyText('log')">Копировать вывод</button>
      </div>
      <pre id="log"></pre>
      <div id="error" class="error-text"></div>
    </div>
    <div class="block">
      <h2>tcpdump wg0 (ICMP / host)</h2>
      <div class="status" id="status-wg0">Готов к снятию</div>
      <div class="controls">
        <label class="inline">Host
          <input id="wg-icmp-host" value="10.6.0.6" />
        </label>
        <button onclick="runWgIcmp()">Снять tcpdump (wg0)</button>
        <button onclick="clearWgLog()">Очистить</button>
        <button class="copy-btn" onclick="copyText('log-wg0')">Копировать вывод</button>
      </div>
      <pre id="log-wg0"></pre>
      <div id="error-wg0" class="error-text"></div>
    </div>
    <div class="block">
      <h2>tcpdump ens3 → UDP 443</h2>
      <div class="status" id="status-ens3">Готов к снятию</div>
      <div class="controls">
        <button onclick="runEns3Capture()">Снять tcpdump (ens3:443)</button>
        <button onclick="clearEns3Log()">Очистить</button>
        <button class="copy-btn" onclick="copyText('log-ens3')">Копировать вывод</button>
      </div>
      <pre id="log-ens3"></pre>
      <div id="error-ens3" class="error-text"></div>
    </div>
  <?php endif; ?>

  
  <script>
    const handshakeElements = document.querySelectorAll('[data-handshake]');

    async function api(action, params = {}) {
      const query = new URLSearchParams({ ajax: '1', action });
      Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
      const res = await fetch('?' + query.toString());
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(text || err.message);
      }
    }

    function copyText(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const text = el.textContent || '';
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    function updateHandshake(text) {
      handshakeElements.forEach(el => (el.textContent = text));
    }

    async function loadHandshakes() {
      const statusEl = document.getElementById('handshake-status');
      statusEl.textContent = 'Запрос /wg/latest-handshakes...';
      if (!handshakeElements.length) {
        statusEl.textContent = 'Нет элементов для отображения handshake.';
        return;
      }
      try {
        const data = await api('wg-latest');
        const text = data.latest || 'Нет данных';
        updateHandshake(text);
        statusEl.textContent = 'Успех: данные получены (' + new Date().toLocaleTimeString() + ')';
      } catch (e) {
        const message = 'Ошибка: ' + e.message;
        updateHandshake(message);
        statusEl.textContent = 'Ошибка запроса /wg/latest-handshakes';
      }
    }

    async function loadStatus() {
      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Запрос /tcpdump/status...';
      try {
        const data = await api('status');
        statusEl.textContent = data.running ? 'Статус: tcpdump запущен' : 'Статус: tcpdump остановлен';
        document.getElementById('log').textContent = (data.tail || '').trim() || '—';
        document.getElementById('error').textContent = '';
        loadHandshakes();
      } catch (e) {
        document.getElementById('error').textContent = 'Ошибка: ' + e.message;
        document.getElementById('log').textContent = 'Ошибка запроса: ' + e.message;
        statusEl.textContent = 'Статус: ошибка';
      }
    }

    async function sendAction(action) {
      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Запрос /tcpdump/' + action + '...';
      try {
        const data = await api(action);
        statusEl.textContent = data.running ? 'Статус: tcpdump запущен' : 'Статус: tcpdump остановлен';
        if (data.tail !== undefined) {
          document.getElementById('log').textContent = (data.tail || '').trim() || '—';
        }
        document.getElementById('error').textContent = '';
        loadHandshakes();
      } catch (e) {
        document.getElementById('error').textContent = 'Ошибка: ' + e.message;
        document.getElementById('log').textContent = 'Ошибка запроса: ' + e.message;
        statusEl.textContent = 'Статус: ошибка';
      }
    }

    async function loadLog() {
      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Запрос /tcpdump/log...';
      try {
        const data = await api('log');
        document.getElementById('log').textContent = (data.log || '').trim() || '—';
        document.getElementById('error').textContent = '';
        statusEl.textContent = 'Статус: лог получен';
      } catch (e) {
        document.getElementById('error').textContent = 'Ошибка: ' + e.message;
        document.getElementById('log').textContent = 'Ошибка запроса: ' + e.message;
        statusEl.textContent = 'Статус: ошибка';
      }
    }

    async function runEns3Capture() {
      const statusEl = document.getElementById('status-ens3');
      const logEl = document.getElementById('log-ens3');
      const errorEl = document.getElementById('error-ens3');
      statusEl.textContent = 'Запрос /tcpdump/ens3-443...';
      try {
        const data = await api('ens3-443', { duration: 5 });
        logEl.textContent = (data.output || '').trim() || '—';
        statusEl.textContent = 'Статус: снимок готов (' + new Date().toLocaleTimeString() + ')';
        errorEl.textContent = '';
        loadHandshakes();
      } catch (e) {
        const msg = 'Ошибка: ' + e.message;
        errorEl.textContent = msg;
        logEl.textContent = msg;
        statusEl.textContent = 'Статус: ошибка снятия';
      }
    }

    function clearEns3Log() {
      document.getElementById('log-ens3').textContent = '';
      document.getElementById('error-ens3').textContent = '';
    }

    async function runWgIcmp() {
      const statusEl = document.getElementById('status-wg0');
      const logEl = document.getElementById('log-wg0');
      const errorEl = document.getElementById('error-wg0');
      statusEl.textContent = 'Запрос /tcpdump/wg0-icmp...';
      try {
        const host = document.getElementById('wg-icmp-host').value || '10.6.0.6';
        const data = await api('wg-icmp', { host });
        logEl.textContent = (data.output || '').trim() || '—';
        statusEl.textContent = 'Статус: снимок готов (' + new Date().toLocaleTimeString() + ')';
        errorEl.textContent = '';
        loadHandshakes();
      } catch (e) {
        const msg = 'Ошибка: ' + e.message;
        errorEl.textContent = msg;
        logEl.textContent = msg;
        statusEl.textContent = 'Статус: ошибка';
      }
    }

    function clearWgLog() {
      document.getElementById('log-wg0').textContent = '';
      document.getElementById('error-wg0').textContent = '';
    }

    <?php if ($cfg !== null && isset($cfg['api'])): ?>
    loadStatus();
    loadHandshakes();
    setInterval(loadHandshakes, 15000);
    <?php endif; ?>
  </script>

</body>
</html>
