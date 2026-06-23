# Horix Platform — Contexto del proyecto

> **Propósito de este archivo**: Mantener el contexto de la conversación entre sesiones de opencode.

## ¿Qué es?
Plataforma de orquestación de módulos ERP independientes. Cada módulo tiene su propio backend, frontend y MCP server. El Launcher orquesta todo. Todos los módulos comparten JWT (auth centralizada).

**Monorepo**: `https://github.com/Kernel-Panic92/horix-erp` (branch activa: `refactor/monorepo-auth`)

**PM2 name**: `horix-erp` (antes `horix-launcher`)

## Estructura del repositorio

```
horix-erp/
├── installer/          ← Wizard de instalación web (GLPI-like)
│   ├── server.js       ← Express temporal en puerto 3001
│   └── public/
│       ├── index.html  ← 7 pasos: requisitos, DB, admin, módulos, review, install, complete
│       └── app.js      ← Lógica del wizard
├── framework/
│   ├── auth.js         ← verifyToken + requireModule(moduleId) — compartido por módulos internos
│   ├── base.css        ← Variables, reset, layout
│   ├── components.css  ← Botones, tablas, modales
│   ├── framework.js    ← initHorixFramework(), api(), navigate()
│   └── theme.js        ← fetchTheme() desde el launcher
├── launcher/           ← Servidor principal Express + SQLite
│   ├── server.js       ← Auth, módulos CRUD, MCP gateway, nginx gen, updater
│   ├── mail.js         ← Helper SMTP
│   ├── modules.json    ← Seed/backup de módulos
│   └── shell/          ← Frontend SPA
├── modules/
│   ├── logistics/      ← Rutas VRP, vehículos, pedidos, clientes, sedes (auth interna)
│   └── docflow/        ← Facturas, proveedores, flujo aprobación (auth interna)
├── nginx/              ← Configs de referencia
├── install.sh          ← Instalador CLI (legacy, usar el wizard web)
├── AGENTS.md
└── README.md
```

## Instalación

### Wizard web (recomendado)
```bash
sudo node installer/server.js
# Abrir http://<IP_VM>:3001
```
Pasos:
1. Verifica requisitos (Node ≥20, PostgreSQL, Git, PM2, Nginx)
2. Configura DB (auto-crea usuario y databases)
3. Admin credentials
4. Selección de módulos: logistics, docflow, horix
5. Opción "Instalación limpia" (requiere escribir CONFIRMAR)
6. Instalación con logs en vivo vía SSE
7. Pantalla final con URLs, credenciales y DB password

### Características del instalador
- Auto-detecta IP de la VM y pre-rellena el campo Dominio
- Si no se especifica DB password, genera una aleatoria y la muestra al final
- Actualiza Node.js a v20 automáticamente
- Reconstruye addons nativos (`npm rebuild`) tras upgrade de Node
- Sincroniza password PostgreSQL con ALTER USER
- Registra módulos vía API del launcher (con retry hasta 30s)
- Configura Nginx con SSL autofirmado + path prefixes

## Arquitectura

```
Claude Web / Desktop → Launcher (MCP Gateway) → Módulos (MCP internos)
Navegador → Nginx (443) → / → launcher:3002
                          /logistics/ → logistics:3004
                          /docflow/ → docflow:3100
                          /horix/ → horix:3000
```

## Módulos

| ID | Nombre | Puerto | Tipo | DB | Estado |
|----|--------|--------|------|----|--------|
| `launcher` | Horix ERP | 3002 | — | SQLite | ✅ |
| `logistics` | Logística | 3004 | Interno | PostgreSQL | ✅ |
| `docflow` | DocFlow | 3100 | Interno | PostgreSQL | ✅ |
| `horix` | Horas Extra | 3000 | Externo | SQLite | ✅ (separado) |

## Auth centralizada
- Launcher tiene el login único
- JWT_SECRET compartido entre launcher y módulos internos
- JWT incluye `modulos[]` — lista de módulos permitidos para el usuario
- `GET /api/auth/me` devuelve `modulos[]`
- `GET /api/modulos` filtra por permisos (admins ven todo)
- Tabla `user_modulos` en SQLite del launcher (asignación módulo ↔ usuario)
- Módulos internos NO tienen login propio — leen cookie `launcher_jwt`

## MCP Gateway
- Unifica herramientas MCP de todos los módulos registrados
- Prefija tools con ID del módulo (ej: `logistics_listar_vehiculos`)
- Endpoint único: `POST /mcp` (JSON-RPC 2.0)
- Sin auth en endpoint MCP (confianza local)

## Pendientes

### Instalador
- [ ] Unity: migrar Horix de SQLite a PostgreSQL
- [ ] Opción de backup previo antes de clean install
- [ ] Probar en VM con IP real (no localhost)

### Arquitectura
- [ ] Unificar usuarios/roles centralizadamente en el launcher
- [ ] Configuración unificada (cada módulo expone schema, launcher renderiza)
- [ ] Mover wordpress-mcp a modules/ (?)

### Horix (migración a PG)
- [ ] Crear `src/db/pg-index.js` (pool de conexión)
- [ ] Adaptar queries SQLite → PostgreSQL en todas las rutas
- [ ] Script `scripts/migrate-to-pg.js` (lee SQLite, escribe en PG)
- [ ] Probar backup/restore con PostgreSQL

## Servidor de producción (actual)
```
FQDN: horixvitamar.fortiddns.com
PM2:
  horix          :3000  (/home/coordinadorsistemas/horix)
  horix-launcher :3002  (/opt/horix-platform/launcher)
  logistics      :3004  (/opt/horix-platform/logistics)
  wordpress-mcp  :3006  (/opt/horix-platform/wordpress-mcp)
SSL: Let's Encrypt
```
