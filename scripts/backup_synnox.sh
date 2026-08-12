#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  backup_synnox.sh — Backup unificado de SynnoxERP (DR)
#
#  Respalda TODO lo necesario para reconstruir el sistema en una VM
#  nueva sin restore de imagen:
#   1. PostgreSQL completo (pg_dump -Fc: DDL + datos + secuencias)
#   2. Roles/globals de PostgreSQL (pg_dumpall --globals-only)
#   3. SQLite hot-backup (launcher.db + horas_extra.db)
#   4. Uploads y media (tar)
#   5. Config bundle (.env, nginx, PM2 dump, crontab, letsencrypt)
#
#  Ejecutado por systemd timer synnox-backup.timer (diario 2 AM).
#  Manual:  sudo scripts/backup_synnox.sh
#
#  Config opcional:
#   backups/.backup.conf  — BACKUP_NOTIFY_SUCCESS=true (email en éxito)
#   backups/.nas.conf     — copia offsite a NAS (ver .nas.conf.example)
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

INSTALL_DIR="${SYNNOX_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_ROOT="$INSTALL_DIR/backups"
SCRIPTS_DIR="${SYNNOX_SCRIPTS_DIR:-$INSTALL_DIR/scripts}"
NODE_PATH_EXPORT="$INSTALL_DIR/launcher/node_modules"
FECHA="$(date +%Y-%m-%d_%H-%M-%S)"
NOMBRE="synnoxerp_backup_${FECHA}.tar.gz"
STAGE="$BACKUP_ROOT/.staging-$$"
LOG_FILE="$BACKUP_ROOT/last-run.log"
START_EPOCH="$(date +%s)"

ERRORES=()
WARNINGS=()
NAS_RESULTADO="null"

mkdir -p "$BACKUP_ROOT"
: > "$LOG_FILE"

log()  { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }
warn() { WARNINGS+=("$*"); log "⚠ $*"; }
paso() { log "✓ $*"; }
falla() { ERRORES+=("$*"); log "✗ $*"; }

# ── Lock: evitar ejecución simultánea ─────────────────────────────
exec 200>"$BACKUP_ROOT/.backup.lock"
if ! flock -n 200; then
  echo "Ya hay un backup en ejecución, saliendo." >&2
  exit 0
fi

cleanup() {
  rm -rf "$STAGE" 2>/dev/null || true
}
trap cleanup EXIT

