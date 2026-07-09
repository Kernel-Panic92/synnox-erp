#!/bin/bash
set -e

# ── Horix Logistics - Instalador ──
# Uso: sudo ./install.sh

ROJO='\033[0;31m'; VERDE='\033[0;32m'; AMARILLO='\033[1;33m'; AZUL='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${AZUL}[LOGISTICS]${NC} $1"; }
ok()    { echo -e "${VERDE}[✓]${NC} $1"; }
err()   { echo -e "${ROJO}[✗]${NC} $1"; }
warn()  { echo -e "${AMARILLO}[!]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then err "Ejecuta con sudo: sudo bash install.sh"; exit 1; fi

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

echo ""
info "============================================"
info "  Horix Logistics - Instalación"
info "============================================"
echo ""

# ── 1. Verificar Node.js ──
info "Verificando Node.js..."
if ! command -v node &>/dev/null; then
  warn "Node.js no encontrado. Instalando v20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) instalado"
else
  ok "Node.js $(node -v)"
fi

# ── 2. PM2 ──
if ! command -v pm2 &>/dev/null; then
  info "Instalando PM2..."
  npm install -g pm2
  ok "PM2 instalado"
else
  ok "PM2 $(pm2 -v)"
fi

# ── 3. Crear .env ──
if [ ! -f .env ]; then
  info "Configurando variables de entorno..."
  cp .env.example .env

  read -p "Puerto del servidor [3004]: " PUERTO
  [ -z "$PUERTO" ] && PUERTO=3004
  sed -i "s/^PORT=.*/PORT=$PUERTO/" .env

  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env

  read -p "Host PostgreSQL [localhost]: " DB_HOST
  [ -z "$DB_HOST" ] && DB_HOST=localhost
  sed -i "s/^DB_HOST=.*/DB_HOST=$DB_HOST/" .env

  read -p "Puerto PostgreSQL [5432]: " DB_PORT
  [ -z "$DB_PORT" ] && DB_PORT=5432
  sed -i "s/^DB_PORT=.*/DB_PORT=$DB_PORT/" .env

  read -p "Nombre BD [vitamar_logistics]: " DB_NAME
  [ -z "$DB_NAME" ] && DB_NAME=vitamar_logistics
  sed -i "s/^DB_NAME=.*/DB_NAME=$DB_NAME/" .env

  read -p "Usuario BD [postgres]: " DB_USER
  [ -z "$DB_USER" ] && DB_USER=postgres
  sed -i "s/^DB_USER=.*/DB_USER=$DB_USER/" .env

  read -s -p "Contraseña BD: " DB_PASS; echo ""
  sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASS/" .env

  read -p "Email admin [admin@vitamar.com]: " ADMIN_EMAIL
  [ -z "$ADMIN_EMAIL" ] && ADMIN_EMAIL=admin@vitamar.com
  sed -i "s/^ADMIN_EMAIL=.*/ADMIN_EMAIL=$ADMIN_EMAIL/" .env

  read -s -p "Contraseña admin [admin123]: " ADMIN_PASS; echo ""
  [ -z "$ADMIN_PASS" ] && ADMIN_PASS=admin123
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$ADMIN_PASS/" .env

  ok ".env configurado"
else
  info ".env ya existe, se usará el actual"
fi

# ── 4. npm install ──
info "Instalando dependencias..."
npm install --omit=dev
ok "Dependencias instaladas"

# ── 5. Crear BD si no existe ──
info "Verificando base de datos..."
source .env
if command -v psql &>/dev/null; then
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -tc \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "CREATE DATABASE $DB_NAME"
  ok "Base de datos $DB_NAME lista"
else
  warn "psql no encontrado. Asegúrate de que la BD '$DB_NAME' exista manualmente."
fi

# ── 6. Migraciones ──
info "Ejecutando migraciones..."
npm run db:migrate
ok "Migraciones completadas"

# ── 7. Seed ──
info "Sembrando usuario admin..."
npm run db:seed
ok "Seed completado"

# ── 6. Seed ──
info "Sembrando usuario admin..."
npm run db:seed
ok "Seed completado"

# ── 8. Crear directorio uploads ──
mkdir -p uploads logs
ok "Directorios creados (uploads, logs)"

# ── 9. Iniciar con PM2 ──
info "Iniciando servicio con PM2..."
pm2 delete logistics 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save
ok "Servicio iniciado"

# ── 10. Verificar ──
sleep 2
if pm2 info logistics &>/dev/null; then
  ok "PM2: logistics corriendo"
else
  warn "PM2: verifica con 'pm2 status'"
fi

echo ""
info "============================================"
info "  Instalación completada"
info "============================================"
echo ""
echo -e "  ${VERDE}URL:${NC}       http://localhost:$PUERTO"
echo -e "  ${VERDE}Email:${NC}     $ADMIN_EMAIL"
echo -e "  ${VERDE}Password:${NC}  $ADMIN_PASS"
echo ""
info "Para ver logs: pm2 logs logistics"
info "Para reiniciar: pm2 restart logistics"
echo ""
