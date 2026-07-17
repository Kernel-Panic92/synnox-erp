#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# SynnoxERP — Instalación automática (monorepo unificado)
#   Uso: sudo bash install.sh
#   Branch: refactor/monorepo-auth
# ─────────────────────────────────────────────────────────────

BRANCH="${1:-main}"
INSTALL_DIR="/opt/synnoxerp"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$INSTALL_DIR/.env"
VERDE="\033[0;32m"; ROJO="\033[0;31m"; AMARILLO="\033[1;33m"; RESET="\033[0m"
ok()  { echo -e " ${VERDE}✓${RESET} $1"; }
err() { echo -e " ${ROJO}✗${RESET} $1"; }
warn(){ echo -e " ${AMARILLO}⚠${RESET} $1"; }

echo -e "${VERDE}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║         SynnoxERP — Instalación automática          ║"
echo "║         Monorepo unificado (1 servidor, 3 módulos)  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""

# ─── Verificar root ────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then warn "Ejecuta con sudo: sudo bash install.sh"; exit 1; fi

# ─── 1. Dependencias del sistema ───────────────────────────
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
DB_USER="${DB_USER:-synnox}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
DB_NAME="${DB_NAME:-synnox_erp}"

# Arrancar PostgreSQL
if ! pg_isready -q 2>/dev/null; then
  pg_lsclusters 2>/dev/null | head -1 | awk '{print $1, $2}' | while read -r v c; do
    pg_ctlcluster "$v" "$c" start 2>/dev/null || true
  done
fi

# Crear usuario y database
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\" | grep -q 1 || psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || true
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\" | grep -q 1 || createdb -O $DB_USER $DB_NAME" 2>/dev/null || true
ok "PostgreSQL listo — database: $DB_NAME"

# ─── 3. Clonar / copiar repositorio ────────────────────────
echo ""
echo ">>> Instalando plataforma en $INSTALL_DIR..."

if [ "$SCRIPT_DIR" = "$INSTALL_DIR" ]; then
  ok "Ya estamos en $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  warn "$INSTALL_DIR ya existe — actualizando..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  if [ -d "$SCRIPT_DIR/.git" ]; then
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='.git' --exclude='node_modules' "$SCRIPT_DIR/" "$INSTALL_DIR/"
    cd "$INSTALL_DIR"
    ok "Archivos copiados desde $SCRIPT_DIR"
  else
    git clone -b "$BRANCH" https://github.com/synnoxerp/synnox-erp.git "$INSTALL_DIR" 2>/dev/null || {
      err "No se pudo clonar el repo"
      exit 1
    }
    cd "$INSTALL_DIR"
    ok "Repositorio clonado (branch $BRANCH)"
  fi
fi

cd "$INSTALL_DIR"

# ─── 4. Generar .env ───────────────────────────────────────
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 64)}"
ADMIN_PASS="${ADMIN_PASS:-$(openssl rand -hex 8)}"

if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
# SynnoxERP — Generado por install.sh $(date)
PORT=3002
JWT_SECRET=$JWT_SECRET
ADMIN_EMAIL=admin@synnoxerp.com
ADMIN_PASS=$ADMIN_PASS
NODE_ENV=production

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

# Schema logistics (idempotente)
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS logistics;" 2>/dev/null || true
psql -U "$DB_USER" -h localhost -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS projects;" 2>/dev/null || true

# Migraciones SQL de logística
if [ -d "$INSTALL_DIR/modules/logistica/backend/migrations" ]; then
  for f in $(ls "$INSTALL_DIR/modules/logistica/backend/migrations/"*.sql 2>/dev/null | sort); do
    psql -U "$DB_USER" -h localhost -d "$DB_NAME" -f "$f" 2>/dev/null || warn "Migration: $(basename "$f")"
  done
  ok "Migraciones logística ejecutadas"
fi

# Migraciones SQL de proyectos
if [ -d "$INSTALL_DIR/modules/proyectos/backend/migrations" ]; then
  for f in $(ls "$INSTALL_DIR/modules/proyectos/backend/migrations/"*.sql 2>/dev/null | sort); do
    psql -U "$DB_USER" -h localhost -d "$DB_NAME" -f "$f" 2>/dev/null || warn "Migration: $(basename "$f")"
  done
  ok "Migraciones proyectos ejecutadas"
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
pm2 start server.js --name synnoxerp
pm2 save
pm2 startup 2>/dev/null || true
ok "Servidor arrancado en puerto ${PORT:-3002}"
ok "PM2 configurado para inicio automático"

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
  systemctl enable fail2ban 2>/dev/null || true
  systemctl start fail2ban 2>/dev/null || true
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
echo ""
echo "  Módulos (montados en el mismo servidor):"
echo "    /proveedores/  → Proveedores (facturas)"
echo "    /logistica/    → Logística (rutas)"
echo "    /nomina/       → Nómina (horas extra)"
echo ""
echo "  Comandos útiles:"
echo "    pm2 logs synnoxerp     # Ver logs"
echo "    pm2 status             # Estado del proceso"
echo "    pm2 restart synnoxerp  # Reiniciar"
echo ""
echo -e "${AMARILLO}  ⚠  Cambia la contraseña del admin después del primer ingreso.${RESET}"
echo -e "${AMARILLO}  ⚠  Configura SMTP en Configuración → Correo para notificaciones.${RESET}"
echo ""
