# Horix Platform

Modular ERP platform with independent micro-frontends. Each module has its own auth, frontend, and MCP server. The **launcher** orchestrates them all — CRUD, health checks, nginx config generation, and MCP gateway.

## Current Architecture (production)

```
FQDN: horixvitamar.fortiddns.com
SSL:  Let's Encrypt

Port 443 ─── Horix (Express :3000)
  ├── location /          → static files (root + try_files)
  ├── location /api/      → proxy_pass :3000
  ├── location /mcp       → proxy_pass :3000
  └── location /logistics → proxy_pass :3004 (via horix nginx)

Port 9443 ─── Launcher (Express :3002)
  ├── location /          → proxy_pass :3002
  ├── location /logistics → proxy_pass :3004
  └── location /wordpress → proxy_pass :3006
```

| Module | Internal | HTTPS | PM2 name | Repo |
|--------|----------|-------|----------|------|
| **Horix** | 3000 | 443 | `horix` | `https://github.com/Kernel-Panic92/Horix` |
| **Launcher** | 3002 | 9443 | `horix-launcher` | `https://github.com/Kernel-Panic92/horix-erp` |
| **Logistics** | 3004 | 9443 | `logistics` | `https://github.com/Kernel-Panic92/horix-logistics` |
| **WordPress MCP** | 3006 | 9443 | `wordpress-mcp` | `wordpress-mcp/` |

## Quick Start

```bash
git clone https://github.com/Kernel-Panic92/horix-erp.git
cd horix-erp
sudo bash install.sh prod
# O para pruebas locales:
sudo bash install.sh test
```

## Update

```bash
sudo git -C /opt/horix-platform pull
sudo npm install --prefix /opt/horix-platform/launcher
sudo pm2 restart horix-launcher
```

## MCP (Model Context Protocol)

The launcher provides a unified MCP gateway compatible with Claude Desktop and Claude Web. Tools are prefixed by module (`horix_*`, `docflow_*`).

### URLs

| URL | Puerto | Uso |
|-----|--------|-----|
| `https://dominio:9443/mcp` | 9443 | Directo al gateway (recomendado) |
| `https://dominio/mcp-gateway/mcp` | 443 | Alternativa vía nginx (firewalls restrictivos) |

### OAuth

Deshabilitado por defecto. Para habilitarlo:

```bash
sudo sqlite3 /opt/horix-platform/launcher/launcher.db \
  "UPDATE config SET value='true' WHERE key='mcp_oauth_enabled'"
sudo pm2 restart horix-launcher
```

### Windows TLS workaround (FortiGate)

Algunos firewalls corporativos rompen el handshake TLS en puertos no estándar con Windows. Solución: agregar en el nginx del puerto 443:

```nginx
location /mcp-gateway/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 300s;
}
```

Luego usar `https://dominio/mcp-gateway/mcp` sin OAuth fields.

## WordPress MCP

Integración con WordPress vía REST API + Application Password.

### Setup

```bash
# 1. Instalar dependencias
cd /opt/horix-platform/wordpress-mcp
npm install
sudo npm install -g pm2  # si no está instalado

# 2. Crear .env con credenciales
cat > .env <<EOF
PORT=3006
WP_URL=https://tusitio.com
WP_USER=admin
WP_APP_PASS=xxxx xxxx xxxx xxxx xxxx xxxx
EOF

# 3. Iniciar servicio
pm2 start server.js --name wordpress-mcp
pm2 save

# 4. Registrar en el Launcher
# Admin → Módulos → Agregar módulo:
#   Nombre: WordPress
#   URL: http://localhost:3006
#   Proxy Prefix: /wordpress
#   MCP: ✅ habilitado
```

Las herramientas aparecerán en el gateway con prefijo `wordpress_*` (ej: `wordpress_listar_posts`).

### Herramientas disponibles

| Tool | Descripción |
|------|-------------|
| `wordpress_listar_posts` | Lista posts con filtros (estado, búsqueda, categoría) |
| `wordpress_obtener_post` | Obtiene un post por ID |
| `wordpress_crear_post` | Crea un nuevo post (requiere confirmación) |
| `wordpress_actualizar_post` | Actualiza un post existente (requiere confirmación) |
| `wordpress_eliminar_post` | Envía un post a papelera (requiere confirmación) |
| `wordpress_listar_paginas` | Lista páginas |
| `wordpress_obtener_pagina` | Obtiene una página por ID |
| `wordpress_listar_categorias` | Lista categorías |
| `wordpress_listar_etiquetas` | Lista etiquetas |
| `wordpress_listar_medios` | Lista archivos multimedia |
| `wordpress_buscar` | Busca en todo el sitio |
| `wordpress_estadisticas` | Estadísticas generales del sitio |

### Application Password

1. En WordPress: Usuarios → Perfil → **Application Passwords**
2. Crear una nueva contraseña (ej: "Claude MCP")
3. Copiar el string y ponerlo en `WP_APP_PASS`

