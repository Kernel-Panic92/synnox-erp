#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# SynnoxERP — Instalación automática (monorepo unificado)
#   Uso: cd synnox-erp && sudo bash install.sh
#   Instala desde el directorio actual del repo (sin copiar)
# ─────────────────────────────────────────────────────────────

BRANCH="${1:-main}"
INSTALL_DIR="$(pwd)"
CONFIG="$INSTALL_DIR/.env"
# Producción: nunca pedir input interactivo (apt, git). El repo privado bajo
# sudo (root) no tiene la credencial de tu usuario → git pediría usuario.
export DEBIAN_FRONTEND=noninteractive
export GIT_TERMINAL_PROMPT=0
VERDE="\033[0;32m"; ROJO="\033[0;31m"; AMARILLO="\033[1;33m"; RESET="\033[0m"
ok()  { echo -e " ${VERDE}✓${RESET} $1"; }
err() { echo -e " ${ROJO}✗${RESET} $1"; }
warn(){ echo -e " ${AMARILLO}⚠${RESET} $1"; }

echo -e "${VERDE}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║         SynnoxERP — Instalación automática          ║"
echo "║         Monorepo unificado (1 servidor, N módulos)  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""

# ─── Verificar root ────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then warn "Ejecuta con sudo: cd synnox-erp && sudo bash install.sh"; exit 1; fi

# ─── Verificar que estamos en el repo ──────────────────────
if [ ! -f "$INSTALL_DIR/server.js" ] || [ ! -d "$INSTALL_DIR/launcher" ]; then
  err "No se detectó el repo de SynnoxERP en $(pwd)"
  err "Ejecuta: cd synnox-erp && sudo bash install.sh"
  exit 1
fi
ok "Directorio de instalación: $INSTALL_DIR"

# ─── 1. Dependencias del sistema ───────────────────────────
echo ""
echo ">>> Instalando dependencias del sistema..."
apt-get update -qq
apt-get install -y -qq curl git nginx openssl postgresql postgresql-client >/dev/null 2>&1 || true

# Node.js 20.x
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null 2>&1
  ok "Node.js $(node -v) instalado"
else
  ok "Node.js $(node -v)"
fi

# PNPM global
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm >/dev/null 2>&1
  ok "pnpm $(pnpm -v) instalado"
else
  ok "pnpm $(pnpm -v)"
fi

# PM2 global
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 >/dev/null 2>&1
  ok "PM2 instalado"
else
  ok "PM2 $(pm2 -v)"
fi

# ─── 2. PostgreSQL ─────────────────────────────────────────
echo ""
echo ">>> Configurando PostgreSQL..."
# Reutilizar credenciales del .env existente: antes se generaba un DB_PASS
# nuevo en cada corrida y el usuario PG quedaba con el viejo → 28P01
# (password authentication failed) en todos los módulos PG.
if [ -f "$CONFIG" ]; then
  _ENV_DB_USER="$(grep -E '^DB_USER=' "$CONFIG" | cut -d= -f2-)"
  _ENV_DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$CONFIG" | cut -d= -f2-)"
  _ENV_DB_NAME="$(grep -E '^DB_NAME=' "$CONFIG" | cut -d= -f2-)"
fi
DB_USER="${DB_USER:-${_ENV_DB_USER:-synnox}}"
DB_PASS="${DB_PASS:-${_ENV_DB_PASSWORD:-$(openssl rand -hex 16)}}"
DB_NAME="${DB_NAME:-${_ENV_DB_NAME:-synnox_erp}}"

# Arrancar PostgreSQL
if ! pg_isready -q 2>/dev/null; then
  pg_lsclusters 2>/dev/null | head -1 | awk '{print $1, $2}' | while read -r v c; do
    pg_ctlcluster "$v" "$c" start 2>/dev/null || true
  done
fi

# Crear usuario y database
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\" | grep -q 1 || psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || true
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\" | grep -q 1 || createdb -O $DB_USER $DB_NAME" 2>/dev/null || true
# Convergencia: el password de la DB siempre queda igual al del .env
# (cubre DBs preexistentes y .env regenerados → evita 28P01).
su - postgres -c "psql -c \"ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || warn "No se pudo sincronizar password PG — revisa manualmente"
su - postgres -c "psql -d $DB_NAME -c \"GRANT ALL ON SCHEMA public TO $DB_USER; GRANT ALL ON DATABASE $DB_NAME TO $DB_USER; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;\"" 2>/dev/null || true
ok "PostgreSQL listo — database: $DB_NAME"

