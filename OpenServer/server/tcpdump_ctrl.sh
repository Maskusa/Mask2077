#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/tmp/tcpdump_wg0.log"
PID_FILE="/run/tcpdump_wg0.pid"
IFACE="${TCPDUMP_IFACE:-wg0}"
FILTER="${TCPDUMP_FILTER:-icmp or udp port 53 or tcp port 80 or tcp port 443}"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start_capture() {
  if is_running; then
    echo "already running"
    return
  fi
  rm -f "$LOG_FILE"
  touch "$LOG_FILE"
  chmod 600 "$LOG_FILE"
  nohup tcpdump -n -i "$IFACE" -vvv -U $FILTER >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "started"
}

stop_capture() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
  echo "stopped"
}

status_capture() {
  if is_running; then echo "running"; else echo "stopped"; fi
}

tail_log() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 200 "$LOG_FILE"
  fi
}

full_log() {
  if [[ -f "$LOG_FILE" ]]; then
    cat "$LOG_FILE"
  fi
}

usage() {
  echo "Usage: $0 {start|stop|status|tail|log}" >&2
  exit 1
}

case "${1:-}" in
  start) start_capture ;;
  stop) stop_capture ;;
  status) status_capture ;;
  tail) tail_log ;;
  log) full_log ;;
  *) usage ;;
esac

