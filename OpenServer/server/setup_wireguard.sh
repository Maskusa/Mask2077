#!/usr/bin/env bash
set -euo pipefail

# --- ПАРАМЕТРЫ ПО УМОЛЧАНИЮ ---
# Публичный IP/домен сервера (для Endpoint в конфиге клиентов)
PUB_ENDPOINT="${PUB_ENDPOINT:-45.151.183.153}"
# Интерфейс WireGuard
WG_IF="${WG_IF:-wg0}"
# Порт WireGuard (UDP)
WG_PORT="${WG_PORT:-51820}"
# Подсеть VPN и адрес сервера
WG_SUBNET="${WG_SUBNET:-10.7.0.0/24}"
WG_SERVER_IP="${WG_SERVER_IP:-10.7.0.1}"
# DNS для клиентов
WG_DNS="${WG_DNS:-1.1.1.1,1.0.0.1}"

require_root() {
  if [[ $(id -u) -ne 0 ]]; then
    echo "Запустите от root: sudo -i; bash setup_wireguard.sh" >&2
    exit 1
  fi
}

detect_wan_iface() {
  ip -o -4 route show to default | awk '{print $5}' | head -n1
}

enable_ip_forward() {
  echo "Включаю IP forwarding..."
  cat >/etc/sysctl.d/99-wireguard-forward.conf <<EOF
net.ipv4.ip_forward=1
EOF
  sysctl --system >/dev/null
}

install_packages() {
  echo "Установка пакетов..."
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard qrencode ufw iproute2
}

generate_server_keys() {
  mkdir -p /etc/wireguard
  chmod 700 /etc/wireguard
  if [[ ! -f /etc/wireguard/server_private.key ]]; then
    umask 077
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey >/etc/wireguard/server_public.key
  fi
}

write_wg_conf() {
  local wan
  wan="${WAN_IF:-$(detect_wan_iface)}"
  local priv
  priv=$(cat /etc/wireguard/server_private.key)

  cat >/etc/wireguard/${WG_IF}.conf <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${priv}
# NAT и форвардинг трафика через внешний интерфейс
PostUp = iptables -t nat -A POSTROUTING -s ${WG_SUBNET} -o ${wan} -j MASQUERADE; \
         iptables -A FORWARD -i ${wan} -o ${WG_IF} -m state --state RELATED,ESTABLISHED -j ACCEPT; \
         iptables -A FORWARD -i ${WG_IF} -o ${wan} -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s ${WG_SUBNET} -o ${wan} -j MASQUERADE; \
           iptables -D FORWARD -i ${wan} -o ${WG_IF} -m state --state RELATED,ESTABLISHED -j ACCEPT; \
           iptables -D FORWARD -i ${WG_IF} -o ${wan} -j ACCEPT
SaveConfig = true
EOF

  chmod 600 /etc/wireguard/${WG_IF}.conf
}

setup_ufw() {
  echo "Настраиваю UFW..."
  ufw allow OpenSSH || true
  ufw allow ${WG_PORT}/udp || true
  ufw allow ${WG_PORT}/tcp || true
  ufw --force enable || true
}

enable_service() {
  systemctl enable --now wg-quick@${WG_IF}
}

prepare_clients_dir() {
  mkdir -p /etc/wireguard/clients
  chmod 700 /etc/wireguard/clients
}

