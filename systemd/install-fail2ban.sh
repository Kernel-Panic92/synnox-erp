#!/bin/bash
# Instala la protección fail2ban del endpoint de login de SynnoxERP.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este script como root: sudo $0" >&2
  exit 1
fi

INSTALL_DIR="${SYNNOX_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG_DIR="$INSTALL_DIR/systemd/fail2ban"

if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update
  apt-get install -y fail2ban
fi

install -m 0644 "$CONFIG_DIR/filter.d/synnox-login.conf" /etc/fail2ban/filter.d/synnox-login.conf
install -m 0644 "$CONFIG_DIR/jail.d/synnox-login.conf" /etc/fail2ban/jail.d/synnox-login.conf

fail2ban-client -t
systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status synnox-login
