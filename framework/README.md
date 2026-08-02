# SynnoxERP Framework — Crear un nuevo módulo desde cero

## Estructura del proyecto

```
modulo/
├── backend/
│   ├── server.js          ← Express: API + estáticos + MCP
│   ├── config/
│   │   └── db.js          ← Conexión a DB
│   ├── routes/
│   │   └── *.js           ← Rutas API
│   └── mcp/
│       └── index.js       ← MCP server (JSON-RPC 2.0)
├── public/
│   ├── index.html         ← Frontend SPA
│   ├── base.css           ← Copiado de framework/base.css
│   ├── framework.js       ← Copiado de framework/framework.js
│   └── js/
│       └── app.js         ← Lógica del frontend
└── AGENTS.md              ← Contexto del proyecto
```

## 1. Frontend — Sidebar (obligatorio)

Todos los módulos usan el mismo sidebar. Copiar `base.css` y `framework.js` del directorio `framework/` al `public/` del módulo.

### HTML mínimo del sidebar

```html
<link rel="stylesheet" href="base.css">
<!-- ... -->
<div class="sidebar-overlay" onclick="closeSidebar()"></div>

<aside class="sidebar" id="sidebar">
  <div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>
  <div class="logo">📦 <span>Mi Módulo</span></div>
  <div class="user-info">
    <div class="name" id="user-name"></div>
    <div class="role" id="user-role"></div>
    <span class="badge" id="user-badge"></span>
  </div>
  <nav id="sidebar-nav">
    <div class="nav-item active" data-page="dashboard" onclick="navigate('dashboard')">
      <span class="icon">📊</span> Dashboard
    </div>
    <div class="nav-item" data-page="items" onclick="navigate('items')">
      <span class="icon">📋</span> Items
    </div>
  </nav>
  <div class="sidebar-footer">
    <a class="sidebar-home" href="/"><span class="icon">🏠</span> <span>Home</span></a>
    <div class="user-name" id="sidebar-user-name"></div>
    <div class="user-role" id="sidebar-user-role"></div>
    <div class="version">
      <div id="app-version">v—</div>
    </div>
    <button class="btn-logout" onclick="mostrarLogoutConfirm()" title="Cerrar sesion">
      <span style="font-size:18px">&#x23FB;</span> Cerrar sesion
    </button>
  </div>
</aside>
```

### Convenciones del sidebar

| Elemento | Clase/ID | Notas |
|----------|----------|-------|
| Sidebar | `<aside class="sidebar" id="sidebar">` | NO usar `<nav>` ni `<div>` |
| Overlay | `<div class="sidebar-overlay">` | Se muestra con `.show` |
| Toggle | `<div class="sidebar-toggle">` | Primer hijo del sidebar |
| Logo | `<div class="logo">` | `emoji <span>Nombre</span>` |
| User info | `<div class="user-info">` | `.name#user-name`, `.role#user-role`, `.badge#user-badge` |
| Nav container | `<nav id="sidebar-nav">` | Puede tener ítems estáticos o dinámicos |
| Nav items | `<div class="nav-item" data-page="xxx">` | `<span class="icon">emoji</span>` + texto |
| Footer | `<div class="sidebar-footer">` | Home link + `#sidebar-user-name` + `#sidebar-user-role` + `#app-version` + `.btn-logout` |
| Colapsado | `localStorage('sidebar_collapsed')` | Framework restaura en init |
| Theme | `themeKey: 'synnox_theme'` | Lee del launcher |

## 1.1 Layout y Grids — Convenciones obligatorias

### `.main` con sidebar fixed

Cuando `.sidebar` usa `position:fixed`, sale del flujo flex. `.main` como único hijo flex **se encoge al tamaño del contenido** sin las propiedades correctas.

**Siempre** agregar en el `<style>` del módulo:
```css
.main {
  padding: 24px 28px;
  flex: 1;
  min-width: 0;
  width: calc(100% - var(--sidebar-w));
}
```