# ─── 3. Actualizar repo (si es repositorio git) ────────────
echo ""
echo ">>> Verificando repositorio..."

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  # SKIP_GIT=1 → no toca git (recomendado en prod: el código desplegado es el local).
  if [ "${SKIP_GIT:-0}" = "1" ]; then
    warn "SKIP_GIT=1 — usando código local sin actualizar desde origin"
  else
    if [ "$(git branch --show-current)" != "$BRANCH" ]; then
      git checkout "$BRANCH" 2>/dev/null || warn "No se pudo cambiar a branch $BRANCH"
    fi
    # Non-interactive: si no hay auth (root/sudo) o red, falla rápido y sigue local.
    git fetch --no-tags --prune origin 2>/dev/null || warn "git fetch falló (sin auth/red?) — continuando con código local"
  fi
  ok "Repositorio git detectado en $INSTALL_DIR"
else
  warn "No es un repositorio git — usando archivos locales"
fi

# ─── 4. Generar .env ───────────────────────────────────────
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 64)}"
LOG_ENCRYPTION_SECRET="${LOG_ENCRYPTION_SECRET:-$(openssl rand -hex 64)}"
INTERNAL_API_TOKEN="${INTERNAL_API_TOKEN:-$(openssl rand -hex 32)}"
ADMIN_PASS="${ADMIN_PASS:-$(openssl rand -hex 8)}"

if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
# SynnoxERP — Generado por install.sh $(date)
PORT=3002
JWT_SECRET=$JWT_SECRET
LOG_ENCRYPTION_SECRET=$LOG_ENCRYPTION_SECRET
ADMIN_EMAIL=admin@synnoxerp.com
ADMIN_PASS=$ADMIN_PASS
NODE_ENV=production

# Token interno entre módulos (obligatorio en producción — launcher/server.js hace exit(1) sin él)
INTERNAL_API_TOKEN=$INTERNAL_API_TOKEN

# PostgreSQL
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME

# CORS (agrega tu dominio en producción)
CORS_ORIGIN=

# SMTP (configurar después)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
  ok ".env creado en $CONFIG"
  echo ""
  warn "JWT_SECRET: $JWT_SECRET"
  warn "Admin: admin@synnoxerp.com / $ADMIN_PASS"
  warn "GUARDA ESTOS DATOS — se pierden si borras el .env"
  echo ""
else
  ok ".env ya existe"
  # Upgrade: instalaciones previas no tienen INTERNAL_API_TOKEN → el launcher
  # muere en producción sin él. Agregar solo si falta (idempotente).
  if ! grep -q "^INTERNAL_API_TOKEN=" "$CONFIG"; then
    echo "" >> "$CONFIG"
    echo "# Token interno entre módulos (agregado por install.sh $(date))" >> "$CONFIG"
    echo "INTERNAL_API_TOKEN=$INTERNAL_API_TOKEN" >> "$CONFIG"
    ok "INTERNAL_API_TOKEN agregado al .env existente"
  fi
fi

# Cargar variables
set -a; source "$CONFIG"; set +a

# ─── 5. pnpm install ───────────────────────────────────────
echo ""
echo ">>> Instalando dependencias (pnpm)..."
cd "$INSTALL_DIR"
pnpm install --prod --frozen-lockfile 2>/dev/null || {
  warn "pnpm install --frozen-lockfile falló — reintentando sin frozen"
  pnpm install --prod 2>/dev/null || warn "pnpm install tuvo problemas"
}
ok "pnpm install completado (producción)"

# ─── 6. Migraciones ────────────────────────────────────────
echo ""
echo ">>> Ejecutando migraciones..."
export PGPASSWORD="$DB_PASS"

# Log detallado: antes los errores se ocultaban con 2>/dev/null y las
# instalaciones quedaban a medias sin avisar (ej. 030 del CRM abortaba
# 031-036 en el auto-migrate del servidor).
MIGRATION_LOG="$INSTALL_DIR/.install-migrations.log"
: > "$MIGRATION_LOG" 2>/dev/null || true
MIG_OK=0; MIG_FAIL=0; MIG_FAILED_FILES=""

