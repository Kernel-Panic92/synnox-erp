# Horix Platform — Contexto del proyecto

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
│   ├── server.js       ← 923 líneas: auth, módulos CRUD, MCP gateway, nginx gen
│   ├── mail.js         ← Helper SMTP (nodemailer)
│   ├── modules.json    ← Seed/backup de módulos
│   └── shell/          ← Frontend SPA (shell + app.js + config)
├── nginx/              ← Configs de referencia
│   ├── platform-test.conf   ← Puerto 8445
│   └── platform-prod.conf   ← Puerto 443
├── wordpress-mcp/      ← Módulo WordPress (independiente)
│   └── server.js       ← 25 herramientas MCP para WordPress
├── AGENTS.md           ← Este archivo
├── config.env.example
├── install.sh
├── README.md
└── ROADMAP.md
```

## MCP Gateway (server.js ~línea 628-775)

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
| `wordpress` | WordPress | 3006 | `wordpress-mcp/` |

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
- Pestañas: Dashboard, Módulos, Nginx, SMTP, Seguridad

## Convenciones
- Los módulos NO deben requerir auth para su endpoint `/mcp` — la confianza es local
- El gateway maneja toda la autenticación hacia afuera
- Usar `mcp_token` por módulo solo si es necesario (opcional)
- Los tool names usan snake_case en español
- Errores MCP: código `-32001` = sesión inválida

## Recordatorio post-cambio
- Después de cada cambio significativo en cualquier módulo (Horix, DocFlow, Platform, etc.), actualizar:
  - `C:\Git\Kernel-Panic92\README.md` (perfil personal — sección "Últimas features")
  - `C:\Git\Horix-Platform\AGENTS.md` (contexto del proyecto)

# Horix - Detalles del Módulo

## Configuración (UI)
- Sidebar tiene un solo item "Configuración" que navega a `#configuracion`
- Layout tipo DocFlow: tabs con botones `.fb` (activo tiene clase `.active`)
- Tabs: Correo, Backup, Seguridad, Auditoría, Permisos, Actualizar
- Módulo frontend: `public/js/modules/configuracion.js` — reemplaza smtp.js, backup.js, security.js, auditoria.js, permisos.js, telemetry.js
- Backend: `src/routes/configuracion.js` montado en `/api/configuracion`
- Admin default: admin@horix.com / admin123

## Updater (desde UI)
- Rutas backend: `/api/configuracion/updater/{status,check,update,restart,logs}`
- Ejecuta: `git fetch origin && git reset --hard origin/main`, `npm install --production`, `pm2 restart horix`
- Log en `logs/updater.log`

## MCP Gateway
- `C:\Git\Horix-Platform\launcher\server.js` — MCP Gateway en líneas ~628-775
- Prefija tools con ID del módulo (ej: `horix_listar_registros`)
- Comunicación JSON-RPC 2.0 vía HTTP POST a `{module.url}/mcp`
- Header `mcp-session-id` para sesiones individuales por módulo
- Timeouts: 5s list, 30s call. Auto-retry en -32001

## Módulos registrados en Platform (C:\Git\Horix-Platform)
| ID | Nombre | Puerto | Repo |
|----|--------|--------|------|
| `docflow` | DocFlow | 3100 | `C:\Git\docflow` |
| `horix` | Horix | 3000 | `C:\Git\Horix` |
| `wordpress` | WordPress | 3006 | `wordpress-mcp/` |
