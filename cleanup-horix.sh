#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# SynnoxERP — Script de limpieza Horix → SynnoxERP
#   Uso: sudo bash cleanup-horix.sh
#   Propósito: Eliminar completamente Horix y módulos legacy
#              del servidor antes de deploy limpio
# ─────────────────────────────────────────────────────────────

VERDE="\033[0;32m"; ROJO="\033[0;31m"; AMARILLO="\033[1;33m"; RESET="\033[0m"
ok()  { echo -e " ${VERDE}✓${RESET} $1"; }
err() { echo -e " ${ROJO}✗${RESET} $1"; }
warn(){ echo -e " ${AMARILLO}⚠${RESET} $1"; }

echo -e "${AMARILLO}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║      SynnoxERP — Limpieza Horix → SynnoxERP        ║"
echo "║      ⚠ Esto eliminará TODOS los procesos legacy    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""

# ─── Verificar root ────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then warn "Ejecuta con sudo: sudo bash cleanup-horix.sh"; exit 1; fi

# ─── Confirmación ──────────────────────────────────────────
echo -e "${ROJO}⚠ ATENCIÓN: Este script eliminará:${RESET}"
echo "  - Todos los procesos PM2 (horix-erp, logistics, docflow, etc.)"
echo "  - Configuraciones de Nginx legacy"
echo "  - Configuraciones de Fail2ban, Cron, Sudoers, Logrotate"
echo "  - Certificados SSL legacy"
echo "  - Archivos .env residuales en subdirectorios"
echo "  - Directorios legacy en /opt/"
echo ""
read -p "¿Estás seguro de que quieres continuar? (s/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
  echo "Cancelado."
  exit 0
fi

# ─── 1. Detener todos los procesos PM2 ─────────────────────
echo ""
echo ">>> 1. Deteniendo procesos PM2..."

PM2_PROCS=(
  "synnoxerp"
  "horix-erp"
  "logistics"
  "docflow"
  "synnox-nomina"
  "synnoxerp-proveedores"
  "horix"
  "logistica"
  "proveedores"
  "nomina"
)

for proc in "${PM2_PROCS[@]}"; do
  pm2 delete "$proc" 2>/dev/null && ok "PM2: $proc eliminado" || true
done

pm2 save 2>/dev/null || true
ok "PM2 procesos limpiados"

# ─── 2. Limpiar configuraciones Nginx ──────────────────────
echo ""
echo ">>> 2. Limpiando configuraciones Nginx legacy..."

NGINX_LEGACY=(
  "docflow"
  "docflow-certbot"
  "synnox-nomina"
  "synnox-nomina-certbot"
  "horix"
  "horix-certbot"
  "logistics"
  "logistics-certbot"
)

for conf in "${NGINX_LEGACY[@]}"; do
  rm -f "/etc/nginx/sites-available/$conf" && ok "Nginx: $conf eliminado" || true
  rm -f "/etc/nginx/sites-enabled/$conf" && ok "Nginx: $conf (enabled) eliminado" || true
done

# Verificar que no queden configs legacy
if ls /etc/nginx/sites-available/ | grep -E "docflow|synnox-nomina|horix|logistics" 2>/dev/null; then
  warn "Quedan configs legacy en Nginx — revisa manualmente"
fi

ok "Nginx limpiado"

# ─── 3. Limpiar Fail2ban ───────────────────────────────────
echo ""
echo ">>> 3. Limpiando Fail2ban..."

F2B_LEGACY=(
  "/etc/fail2ban/jail.d/docflow.conf"
  "/etc/fail2ban/filter.d/docflow-login.conf"
  "/etc/fail2ban/jail.d/synnox-nomina.conf"
  "/etc/fail2ban/filter.d/synnox-nomina-login.conf"
  "/etc/fail2ban/jail.d/horix.conf"
  "/etc/fail2ban/filter.d/horix-login.conf"
  "/etc/fail2ban/jail.d/logistics.conf"
  "/etc/fail2ban/filter.d/logistics-login.conf"
)

for f in "${F2B_LEGACY[@]}"; do
  rm -f "$f" && ok "Fail2ban: $(basename "$f") eliminado" || true
