# Horix Platform — Contexto del proyecto

> **Propósito de este archivo**: Mantener el contexto de la conversación entre sesiones de opencode. Al iniciar una nueva sesión, opencode lee este archivo para retomar el estado del proyecto sin perder el hilo. Debe reflejar siempre la realidad actual del código.

## ¿Qué es?
Plataforma de orquestación de módulos ERP independientes. Cada módulo (DocFlow, Horix, WordPress, etc.) tiene su propio backend, frontend y MCP server. El Launcher orquesta todo: registro de módulos, health checks, generación de nginx y MCP Gateway unificado.

## Arquitectura

```
Claude Web / Desktop
       │ (única conexión MCP)
       ▼
┌─────────────────────────────┐
│   Horix-Platform Launcher   │  (puerto 3002)
│   MCP Gateway               │
│   SQLite: launcher.db       │
│   - modulos_plataforma      │
│   - usuarios                │
│   - config                  │
└──────┬──────────┬───────────┘
       │ MCP      │ HTTP Proxy
       ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  DocFlow │ │  Horix   │ │WordPress │
│  :3100   │ │  :3000   │ │  :3006   │
└──────────┘ └──────────┘ └──────────┘
```

## Estructura del repositorio

```
horix-platform/
├── launcher/           ← Servidor principal Express + SQLite
│   ├── server.js       ← 1001 líneas: auth, módulos CRUD, MCP gateway, nginx gen
│   ├── mail.js         ← Helper SMTP (nodemailer)
│   ├── modules.json    ← Seed/backup de módulos
│   └── shell/          ← Frontend SPA (shell + app.js + config)
├── nginx/              ← Configs de referencia
│   ├── platform-test.conf   ← Puerto 8445
│   └── platform-prod.conf   ← Puerto 443
├── wordpress-mcp/      ← Módulo WordPress (independiente)
│   └── server.js       ← 31 herramientas MCP (WordPress + WooCommerce + Site Kit Analytics)
├── AGENTS.md           ← Este archivo
├── config.env.example
├── install.sh
├── README.md
└── ROADMAP.md
```

## MCP Gateway (server.js ~línea 684-776)

### Cómo funciona
- Unifica todas las herramientas MCP de los módulos registrados
- Prefija cada tool con el ID del módulo (ej: `docflow_listar_facturas`)
- El gateway maneja sesiones propias y mantiene sesiones individuales con cada módulo

### Métodos del gateway
| Método | Descripción |
|--------|-------------|
| `initialize` | Crea sesión gateway, devuelve protocolVersion |
| `ping` | Health check interno |
| `tools/list` | Agrega tools de TODOS los módulos con prefijo |
| `tools/call` | Enruta al módulo según prefijo del tool name |
| `notifications/*` | Silently accepted |

### Comunicación gateway ↔ módulos
- JSON-RPC 2.0 sobre HTTP POST a `{module.url}/mcp`
- Header `mcp-session-id` (sesión individual por módulo)
- Header opcional `Authorization: Bearer {mcp_token}`
- Timeouts: 5s initialize/list, 30s tools/call
- Auto-retry en error -32001 (sesión expirada)

## Cómo agregar un módulo

1. Crear el servidor con endpoint `/mcp` (JSON-RPC 2.0)
2. Implementar: `initialize`, `ping`, `tools/list`, `tools/call`
3. Ir al Admin → Módulos → Agregar:
   - **ID**: nombre corto (ej: `docflow`, `horix`)
   - **URL**: `http://localhost:{puerto}`
   - **Proxy Prefix**: `/{id}/` (para frontend vía nginx)
   - **MCP**: ✅ habilitado
4. Las tools aparecen automáticamente con prefijo `{id}_`

## Módulos actuales

| ID | Nombre | Puerto | Repo |
|----|--------|--------|------|
| `docflow` | DocFlow | 3100 | `C:\Git\docflow` |
| `horix` | Horix | 3000 | `C:\Git\Horix` |
| `wordpress` | WordPress | 3006 | `wordpress-mcp/` | 31 tools (+ Site Kit Analytics) |

## Desarrollo local

```bash
# Iniciar launcher
cd launcher
npm install
node server.js
# → http://localhost:3002

# Iniciar módulos (cada uno en su terminal)
cd ../C:\Git\docflow && npm run dev
cd ../C:\Git\Horix && node server.js
```

### Admin UI
- `http://localhost:3002` → Login: admin@horix.com / admin123
- Pestañas: Usuarios, Módulos, MCP, SMTP, Apariencia, Seguridad, Nginx, Actualizar, Servicios MCP

## Convenciones
- Los módulos NO deben requerir auth para su endpoint `/mcp` — la confianza es local
- El gateway maneja toda la autenticación hacia afuera
- Usar `mcp_token` por módulo solo si es necesario (opcional)
- Los tool names usan snake_case en español
- Errores MCP: código `-32001` = sesión inválida

