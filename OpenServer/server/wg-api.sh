#!/usr/bin/env bash
set -euo pipefail

WG_IF="${WG_IF:-wg0}"
WG_DIR="/etc/wireguard"
CLIENTS_DIR="$WG_DIR/clients"

require_root() { [[ $(id -u) -eq 0 ]] || { echo "Только root" >&2; exit 1; }; }

srv_pub() { [[ -f "$WG_DIR/server_public.key" ]] && cat "$WG_DIR/server_public.key"; }

endpoint() {
  if [[ -n "${PUB_ENDPOINT:-}" ]]; then echo "$PUB_ENDPOINT"; return; fi
  local ip port
  ip=$(curl -fsS ifconfig.me || true)
  port=$(awk -F= '/^ListenPort/ {print $2}' "$WG_DIR/$WG_IF.conf" | tr -d ' ')
  if [[ -z "$ip" ]]; then ip=$(hostname -I | awk '{print $1}'); fi
  echo "$ip:${port:-51820}"
}

subnet_base() {
  local addr
  addr=$(sed -n 's/^Address[[:space:]]*=[[:space:]]*\([0-9.]*\)\/.*/\1/p' "$WG_DIR/$WG_IF.conf" | head -n1)
  echo "$addr" | cut -d. -f1-3
}

is_used_ip() {
  local ip="$1"
  if grep -qE "(^|[[:space:]])AllowedIPs[[:space:]]*=[[:space:]]*$ip/32" "$WG_DIR/$WG_IF.conf"; then return 0; fi
  if wg show "$WG_IF" allowed-ips 2>/dev/null | grep -qE "[[:space:]]$ip/32($|[[:space:]])"; then return 0; fi
  return 1
}

next_ip() {
  local base; base=$(subnet_base)
  local i
  for i in $(seq 2 254); do
    local cand="$base.$i"
    if ! is_used_ip "$cand"; then echo "$cand"; return 0; fi
  done
  echo "Нет свободных IP" >&2; exit 1
}

add_peer() {
  local name="" ip=""
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
  wg set "$WG_IF" peer "$cpub" allowed-ips "$ip/32"
  {
    printf "\n[Peer]\n"
    printf "PublicKey = %s\n" "$cpub"
    printf "AllowedIPs = %s/32\n" "$ip"
  } >>"$WG_DIR/$WG_IF.conf"
  systemctl restart "wg-quick@$WG_IF"
  local spub sDNS endpoint_url
  spub=$(srv_pub)
  sDNS=$(awk -F= '/^#DNS_DEFAULT/ {print $2}' "$WG_DIR/$WG_IF.conf" 2>/dev/null | tr -d ' ' || true)
  endpoint_url=$(endpoint)
  cat <<CFG
[Interface]
PrivateKey = $cpriv
Address = $ip/32
DNS = ${sDNS:-1.1.1.1}

[Peer]
PublicKey = $spub
Endpoint = $endpoint_url
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
CFG
}

get_cfg() { local name="$1"; [[ -f "$CLIENTS_DIR/$name.conf" ]] && cat "$CLIENTS_DIR/$name.conf" || { echo "Нет клиента $name" >&2; exit 1; }; }

list_peers() { wg show "$WG_IF" peers; }

remove_peer() {
  local pub="$1"; [[ -n "$pub" ]] || { echo "Укажите pubkey" >&2; exit 1; }
  wg set "$WG_IF" peer "$pub" remove || true
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
