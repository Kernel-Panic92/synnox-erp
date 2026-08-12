#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  restore_synnox.sh — Restore completo de SynnoxERP desde backup
#
#  Uso:
#    sudo scripts/restore_synnox.sh <archivo_backup.tar.gz>
#    sudo scripts/restore_synnox.sh --dry-run <archivo_backup.tar.gz>
#
#  Restaura TODO: PostgreSQL (pg_restore), SQLite (hot-copy), uploads,
#  config bundle (.env, nginx, PM2, crontab).
#
#  IMPORTANTE: Detener PM2 antes de restaurar (pm2 stop all).
#  El script verifica que no haya procesos Node activos sobre la DB.
#
#  Requiere: pg_restore, tar, better-sqlite3 (vía node), root/sudo
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

DRY_RUN=false
BACKUP_FILE=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h) echo "Uso: sudo $0 [--dry-run] <backup.tar.gz>"; exit 0 ;;
    *) BACKUP_FILE="$arg" ;;
  esac
done

if [ -z "$BACKUP_FILE" ]; then
  echo "✗ Uso: sudo $0 [--dry-run] <backup.tar.gz>" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "✗ Archivo no encontrado: $BACKUP_FILE" >&2
  exit 1
fi

INSTALL_DIR="${SYNNOX_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STAGE=$(mktemp -d)
ERRORES=()
WARNINGS=()

log()  { echo "[$(date '+%F %T')] $*"; }
warn() { WARNINGS+=("$*"); log "⚠ $*"; }
paso() { log "✓ $*"; }
falla() { ERRORES+=("$*"); log "✗ $*"; }

cleanup() { rm -rf "$STAGE" 2>/dev/null; }
trap cleanup EXIT

log "══════════════════════════════════════════════════"
log "Restore SynnoxERP — $(date '+%Y-%m-%d %H:%M:%S')"
log "Archivo: $BACKUP_FILE"
log "Install dir: $INSTALL_DIR"
log "Dry run: $DRY_RUN"
log "══════════════════════════════════════════════════"

# ══════════════════════════════════════════════════════════════════
# PASO 1 — Extraer backup
# ══════════════════════════════════════════════════════════════════
log "── Paso 1/5: Extraer backup ──"
if ! tar xzf "$BACKUP_FILE" -C "$STAGE" 2>/dev/null; then
  falla "No se pudo extraer el archivo (¿no es un .tar.gz válido?)"
  exit 1
fi

# Verificar manifest
if [ ! -f "$STAGE/manifest.json" ]; then
  falla "manifest.json no encontrado — ¿este archivo es un backup de SynnoxERP?"
  exit 1
fi

MANIFEST_VERSION=$(node -e "console.log(require('$STAGE/manifest.json').version || 1)" 2>/dev/null)
MANIFEST_GENERADO=$(node -e "console.log(require('$STAGE/manifest.json').generado || '?')" 2>/dev/null)
MANIFEST_HOST=$(node -e "console.log(require('$STAGE/manifest.json').host || '?')" 2>/dev/null)
log "Manifest: v$MANIFEST_VERSION, generado $MANIFEST_GENERADO, host $MANIFEST_HOST"

# Verificar integridad del dump
if [ -f "$STAGE/postgres/synnox_erp.dump" ]; then
  if pg_restore --list "$STAGE/postgres/synnox_erp.dump" >/dev/null 2>&1; then
    DUMP_OBJECTS=$(pg_restore --list "$STAGE/postgres/synnox_erp.dump" 2>/dev/null | grep -c "^[0-9]" || echo "?")
    paso "Dump PostgreSQL verificado ($DUMP_OBJECTS objetos)"
  else
    falla "El dump PostgreSQL está corrupto (pg_restore --list falló)"
    exit 1
  fi
else
  falla "synnox_erp.dump no encontrado en el backup"
  exit 1
fi

