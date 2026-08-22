# SynnoxERP

Plataforma ERP modular con arquitectura monorepo unificado. Un servidor, cinco módulos, auth centralizada.

## Arquitectura

```
                     Nginx (443/HTTPS)
                          │
                     Express :3002
                          │
        ┌─────────┬───────┼───────┬─────────┐
        │         │       │       │         │
   /proveedores /logistica /nomina /proyectos  /
   (PostgreSQL) (PostgreSQL) (SQLite) (PostgreSQL) (SQLite)
```

| Módulo | Función | DB | Ruta |
|--------|---------|-----|------|
| **Launcher** | Login, dashboard, admin, backups | SQLite | `/` |
| **Proveedores** | Facturas, compras, proveedores | PostgreSQL | `/proveedores/` |
| **Logística** | Rutas, pedidos, vehículos, clientes | PostgreSQL | `/logistica/` |
| **Nómina** | Horas extra, novedades, calendario | SQLite | `/nomina/` |
| **Proyectos** | Gestión de proyectos, tareas, actas | PostgreSQL | `/proyectos/` |

## Features MVP v1.1.0

### Launcher
- Dashboard centralizado con widgets de todos los módulos
- Gestión de usuarios, roles y permisos
- Gestión de centros de operación (CRUD centralizado)
- Backup general del sistema (ZIP con todos los módulos)
- Backup individual por módulo
- Import/Export de configuración
- Telemetría y auditoría de accesos
- Actualización del sistema vía UI

### Nómina
- Registro de horas extra con aprobación
- Calendario de nómina con fechas límite configurables
- Alertas al registrar fuera de fecha límite
- Dashboard con gráficos por sede, departamento, empleado
- Exportación SIESA (formato contable)
- Backup/Restore completo

### Logística
- Gestión de flota vehicular
- Pedidos con asignación masiva
- Generación de rutas optimizadas (VRP)
- Mapa interactivo con Leaflet
- Reportes de eficiencia y KPIs
- Importación de datos (SIESA, Widetech GPS)
- Exportación a Excel

### Proveedores
- Gestión de facturas y proveedores
- Flujo de aprobación con centro de operación
- Categorías de compra y áreas
- Sync de centros desde launcher
- Backup con uploads

### Proyectos
- Gestión de proyectos y tareas (estilo Kanban)
- Tablero visual con drag & drop
- Actas de cierre de proyecto con exportación a PDF
- Sistema de aprobación por gerente
- Comentarios y evidencias en tareas
- Alertas de vencimiento por email

## Seguridad

- **JWT httpOnly cookies** — previene robo de token via XSS
- **Rate limiting** — protección contra fuerza bruta
- **CSRF protection** — tokens en requests modificativos
- **Password hashing** — bcryptjs
- **CORS configurado** — por dominio
- **Path traversal protection** — en uploads y downloads
- **Backup automático pre-import** — antes de restaurar datos

## Instalación rápida

```bash
git clone -b main https://github.com/synnoxerp/synnox-erp.git
cd synnox-erp
sudo bash install.sh
```

El instalador:
1. Instala dependencias (Node.js, PostgreSQL, nginx, PM2)
2. Genera `.env` con JWT_SECRET fuerte
3. Ejecuta `pnpm install --prod`
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
LOG_ENCRYPTION_SECRET=<otro-secret-fuerte-distinto>
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
pnpm install --prod
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

## Primer login

1. Abrir `https://tudominio.com`
2. Login: `admin@synnoxerp.com` / contraseña del `.env`
3. **Cambiar contraseña inmediatamente** en Admin → Usuarios
4. Configurar SMTP en Configuración → Correo
5. Asignar módulos a usuarios en Admin → Usuarios
6. Crear centros de operación en Admin → Centros
7. Generar períodos de nómina en Nómina → Períodos

## Comandos útiles

```bash
# Logs
pm2 logs synnoxerp

# Estado
pm2 status

# Reiniciar
pm2 restart synnoxerp

# Backup general
curl -H "Authorization: Bearer <token>" http://localhost:3002/api/admin/backup/general -o backup.zip

# Actualizar
cd ~/.local/share/synnoxerp
git pull
pnpm install --prod
pm2 restart synnoxerp
```

## Estructura del proyecto

```
synnox-erp/
├── server.js              # Entry point unificado
├── .env                   # Variables de entorno (no subir a git)
├── package.json           # Dependencias raíz (v1.1.0)
├── install.sh             # Instalador automático
├── SECURITY.md            # Documentación CVEs
├── ARCHITECTURE.md        # Arquitectura del sistema
├── AGENTS.md              # Contexto para AI agents
├── framework/
│   ├── base.css           # CSS compartido (sidebar, layout, filtros)
│   ├── framework.js       # JS compartido (sidebar, auth, filtros)
│   ├── auth.mjs           # Auth compartida (ESM)
│   └── README.md          # Guía para crear módulos
├── launcher/
│   ├── server.js          # Launcher backend
│   └── shell/             # Frontend launcher
├── media/
│   └── LogoERP.png        # Logo del ERP
└── modules/
    ├── proveedores/       # Facturas y proveedores
    ├── logistica/         # Rutas y pedidos
    ├── nomina/            # Horas extra y calendario
    └── proyectos/         # Gestión de proyectos y actas
```

## Changelog v1.1.0

### Features
- **Calendario de nómina** — Fechas límite configurables por tipo de período
- **Actas de cierre** — Generación y exportación a PDF de actas de proyecto
- **Backup general** — Endpoint para respaldar todos los módulos en un solo ZIP
- **Filtros dinámicos** — CSS y JS reutilizable para tablas
- **Sedes centralizadas** — Módulos consumen centros desde el launcher
- **Logout seguro** — Server-side cookie clearing para httpOnly

### Fixes
- **Logística restore** — Ahora restaura las 6 tablas correctamente
- **Logout módulos** — Cookie httpOnly ahora se limpia correctamente
- **Nómina backup** — Restore incluye fecha_limite y aprobacion_pendiente
- **Framework logout** — Todas las copias de framework.js actualizadas

### Security
- **Server-side logout** — Endpoint POST /api/auth/logout + GET /logout
- **Backup pre-import** — Backup automático antes de restaurar datos

## Licencia

Privado — Kernel-Panic92 © 2026
