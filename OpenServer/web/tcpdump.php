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
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;}
    button{padding:8px 14px;margin-right:8px}
    pre{background:#0b1021;color:#e6eaf0;padding:12px;overflow:auto;max-height:400px}
    .status{margin-bottom:12px;font-weight:600}
    #error{color:#b00;margin-top:12px}
  </style>
</head>
<body>
  <h1>tcpdump на сервере WireGuard</h1>
  <?php if ($cfg === null || !isset($cfg['api'])): ?>
    <p style="color:#b00">Настройте <code>web/config.php</code>, указав раздел <code>api</code> (url и token).</p>
  <?php else: ?>
    <div class="status" id="status">Загрузка статуса...</div>
    <div>
      <button onclick="sendAction('start')">Запустить tcpdump</button>
      <button onclick="sendAction('stop')">Остановить</button>
      <button onclick="loadStatus()">Обновить</button>
      <button onclick="loadLog()">Показать лог</button>
    </div>
    <pre id="log"></pre>
    <div id="error"></div>
  <?php endif; ?>

  <script>
    async function api(action){
      const res = await fetch('?ajax=1&action='+action);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch(e){
        throw new Error(text || e.message);
      }
    }
    async function loadStatus(){
      try{
        const data = await api('status');
        document.getElementById('status').textContent = data.running ? 'Статус: tcpdump запущен' : 'Статус: tcpdump остановлен';
        document.getElementById('log').textContent = (data.tail || '').trim();
        document.getElementById('error').textContent = '';
      }catch(e){
        document.getElementById('error').textContent = 'Ошибка: '+e.message;
      }
    }
    async function sendAction(action){
      try{
        const data = await api(action);
        document.getElementById('status').textContent = data.running ? 'Статус: tcpdump запущен' : 'Статус: tcpdump остановлен';
        if (data.tail) document.getElementById('log').textContent = (data.tail || '').trim();
        document.getElementById('error').textContent = '';
      }catch(e){
        document.getElementById('error').textContent = 'Ошибка: '+e.message;
      }
    }
    async function loadLog(){
      try{
        const data = await api('log');
        document.getElementById('log').textContent = (data.log || '').trim();
        document.getElementById('error').textContent = '';
      }catch(e){
        document.getElementById('error').textContent = 'Ошибка: '+e.message;
      }
    }
    <?php if ($cfg !== null && isset($cfg['api'])): ?>
    loadStatus();
    <?php endif; ?>
  </script>
</body>
</html>

