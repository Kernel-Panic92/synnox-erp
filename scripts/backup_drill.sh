#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  backup_drill.sh — Drill mensual de restore para verificar backups
#
#  Restaura el último (o指定) backup en una DB scratch, compara
#  conteos de filas, y reporta éxito/fallo.
#
#  Uso:
#    sudo scripts/backup_drill.sh                    # usa el último backup
#    sudo scripts/backup_drill.sh <backup.tar.gz>    # backup específico
#
#  Ejecutado por systemd timer synnox-drill.timer (mensual, día 1)
#  Requiere: sudo, psql, pg_restore, better-sqlite3, CREATEB
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

INSTALL_DIR="${SYNNOX_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_ROOT="$INSTALL_DIR/backups"
BACKUP_FILE="${1:-}"
DRILL_DB="synnox_erp_drill"
STAGE=$(mktemp -d)
RESULTADO="fail"
ERRORES=()

log()  { echo "[$(date '+%F %T')] $*"; }
falla() { ERRORES+=("$*"); log "✗ $*"; }

cleanup() {
  rm -rf "$STAGE" 2>/dev/null
  psql -h "${DB_HOST:-127.0.0.1}" -U "${DB_USER:-synnox}" -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB;" 2>/dev/null
}
trap cleanup EXIT

log "══════════════════════════════════════════════════"
log "Backup Drill — $(date '+%Y-%m-%d %H:%M:%S')"
log "══════════════════════════════════════════════════"

# Cargar .env
if [ -f "$INSTALL_DIR/.env" ]; then
  set -a; . "$INSTALL_DIR/.env"; set +a
fi

export PGHOST="${DB_HOST:-127.0.0.1}"
export PGPORT="${DB_PORT:-5432}"
export PGUSER="${DB_USER:-synnox}"
export PGPASSWORD="${DB_PASSWORD:-}"

# Seleccionar backup
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE=$(ls -t "$BACKUP_ROOT"/synnoxerp_backup_*.tar.gz 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  log "✗ No hay backups disponibles para drill"
  exit 1
fi

log "Backup: $(basename "$BACKUP_FILE")"

# Extraer
log "Extrayendo..."
if ! tar xzf "$BACKUP_FILE" -C "$STAGE" 2>/dev/null; then
  falla "No se pudo extraer el backup"
  exit 1
fi

# Verificar manifest
if [ ! -f "$STAGE/manifest.json" ]; then
  falla "manifest.json no encontrado"
  exit 1
fi

ESPERADOS=$(node -e "
const m = require('$STAGE/manifest.json');
const s = m.postgres?.schemas || {};
let rows = [];
for (const [schema, info] of Object.entries(s)) {
  rows.push(schema + '\t' + (info.tablas || 0) + '\t' + (info.filas || 0));
}
console.log(rows.join('\n'));
" 2>/dev/null)

if [ -z "$ESPERADOS" ]; then
  falla "No se pudieron leer conteos esperados del manifest"
  exit 1
fi

log "Conteos esperados del manifest:"
echo "$ESPERADOS" | while IFS=$'\t' read schema tablas filas; do
  log "  $schema: $tablas tablas, $filas filas"
done

# Crear DB scratch
log "Creando DB scratch $DRILL_DB..."
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB;" 2>/dev/null
if ! psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "CREATE DATABASE $DRILL_DB;" 2>/dev/null; then
  falla "No se pudo crear $DRILL_DB — ¿el usuario tiene CREATEB?"
  exit 1
fi

# Restaurar dump
log "Restaurando dump en $DRILL_DB..."
if pg_restore -h "$PGHOST" -U "$PGUSER" -d "$DRILL_DB" \
    --no-owner --no-privileges \
    "$STAGE/postgres/synnox_erp.dump" 2>/dev/null; then
  log "pg_restore completado"
else
  log "pg_restore terminó con warnings (normal)"
fi

# Comparar conteos reales vs esperados
log "Comparando conteos..."
FAIL=false

while IFS=$'\t' read schema tablas_esperadas filas_esperadas; do
  tablas_reales=$(psql -h "$PGHOST" -U "$PGUSER" -d "$DRILL_DB" -Atq -c \
    "SELECT count(*) FROM pg_tables WHERE schemaname='$schema'" 2>/dev/null)
  filas_reales=$(psql -h "$PGHOST" -U "$PGUSER" -d "$DRILL_DB" -Atq -c \
    "SELECT COALESCE(sum(n_live_tup),0)::int FROM pg_stat_user_tables WHERE schemaname='$schema'" 2>/dev/null)

  tablas_reales=${tablas_reales:-0}
  filas_reales=${filas_reales:-0}

  if [ "$tablas_reales" -eq "$tablas_esperadas" ] 2>/dev/null; then
    log "  ✓ $schema: $tablas_reales tablas, $filas_reales filas"
  else
    log "  ✗ $schema: esperadas $tablas_esperadas tablas, reales $tablas_reales"
    FAIL=true
    ERRORES+=("$schema: $tablas_esperadas tablas esperadas, $tablas_reales reales")
  fi
done <<< "$ESPERADOS"

# Verificar SQLite backup integrity
log "Verificando SQLite..."
for f in "$STAGE/sqlite/"*.db; do
  [ -e "$f" ] || continue
  fname=$(basename "$f")
  if node -e "const D=require('better-sqlite3');const d=new D('$f',{readonly:true});console.log(d.pragma('integrity_check')[0].integrity_check);d.close()" 2>/dev/null | grep -q "ok"; then
    log "  ✓ $fname: integrity OK"
  else
    log "  ✗ $fname: integrity FAIL"
    FAIL=true
    ERRORES+=("SQLite $fname: integrity check falló")
  fi
done

if [ "$FAIL" = false ]; then
  RESULTADO="pass"
fi

# Resultado
log "══════════════════════════════════════════════════"
if [ "$RESULTADO" = "pass" ]; then
  log "✅ DRILL PASADO — backup $(basename "$BACKUP_FILE") es válido"
else
  log "❌ DRILL FALLÓ — ${#ERRORES[@]} error(es):"
  printf '   - %s\n' "${ERRORES[@]}"
fi
log "══════════════════════════════════════════════════"

exit $( [ "$RESULTADO" = "pass" ] && echo 0 || echo 1 )
