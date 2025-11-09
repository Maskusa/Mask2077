import os
import sys
import time

HOST = os.environ.get("WG_HOST", "45.151.183.153")
USER = os.environ.get("WG_USER", "root")
PASSWORD = os.environ.get("WG_PASS", "760RBeSbt57T")
PUB_ENDPOINT = os.environ.get("PUB_ENDPOINT", "45.151.183.153")
LOCAL_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "server", "setup_wireguard.sh")
REMOTE_SCRIPT = "/root/setup_wireguard.sh"

def main():
    try:
        import paramiko
    except ImportError:
        print("[!] Требуется пакет paramiko. Установите: pip install paramiko", file=sys.stderr)
        sys.exit(2)

    if not os.path.isfile(LOCAL_SCRIPT):
        print(f"[!] Не найден локальный скрипт: {LOCAL_SCRIPT}", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Подключение к {USER}@{HOST} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    print("[*] Загрузка setup_wireguard.sh ...")
    sftp = client.open_sftp()
    sftp.put(LOCAL_SCRIPT, REMOTE_SCRIPT)
    sftp.chmod(REMOTE_SCRIPT, 0o755)
    sftp.close()

    print("[*] Запуск установки WireGuard (это займет 10-60 сек) ...")
    cmd = f"PUB_ENDPOINT={PUB_ENDPOINT} bash {REMOTE_SCRIPT}"
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    # потоково показываем вывод
    while not stdout.channel.exit_status_ready():
        time.sleep(0.3)
        chunk = stdout.channel.recv(4096)
        if chunk:
            sys.stdout.buffer.write(chunk)
            sys.stdout.flush()
    # выведем оставшееся
    rest = stdout.read()
    if rest:
        sys.stdout.buffer.write(rest)
        sys.stdout.flush()

    exit_status = stdout.channel.recv_exit_status()
    if exit_status != 0:
        print("[!] Установка завершилась с ошибкой:")
        print(stderr.read().decode("utf-8", "ignore"))
        client.close()
        sys.exit(exit_status)

    print("[*] Проверка статуса wg0 ...")
    _, s_out, s_err = client.exec_command("wg show")
    print(s_out.read().decode())
    err = s_err.read().decode().strip()
    if err:
        print(err, file=sys.stderr)

    client.close()
    print("[+] Сервер настроен.")

if __name__ == "__main__":
    main()