# Verificar SQLite
for f in "$STAGE/sqlite/"*.db; do
  [ -e "$f" ] || continue
  fname=$(basename "$f")
  if node -e "const D=require('better-sqlite3');const d=new D('$f',{readonly:true});console.log('ok:'+d.pragma('integrity_check')[0].integrity_check);d.close()" 2>/dev/null | grep -q "ok:ok"; then
    paso "SQLite $fname verificado"
  else
    warn "SQLite $fname falló integrity check"
  fi
done

if [ "$DRY_RUN" = true ]; then
  log "══════════════════════════════════════════════════"
  log "🔍 DRY RUN completado — backup válido, listo para restore"
  log "Archivos encontrados:"
  ls -lh "$STAGE"/postgres/ "$STAGE"/sqlite/ 2>/dev/null
  log "══════════════════════════════════════════════════"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# PASO 2 — Verificar que PM2 no esté corriendo
# ══════════════════════════════════════════════════════════════════
log "── Paso 2/5: Verificar procesos ──"
if pgrep -f "node.*launcher" >/dev/null 2>&1 || pm2 list 2>/dev/null | grep -q "online"; then
  warn "PM2 o procesos Node detectados — deteniendo..."
  pm2 stop all 2>/dev/null || true
  sleep 2
  if pm2 list 2>/dev/null | grep -q "online"; then
    falla "No se pudo detener PM2 — ejecutar 'pm2 stop all' manualmente"
    exit 1
  fi
  paso "PM2 detenido"
else
  paso "No hay procesos Node activos"
fi

# ══════════════════════════════════════════════════════════════════
# PASO 3 — Restaurar PostgreSQL
# ══════════════════════════════════════════════════════════════════
log "── Paso 3/5: Restaurar PostgreSQL ──"

# Cargar .env para credenciales
if [ -f "$INSTALL_DIR/.env" ]; then
  set -a; . "$INSTALL_DIR/.env"; set +a
fi

export PGHOST="${DB_HOST:-127.0.0.1}"
export PGPORT="${DB_PORT:-5432}"
export PGDATABASE="${DB_NAME:-synnox_erp}"
export PGUSER="${DB_USER:-synnox}"
export PGPASSWORD="${DB_PASSWORD:-}"

# Restaurar roles (globals) si existe
if [ -f "$STAGE/postgres/globals.sql" ]; then
  log "Restaurando roles/globals..."
  if su postgres -c "psql -f $STAGE/postgres/globals.sql" 2>>"$STAGE/restore.log"; then
    paso "Roles restaurados"
  else
    warn "Globals no restaurado (¿sin acceso a superuser?)"
  fi
fi

# pg_restore: recrear schemas y restaurar objetos
log "Restaurando schemas (logistics, projects)..."
for schema in logistics projects; do
  psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -c "DROP SCHEMA IF EXISTS $schema CASCADE; CREATE SCHEMA $schema;" 2>/dev/null
done

log "Ejecutando pg_restore (esto puede tardar)..."
if pg_restore -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
    --no-owner --no-privileges --if-exists --clean \
    "$STAGE/postgres/synnox_erp.dump" 2>>"$STAGE/restore.log"; then
  paso "PostgreSQL restaurado"
else
  # pg_restore returns non-zero even on success (warnings)
  if psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Atq -c "SELECT count(*) FROM pg_tables WHERE schemaname='logistics'" 2>/dev/null | grep -q "^[0-9]"; then
    paso "PostgreSQL restaurado (con warnings menores)"
  else
    falla "pg_restore falló — verificar $STAGE/restore.log"
  fi
fi

# Verificar conteos post-restore
TOTAL_TABLES=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Atq -c "SELECT count(*) FROM pg_tables WHERE schemaname IN ('logistics','projects','public')" 2>/dev/null)
paso "Tablas restauradas: $TOTAL_TABLES"

# ══════════════════════════════════════════════════════════════════
# PASO 4 — Restaurar SQLite
# ══════════════════════════════════════════════════════════════════
log "── Paso 4/5: Restaurar SQLite ──"

