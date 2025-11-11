#!/usr/bin/env bash
set -euo pipefail

# Helper that mirrors the Android diagnostics port list and installs all
# required iptables rules (forwarding and DNAT) so that every tested port can
# terminate on the same WireGuard interface/port.

ACTION="${1:-}"

WG_IF="${WG_IF:-wg0}"
WG_SUBNET="${WG_SUBNET:-10.7.0.0/24}"
WG_PORT="${WG_PORT:-443}"
WAN_IF="${WAN_IF:-$(ip -o -4 route show to default | awk '{print $5}' | head -n1)}"

# Keep this list in sync with components/ServerSettings.tsx > ENDPOINT_PORT_PROBES.
# Add extra "popular" ports that frequently bypass ISP firewalls so diagnostics
# can find at least one reachable option.
PROBE_PORTS_FILE="${PROBE_PORTS_FILE:-/etc/wireguard/probe_ports.txt}"
DEFAULT_PORTS=(
  443
)

PORTS=("${DEFAULT_PORTS[@]}")

load_probe_ports() {
  if [[ ! -f "$PROBE_PORTS_FILE" ]]; then
    return
  fi
  mapfile -t loaded <"$PROBE_PORTS_FILE"
  if [[ ${#loaded[@]} -eq 0 ]]; then
    return
  fi
  declare -A requested=()
  for entry in "${loaded[@]}"; do
    port=$(printf '%s' "$entry" | tr -d '[:space:]')
    if [[ "$port" =~ ^[0-9]+$ ]]; then
      requested["$port"]=1
    fi
  done
  local sanitized=()
  for candidate in "${DEFAULT_PORTS[@]}"; do
    if [[ -n "${requested[$candidate]:-}" ]]; then
      sanitized+=("$candidate")
    fi
  done
  if [[ ${#sanitized[@]} -gt 0 ]]; then
    PORTS=("${sanitized[@]}")
  fi
}
load_probe_ports

log() {
  local msg="$1"
  if command -v logger >/dev/null 2>&1; then
    logger -t wg-net-hooks "$msg"
  else
    echo "wg-net-hooks: $msg"
  fi
}

apply_rules() {
  local mode="$1"
  local op
  if [[ "$mode" == "add" ]]; then
    op="-A"
  else
    op="-D"
  fi

  log "apply_rules mode=${mode} wan=${WAN_IF} wg_port=${WG_PORT} ports=${PORTS[*]}"

  iptables -t nat $op POSTROUTING -s "$WG_SUBNET" -o "$WAN_IF" -j MASQUERADE 2>/dev/null || true
  iptables $op FORWARD -i "$WAN_IF" -o "$WG_IF" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  iptables $op FORWARD -i "$WG_IF" -o "$WAN_IF" -j ACCEPT 2>/dev/null || true
  iptables -t mangle $op FORWARD -i "$WG_IF" -o "$WAN_IF" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
  iptables -t mangle $op FORWARD -i "$WAN_IF" -o "$WG_IF" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true

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