# Launcher - SSH (pestaña Seguridad)
- Configuración SSH para reinicios remotos (Host + usuario)
- Guarda en DB de config del launcher (`ssh_host`, `ssh_user`)
- Botón "Probar conexión" que ejecuta `ssh user@host pm2 --version` para verificar
- El launcher usa SSH como tercer fallback en `pm2Exec()`: primero intenta `pm2`, luego `sudo pm2`, luego `ssh user@host sudo pm2`

## Pendientes
- [ ] Configurar llaves SSH desde Windows hacia servidor Linux para que los reinicios remotos funcionen desde el launcher
  - En Windows: `ssh-keygen -t ed25519`
  - En servidor: agregar la clave pública a `~/.ssh/authorized_keys`
  - Probar: `ssh root@host sudo pm2 list`
  - Luego configurar Host y Usuario en el admin del launcher (Seguridad → Conexión SSH)

# Launcher - Export/Import (pestaña Respaldo)
- Pestaña "Respaldo" en el admin del Launcher
- Export: `GET /api/admin/export` — descarga JSON con módulos, config (SMTP, SSH, etc.) y usuarios
- Import: `POST /api/admin/import` — sube JSON y restaura módulos, config y usuarios
- Útil para reinstalaciones o migraciones entre servidores

# Launcher - Servicios MCP (pestaña admin)
- Pestaña "Servicios MCP" en el admin del Launcher
- Muestra todos los módulos con MCP habilitado registrados en la plataforma
- Por cada módulo: health check (HTTP GET /health o /mcp), estado PM2, botón reiniciar, detalle con logs
- Rutas backend: `GET /api/admin/mcp-modules/status`, `POST /api/admin/mcp-modules/:id/restart`, `GET /api/admin/mcp-modules/:id/logs`
- Health check: primero intenta `/health`; si no responde OK, fallback a `/mcp`
- PM2 name mapping: `pm2Name()` traduce IDs de módulo a nombres PM2 (ej: `wordpress` → `wordpress-mcp`)
- URLs: `url` se usa para health check interno, `public_url` para mostrar en UI (evitar trailing slash en url)

# Launcher - Versión
- Versión actual: `1.0.0` (definida en `launcher/package.json`)
- Mostrada junto al nombre de usuario en el header del launcher y admin
- Endpoint: `GET /api/version` devuelve `{ v: SERVER_START, version: "1.0.0" }`

# Launcher - Dashboard
- Pantalla principal muestra tarjetas de todos los módulos registrados
- Cada tarjeta tiene borde de color según estado MCP: 🟢 verde (online), 🟡 amarillo (error), 🔴 rojo (offline)
- La tarjeta de Admin no tiene borde de estado
- Consulta `/api/admin/mcp-modules/status` en paralelo con `/api/modulos`
- Widget **Servidor** visible solo para admin: CPU (núcleos + carga %), RAM (usado/total + barra), disco (df -h), hostname, plataforma, Node.js, uptime

# Launcher - Updater (desde UI)
- Tab "Actualizar" en el admin del Launcher (pestañas: Usuarios, Módulos, MCP, SMTP, Apariencia, Seguridad, Nginx, **Actualizar**, Servicios MCP)
- Rutas backend: `GET /api/admin/updater/status`, `POST /api/admin/updater/check`, `POST /api/admin/updater/update`, `POST /api/admin/updater/restart`, `GET /api/admin/updater/logs`
- Ejecuta: `git fetch origin && git reset --hard origin/main` sobre `C:\Git\Horix-Platform`, `npm install --production` en `launcher/`
- Reinicia automáticamente `wordpress-mcp` y luego `horix-launcher` (o `horix-erp` como fallback) vía PM2
- El frontend muestra mensaje de reinicio y recarga la página a los 5 segundos
- Log en `launcher/logs/updater.log`
- Frontend: `shell/app.js` (funciones `loadUpdaterStatus`, `checkUpdate`, `doUpdate`, `loadUpdaterLogs`) y `shell/index.html` (`#tab-actualizar`)

## Regla obligatoria: mantener contexto sincronizado
En **cada sesión de opencode**, antes de finalizar, verificar y actualizar:
1. `C:\Git\Horix-Platform\AGENTS.md` — reflejar cualquier cambio significativo en la arquitectura, rutas, módulos, puertos, etc.
2. `C:\Git\Kernel-Panic92\README.md` — funciona como **bitácora personal**: agregar entrada con fecha y descripción de los cambios realizados en todos los repos (Horix-Platform, Horix, DocFlow, etc.)

Esto permite trabajar en múltiples instancias de opencode simultáneamente sin perder contexto.

# Horix Logistics - Nuevo módulo de logística y rutas