# ── Cargar .env ────────────────────────────────────────────────────
if [ -f "$INSTALL_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$INSTALL_DIR/.env"
  set +a
else
  warn ".env no encontrado en $INSTALL_DIR — usando defaults"
fi

export PGHOST="${DB_HOST:-127.0.0.1}"
export PGPORT="${DB_PORT:-5432}"
export PGDATABASE="${DB_NAME:-synnox_erp}"
export PGUSER="${DB_USER:-postgres}"
export PGPASSWORD="${DB_PASSWORD:-}"

PG_DUMP_TIMEOUT="${PG_DUMP_TIMEOUT:-1800}"

log "══════════════════════════════════════════════════"
log "Backup SynnoxERP iniciado — $FECHA"
log "Install dir: $INSTALL_DIR"
log "══════════════════════════════════════════════════"

mkdir -p "$STAGE/postgres" "$STAGE/sqlite" "$STAGE/config"
chmod 700 "$STAGE"

# ══════════════════════════════════════════════════════════════════
# PASO 1 — PostgreSQL: dump completo (todos los schemas)
# ══════════════════════════════════════════════════════════════════
log "── Paso 1/6: pg_dump $PGDATABASE ──"
if timeout "$PG_DUMP_TIMEOUT" pg_dump \
    --format=custom --compress=6 --no-owner --no-privileges \
    --file="$STAGE/postgres/synnox_erp.dump" \
    2>"$STAGE/postgres/pg_dump.log"; then
  if pg_restore --list "$STAGE/postgres/synnox_erp.dump" >/dev/null 2>&1; then
    paso "pg_dump OK ($(du -h "$STAGE/postgres/synnox_erp.dump" | cut -f1))"
  else
    falla "pg_dump generó un archivo ilegible (pg_restore --list falló)"
  fi
else
  falla "pg_dump falló: $(tail -3 "$STAGE/postgres/pg_dump.log" | tr '\n' ' ')"
fi

# ══════════════════════════════════════════════════════════════════
# PASO 2 — PostgreSQL: roles/globals
# Requiere acceso a pg_authid (superuser). Si el usuario de la app no
# lo tiene, se intenta como usuario de sistema `postgres` (peer auth).
# Si tampoco, degrada a warning: las credenciales de la app van en el
# config bundle (.env) y los roles pueden recrearse en el restore.
# ══════════════════════════════════════════════════════════════════
log "── Paso 2/6: pg_dumpall --globals-only ──"
if timeout 300 pg_dumpall --globals-only --file="$STAGE/postgres/globals.sql" 2>>"$STAGE/postgres/pg_dump.log"; then
  if grep -q "PASSWORD" "$STAGE/postgres/globals.sql" 2>/dev/null; then
    paso "globals.sql OK (incluye password hashes)"
  else
    paso "globals.sql OK"
    warn "globals.sql sin password hashes — el usuario $PGUSER no puede leer pg_authid"
  fi
elif id postgres >/dev/null 2>&1 && su postgres -c "pg_dumpall --globals-only" > "$STAGE/postgres/globals.sql" 2>>"$STAGE/postgres/pg_dump.log"; then
  chown root:root "$STAGE/postgres/globals.sql" 2>/dev/null || true
  paso "globals.sql OK (via usuario de sistema postgres)"
else
  rm -f "$STAGE/postgres/globals.sql"
  warn "globals.sql no generado — $PGUSER sin acceso a pg_authid y sin usuario local postgres. Roles recreables desde .env (incluido en config bundle)"
fi

# Conteos exactos de filas por tabla (para el manifest y el restore drill)
psql -Atq -c "SELECT 'SELECT ''' || schemaname || '.' || tablename || ''' AS tabla, count(*) FROM ' || quote_ident(schemaname) || '.' || quote_ident(tablename) || ';' FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1;" 2>/dev/null \
  | psql -Atq -F $'\t' > "$STAGE/postgres/counts.tsv" 2>/dev/null \
  || warn "No se pudieron generar conteos de filas (counts.tsv)"

# ══════════════════════════════════════════════════════════════════
# PASO 3 — SQLite hot-backup (launcher + nómina)
# ══════════════════════════════════════════════════════════════════
log "── Paso 3/6: SQLite hot-backup ──"
if NODE_PATH="$NODE_PATH_EXPORT" node "$SCRIPTS_DIR/backup-sqlite.js" "$INSTALL_DIR" "$STAGE" >>"$LOG_FILE" 2>&1; then
  paso "SQLite hot-backup OK"
else
  falla "SQLite hot-backup falló (ver log)"
fi

# ══════════════════════════════════════════════════════════════════
# PASO 4 — Uploads y media
# ══════════════════════════════════════════════════════════════════
log "── Paso 4/6: uploads y media ──"
UPLOAD_DIRS=()
for d in modules/proveedores/uploads modules/logistica/uploads media; do
  [ -d "$INSTALL_DIR/$d" ] && UPLOAD_DIRS+=("$d")
done
if [ ${#UPLOAD_DIRS[@]} -gt 0 ]; then
  if tar czf "$STAGE/uploads.tar.gz" -C "$INSTALL_DIR" "${UPLOAD_DIRS[@]}" 2>>"$LOG_FILE"; then
    paso "uploads.tar.gz OK (${#UPLOAD_DIRS[@]} dirs: ${UPLOAD_DIRS[*]})"
  else
    falla "tar de uploads falló"
  fi
else
  warn "No hay directorios de uploads/media — omitido"
fi

# ══════════════════════════════════════════════════════════════════
# PASO 5 — Config bundle (.env, nginx, PM2, crontab, letsencrypt)
# ══════════════════════════════════════════════════════════════════
log "── Paso 5/6: config bundle ──"
CFG="$STAGE/config"

copiar_si_existe() {
  local src="$1" dest="$2"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    if cp -rL "$src" "$dest" 2>>"$LOG_FILE"; then return 0; fi
    warn "No se pudo copiar $src (¿permisos?)"
  fi
  return 1
}

copiar_si_existe "$INSTALL_DIR/.env" "$CFG/env/root.env"
for f in "$INSTALL_DIR"/launcher/.env "$INSTALL_DIR"/modules/*/.env; do
  [ -e "$f" ] || continue
  rel="${f#"$INSTALL_DIR"/}"
  copiar_si_existe "$f" "$CFG/env/${rel//\//_}"
done

if [ -d /etc/nginx/sites-available ]; then
  copiar_si_existe /etc/nginx/sites-available "$CFG/nginx/sites-available"
fi

# PM2: dump de procesos + ecosystem files del repo
PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
copiar_si_existe "$PM2_HOME/dump.pm2" "$CFG/pm2/dump.pm2"
for f in "$INSTALL_DIR"/ecosystem.config.* "$INSTALL_DIR"/modules/*/ecosystem.config.*; do
  [ -e "$f" ] || continue
  rel="${f#"$INSTALL_DIR"/}"
  copiar_si_existe "$f" "$CFG/pm2/$rel"
done

if crontab -l > "$CFG/crontab.txt" 2>/dev/null; then
  [ -s "$CFG/crontab.txt" ] || rm -f "$CFG/crontab.txt"
fi

if [ -d /etc/letsencrypt ]; then
  if ! copiar_si_existe /etc/letsencrypt "$CFG/letsencrypt"; then
    warn "letsencrypt no copiado — ejecutar como root para incluir certificados"
  fi
fi

copiar_si_existe /etc/systemd/system/synnox-backup.service "$CFG/systemd/synnox-backup.service"
copiar_si_existe /etc/systemd/system/synnox-backup.timer "$CFG/systemd/synnox-backup.timer"

if [ -n "$(ls -A "$CFG" 2>/dev/null)" ]; then
  if tar czf "$STAGE/config.tar.gz" -C "$CFG" . 2>>"$LOG_FILE"; then
    paso "config.tar.gz OK"
    rm -rf "$CFG"
  else
    falla "tar de config falló"
  fi
else
  warn "Config bundle vacío — omitido"
fi

# ══════════════════════════════════════════════════════════════════
# PASO 6 — Manifest + empaquetado final
# ══════════════════════════════════════════════════════════════════
log "── Paso 6/6: manifest y empaquetado ──"
if ! node "$SCRIPTS_DIR/backup-finalize.js" "$STAGE" "$INSTALL_DIR" >>"$LOG_FILE" 2>&1; then
  falla "Generación de manifest falló"
fi

if [ ${#ERRORES[@]} -eq 0 ]; then
  if tar -I 'gzip -1' -cf "$BACKUP_ROOT/$NOMBRE" -C "$STAGE" . 2>>"$LOG_FILE" && tar tzf "$BACKUP_ROOT/$NOMBRE" >/dev/null 2>&1; then
    chmod 600 "$BACKUP_ROOT/$NOMBRE"
    sha256sum "$BACKUP_ROOT/$NOMBRE" > "$BACKUP_ROOT/$NOMBRE.sha256"
    chmod 600 "$BACKUP_ROOT/$NOMBRE.sha256"
    paso "Empaquetado: $NOMBRE ($(du -h "$BACKUP_ROOT/$NOMBRE" | cut -f1))"
  else
    falla "Empaquetado final falló o el tar está corrupto"
    rm -f "$BACKUP_ROOT/$NOMBRE"
  fi
fi

# ── Copia offsite a NAS (opcional, Phase 2) ───────────────────────
if [ -f "$BACKUP_ROOT/.nas.conf" ] && [ -e "$BACKUP_ROOT/$NOMBRE" ]; then
  # shellcheck disable=SC1091
  . "$BACKUP_ROOT/.nas.conf"
  if [ "${NAS_ENABLED:-false}" = "true" ]; then
    log "── Copia a NAS: ${NAS_SHARE:-?} ──"
    NAS_OK=false
    MONTAR_DESMONTADO=false
    MOUNT_POINT="${NAS_MOUNT:-/mnt/synnox-nas}"
    if ! mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
      mkdir -p "$MOUNT_POINT"
      if mount -t cifs "$NAS_SHARE" "$MOUNT_POINT" -o username="${NAS_USER:-}",password="${NAS_PASS:-}",iocharset=utf8,vers=3.0,noperm 2>>"$LOG_FILE"; then
        MONTAR_DESMONTADO=true
      else
        falla "NAS: no se pudo montar $NAS_SHARE"
      fi
    fi
    if mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
      NAS_DEST="$MOUNT_POINT/${NAS_SUBDIR:-synnoxerp}"
      mkdir -p "$NAS_DEST" 2>/dev/null
      if cp "$BACKUP_ROOT/$NOMBRE" "$NAS_DEST/" && cp "$BACKUP_ROOT/$NOMBRE.sha256" "$NAS_DEST/" \
         && (cd "$NAS_DEST" && sha256sum -c "$NOMBRE.sha256" >/dev/null 2>&1); then
        find "$NAS_DEST" -name "synnoxerp_backup_*.tar.gz" -mtime +"${NAS_RETAIN_DAYS:-30}" -type f -delete 2>/dev/null
        NAS_OK=true
        paso "Copia NAS OK: $NAS_DEST/$NOMBRE"
      else
        falla "NAS: copia o verificación de checksum falló"
      fi
      [ "$MONTAR_DESMONTADO" = true ] && umount "$MOUNT_POINT" 2>/dev/null
    fi
    NAS_RESULTADO="{\"ok\":$NAS_OK,\"destino\":\"${NAS_DEST:-}\"}"
  fi
fi

# ── Retención GFS: 7 diarias / 4 semanales / 3 mensuales ──────────
retencion_gfs() {
  local archivo fecha_arch edad dias_epoch
  dias_epoch="$(date +%s)"
  declare -A mejor_semana mejor_mes
  local viejos=()

  for archivo in "$BACKUP_ROOT"/synnoxerp_backup_*.tar.gz; do
    [ -e "$archivo" ] || continue
    fecha_arch="$(basename "$archivo" | sed -E 's/synnoxerp_backup_([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/')"
    edad=$(( (dias_epoch - "$(date -d "$fecha_arch" +%s)") / 86400 ))
    (( edad <= 7 )) && continue
    viejos+=("$archivo")
    local sem mes
    sem="$(date -d "$fecha_arch" +%G-W%V)"
    mes="${fecha_arch:0:7}"
    if [[ -z "${mejor_semana[$sem]:-}" || "$archivo" > "${mejor_semana[$sem]}" ]]; then mejor_semana[$sem]="$archivo"; fi
    if [[ -z "${mejor_mes[$mes]:-}" || "$archivo" > "${mejor_mes[$mes]}" ]]; then mejor_mes[$mes]="$archivo"; fi
  done

  # Conservar solo las 4 semanas y 3 meses más recientes
  declare -A conservar
  local claves
  claves="$(for k in "${!mejor_semana[@]}"; do echo "$k"; done | sort -r | head -4)"
  for k in $claves; do conservar["${mejor_semana[$k]}"]=1; done
  claves="$(for k in "${!mejor_mes[@]}"; do echo "$k"; done | sort -r | head -3)"
  for k in $claves; do conservar["${mejor_mes[$k]}"]=1; done

  for archivo in "${viejos[@]}"; do
    if [[ -z "${conservar[$archivo]:-}" ]]; then
      rm -f "$archivo" "$archivo.sha256"
      log "Retención: eliminado $(basename "$archivo")"
    fi
  done
}
retencion_gfs

# ── status.json + historial ────────────────────────────────────────
DURACION=$(( $(date +%s) - START_EPOCH ))
OK=true
PARCIAL=false
[ ${#ERRORES[@]} -gt 0 ] && OK=false

BYTES=0
[ -e "$BACKUP_ROOT/$NOMBRE" ] && BYTES="$(stat -c%s "$BACKUP_ROOT/$NOMBRE")"

ERRORES_JSON="[]"
if [ ${#ERRORES[@]} -gt 0 ]; then
  ERRORES_JSON="$(printf '%s\n' "${ERRORES[@]}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(d.split("\n").filter(Boolean))))')"
fi
WARN_JSON="[]"
if [ ${#WARNINGS[@]} -gt 0 ]; then
  WARN_JSON="$(printf '%s\n' "${WARNINGS[@]}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(d.split("\n").filter(Boolean))))')"
fi

MANIFEST_RESUMEN="{}"
[ -f "$STAGE/manifest.json" ] && MANIFEST_RESUMEN="$(node -e "const m=require('$STAGE/manifest.json');console.log(JSON.stringify({postgres:m.postgres,sqlite:m.sqlite.map(s=>({nombre:s.nombre,tablas:s.tablas,filas:s.filas})),total_bytes:m.total_bytes}))" 2>/dev/null || echo '{}')"

cat > "$BACKUP_ROOT/status.json" <<EOF
{
  "fecha": "$(date -Iseconds)",
  "ok": $OK,
  "archivo": "$NOMBRE",
  "bytes": $BYTES,
  "duracion_s": $DURACION,
  "nas": $NAS_RESULTADO,
  "errores": $ERRORES_JSON,
  "warnings": $WARN_JSON,
  "resumen": $MANIFEST_RESUMEN
}
EOF

echo "{\"fecha\":\"$(date -Iseconds)\",\"ok\":$OK,\"archivo\":\"$NOMBRE\",\"bytes\":$BYTES,\"duracion_s\":$DURACION}" >> "$BACKUP_ROOT/history.jsonl"

# ── Alertas por email ──────────────────────────────────────────────
NOTIFY_SUCCESS="${BACKUP_NOTIFY_SUCCESS:-false}"
[ -f "$BACKUP_ROOT/.backup.conf" ] && { . "$BACKUP_ROOT/.backup.conf"; }

if [ "$OK" = false ]; then
  log "✗ Backup COMPLETADO CON ERRORES (${#ERRORES[@]}): ${ERRORES[*]}"
  CUERPO="Errores (${#ERRORES[@]}):
$(printf ' - %s\n' "${ERRORES[@]}")

Warnings (${#WARNINGS[@]}):
$({ [ ${#WARNINGS[@]} -gt 0 ] && printf ' - %s\n' "${WARNINGS[@]}"; } || echo ' (ninguno)')

Host: $(hostname)
Duración: ${DURACION}s
Log: $LOG_FILE"
  NODE_PATH="$NODE_PATH_EXPORT" node "$SCRIPTS_DIR/backup-alert.js" "$INSTALL_DIR" fail "Backup SynnoxERP con errores — $FECHA" "$CUERPO" >>"$LOG_FILE" 2>&1 || true
elif [ "$NOTIFY_SUCCESS" = "true" ]; then
  CUERPO="Backup completado en ${DURACION}s.
Archivo: $NOMBRE ($(( BYTES / 1024 / 1024 )) MB)
NAS: $NAS_RESULTADO
Host: $(hostname)"
  NODE_PATH="$NODE_PATH_EXPORT" node "$SCRIPTS_DIR/backup-alert.js" "$INSTALL_DIR" ok "Backup SynnoxERP completado — $FECHA" "$CUERPO" >>"$LOG_FILE" 2>&1 || true
fi

log "══════════════════════════════════════════════════"
if [ "$OK" = true ]; then
  log "✅ Backup completado exitosamente en ${DURACION}s"
else
  log "❌ Backup terminado con errores"
fi
log "══════════════════════════════════════════════════"

[ "$OK" = true ] && exit 0 || exit 1