run_migrations() {
  local label="$1" dir="$2" f base
  [ -d "$dir" ] || return 0
  for f in $(ls "$dir/"*.sql 2>/dev/null | sort); do
    base="$(basename "$f")"
    # ON_ERROR_STOP=1: sin esto psql retorna 0 aunque falle el archivo
    if psql -U "$DB_USER" -h localhost -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f" >>"$MIGRATION_LOG" 2>&1; then
      MIG_OK=$((MIG_OK+1))
    else
      MIG_FAIL=$((MIG_FAIL+1))
      MIG_FAILED_FILES="$MIG_FAILED_FILES $label/$base"
      echo "FAIL $label/$base" >>"$MIGRATION_LOG"
    fi
  done
}

# Extensiones requeridas (idempotente — CRM usa uuid_generate_v4 + pg_trgm)
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' >>"$MIGRATION_LOG" 2>&1 || warn "Extensión uuid-ossp (ver $MIGRATION_LOG)"
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' >>"$MIGRATION_LOG" 2>&1 || warn "Extensión pg_trgm (ver $MIGRATION_LOG)"

# Schemas (idempotente)
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS logistics;" >>"$MIGRATION_LOG" 2>&1 || true
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS projects;" >>"$MIGRATION_LOG" 2>&1 || true
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS crm;" >>"$MIGRATION_LOG" 2>&1 || true

run_migrations "framework" "$INSTALL_DIR/framework/migrations"
run_migrations "logistica" "$INSTALL_DIR/modules/logistica/backend/migrations"
run_migrations "proyectos" "$INSTALL_DIR/modules/proyectos/backend/migrations"
# CRM (001 a 036, excluye run.js). El servidor también auto-migra al arrancar
# (runMigrations en modules/crm/backend/server.js); esto es fail-fast en limpio.
run_migrations "crm" "$INSTALL_DIR/modules/crm/backend/migrations"

if [ "$MIG_FAIL" -gt 0 ]; then
  warn "Migraciones con error ($MIG_FAIL de $((MIG_OK+MIG_FAIL))):$MIG_FAILED_FILES"
  warn "Detalle en $MIGRATION_LOG — corrige antes de usar el sistema"
else
  ok "Migraciones OK ($MIG_OK archivos, 0 errores)"
fi

# El servidor crea tablas SQLite (launcher, nomina) automáticamente al iniciar

# ─── 7. PM2 — UN solo proceso ─────────────────────────────
echo ""
echo ">>> Arrancando servidor unificado..."
pm2 delete synnoxerp 2>/dev/null || true
pm2 delete horix-erp 2>/dev/null || true
pm2 delete logistics 2>/dev/null || true
pm2 delete docflow 2>/dev/null || true

cd "$INSTALL_DIR"
pm2 start server.js --name synnoxerp --cwd "$INSTALL_DIR"
pm2 save
pm2 startup 2>/dev/null || true
ok "Servidor arrancado en puerto ${PORT:-3002}"
ok "PM2 configurado para inicio automático"

# ─── 7b. Smoke test — detecta módulos caídos antes de entregar ──
echo ""
echo ">>> Verificando backend y módulos..."
SMOKE_OK=1
for i in $(seq 1 30); do
  if curl -sf -m 3 "http://127.0.0.1:${PORT:-3002}/api/health" >/dev/null 2>&1; then
    SMOKE_OK=0
    break
  fi
  sleep 2
done
if [ "$SMOKE_OK" != 0 ]; then
  warn "El backend no respondió en 60s — revisa: sudo pm2 logs synnoxerp --lines 50 --nostream"
else
  ok "Backend responde en :${PORT:-3002}"
  # 200/401/403 = módulo MONTADO (401/403 = pide auth, pero la ruta existe).
  # 404/000 = módulo NO montado (el import falló al arrancar).
  for mod in proveedores logistica proyectos crm; do
    CODE="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3002}/$mod/api/health" 2>/dev/null || echo 000)"
    case "$CODE" in
      200|401|403) ok "$mod: montado (HTTP $CODE)" ;;
      *) warn "$mod: HTTP $CODE — módulo posiblemente NO montado (ver pm2 logs)" ;;
    esac
  done
  NOMINA_CODE="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-3002}/nomina/" 2>/dev/null || echo 000)"
  case "$NOMINA_CODE" in
    200|301|302) ok "nomina: montado (HTTP $NOMINA_CODE)" ;;
    *) warn "nomina: HTTP $NOMINA_CODE — módulo posiblemente NO montado (ver pm2 logs)" ;;
  esac
fi

# ─── 8. Nginx ──────────────────────────────────────────────
echo ""
echo ">>> Configurando Nginx..."

