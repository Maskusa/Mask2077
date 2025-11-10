#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

WG_IF="${WG_IF:-wg0}"
WG_SUBNET="${WG_SUBNET:-10.7.0.0/24}"
WG_PORT="${WG_PORT:-51820}"
WAN_IF="${WAN_IF:-$(ip -o -4 route show to default | awk '{print $5}' | head -n1)}"
PORTS=(1024 53 123 443 500 51820 8443 3389)

apply_rules() {
  local mode="$1"
  local op
  if [[ "$mode" == "add" ]]; then
    op="-A"
  else
    op="-D"
  fi

  iptables -t nat $op POSTROUTING -s "$WG_SUBNET" -o "$WAN_IF" -j MASQUERADE 2>/dev/null || true
  iptables $op FORWARD -i "$WAN_IF" -o "$WG_IF" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  iptables $op FORWARD -i "$WG_IF" -o "$WAN_IF" -j ACCEPT 2>/dev/null || true

  for port in "${PORTS[@]}"; do
    iptables $op INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
    if [[ "$port" != "$WG_PORT" ]]; then
      iptables -t nat $op PREROUTING -i "$WAN_IF" -p udp --dport "$port" -j REDIRECT --to-ports "$WG_PORT" 2>/dev/null || true
    fi
  done
}

case "$ACTION" in
  up)
    apply_rules add
    ;;
  down)
    apply_rules delete
    ;;
  *)
    echo "Usage: $0 {up|down}" >&2
    exit 1
    ;;
esac
