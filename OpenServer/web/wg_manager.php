<?php
// Простой менеджер WireGuard: подключение по SSH (php_ssh2) к серверу и вызов wg-api.sh
// Не хранит пароли — введите при каждом использовании. Защитите доступ к файлу на хостинге (HTTP auth/IP).

function have_ssh2() { return function_exists('ssh2_connect'); }

function run_remote($host, $user, $pass, $cmd) {
    if (!have_ssh2()) {
        throw new RuntimeException('Требуется PHP-расширение ssh2. Обратитесь в поддержку хостинга.');
    }
    $conn = @ssh2_connect($host, 22, ['hostkey' => 'ssh-rsa']);
    if (!$conn) throw new RuntimeException('SSH: не удалось подключиться');
    if (!@ssh2_auth_password($conn, $user, $pass)) throw new RuntimeException('SSH: неверные логин/пароль');
    $stream = ssh2_exec($conn, $cmd);
    if (!$stream) throw new RuntimeException('SSH: не удалось выполнить команду');
    stream_set_blocking($stream, true);
    $out = stream_get_contents($stream);
    fclose($stream);
    return $out;
}

$error = null; $output = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $host = trim($_POST['host'] ?? '');
    $user = trim($_POST['user'] ?? 'root');
    $pass = $_POST['pass'] ?? '';
    $action = $_POST['action'] ?? '';
    $name = trim($_POST['name'] ?? '');
    try {
        if ($action === 'status') {
            $output = run_remote($host, $user, $pass, 'wg-api.sh status || wg show');
        } elseif ($action === 'up') {
            $output = run_remote($host, $user, $pass, 'wg-api.sh up && echo OK');
        } elseif ($action === 'down') {
            $output = run_remote($host, $user, $pass, 'wg-api.sh down && echo OK');
        } elseif ($action === 'add' && $name) {
            // Возвращает конфиг клиента — отобразим его и сгенерируем QR на странице
            $output = run_remote($host, $user, $pass, 'wg-api.sh add-peer --name '.escapeshellarg($name));
        } elseif ($action === 'get' && $name) {
            $output = run_remote($host, $user, $pass, 'wg-api.sh get-config '.escapeshellarg($name));
        } elseif ($action === 'list') {
            $output = run_remote($host, $user, $pass, 'wg-api.sh list-peers');
        } elseif ($action === 'remove' && $name) {
            // remove ожидает публичный ключ — для простоты позволим ввести pubkey в поле name
            $output = run_remote($host, $user, $pass, 'wg-api.sh remove-peer '.escapeshellarg($name));
        } else {
            throw new RuntimeException('Неверные параметры действия');
        }
    } catch (Throwable $e) { $error = $e->getMessage(); }
}
?><!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WireGuard Manager</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px;}
    form{display:grid;gap:8px;max-width:720px}
    input,button,select,textarea{font:inherit;padding:8px}
    .row{display:flex;gap:8px;flex-wrap:wrap}
    .row>*{flex:1 1 200px}
    #qr{margin-top:12px}
    pre{background:#f6f8fa;padding:12px;overflow:auto}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <script>
    function makeQR(){
      const cfg = document.getElementById('cfg').textContent.trim();
      const box = document.getElementById('qr');
      box.innerHTML='';
      if(!cfg) return;
      const canvas = document.createElement('canvas');
      box.appendChild(canvas);
      QRCode.toCanvas(canvas, cfg, {width:256, margin:1}, (err)=>{ if(err) alert(err); });
    }
  </script>
  </head>
<body>
  <h1>Управление WireGuard</h1>
  <form method="post">
    <div class="row">
      <input name="host" placeholder="Хост (IP/домен)" required value="<?=htmlspecialchars($_POST['host'] ?? '45.151.183.153')?>">
      <input name="user" placeholder="Пользователь" value="<?=htmlspecialchars($_POST['user'] ?? 'root')?>">
      <input name="pass" type="password" placeholder="Пароль" value="<?=htmlspecialchars($_POST['pass'] ?? '')?>">
    </div>
    <div class="row">
      <select name="action">
        <option value="status" <?=(($_POST['action']??'')==='status'?'selected':'')?>>Статус</option>
        <option value="up" <?=(($_POST['action']??'')==='up'?'selected':'')?>>Поднять интерфейс</option>
        <option value="down" <?=(($_POST['action']??'')==='down'?'selected':'')?>>Опустить интерфейс</option>
        <option value="list" <?=(($_POST['action']??'')==='list'?'selected':'')?>>Список peers</option>
        <option value="add" <?=(($_POST['action']??'')==='add'?'selected':'')?>>Добавить peer (name)</option>
        <option value="get" <?=(($_POST['action']??'')==='get'?'selected':'')?>>Получить конфиг (name)</option>
        <option value="remove" <?=(($_POST['action']??'')==='remove'?'selected':'')?>>Удалить peer (pubkey)</option>
      </select>
      <input name="name" placeholder="name / pubkey (для add/get/remove)" value="<?=htmlspecialchars($_POST['name'] ?? '')?>">
      <button type="submit">Выполнить</button>
    </div>
  </form>

  <?php if ($error): ?>
    <p style="color:#b00"><strong>Ошибка:</strong> <?=htmlspecialchars($error)?></p>
  <?php endif; ?>

  <?php if ($output): ?>
    <h2>Результат</h2>
    <pre id="cfg"><?=htmlspecialchars($output)?></pre>
    <button onclick="makeQR()">Показать QR для конфигурации</button>
    <div id="qr"></div>
  <?php endif; ?>

  <hr>
  <p><strong>Совет по безопасности:</strong> ограничьте доступ к этой странице (HTTP auth, IP),
  желательно используйте SSH-ключи и запрет пароля для root на сервере.</p>
</body>
</html>

