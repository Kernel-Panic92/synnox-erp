#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Horix Platform Monorepo Installer
#   Uso: sudo bash install.sh
#   Branch por defecto: refactor/monorepo-auth
# ─────────────────────────────────────────────────────────────

BRANCH="${1:-refactor/monorepo-auth}"
INSTALL_DIR="/opt/horix-platform"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$INSTALL_DIR/config.env"
JUAN="\033[0;32m"; ROJO="\033[0;31m"; AMARILLO="\033[1;33m"; RESET="\033[0m"
ok()  { echo -e " ${JUAN}✓${RESET} $1"; }
err() { echo -e " ${ROJO}✗${RESET} $1"; }
warn(){ echo -e " ${AMARILLO}⚠${RESET} $1"; }

echo -e "${JUAN}"
echo "╔══════════════════════════════════════════╗"
echo "║     Horix Platform — Monorepo Setup     ║"
echo "║         Branch: $BRANCH          ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${RESET}"

# ─── Verificar root ────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then warn "Ejecuta con sudo: sudo bash install.sh"; exit 1; fi

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
DB_USER="${DB_USER:-horix}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
DB_LAUNCHER="${DB_LAUNCHER:-horix_launcher}"

# Arrancar PostgreSQL si no corre
if ! pg_isready -q 2>/dev/null; then
  pg_lsclusters 2>/dev/null | head -1 | awk '{print $1, $2}' | while read -r v c; do
    pg_ctlcluster "$v" "$c" start 2>/dev/null || true
  done
fi

# Crear usuario y databases
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\" | grep -q 1 || psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || true
for db in horix_launcher horix_logistics horix_docflow; do
  su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$db'\" | grep -q 1 || createdb -O $DB_USER $db" 2>/dev/null || true
done
ok "PostgreSQL listo — usuario: $DB_USER"

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
  # Si estamos dentro del repo (clonado temporalmente), copiar
  if [ -d "$SCRIPT_DIR/.git" ]; then
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='.git' --exclude='node_modules' "$SCRIPT_DIR/" "$INSTALL_DIR/"
    cd "$INSTALL_DIR"
    ok "Archivos copiados desde $SCRIPT_DIR"
  else
    # Clonar desde GitHub
    git clone -b "$BRANCH" https://github.com/Kernel-Panic92/horix-erp.git "$INSTALL_DIR" 2>/dev/null || {
      err "No se pudo clonar el repo. Asegúrate de que existe o copia manualmente los archivos a $INSTALL_DIR"
      exit 1
    }
    cd "$INSTALL_DIR"
    ok "Repositorio clonado (branch $BRANCH)"
  fi
fi

cd "$INSTALL_DIR"

# ─── 4. Config.env ─────────────────────────────────────────
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
# Generado por install.sh — $(date)
INSTALL_DIR=$INSTALL_DIR
JWT_SECRET=$JWT_SECRET
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_HOST=localhost
EOF
  ok "Config guardada en $CONFIG"
fi
source "$CONFIG"

# ─── 5. .env para cada módulo ──────────────────────────────
echo ""
echo ">>> Generando .env para módulos..."

generar_env() {
  local dir="$1" port="$2" db_name="$3" module_id="$4"
  local env_path="$INSTALL_DIR/$dir/.env"
  if [ ! -f "$env_path" ]; then
    mkdir -p "$(dirname "$env_path")"
    cat > "$env_path" <<EOF
PORT=$port
MODULE_ID=$module_id
JWT_SECRET=$JWT_SECRET
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$db_name
NODE_ENV=production
OSRM_URL=https://router.project-osrm.org
EOF
    ok ".env creado: $dir"
  else
    ok ".env existe: $dir"
  fi
}

generar_env "launcher"           3002 "horix_launcher"  "launcher"
generar_env "modules/logistics"  3004 "horix_logistics" "logistics"
generar_env "modules/docflow"    3100 "horix_docflow"   "docflow"

# ─── 6. npm install ────────────────────────────────────────
echo ""
echo ">>> Instalando dependencias npm..."
for dir in launcher modules/logistics modules/docflow; do
  if [ -f "$INSTALL_DIR/$dir/package.json" ]; then
    cd "$INSTALL_DIR/$dir"
    npm install --omit=dev 2>/dev/null || warn "npm install en $dir tuvo problemas (puede ignorarse)"
    ok "npm: $dir"
  fi