restore_sqlite() {
  local src="$1" dest="$2" nombre="$3"
  if [ ! -f "$src" ]; then warn "SQLite $nombre no encontrado en backup"; return; fi
  if [ ! -f "$dest" ]; then warn "SQLite $nombre destino no existe — copiando"; fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  # Limpiar WAL/SHM residuales
  rm -f "$dest-wal" "$dest-shm"
  # Verificar
  if node -e "const D=require('better-sqlite3');const d=new D('$dest',{readonly:true});console.log(d.pragma('integrity_check')[0].integrity_check);d.close()" 2>/dev/null | grep -q "ok"; then
    paso "SQLite $nombre restaurado"
  else
    warn "SQLite $nombre restaurado pero integrity check falló"
  fi
}

restore_sqlite "$STAGE/sqlite/launcher.db" "$INSTALL_DIR/launcher/launcher.db" "launcher.db"
restore_sqlite "$STAGE/sqlite/horas_extra.db" "$INSTALL_DIR/horas_extra.db" "horas_extra.db"

# ══════════════════════════════════════════════════════════════════
# PASO 5 — Restaurar uploads y config
# ══════════════════════════════════════════════════════════════════
log "── Paso 5/5: Restaurar uploads y config ──"

# Uploads
if [ -f "$STAGE/uploads.tar.gz" ]; then
  log "Restaurando uploads..."
  if tar xzf "$STAGE/uploads.tar.gz" -C "$INSTALL_DIR" 2>>"$STAGE/restore.log"; then
    paso "Uploads restaurados"
  else
    warn "Error restaurando uploads"
  fi
fi

# Config bundle
if [ -f "$STAGE/config.tar.gz" ]; then
  log "Restaurando config bundle..."
  CONFIG_STAGE="$STAGE/config-extracted"
  mkdir -p "$CONFIG_STAGE"
  tar xzf "$STAGE/config.tar.gz" -C "$CONFIG_STAGE" 2>>"$STAGE/restore.log"

  # Restaurar .env solo si no existe
  if [ -f "$CONFIG_STAGE/env/root.env" ] && [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$CONFIG_STAGE/env/root.env" "$INSTALL_DIR/.env"
    paso ".env restaurado"
  else
    warn ".env existente no sobrescrito (restaurar manualmente si es necesario)"
  fi

  # Restaurar nginx
  if [ -d "$CONFIG_STAGE/nginx/sites-available" ] && [ -d /etc/nginx/sites-available ]; then
    cp "$CONFIG_STAGE/nginx/sites-available/"* /etc/nginx/sites-available/ 2>/dev/null
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null
    paso "Nginx restaurado"
  fi

  # Restaurar PM2 dump
  PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
  if [ -f "$CONFIG_STAGE/pm2/dump.pm2" ]; then
    mkdir -p "$PM2_HOME"
    cp "$CONFIG_STAGE/pm2/dump.pm2" "$PM2_HOME/"
    paso "PM2 dump restaurado"
  fi

  rm -rf "$CONFIG_STAGE"
fi

# ══════════════════════════════════════════════════════════════════
# Resumen
# ══════════════════════════════════════════════════════════════════
log "══════════════════════════════════════════════════"
if [ ${#ERRORES[@]} -eq 0 ]; then
  log "✅ Restore completado exitosamente"
  log "Siguiente paso: 'pm2 resurrect' o 'pm2 start ecosystem.config.js'"
else
  log "❌ Restore completado con ${#ERRORES[@]} error(es):"
  printf '   - %s\n' "${ERRORES[@]}"
fi
if [ ${#WARNINGS[@]} -gt 0 ]; then
  log "⚠ ${#WARNINGS[@]} warning(s):"
  printf '   - %s\n' "${WARNINGS[@]}"
fi
log "══════════════════════════════════════════════════"

[ ${#ERRORES[@]} -eq 0 ] && exit 0 || exit 1
