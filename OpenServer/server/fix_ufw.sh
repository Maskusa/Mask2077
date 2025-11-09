#!/usr/bin/env bash
set -euo pipefail

sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw || true
ufw --force enable >/dev/null 2>&1 || true
ufw route allow in on wg0 out on ens3 || true
ufw allow in on wg0 || true
ufw reload || true
ufw status verbose