done

# ─── 7. Migraciones y seeds ────────────────────────────────
echo ""
echo ">>> Ejecutando migraciones..."

# Logistics: migraciones SQL secuenciales
LOG_DB="postgresql://$DB_USER:$DB_PASS@localhost:5432/horix_logistics"
export PGPASSWORD="$DB_PASS"

# Schema logistics (idempotente)
psql -U "$DB_USER" -h localhost -d horix_logistics -c "CREATE SCHEMA IF NOT EXISTS logistics;" 2>/dev/null || true

if [ -d "$INSTALL_DIR/modules/logistics/backend/migrations" ]; then
  for f in $(ls "$INSTALL_DIR/modules/logistics/backend/migrations/"*.sql 2>/dev/null | sort); do
    psql -U "$DB_USER" -h localhost -d horix_logistics -f "$f" 2>/dev/null || warn "Migration: $(basename "$f")"
  done
  ok "Logistics: migraciones ejecutadas"
fi

# DocFlow: migrate script
if [ -f "$INSTALL_DIR/modules/docflow/src/db/migrate.js" ]; then
  cd "$INSTALL_DIR/modules/docflow"
  PGPASSWORD="$DB_PASS" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASS" DB_NAME=horix_docflow node src/db/migrate.js 2>/dev/null || warn "DocFlow migrate tuvo problemas"
  ok "DocFlow: migraciones ejecutadas"
fi

# Launcher: SQLite se crea solo al arrancar

# ─── 8. Seeds demo ─────────────────────────────────────────
echo ""
echo ">>> Sembrando datos demo..."
DEMO="${DEMO:-yes}"
if [ "$DEMO" = "yes" ]; then
  # Launcher: admin por defecto
  # (se crea automáticamente al iniciar server.js si no existe)

  # Logistics: seed
  if [ -f "$INSTALL_DIR/modules/logistics/backend/db/seed.js" ]; then
    cd "$INSTALL_DIR/modules/logistics"
    PGPASSWORD="$DB_PASS" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASS" DB_NAME=horix_logistics node backend/db/seed.js 2>/dev/null || true
    ok "Logistics: admin seed"
  fi

  # DocFlow: seed
  if [ -f "$INSTALL_DIR/modules/docflow/src/db/seed.js" ]; then
    cd "$INSTALL_DIR/modules/docflow"
    PGPASSWORD="$DB_PASS" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASS" DB_NAME=horix_docflow node src/db/seed.js 2>/dev/null || true
    ok "DocFlow: admin seed"
  fi

  # ─── Seeds demo de negocio ──────────────────────────────
  echo ""
  echo ">>> Sembrando datos demo de negocio..."

  # Logistics: seed-demo (sedes, clientes, vehículos, pedidos)
  if [ -f "$INSTALL_DIR/modules/logistics/backend/db/seed-demo.js" ]; then
    cd "$INSTALL_DIR/modules/logistics"
    PGPASSWORD="$DB_PASS" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASS" DB_NAME=horix_logistics node backend/db/seed-demo.js 2>/dev/null || true
    ok "Logistics: datos demo"
  fi

  # DocFlow: seed-demo (proveedores, facturas)
  if [ -f "$INSTALL_DIR/modules/docflow/src/db/seed-demo.js" ]; then
    cd "$INSTALL_DIR/modules/docflow"
    PGPASSWORD="$DB_PASS" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASS" DB_NAME=horix_docflow node src/db/seed-demo.js 2>/dev/null || true
    ok "DocFlow: datos demo"
  fi
fi

# ─── 9. PM2 ────────────────────────────────────────────────
echo ""
echo ">>> Arrancando servicios PM2..."
pm2 delete horix-erp logistics docflow 2>/dev/null || true

cd "$INSTALL_DIR/launcher"
pm2 start server.js --name horix-erp -- --port 3002
ok "Launcher → :3002"

cd "$INSTALL_DIR/modules/logistics"
pm2 start backend/server.js --name logistics -- --port 3004
ok "Logistics → :3004"

