#!/bin/bash
# install-backup.sh — Instala las unidades systemd del backup unificado.
# Uso: sudo scripts/install-backup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecutar con sudo: sudo scripts/install-backup.sh" >&2
  exit 1
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="/etc/systemd/system"

for unit in synnox-backup.service synnox-backup.timer; do
  sed "s|__INSTALL_DIR__|$INSTALL_DIR|g" "$INSTALL_DIR/systemd/$unit" > "$SYSTEMD_DIR/$unit"
  chmod 644 "$SYSTEMD_DIR/$unit"
  echo "✓ $unit instalado"
done

chmod +x "$INSTALL_DIR/scripts/backup_synnox.sh"
chmod +x "$INSTALL_DIR/scripts/install-backup.sh"

mkdir -p "$INSTALL_DIR/backups"

if [ ! -f "$INSTALL_DIR/backups/.nas.conf" ]; then
  cp "$INSTALL_DIR/systemd/nas.conf.example" "$INSTALL_DIR/backups/.nas.conf"
  chmod 600 "$INSTALL_DIR/backups/.nas.conf"
  echo "✓ backups/.nas.conf creado (editar para habilitar copia a NAS)"
fi

systemctl daemon-reload
systemctl enable --now synnox-backup.timer

echo ""
echo "✓ Timer activo — próximo backup:"
systemctl list-timers synnox-backup.timer --no-pager
echo ""
echo "Prueba manual:  sudo $INSTALL_DIR/scripts/backup_synnox.sh"