## ¿Qué es?
Módulo independiente de optimización de rutas y logística para Vitamar, con geocodificación, planificación de rutas vía OSRM, y mapa Leaflet.

**Repo:** `https://github.com/Kernel-Panic92/horix-logistics.git` (en `C:\Git\HorixLogistics`)
**Puerto:** 3004
**PM2 name:** logistics

## Features implementadas
- Autenticación JWT con rate limiter
- Importación SIESA PDF (parseo de planillas de cuadre con 3 líneas por registro: nombre / dos valores + FEV / ciudad+dir+tel)
- Importación Widetech Excel (históricos GPS)
- Geocodificación con Nominatim + caché en DB
- Optimización VRP (OSRM + Nearest Neighbor + 2-opt)
- Dashboard con estadísticas
- CRUD de vehículos, pedidos, clientes, rutas, usuarios
- Mapa Leaflet con rutas, paradas y posiciones de vehículos
- Configuración: SMTP, Backup ZIP, Seguridad, Auditoría, Mapas (Google API key), Actualizador
- Sidebar estilo Horix con versión, copyright, GitHub, logout con confirmación
- Clientes: card grid con avatar+iniciales, selección múltiple, búsqueda, pg_trgm fuzzy matching
- Pedidos: valor_contado + valor_credito + conductor + placa + nro_guia, búsqueda y filtro por estado
- Vehículos: búsqueda y filtro por estado
- Google Places Autocomplete en formulario cliente (con API key configurable en Mapas)
- Auto-creación de vehículo al importar SIESA si la placa no existe

## Updater
- Backend: `backend/routes/actualizador.js` (status, check, update, restart, logs)
- Auto-detecta la rama actual (master) en vez de hardcodear main
- Frontend: pestaña "Actualizar" en Configuración
- Endpoint `/api/health` para monitoreo de reinicio

## Herencia SMTP entre módulos
- El launcher expone `GET /api/smtp/internal` (sin auth, localhost) con la configuración SMTP
- Los módulos pueden heredar esta config activando `smtp_heredar = true` y apuntando `launcher_url` (default `http://localhost:3002`)
- Si el launcher no responde, cada módulo cae a su propia config SMTP local
- Frontend: checkbox "Heredar del Launcher" + campo URL del Launcher en la pestaña Correo de cada módulo
- ✅ Implementado en Horix Logistics, Horix y DocFlow

## Pendientes
- [ ] App móvil para conductores

## Horix Framework — Cómo crear un nuevo módulo desde cero

```
bash horix-erp/framework/init.sh /ruta/del/nuevo-modulo/public
```

Esto copia `base.css`, `components.css`, `framework.js`, `theme.js` y genera un `index.html` completo con login, sidebar, modales y forgot password.

### Estructura resultante
```
nuevo-modulo/public/
├── index.html          ← Base con login + app layout + modales
├── css/
│   ├── base.css        ← Variables, reset, layout, responsive
│   └── components.css  ← Botones, tablas, modales, cards, badges
└── js/
    ├── framework.js    ← initHorixFramework(), api(), toast(), confirmar(), navigate()
    └── theme.js        ← fetchTheme() desde el launcher (fallback silencioso)
```

### 1. Agregar páginas en el HTML
Dentro de `<div class="main-body">` en `index.html`:
```html
<div class="page active" id="page-dashboard">
  <div class="page-header"><h3>Dashboard</h3><p>Resumen</p></div>
  <div id="dash-content"></div>
</div>
<div class="page" id="page-items">
  <div class="page-header"><h3>Items</h3><p>Listado</p></div>
  <div id="items-content"></div>
</div>
```

### 2. Configurar navegación
En `<script>` después de `framework.js`:
```javascript
initHorixFramework({
  apiPrefix: '/api',
  tokenKey: 'app_token',
  themeKey: 'app_theme',
  themePages: ['dashboard'],
  routes: {
    dashboard: cargarDashboard,
    items: cargarItems,
  },
});

async function cargarDashboard() {
  const data = await api('/stats');
  document.getElementById('dash-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${data.total}</div></div>
    </div>`;
}
```

### 3. Sidebar nav-items
```html
<nav id="sidebar-nav">
  <div class="nav-item active" data-page="dashboard" onclick="navigate('dashboard')">
    <span class="icon">📊</span> Dashboard
  </div>
  <div class="nav-item" data-page="items" onclick="navigate('items')">
    <span class="icon">📦</span> Items
  </div>