cd "$INSTALL_DIR/modules/docflow"
pm2 start src/server.js --name docflow -- --port 3100
ok "DocFlow → :3100"

pm2 save
pm2 startup 2>/dev/null || true
ok "PM2 configurado para inicio automático"

# ─── 10. Nginx ─────────────────────────────────────────────
echo ""
echo ">>> Configurando Nginx..."

DOMAIN="${DOMAIN:-localhost}"
NGINX_CONF="/etc/nginx/sites-available/horix-platform"

if [ ! -f "$NGINX_CONF" ] || [ "$DOMAIN" = "localhost" ]; then
  # Autofirmado para test
  mkdir -p /etc/ssl/horix-platform
  if [ ! -f /etc/ssl/horix-platform/cert.pem ]; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/ssl/horix-platform/key.pem \
      -out /etc/ssl/horix-platform/cert.pem \
      -subj "/CN=$DOMAIN/O=HorixERP/C=CO" 2>/dev/null
  fi

  cat > "$NGINX_CONF" <<NGINX
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate     /etc/ssl/horix-platform/cert.pem;
    ssl_certificate_key /etc/ssl/horix-platform/key.pem;

    # Launcher (Admin / Dashboard)
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Logistics
    location /logistics/ {
        proxy_pass http://127.0.0.1:3004/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # DocFlow
    location /docflow/ {
        proxy_pass http://127.0.0.1:3100/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# Redirigir HTTP a HTTPS
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
NGINX
  ok "Nginx config creada: $NGINX_CONF"
fi

# Activar site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ 2>/dev/null || true
nginx -t 2>/dev/null && systemctl reload nginx && ok "Nginx recargado" || warn "Nginx config tiene errores — revisa manualmente"

# ─── 11. Registrar módulos en DB del launcher ──────────────
echo ""
echo ">>> Registrando módulos en el launcher..."
sleep 2  # esperar que el launcher arranque y cree la DB

# Usar API del launcher para registrar
register_module() {
  local id="$1" nombre="$2" url="$3" prefix="$4" tipo="$5"
  curl -s -X POST "http://localhost:3002/api/admin/modulos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"id\":\"$id\",\"nombre\":\"$nombre\",\"url\":\"$url\",\"proxy_prefix\":\"$prefix\",\"mcp_enabled\":true,\"tipo\":\"$tipo\"}" >/dev/null 2>&1 || true
}

# Obtener token admin primero
TOKEN=$(curl -s -X POST "http://localhost:3002/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@horix.com","password":"admin123"}' 2>/dev/null | grep -o '"jwt":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "$TOKEN" ]; then
  register_module "logistics" "Logística" "http://localhost:3004" "/logistics/" "interno"
  register_module "docflow"   "DocFlow"   "http://localhost:3100" "/docflow/"   "interno"
  ok "Módulos registrados vía API"
else
  warn "No se pudo obtener token. Registra los módulos manualmente desde Admin → Módulos"
  warn "  logistics: http://localhost:3004, prefix /logistics/, tipo interno"
  warn "  docflow:   http://localhost:3100, prefix /docflow/,   tipo interno"
fi

# ─── Listo ─────────────────────────────────────────────────
echo ""
echo -e "${JUAN}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${JUAN}║            Instalación completada 🎉              ║${RESET}"
echo -e "${JUAN}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  Launcher:  http://localhost:3002"
if [ "$DOMAIN" != "localhost" ]; then
  echo "  HTTPS:     https://$DOMAIN"
  echo "  Logistics: https://$DOMAIN/logistics/"
  echo "  DocFlow:   https://$DOMAIN/docflow/"
fi
echo ""
echo "  Admin: admin@horix.com / admin123"
echo "  Asigna módulos a usuarios en Admin → Usuarios"
echo ""
echo "  Comandos útiles:"
echo "    pm2 logs horix-erp        # Ver logs del launcher"
echo "    pm2 logs logistics        # Ver logs de logistics"
echo "    pm2 logs docflow          # Ver logs de docflow"
echo "    pm2 status                # Estado de todos los procesos"
echo ""
echo -e "${AMARILLO}  ⚠  Cambia la contraseña del admin después del primer ingreso.${RESET}"
echo ""