done

systemctl restart fail2ban 2>/dev/null || true
ok "Fail2ban limpiado"

# ─── 4. Limpiar Cron ───────────────────────────────────────
echo ""
echo ">>> 4. Limpiando entradas Cron legacy..."

if crontab -l 2>/dev/null | grep -q "backup_docflow\|backup_horasextra\|backup_logistics\|backup_nomina"; then
  crontab -l | grep -v "backup_docflow\|backup_horasextra\|backup_logistics\|backup_nomina" | crontab -
  ok "Cron: entradas legacy eliminadas"
else
  ok "Cron: sin entradas legacy"
fi

# ─── 5. Limpiar Sudoers ────────────────────────────────────
echo ""
echo ">>> 5. Limpiando Sudoers legacy..."

SUDOERS_LEGACY=(
  "/etc/sudoers.d/docflow-mount"
  "/etc/sudoers.d/synnox-nomina-mount"
  "/etc/sudoers.d/horix-mount"
  "/etc/sudoers.d/logistics-mount"
)

for f in "${SUDOERS_LEGACY[@]}"; do
  rm -f "$f" && ok "Sudoers: $(basename "$f") eliminado" || true
done

ok "Sudoers limpiado"

# ─── 6. Limpiar Logrotate ──────────────────────────────────
echo ""
echo ">>> 6. Limpiando Logrotate legacy..."

LOGROTATE_LEGACY=(
  "/etc/logrotate.d/docflow"
  "/etc/logrotate.d/docflow-logrotate"
  "/etc/logrotate.d/synnox-nomina"
  "/etc/logrotate.d/synnox-nomina-logrotate"
  "/etc/logrotate.d/horix"
  "/etc/logrotate.d/logistics"
)

for f in "${LOGROTATE_LEGACY[@]}"; do
  rm -f "$f" && ok "Logrotate: $(basename "$f") eliminado" || true
done

ok "Logrotate limpiado"

# ─── 7. Limpiar certificados SSL legacy ────────────────────
echo ""
echo ">>> 7. Limpiando certificados SSL legacy..."

SSL_LEGACY=(
  "/etc/ssl/docflow"
  "/etc/ssl/synnox-nomina"
  "/etc/ssl/horix"
  "/etc/ssl/logistics"
  "/etc/ssl/platform"
)

for dir in "${SSL_LEGACY[@]}"; do
  rm -rf "$dir" && ok "SSL: $dir eliminado" || true
done

ok "SSL limpiado"

# ─── 8. Limpiar directorios legacy en /opt/ ────────────────
echo ""
echo ">>> 8. Limpiando directorios legacy en /opt/..."

OPT_LEGACY=(
  "/opt/horix-platform"
  "/opt/synnoxerp"
  "/opt/horix-erp"
  "/opt/logistics"
  "/opt/docflow"
)

for dir in "${OPT_LEGACY[@]}"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir" && ok "Directorio: $dir eliminado" || true
  fi
done

ok "Directorios /opt/ limpiados"

# ─── 9. Limpiar directorios de usuario ─────────────────────
echo ""
echo ">>> 9. Limpiando directorios de usuario..."

USER_LEGACY=(
  "$HOME/synnox-erp"
  "$HOME/horix-erp"
  "$HOME/logistics"
  "$HOME/docflow"
  "$HOME/horix"
  "$HOME/backups/nomina"
  "$HOME/backups/proveedores"
  "$HOME/backups/logistics"
)

for dir in "${USER_LEGACY[@]}"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir" && ok "Directorio: $dir eliminado" || true
  fi
done

# Limpiar backups viejos en home
find "$HOME" -maxdepth 1 -name "docflow_*" -type f -delete 2>/dev/null || true
find "$HOME" -maxdepth 1 -name "horix_backup_*" -type f -delete 2>/dev/null || true
find "$HOME" -maxdepth 1 -name "synnox_*" -type f -delete 2>/dev/null || true

ok "Directorios de usuario limpiados"