En móvil (≤768px), sobreescribir:
```css
@media (max-width: 768px) {
  .main { margin-left: 0; width: 100%; }
}
```

### Grids responsive

Siempre usar `auto-fit` con `minmax()`:
```css
/* CORRECTO — se adapta al ancho disponible */
grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));

/* INCORRECTO — fijo, no se adapta */
grid-template-columns: 1fr 1fr;
grid-template-columns: repeat(3, 1fr);
```

**`auto-fit` vs `auto-fill`**:
- `auto-fit`: colapsa columnas vacías y estira items. Usar para pocos items (1-5).
- `auto-fill`: reserva columnas vacías. Usar solo cuando se necesitan slots vacíos.

### Tablas overflow

```css
/* CORRECTO — permite scroll horizontal */
.table-wrap { overflow-x: auto; }

/* INCORRECTO — recorta contenido sin scroll */
.table-wrap { overflow: hidden; }
```

### Skeleton loaders

Widgets que hacen fetch deben mostrar skeleton mientras cargan:
```css
.widget-skeleton {
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.skel-line {
  height: 14px;
  margin-bottom: 10px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--border) 25%, transparent 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: skel-pulse 1.5s infinite;
}
@keyframes skel-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

NO usar `display:none` en widgets — aparecen de golpe cuando llegan datos.

## 2. Frontend — JavaScript

```html
<script src="framework.js"></script>
<script src="js/app.js"></script>
```

En `app.js`:

```javascript
initFramework({
  basePath: '/mi-modulo',     // prefix si está detrás de proxy
  apiPrefix: '/api',
  themeKey: 'synnox_theme',   // SIEMPRE este valor
  tokenKey: 'mi-modulo_token',
  routes: {
    dashboard: () => cargarDashboard(),
    items: () => cargarItems(),
  }
});

// Cargar versión (framework.js loadVersion() lo hace automático)
// Solo implementar lógica específica del módulo
```

## 3. Backend mínimo

`backend/server.js`:

```javascript
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3008;

app.use(cors());
app.use(express.json());

// Auth
function verificarToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try { req.usuario = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token inválido' }); }
}

// Version — SIEMPRE leer de root package.json
app.get('/api/version', (req, res) => {
  try {
    const rootPkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    res.json({ version: rootPkg.version || '1.0.0', name: 'Mi Módulo' });
  } catch { res.json({ version: '1.0.0', name: 'Mi Módulo' }); }
});

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// MCP endpoint (sin auth — confianza local)
import { createMiddleware } from './mcp/index.js';
app.use('/mcp', createMiddleware());

// API routes
// app.use('/api/items', verificarToken, itemsRoutes);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Módulo escuchando en puerto ${PORT}`));
export default app;
```

## 4. Versión unificada

Todos los módulos leen `/api/version` del root `package.json`. **NUNCA** usar el `package.json` del módulo.

```javascript
// Backend
const rootPkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
res.json({ version: rootPkg.version });

// Frontend — framework.js loadVersion() lo hace automáticamente
// El resultado se muestra en #app-version como "v1.0.0"
```

## 5. MCP server

`backend/mcp/index.js` — copia el patrón de logistics:

```javascript
import pool from '../config/db.js';

const TOOLS = [
  {
    name: 'nombre_herramienta',
    description: 'Descripción',
    inputSchema: { type: 'object', properties: { ... }, required: [...] }
  }
];