## Features

- **Auth**: login JWT por módulo (independiente), roles admin/operador
- **Nginx Generator**: Admin → Nginx → genera config con prefixes de módulos
- **Password Recovery**: SMTP configurable desde Admin, reset links con 1h de expiración
- **SMTP Config**: Admin → SMTP, con botón de prueba
- **MCP Gateway**: sesiones por módulo, auto-retry, health checks
- **WordPress MCP**: CRUD de contenido vía REST API + Application Password
- **Responsive**: mobile-friendly (max-width 640px)

## Config

`/opt/horix-platform/config.env`:

```env
MODE=prod
DOMAIN=horix.app
LAUNCHER_PORT=3002
MCP_PORT=9443
INSTALL_DIR=/opt/horix-platform
```

## Nginx

Editar los módulos desde Admin → Módulos, definir `URL` y `Proxy Prefix`. Luego Admin → Nginx → "Generar y recargar".

### Ports

| Service | Internal | HTTPS |
|---------|----------|-------|
| Horix API | 3000 | 443 |
| Launcher | 3002 | 9443 |
| DocFlow | 3005 | 9442 |

## Creating a new module

See [`framework/README.md`](framework/README.md) for the complete guide: backend boilerplate, MCP implementation, registration, Nginx, and PM2 setup.

## Clean Install Guide (new server)

When migrating to a new server, this is the **ideal architecture** with a single HTTPS port and path-based routing:

### Ideal Architecture

```
Port 443 ─── Nginx (single SSL termination)
  ├── location /horix/      → proxy_pass :3000
  ├── location /launcher/   → proxy_pass :3002
  ├── location /logistics/  → proxy_pass :3004
  ├── location /wordpress/  → proxy_pass :3006
  └── location /crm/        → proxy_pass :3008   (future)
```

**No port 9443 needed.** All modules live under `/prefix/`, each one handles its own static files via Express (`express.static`) or Nginx `alias`.

### Migration Steps

1. **Install dependencies**
   ```bash
   apt update && apt install -y nginx postgresql nodejs npm pm2 certbot
   ```

2. **Clone all repos**
   ```bash
   mkdir -p /opt/horix-platform
   cd /opt/horix-platform
   git clone https://github.com/Kernel-Panic92/horix-erp.git launcher
   git clone https://github.com/Kernel-Panic92/horix-logistics.git logistics
   git clone https://github.com/Kernel-Panic92/Horix.git horix
   ```

3. **Install dependencies per module**
   ```bash
   for dir in launcher logistics horix; do
     cd /opt/horix-platform/$dir && npm install
   done
   ```

4. **Register in launcher DB**
   ```bash
   cd /opt/horix-platform/launcher
   node -e "
   const Database = require('better-sqlite3');
   const db = new Database('launcher.db');
   const modules = [
     {id:'horix', nombre:'Horix', url:'http://localhost:3000', prefix:'/horix/'},
     {id:'logistics', nombre:'Logistics', url:'http://localhost:3004', prefix:'/logistics/'},
     {id:'wordpress', nombre:'WordPress', url:'http://localhost:3006', prefix:'/wordpress/'},
   ];
   for (const m of modules) {
     db.prepare(\`INSERT OR REPLACE INTO modulos_plataforma
       (id, nombre, descripcion, url, icon, mcp_enabled, activo, orden, proxy_prefix, tipo)
       VALUES (?, ?, '', ?, '📦', 1, 1, 0, ?, 'externo')\`).run(m.id, m.nombre, m.url, m.prefix);
   }
   console.log('Modules registered');
   "
   ```

5. **Generate Nginx config from Admin UI**
   - Start launcher: `pm2 start server.js --name horix-launcher`
   - Open `http://localhost:3002` → Admin → Nginx → **Generate** → **Apply**
   - This auto-generates location blocks for all registered modules

6. **Obtain SSL certificate**
   ```bash
   certbot certonly --nginx -d tudominio.com
   ```

7. **Adjust generated Nginx**
   - The generated config from step 5 will have the correct location blocks
   - Set `ssl_certificate` / `ssl_certificate_key` to Let's Encrypt paths
   - Ensure `location /` serves the launcher

8. **Start all modules with PM2**
   ```bash
   pm2 start /opt/horix-platform/horix/server.js --name horix
   pm2 start /opt/horix-platform/logistics/backend/server.js --name logistics
   pm2 start /opt/horix-platform/launcher/server.js --name horix-launcher
   pm2 save
   pm2 startup
   ```

### Notes

- The launcher **must** run for modules to be discoverable via MCP Gateway
- Each module's `/mcp` endpoint does NOT need auth (trusted internal network)
- The gateway prefixes tools with module ID: `logistics_dashboard`, `horix_empleados`, etc.
- The DB (`launcher.db`) with `modulos_plataforma` table is the **source of truth** for which modules exist