DOMAIN="${DOMAIN:-localhost}"
NGINX_CONF="/etc/nginx/sites-available/synnoxerp"

# Certificado autofirmado si es localhost
if [ "$DOMAIN" = "localhost" ]; then
  mkdir -p /etc/ssl/synnoxerp
  if [ ! -f /etc/ssl/synnoxerp/cert.pem ]; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/ssl/synnoxerp/key.pem \
      -out /etc/ssl/synnoxerp/cert.pem \
      -subj "/CN=$DOMAIN/O=SynnoxERP/C=CO" 2>/dev/null
    ok "Certificado autofirmado generado"
  fi
  SSL_CERT="/etc/ssl/synnoxerp/cert.pem"
  SSL_KEY="/etc/ssl/synnoxerp/key.pem"
else
  # Let's Encrypt para dominio real
  if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null 2>&1 || true
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" 2>/dev/null || warn "Certbot falló — configura SSL manualmente"
  fi
  SSL_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  SSL_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
fi

cat > "$NGINX_CONF" <<NGINX
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     $SSL_CERT;
    ssl_certificate_key $SSL_KEY;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    # Backup restore — backups prod (hasta 10GB): sin límite y sin buffering,
    # con timeouts largos. Sin esto nginx responde 413 con el default de 1MB.
    location /api/admin/backup/restore {
        client_max_body_size 0;
        proxy_pass http://127.0.0.1:${PORT:-3002};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # Launcher + todos los módulos (single server)
    location / {
        proxy_pass http://127.0.0.1:${PORT:-3002};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
NGINX

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ 2>/dev/null || true
# Remover default si existe
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t 2>/dev/null && systemctl reload nginx && ok "Nginx configurado" || warn "Nginx tiene errores — revisa manualmente"

# ─── 9. Fail2ban (opcional) ────────────────────────────────
echo ""
echo ">>> Configurando Fail2ban..."
if command -v fail2ban-client &>/dev/null; then
  if [ -f "$INSTALL_DIR/systemd/fail2ban/filter.d/synnox-login.conf" ]; then
    install -m 0644 "$INSTALL_DIR/systemd/fail2ban/filter.d/synnox-login.conf" /etc/fail2ban/filter.d/synnox-login.conf
    install -m 0644 "$INSTALL_DIR/systemd/fail2ban/jail.d/synnox-login.conf" /etc/fail2ban/jail.d/synnox-login.conf
    fail2ban-client -t 2>/dev/null || warn "Configuración Fail2ban inválida — revisa /etc/fail2ban"
  fi
  systemctl enable fail2ban 2>/dev/null || true
  systemctl restart fail2ban 2>/dev/null || true
  ok "Fail2ban activo"
else
  warn "Fail2ban no instalado — instálalo para protección adicional"
fi

# ─── 10. Permisos ──────────────────────────────────────────
echo ""
echo ">>> Configurando permisos..."
chown -R www-data:www-data /etc/ssl/synnoxerp 2>/dev/null || true
chmod 600 /etc/ssl/synnoxerp/key.pem 2>/dev/null || true
ok "Permisos configurados"

# ─── Listo ─────────────────────────────────────────────────
echo ""
echo -e "${VERDE}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${VERDE}║          Instalación completada 🎉                 ║${RESET}"
echo -e "${VERDE}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  URL:        https://$DOMAIN"
echo "  Admin:      admin@synnoxerp.com"
echo "  Password:   $ADMIN_PASS"
echo "  Directorio: $INSTALL_DIR"
echo ""
echo "  Módulos (montados en el mismo servidor):"
echo "    /proveedores/  → Proveedores (facturas)"
echo "    /logistica/    → Logística (rutas)"
echo "    /nomina/       → Nómina (horas extra)"
echo "    /proyectos/    → Proyectos y tareas"
echo "    /crm/          → CRM (clientes, pipeline, cotizaciones)"
echo ""
echo "  Comandos útiles:"
echo "    pm2 logs synnoxerp     # Ver logs"
echo "    pm2 status             # Estado del proceso"
echo "    pm2 restart synnoxerp  # Reiniciar"
echo ""
echo -e "${AMARILLO}  ⚠  Cambia la contraseña del admin después del primer ingreso.${RESET}"
echo -e "${AMARILLO}  ⚠  Configura SMTP en Configuración → Correo para notificaciones.${RESET}"
echo ""