export function createMiddleware() {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { method, params, id } = req.body;

    let response;
    switch (method) {
      case 'initialize':
        response = { jsonrpc: '2.0', id, result: { protocolVersion: '0.1.0', capabilities: { tools: {} }, serverInfo: { name: 'mi-modulo', version: '1.0.0' } } };
        break;
      case 'ping':
        response = { jsonrpc: '2.0', id, result: {} };
        break;
      case 'tools/list':
        response = { jsonrpc: '2.0', id, result: { tools: TOOLS } };
        break;
      case 'tools/call':
        try {
          const result = await ejecutarTool(params.name, params.arguments || {});
          response = { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
        } catch (err) {
          response = { jsonrpc: '2.0', id, error: { code: -32000, message: err.message } };
        }
        break;
      default:
        response = { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
    res.json(response);
  };
}

async function ejecutarTool(name, args) {
  // Implementar handlers por tool
  throw new Error(`Tool not implemented: ${name}`);
}
```

**Requisitos del MCP:**
- Sin autenticación (la confianza es local)
- JSON-RPC 2.0 (campos: `jsonrpc`, `id`, `method`, `params`)
- Implementar: `initialize`, `ping`, `tools/list`, `tools/call`
- Tool names en snake_case, español
- El gateway de la plataforma prefija las tools con `{module_id}_`

## 6. Registrar en la plataforma

Ejecuta este script (adaptando valores):

```bash
cd ~/.local/share/synnoxerp/launcher
node -e "
const Database = require('better-sqlite3');
const db = new Database('launcher.db');
db.prepare(\`INSERT OR REPLACE INTO modulos_plataforma
  (id, nombre, descripcion, url, icon, mcp_enabled, activo, orden, proxy_prefix, tipo)
  VALUES (?, ?, '', ?, '📦', 1, 1, 0, ?, 'externo')\`)
  .run('mi-modulo', 'Mi Módulo', 'http://localhost:3008', '/mi-modulo/');
console.log('Registrado');
"
```

O desde Admin UI: `https://dominio:9443` → Módulos → Agregar.

## 7. Nginx

Agrega el location block en el server del puerto que corresponda:

```nginx
location /mi-modulo/ {
    proxy_pass http://127.0.0.1:3008/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 8. initFramework options

| Opción | Default | Descripción |
|--------|---------|-------------|
| `apiPrefix` | `/api` | Prefijo para llamadas API |
| `basePath` | `''` | Base path cuando el módulo está detrás de proxy prefix |
| `tokenKey` | `'hf_token'` | Clave en localStorage para el token |
| `themeKey` | `'synnox_theme'` | **SIEMPRE usar este valor** — lee tema del launcher |
| `routes` | `{}` | Mapa de páginas `{ dashboard: fn, items: fn }` |
| `themePages` | `['dashboard']` | Páginas que muestran toggle de tema |

## 9. PM2

```bash
pm2 start ~/.local/share/synnoxerp/mi-modulo/backend/server.js --name mi-modulo
pm2 save
```

## Convenciones

- Puerto: 3000 + offset (próximo disponible)
- PM2 name: nombre corto del módulo
- MCP sin auth (confianza local)
- DB: PostgreSQL con schema propio o SQLite local
- Tool names en snake_case, español
- AGENTS.md en la raíz del proyecto con contexto
- Versión: SIEMPRE de root `package.json`, NO del módulo
- Sidebar: SIEMPRE `base.css` + `framework.js`, NO CSS inline
- Theme: SIEMPRE `synnox_theme`, NO key propia del módulo
- **Sedes/Centros**: Usar `loadCentros()` del framework (lee de `GET /api/centros`, caché en `HF.centros`). NO crear tablas locales de centros. Launcher es fuente única de verdad. Nombre en sidebar: SIEMPRE "Centros de operación" con icono 🏢.
- **Logout**: Usar `window.location.href = '/logout'` (server-side cookie clearing). NO usar `document.cookie` (httpOnly).
- **Filtros**: Usar `.table-filters` + `initTableFilters()` del framework. Ver CSS en `base.css`.
- **Modales**: Usar `abrirModal(titulo, desc, body, actions)` y `cerrarModal()` del framework.
- **Confirmaciones**: Usar `confirmarModal(titulo, mensaje)` del framework. NO usar `confirm()` del navegador.
- **Toasts**: Usar `toast(msg, type)` del framework para feedback.
- **Backups**: Cada módulo debe tener `GET /api/backup` (export) y `POST /api/backup/restore` (import). Usar ZIP con `backup.json` + CSVs.
