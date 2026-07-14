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
│   └── js/
│       ├── framework.js   ← Copiado de framework/
│       └── app.js         ← Lógica del frontend
└── AGENTS.md              ← Contexto del proyecto
```

## 1. Frontend

Usa `init.sh` para copiar la base:

```bash
bash framework/init.sh /ruta/del/modulo/public
```

Esto copia `base.css`, `components.css`, `framework.js`, `theme.js` y genera `index.html`.

## 2. Backend mínimo

`backend/server.js`:

```javascript
import express from 'express';
import cors from 'cors';
import path from 'path';
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

## 3. MCP server

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

## 4. Registrar en la plataforma

Ejecuta este script (adaptando valores):

```bash
cd /opt/synnoxerp/launcher
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

## 5. Nginx

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

## 6. initFramework options

| Opción | Default | Descripción |
|--------|---------|-------------|
| `apiPrefix` | `/api` | Prefijo para llamadas API |
| `basePath` | `''` | Base path cuando el módulo está detrás de proxy prefix |
| `tokenKey` | `'hf_token'` | Clave en localStorage para el token |
| `themeKey` | `'hf_theme'` | Clave en localStorage para el tema |
| `routes` | `{}` | Mapa de páginas `{ dashboard: fn, items: fn }` |

Si el módulo se sirve desde un proxy prefix (ej: `:9443/mi-modulo/`), pasar `basePath: '/mi-modulo'` para que las API calls apunten a `/mi-modulo/api/...`.

## 7. PM2

```bash
pm2 start /opt/synnoxerp/mi-modulo/backend/server.js --name mi-modulo
pm2 save
```

## Convenciones

- Puerto: 3000 + offset (próximo disponible)
- PM2 name: nombre corto del módulo
- MCP sin auth (confianza local)
- DB: PostgreSQL con schema propio o SQLite local
- Tool names en snake_case, español
- AGENTS.md en la raíz del proyecto con contexto