</nav>
```

### 4. Backend mínimo
- Endpoints: `/api/auth/login`, `/api/auth/verificar` (JWT)
- Opcional: `/api/version`, `/api/health`
- Para herencia SMTP: tabla config con `smtp_heredar` + `launcher_url`; en mail utility fetch a `${launcher_url}/api/smtp/internal`

### 5. API disponibles (framework.js globales)
| Función | Descripción |
|---------|-------------|
| `api(path, opts)` | Fetch con auth, maneja 401 → logout |
| `esc(s)` | Escape HTML |
| `toast(msg, type, duration)` | Notificación. type: success/error/info |
| `abrirModal(titulo, desc, bodyHtml, accionesHtml)` | Modal genérico |
| `confirmar({ titulo, mensaje, icono, btnTxt, onConfirm })` | Confirmación con callback |
| `toggleAll(tipo, checked)` | Checkbox "Seleccionar todo" |
| `eliminarSeleccionados(tipo, endpoint)` | Bulk delete |
| `setLoading(elId, loading)` | Loading state en botones |
| `navigate(page)` | Cambiar página activa (.page + .nav-item) |
| `toggleTheme()` | Light/dark mode |

### Reglas
- Sin dependencia runtime del launcher — `theme.js` fallback a defaults CSS
- Módulos existentes NO se modifican — framework solo para nuevos
- Cada módulo puede sobreescribir variables CSS en su `<style>` después de components.css
- Funciones son globales (window) para compatibilidad HTML inline

# Horix - Detalles del Módulo

## Configuración (UI)
- Sidebar tiene un solo item "Configuración" que navega a `#configuracion`
- Layout tipo DocFlow: tabs con botones `.fb` (activo tiene clase `.active`)
- Tabs: Correo, Backup, Seguridad, Auditoría, Permisos, **Telemetría**, Actualizar
- Módulo frontend: `public/js/modules/configuracion.js` — reemplaza smtp.js, backup.js, security.js, auditoria.js, permisos.js, telemetry.js
- Backend: `src/routes/configuracion.js` montado en `/api/configuracion`
- Admin default: admin@horix.com / admin123

## Updater (desde UI)
- Rutas backend: `/api/configuracion/updater/{status,check,update,restart,logs}`
- Ejecuta: `git fetch origin && git reset --hard origin/main`, `npm install --production`, `sudo pm2 restart horix`
- Log en `logs/updater.log`

## Telemetría
- Tab en configuración que muestra dashboard con: totales de eventos, páginas más visitadas (30d), errores JS, eventos recientes, errores backend
- Backend: `GET /api/telemetry/dashboard` (solo admin), `POST /api/telemetry`
- Frontend: `public/js/modules/telemetry.js` con `cargarDiagnostico()` y `renderDiagnostico()`

# Última sesión — 2026-06-19

## SMTP layout unification
Se replicó el estilo card (max-width:600px, form-grid) de Logistics a DocFlow y Horix:
- **DocFlow**: ya tenía layout similar, ajustes menores
- **Horix**: se reemplazó layout inline por card con form-grid; se agregó card separada "Template" para configuración de plantilla
- **Logistics**: ya tenía el patrón, se dejó igual

## Plantillas de Correo centralizadas (Launcher)
- Tabla `plantillas_correo` en `launcher.db` (SQLite)
- CRUD: `GET/PUT/DELETE /api/plantillas` (admin), `GET /api/plantillas/internal` (sin auth, para módulos)
- Admin UI: tab "📝 Plantillas" con selector de módulo, tipo, asunto, cuerpo_html

### Herencia de plantillas en módulos
Cada módulo obtiene plantillas del Launcher si `plantilla_heredar=1`:

| Módulo | Archivo backend | Archivo frontend | Checkbox |
|--------|----------------|-----------------|----------|
| Logistics | `modules/logistics/.../email.js` | config.html (in-page) | En card SMTP |
| Horix | `server/src/services/email.js` | `public/js/modules/configuracion.js` | Card separada "Template" |
| DocFlow | `src/services/smtp.service.js` | `public/js/modules/config.js` | En card SMTP |

### Patrón de implementación
```javascript
async function obtenerPlantilla(tipo) {
  const cfg = await getConfig();
  if (cfg.plantilla_heredar !== '1') return null;
  const url = (cfg.launcher_url || 'http://localhost:3002').replace(/\/+$/, '');
  const res = await fetch(`${url}/api/plantillas/internal?modulo=ID&tipo=${tipo}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const p = await res.json();
  return { asunto: p.asunto, cuerpo_html: p.cuerpo_html };
}
// Luego: html.replace(/{nombre}/g, u.nombre).replace(/{enlace}/g, link).replace(/{empresa}/g, empresa)
```

### Decisiones clave
- `plantilla_heredar` es flag separado de `smtp_heredar` (cada módulo decide)
- Internal endpoint no requiere auth (solo accesible desde red interna)
- Placeholders: `{nombre}`, `{enlace}`, `{empresa}` — reemplazados server-side
- Fallback: si launcher no responde o no hay template, se usa la plantilla hardcodeada existente
- Horix tiene card separada "Template" en el tab SMTP (distinto de Logistics/DocFlow que lo embeben inline)