# ─── 10. Limpiar archivos .env residuales ───────────────────
echo ""
echo ">>> 10. Limpiando archivos .env residuales..."

ENV_DIRS=(
  "modules/logistica"
  "modules/proveedores"
  "modules/nomina"
  "launcher"
  "modules/proyectos"
)

for dir in "${ENV_DIRS[@]}"; do
  if [ -f "$HOME/synnox-erp/$dir/.env" ] 2>/dev/null; then
    rm -f "$HOME/synnox-erp/$dir/.env" && ok ".env: $dir/.env eliminado" || true
  fi
done

ok "Archivos .env residuales limpiados"

# ─── 11. Limpiar logs legacy ───────────────────────────────
echo ""
echo ">>> 11. Limpiando logs legacy..."

LOG_DIRS=(
  "modules/logistica/logs"
  "modules/proveedores/logs"
  "modules/nomina/logs"
  "modules/proyectos/logs"
  "logs"
)

for dir in "${LOG_DIRS[@]}"; do
  if [ -d "$HOME/synnox-erp/$dir" ] 2>/dev/null; then
    rm -rf "$HOME/synnox-erp/$dir" && ok "Logs: $dir eliminado" || true
  fi
done

# Limpiar logs del sistema
rm -f /var/log/backup_nomina.log 2>/dev/null || true
rm -f /var/log/backup_docflow.log 2>/dev/null || true
rm -f /var/log/backup_logistics.log 2>/dev/null || true

ok "Logs limpiados"

# ─── 12. Limpiar uploads legacy ────────────────────────────
echo ""
echo ">>> 12. Limpiando uploads legacy..."

UPLOAD_DIRS=(
  "modules/proveedores/uploads"
  "modules/nomina/uploads"
  "modules/logistica/uploads"
  "modules/proyectos/uploads"
)

for dir in "${UPLOAD_DIRS[@]}"; do
  if [ -d "$HOME/synnox-erp/$dir" ] 2>/dev/null; then
    rm -rf "$HOME/synnox-erp/$dir" && ok "Uploads: $dir eliminado" || true
  fi
done

ok "Uploads limpiados"

# ─── 13. Limpiar archivos SQLite legacy ────────────────────
echo ""
echo ">>> 13. Limpiando archivos SQLite legacy..."

SQLITE_LEGACY=(
  "launcher/launcher.db"
  "launcher/launcher.db-shm"
  "launcher/launcher.db-wal"
  "modules/nomina/horas_extra.db"
  "modules/nomina/horas_extra.db-shm"
  "modules/nomina/horas_extra.db-wal"
  "modules/nomina/launcher.db"
  "modules/nomina/launcher.db-shm"
  "modules/nomina/launcher.db-wal"
)

for f in "${SQLITE_LEGACY[@]}"; do
  if [ -f "$HOME/synnox-erp/$f" ] 2>/dev/null; then
    rm -f "$HOME/synnox-erp/$f" && ok "SQLite: $f eliminado" || true
  fi
done

ok "SQLite limpiado"

# ─── 14. Verificación final ────────────────────────────────
echo ""
echo ">>> 14. Verificación final..."

echo ""
echo "Estado de PM2:"
pm2 list

echo ""
echo "Configs Nginx:"
ls /etc/nginx/sites-available/ 2>/dev/null || echo "  (vacío)"

echo ""
echo "Fail2ban:"
ls /etc/fail2ban/jail.d/ 2>/dev/null || echo "  (vacío)"

echo ""
echo "Cron:"
crontab -l 2>/dev/null || echo "  (vacío)"

# ─── Resumen ───────────────────────────────────────────────
echo ""
echo -e "${VERDE}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${VERDE}║         Limpieza completada                         ║${RESET}"
echo -e "${VERDE}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  El servidor está limpio de Horix y módulos legacy."
echo ""
echo "  Siguiente paso: Clonar SynnoxERP y ejecutar install.sh"
echo ""
echo "  O ejecuta directamente:"
echo "    cd $HOME"
echo "    git clone https://github.com/synnoxerp/synnox-erp.git"
echo "    cd synnox-erp"
echo "    sudo bash install.sh"
echo ""