install_api() {
  if [[ -f /usr/local/bin/wg-api.sh ]]; then
    return
  fi
  echo "Устанавливаю вспомогательный API-скрипт управления peers..."
  cat >/usr/local/bin/wg-api.sh <<'EOS'
#!/usr/bin/env bash
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
WG_DIR="/etc/wireguard"
CLIENTS_DIR="$WG_DIR/clients"

require_root() { [[ $(id -u) -eq 0 ]] || { echo "Только root" >&2; exit 1; }; }

srv_pub() { [[ -f "$WG_DIR/server_public.key" ]] && cat "$WG_DIR/server_public.key"; }

endpoint() {
  # Можно переопределить: export PUB_ENDPOINT=ip_or_domain:port
  if [[ -n "${PUB_ENDPOINT:-}" ]]; then echo "$PUB_ENDPOINT"; return; fi
  local ip port
  ip=$(curl -fsS ifconfig.me || true)
  port=$(awk -F= '/ListenPort/ {print $2}' "$WG_DIR/$WG_IF.conf" | tr -d ' ')
  if [[ -z "$ip" ]]; then ip=$(hostname -I | awk '{print $1}'); fi
  echo "$ip:${port:-51820}"
}

next_ip() {
  local base
  base=$(awk -F'[= /]' '/Address/ {print $3}' "$WG_DIR/$WG_IF.conf" | head -n1)
  base=${base%.*}
  local used
  used=$(awk -F'[=,/ ]' '/AllowedIPs/ {print $5}' "$WG_DIR/$WG_IF.conf" | sort -u)
  for i in $(seq 2 254); do
    local cand="$base.$i"
    if ! grep -q "\b$cand\b" <<<"$used"; then
      echo "$cand"
      return
    fi
  done
  echo "Нет свободных IP" >&2; exit 1
}

add_peer() {
  local name=""
  local ip=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) name="$2"; shift 2;;
      --ip) ip="$2"; shift 2;;
      *) echo "Неизвестный аргумент: $1" >&2; exit 1;;
    esac
  done
  [[ -n "$name" ]] || { echo "--name обязателен" >&2; exit 1; }
  mkdir -p "$CLIENTS_DIR"; chmod 700 "$CLIENTS_DIR"
  umask 077
  local cpriv cpub
  cpriv=$(wg genkey)
  cpub=$(sed -n '1p' <<<"$cpriv" | wg pubkey)
  [[ -n "$ip" ]] || ip=$(next_ip)
  # Добавляем на сервер
  wg set "$WG_IF" peer "$cpub" allowed-ips "$ip/32"
  # Для персистентности
  cat >>"$WG_DIR/$WG_IF.conf" <<EOF
[Peer]
PublicKey = $cpub
AllowedIPs = $ip/32
EOF
  systemctl restart "wg-quick@$WG_IF"
  local spub saddr sDNS endpoint
  spub=$(srv_pub)
  saddr=$(awk -F'[= /]' '/Address/ {print $3}' "$WG_DIR/$WG_IF.conf" | head -n1)
  sDNS=$(awk -F= '/#DNS_DEFAULT/ {print $2}' "$WG_DIR/$WG_IF.conf" 2>/dev/null | tr -d ' ' || true)
  endpoint=$(endpoint)
  # Конфиг клиента
  local cfg
  cfg="[Interface]
PrivateKey = $cpriv
Address = $ip/32
DNS = ${sDNS:-1.1.1.1}

[Peer]
PublicKey = $spub
Endpoint = $endpoint
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
"
  echo "$cfg" | tee "$CLIENTS_DIR/$name.conf" >/dev/null
  echo "$cfg"
}

get_cfg() {
  local name="$1"
  [[ -f "$CLIENTS_DIR/$name.conf" ]] || { echo "Нет клиента $name" >&2; exit 1; }
  cat "$CLIENTS_DIR/$name.conf"
}

list_peers() {
  wg show "$WG_IF" peers | while read -r p; do
    ip=$(awk -v pub="$p" 'pub==""{next} $0 ~ pub {f=1} f && /allowed ips/ {print $3; exit}' <(wg show "$WG_IF" verbose) || true)
    echo "$p $ip"
  done
}

remove_peer() {
  local pub="$1"
  [[ -n "$pub" ]] || { echo "Укажите pubkey" >&2; exit 1; }
  wg set "$WG_IF" peer "$pub" remove || true
  # Удаляем из конфига
  awk -v k="$pub" 'BEGIN{RS=""}/\[Peer\]/&&$0~k{next}1' "$WG_DIR/$WG_IF.conf" >"$WG_DIR/$WG_IF.conf.new"
  mv "$WG_DIR/$WG_IF.conf.new" "$WG_DIR/$WG_IF.conf"
  systemctl restart "wg-quick@$WG_IF"
}

case "${1:-}" in
  add-peer) shift; require_root; add_peer "$@" ;;
  get-config) shift; require_root; get_cfg "$1" ;;
  list-peers) require_root; list_peers ;;
  remove-peer) shift; require_root; remove_peer "$1" ;;
  up) require_root; systemctl start "wg-quick@$WG_IF" ;;
  down) require_root; systemctl stop "wg-quick@$WG_IF" ;;
  status) wg show "$WG_IF" ;;
  *) echo "Использование: $0 {add-peer|get-config|list-peers|remove-peer|up|down|status}" ; exit 1 ;;
esac
EOS
  chmod +x /usr/local/bin/wg-api.sh
}

main() {
  require_root
  install_packages
  enable_ip_forward
  generate_server_keys
  write_wg_conf
  setup_ufw || true
  enable_service
  prepare_clients_dir
  install_api
  echo
  echo "WireGuard установлен и запущен на ${WG_IF}."
  echo "Публичная точка: ${PUB_ENDPOINT}:${WG_PORT} (изменить через PUB_ENDPOINT=...)"
  echo "Добавьте первого клиента: wg-api.sh add-peer --name phone"
}

main "$@"
