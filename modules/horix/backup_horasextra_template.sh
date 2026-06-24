#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  backup_horasextra.sh — Backup automático de Horix
#  Generado por install.sh — NO editar manualmente las variables
#  Para reconfigurar, edita las variables en la sección CONFIG.
#
#  Cron diario a las 2:00 AM (ejecutar como root):
#    0 2 * * * __INSTALL_DIR__/backup_horasextra.sh >> /var/log/backup_horasextra.log 2>&1
# ═══════════════════════════════════════════════════════════════

# ── CONFIGURACIÓN — generada por install.sh ────────────────────
APP_URL="http://localhost:__PORT__"
INSTALL_DIR="__INSTALL_DIR__"

BACKUP_LOCAL="__BACKUP_LOCAL__"
USAR_NAS="__USAR_NAS__"
BACKUP_RED="__BACKUP_RED__"
SMB_SERVER="__SMB_SERVER__"
SMB_MOUNT="__SMB_MOUNT__"
SMB_USER="__SMB_USER__"
SMB_PASS="__SMB_PASS__"

RETENER_DIAS=30
FECHA=$(date +"%Y-%m-%d_%H-%M-%S")
NOMBRE="horix_backup_${FECHA}.zip"
LOG_TAG="[Horix Backup]"
ERROR_RED=""
BACKUP_TOKEN="${BACKUP_TOKEN:-}"
# ──────────────────────────────────────────────────────────────

# Leer token desde archivo o .env si no se pasó como variable de entorno
if [ -z "$BACKUP_TOKEN" ]; then
  BACKUP_TOKEN=$(cat "$INSTALL_DIR/.backup_token" 2>/dev/null || echo '')
fi
if [ -z "$BACKUP_TOKEN" ] && [ -f "$INSTALL_DIR/.env" ]; then
  BACKUP_TOKEN=$(grep '^BACKUP_TOKEN=' "$INSTALL_DIR/.env" | cut -d= -f2- | head -1)
fi
if [ -z "$BACKUP_TOKEN" ]; then
  echo "$LOG_TAG  ✗ ERROR: BACKUP_TOKEN no configurado. Ejecuta install.sh o crea .backup_token"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $BACKUP_TOKEN"

enviar_alerta() {
  local ERROR_MSG="$1"
  local DETALLE="$2"
  echo "$LOG_TAG  📧 Enviando alerta por correo..."
  curl -sL -X POST "$APP_URL/api/backup/alerta" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -H "x-forwarded-proto: https" \
    -d "{\"error\":\"$ERROR_MSG\",\"detalle\":\"$DETALLE\"}" > /dev/null
  echo "$LOG_TAG  ✓ Alerta enviada"
}

echo ""
echo "══════════════════════════════════════════"
echo "$LOG_TAG  Iniciando — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════"

mkdir -p "$BACKUP_LOCAL"

echo "$LOG_TAG  🔐 Usando token de backup..."

ARCHIVO_LOCAL="$BACKUP_LOCAL/$NOMBRE"
echo "$LOG_TAG  📦 Descargando backup..."
HTTP_CODE=$(curl -sL -o "$ARCHIVO_LOCAL" -w "%{http_code}" \
  -H "$AUTH_HEADER" \
  -H "x-forwarded-proto: https" \
  "$APP_URL/api/backup")

if [ "$HTTP_CODE" = "200" ] && [ -s "$ARCHIVO_LOCAL" ]; then
  TAMANO=$(du -sh "$ARCHIVO_LOCAL" | cut -f1)
  echo "$LOG_TAG  ✓ Backup: $ARCHIVO_LOCAL ($TAMANO)"
else
  echo "$LOG_TAG  ✗ ERROR: Falló la descarga (HTTP $HTTP_CODE)"
  rm -f "$ARCHIVO_LOCAL"
  enviar_alerta "Error al descargar backup" "HTTP $HTTP_CODE"
  exit 1
fi

if [ "$USAR_NAS" = "true" ]; then
  MONTAR_DESMONTADO=false
  if ! mountpoint -q "$SMB_MOUNT" 2>/dev/null; then
    echo "$LOG_TAG  📡 Montando share $SMB_SERVER..."
    sudo mkdir -p "$SMB_MOUNT"
    sudo mount -t cifs "$SMB_SERVER" "$SMB_MOUNT" \
      -o username="$SMB_USER",password="$SMB_PASS",iocharset=utf8,vers=3.0,noperm 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "$LOG_TAG  ✓ Share montado"
      MONTAR_DESMONTADO=true
    else
      ERROR_RED="No se pudo montar $SMB_SERVER"
      echo "$LOG_TAG  ✗ $ERROR_RED"
      enviar_alerta "Error al montar share de red" "$ERROR_RED"
      BACKUP_RED=""
    fi
  fi

  RED_OK=false
  if [ -n "$BACKUP_RED" ]; then
    mkdir -p "$BACKUP_RED" 2>/dev/null
    cp "$ARCHIVO_LOCAL" "$BACKUP_RED/"
    if [ $? -eq 0 ]; then
      echo "$LOG_TAG  ✓ Copia en red: $BACKUP_RED/$NOMBRE"
      RED_OK=true
      # Rotar backups viejos en NAS (antes de desmontar)
      find "$BACKUP_RED" -name "horix_backup_*.zip" -mtime +$RETENER_DIAS -type f -delete
    else
      echo "$LOG_TAG  ✗ ERROR: No se pudo copiar a la red"
    fi
  fi

  if [ "$MONTAR_DESMONTADO" = true ]; then
    sudo umount "$SMB_MOUNT" 2>/dev/null && echo "$LOG_TAG  📡 Share desmontado"
  fi
fi

find "$BACKUP_LOCAL" -name "horix_backup_*.zip" -mtime +$RETENER_DIAS -type f -delete

TAMANO_FINAL=$(du -sh "$ARCHIVO_LOCAL" 2>/dev/null | cut -f1 || echo "desconocido")

export ERROR_RED="$ERROR_RED"
node -e "
const errorRed = process.env.ERROR_RED || null;
const data = {
  fecha:   new Date().toISOString(),
  archivo: '$NOMBRE',
  tamano:  '$TAMANO_FINAL',
  ok:      !errorRed,
  local:   true,
  red:     $RED_OK,
  error:   errorRed || null
};
require('fs').writeFileSync(
  '$INSTALL_DIR/last_backup.json',
  JSON.stringify(data, null, 2)
);
"

TOTAL_LOCAL=$(find "$BACKUP_LOCAL" -name "horix_backup_*.zip" -type f 2>/dev/null | wc -l)
echo ""
if [ -n "$ERROR_RED" ]; then
  echo "$LOG_TAG  ⚠ Backup local OK — errores en la red: $ERROR_RED"
else
  echo "$LOG_TAG  ✅ Backup completado exitosamente"
fi
echo "$LOG_TAG  📁 Backups locales: $TOTAL_LOCAL archivo(s)"
echo "$LOG_TAG  ⏱  Fin — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════"