# SynnoxERP

Plataforma ERP modular con arquitectura monorepo unificado. Un solo servidor, tres módulos, auth centralizada.

## Arquitectura

```
                    Nginx (443/HTTPS)
                         │
                    ┌────┴────┐
                    │         │
              Express :3002  SSL
                    │
        ┌───────────┼───────────┐
        │           │           │
   /proveedores  /logistica  /nomina
   (PostgreSQL)  (PostgreSQL)  (SQLite)
```

| Módulo | Función | DB | Ruta |
|--------|---------|-----|------|
| **Launcher** | Login, dashboard, admin | SQLite | `/` |
| **Proveedores** | Facturas, compras | PostgreSQL | `/proveedores/` |
| **Logística** | Rutas, pedidos, vehículos | PostgreSQL | `/logistica/` |
| **Nómina** | Horas extra, novedades | SQLite | `/nomina/` |

## Instalación rápida

```bash
git clone -b main https://github.com/synnoxerp/synnox-erp.git
cd synnox-erp
sudo bash install.sh
```

El instalador:
1. Instala dependencias (Node.js, PostgreSQL, nginx, PM2)
2. Genera `.env` con JWT_SECRET fuerte
3. Ejecuta `npm install`
4. Corre migraciones automáticamente
5. Configura nginx con SSL
6. Arranca el servidor con PM2

## Configuración manual

### 1. Variables de entorno (.env)

```bash
# Generar JWT_SECRET fuerte
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Crear `.env` en la raíz del proyecto:

```env
PORT=3002
JWT_SECRET=<tu-secret-fuerte-de-64-chars>
ADMIN_EMAIL=admin@tudominio.com
ADMIN_PASS=<contraseña-segura>
NODE_ENV=production

# PostgreSQL
DB_USER=synnox
DB_PASSWORD=<password-db>
DB_HOST=localhost
DB_PORT=5432
DB_NAME=synnox_erp

# CORS
CORS_ORIGIN=https://tudominio.com

# SMTP (opcional, configurar después)
SMTP_HOST=smtp.tudominio.com
SMTP_PORT=587
SMTP_USER=correo@tudominio.com
SMTP_PASS=password
SMTP_FROM=erp@tudominio.com
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. PostgreSQL

```bash
# Crear usuario y database
sudo -u postgres psql -c "CREATE USER synnox WITH PASSWORD 'tu-password';"
sudo -u postgres psql -c "CREATE DATABASE synnox_erp OWNER synnox;"

# Las migraciones corren automáticamente al iniciar el servidor
```

### 4. Arrancar servidor

```bash
# Desarrollo
node server.js

# Producción (PM2)
pm2 start server.js --name synnoxerp
pm2 save
pm2 startup
```

### 5. Nginx (HTTPS)

```nginx
server {
    listen 443 ssl http2;
    server_name tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name tudominio.com;
    return 301 https://$host$request_uri;
}
```

### 6. Let's Encrypt (producción)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com
```

## Seguridad

### JWT_SECRET

**NUNCA** usar valores por defecto. Si `JWT_SECRET` no está configurado, el servidor no arranca.

```bash
# Generar secret fuerte
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Cookie

- `httpOnly: false` — necesario para que los módulos lean el token via JavaScript
- `sameSite: lax` — permite navegación desde el launcher a módulos
- `secure: true` solo en HTTPS (producción)

### Primer login

1. Abrir `https://tudominio.com`
2. Login: `admin@synnoxerp.com` / contraseña del `.env`
3. **Cambiar contraseña inmediatamente** en Admin → Usuarios
4. Configurar SMTP en Configuración → Correo
5. Asignar módulos a usuarios en Admin → Usuarios

## Comandos útiles

```bash
# Logs
pm2 logs synnoxerp

# Estado
pm2 status

# Reiniciar
pm2 restart synnoxerp

# Actualizar
cd /opt/horix-platform
git pull
npm install
pm2 restart synnoxerp
```

## Estructura del proyecto

```
horix-erp/
├── server.js              # Entry point unificado
├── .env                   # Variables de entorno (no subir a git)
├── package.json           # Dependencias raíz
├── install.sh             # Instalador automático
├── SECURITY.md            # Documentación CVEs
├── framework/
│   └── auth.mjs           # Auth compartida (ESM)
├── launcher/
│   ├── server.js          # Launcher backend
│   └── shell/             # Frontend launcher
├── media/
│   └── LogoERP.png        # Logo del ERP
└── modules/
    ├── proveedores/       # Facturas y proveedores
    ├── logistica/         # Rutas y pedidos
    └── nomina/            # Horas extra
```

## Troubleshooting

### Servidor no arranca
- Verificar `.env` tiene `JWT_SECRET` configurado
- Verificar PostgreSQL está corriendo: `pg_isready`
- Ver logs: `pm2 logs synnoxerp`

### Módulos no autentican
- Verificar que el cookie `launcher_jwt` exista (DevTools → Application → Cookies)
- Verificar `JWT_SECRET` es igual en todos los módulos (mismo `.env`)
- Verificar `NODE_ENV` no cause problemas con `secure` cookies en HTTP

### Nginx 502 Bad Gateway
- Verificar PM2 está corriendo: `pm2 status`
- Verificar puerto: `curl http://localhost:3002/api/health`
- Ver logs nginx: `tail -f /var/log/nginx/error.log`

## Licencia

Privado — Edgar Velásquez © 2026
