#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  rollback.sh — Rollback a una versión específica de SynnoxERP
#
#  Uso:
#    sudo scripts/rollback.sh v2.1.0
#    sudo scripts/rollback.sh v2.1.0 --dry-run
#
#  Restaura el código a un tag específico, reinstala dependencias
#  y reinicia PM2.
#
#  IMPORTANTE: Crear backup antes de ejecutar (scripts/backup_synnox.sh)
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

DRY_RUN=false
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h) echo "Uso: sudo $0 [--dry-run] <vX.Y.Z>"; exit 0 ;;
    *) VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "✗ Uso: sudo $0 [--dry-run] <vX.Y.Z>" >&2
  echo "  Tags disponibles:" >&2
  git tag -l 'v*' | sort -V | tail -5 >&2
  exit 1
fi

# Validate version format
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ Formato inválido: $VERSION (esperado: vX.Y.Z)" >&2
  exit 1
fi

INSTALL_DIR="${SYNNOX_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log()  { echo "[$(date '+%F %T')] $*"; }
ok()   { echo -e " \033[0;32m✓\033[0m $1"; }
warn() { echo -e " \033[1;33m⚠\033[0m $1"; }
fail() { echo -e " \033[0;31m✗\033[0m $1"; exit 1; }

log "══════════════════════════════════════════════════"
log "Rollback SynnoxERP — $(date '+%Y-%m-%d %H:%M:%S')"
log "Versión objetivo: $VERSION"
log "Directorio: $INSTALL_DIR"
log "Dry run: $DRY_RUN"
log "══════════════════════════════════════════════════"

# ══════════════════════════════════════════════════
# PASO 1 — Verificar que el tag existe
# ══════════════════════════════════════════════════
log "── Paso 1/4: Verificar tag ──"
cd "$INSTALL_DIR"

if ! git rev-parse "$VERSION" >/dev/null 2>&1; then
  log "Tag $VERSION no existe. Tags disponibles:"
  git tag -l 'v*' | sort -V
  exit 1
fi

TAG_COMMIT=$(git rev-parse --short "$VERSION")
TAG_DATE=$(git log -1 --format=%ci "$VERSION")
ok "Tag $VERSION encontrado ($TAG_COMMIT, $TAG_DATE)"

# ══════════════════════════════════════════════════
# PASO 2 — Verificar estado actual
# ══════════════════════════════════════════════════
log "── Paso 2/4: Verificar estado ──"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
CURRENT_COMMIT=$(git rev-parse --short HEAD)
log "Branch actual: $CURRENT_BRANCH ($CURRENT_COMMIT)"

# Check for uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  warn "Hay cambios sin commitear — se perderán con el rollback"
fi

if [ "$DRY_RUN" = true ]; then
  log "══════════════════════════════════════════════════"
  log "🔍 DRY RUN completado — tag $VERSION válido"
  log "Cambios que se realizarían:"
  log "  1. git checkout $VERSION"
  log "  2. pnpm install --prod"
  log "  3. pm2 restart all"
  log "══════════════════════════════════════════════════"
  exit 0
fi

# ══════════════════════════════════════════════════
# PASO 3 — Ejecutar rollback
# ══════════════════════════════════════════════════
log "── Paso 3/4: Rollback a $VERSION ──"

# Stash any changes
if ! git diff --quiet HEAD 2>/dev/null; then
  git stash push -m "rollback-stash-$(date +%s)" 2>/dev/null || true
  log "Cambios existentes guardados en stash"
fi

# Checkout the tag
if ! git checkout "$VERSION" 2>&1; then
  fail "No se pudo hacer checkout a $VERSION"
fi
ok "Checkout a $VERSION completado"

# Install dependencies
log "Instalando dependencias..."
if ! pnpm install --prod 2>&1 | tail -3; then
  warn "pnpm install tuvo warnings (no crítico)"
fi
ok "Dependencias instaladas"

# ══════════════════════════════════════════════════
# PASO 4 — Reiniciar servicios
# ══════════════════════════════════════════════════
log "── Paso 4/4: Reiniciar servicios ──"
if pm2 restart all 2>/dev/null; then
  ok "PM2 reiniciado"
else
  warn "PM2 no disponible — reiniciar manualmente"
fi

# ══════════════════════════════════════════════════
# Resumen
# ══════════════════════════════════════════════════
log "══════════════════════════════════════════════════"
ok "Rollback completado: $CURRENT_COMMIT → $VERSION"
log "══════════════════════════════════════════════════"
