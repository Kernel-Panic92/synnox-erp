# SynnoxERP — Arquitectura del Sistema

> Documento de referencia para desarrollo, mantenimiento y escalabilidad.
> Última actualización: 28 Ago 2026 — v2.4.1

---

## 1. Visión General

SynnoxERP es un sistema ERP modular de uso interno diseñado para gestión de:
- **Nómina**: Horas extras, aprobaciones, reportes SIESA, calendario con fechas límite
- **Proveedores**: Facturas electrónicas DIAN, flujo de aprobación, sincronización IMAP
- **Logística**: Rutas optimizadas, pedidos, vehículos, clientes, devoluciones
- **Proyectos**: Gestión de proyectos, tareas, tablero Kanban, actas de cierre, miembros, archivo
- **CRM**: Pipeline de ventas, clientes, cotizaciones, leads, visitas de campo, integración SIESA

### Capacidades Transversales

| Capacidad | Estado |
|-----------|--------|
| Autenticación JWT + OAuth social (Google, GitHub, Microsoft) | ✅ |
| Auditoría central (38+ eventos, insert-only, HMAC integridad) | ✅ |
| Notificaciones in-app + navegador | ✅ |
| MCP Gateway para IA (~55 herramientas) | ✅ |
| Backup DR unificado (systemd timer, GFS retention) | ✅ |
| Fail2ban + rate limiting por contexto | ✅ |
| Archivo de tareas y proyectos completados | ✅ |

### Principios de Diseño

| Principio | Decisión | Justificación |
|-----------|----------|---------------|
| **Monorepo** | Todo en un solo repositorio | Despliegue atómico, desarrollo simplificado |
| **Servidor Unificado** | 1 proceso PM2, 5 módulos montados | Simplifica deployment, comparten memoria |
| **DB Híbrida** | PostgreSQL + SQLite | Nómina usa SQLite, demás usan PostgreSQL |
| **JWT Centralizado** | Launcher emite, módulos verifican | SSO simple, permisos embebidos |
| **Sedes Centralizadas** | Launcher es fuente única | Todos los módulos consumen desde launcher |

---

## 2. Arquitectura Actual

### 2.1 Diagrama de Componentes

```
                     Nginx (443/HTTPS)
                          │
                     Express :3002
                     (1 proceso PM2)
                          │
        ┌─────────┬───────┼───────┬─────────┬─────────┐
        │         │       │       │         │         │
   /proveedores /logistica /nomina /proyectos  /crm    /
   (PostgreSQL) (PostgreSQL) (SQLite) (PostgreSQL) (PostgreSQL) (SQLite)
                          │
                     /mcp (Gateway)
                     ~55 tools IA
```

| Módulo | Función | DB | Ruta | Puerto |
|--------|---------|-----|------|--------|
| **Launcher** | Login, dashboard, admin, backups, OAuth, MCP gateway | SQLite (launcher.db) | `/` | 3002 |
| **Proveedores** | Facturas, compras, proveedores, sincronización IMAP | PostgreSQL (public) | `/proveedores/` | 3002 |
| **Logística** | Rutas, pedidos, vehículos, clientes, devoluciones | PostgreSQL (logistics) | `/logistica/` | 3002 |
| **Nómina** | Horas extra, novedades, calendario | SQLite (horas_extra.db) | `/nomina/` | 3002 |
| **Proyectos** | Proyectos, tareas, actas, miembros, archivo | PostgreSQL (projects) | `/proyectos/` | 3002 |
| **CRM** | Clientes, pipeline, cotizaciones, leads, visitas | PostgreSQL (crm) | `/crm/` | 3002 |

### 2.2 Servidor Unificado

Un solo proceso PM2 ejecuta todos los módulos. El root `server.js` monta cada módulo en su prefijo de ruta:

```javascript
// server.js
app.use('/proveedores', express.static('modules/proveedores/public'));
app.use('/nomina', require('./modules/nomina/server'));
app.use('/nomina', express.static('modules/nomina/public'));
app.use('/logistica', logisticaApp);
app.use('/proyectos', proyectosApp);
app.use('/crm', crmApp);
```

**Ventajas:**
- Un solo proceso PM2 que administrar
- Módulos comparten `globalThis.__centrosCache` (logística, proyectos, CRM)
- Un solo `.env` compartido
- Deploy simple: `git pull && pm2 restart synnoxerp`

### 2.3 Base de Datos

**Motor:** PostgreSQL 16+ (logística, proyectos, proveedores, CRM) + SQLite (nómina, launcher)

| Módulo | Engine | Schema | Tablas Principales |
|--------|--------|--------|-------------------|
| Launcher | SQLite | default | `usuarios`, `config`, `modulos_plataforma`, `centros_operacion`, `jwt_blacklist`, `refresh_token_blacklist`, `oauth_accounts`, `oauth_clients`, `oauth_codes`, `oauth_tokens`, `notificaciones`, `email_notif_config` |
| Proveedores | PostgreSQL | `public` | `facturas`, `proveedores`, `categorias_compra`, `areas`, `centros_operacion` |
| Logística | PostgreSQL | `logistics` | `vehiculos`, `pedidos_logistica`, `rutas`, `paradas_ruta`, `clientes`, `devoluciones`, `causales_devolucion`, `geocercas` |
| Nómina | SQLite | default | `usuarios`, `empleados`, `registros`, `nominas`, `tipos`, `configuracion` |
| Proyectos | PostgreSQL | `projects` | `proyectos`, `tareas`, `comentarios`, `evidencias`, `actas_cierre`, `proyecto_miembros`, `tareas_archivadas`, `proyectos_archivadas`, `archivo_config`, `archivo_log` |
| CRM | PostgreSQL | `crm` | `clientes`, `contactos`, `oportunidades`, `oportunidad_historial`, `cotizaciones`, `cotizacion_items`, `descuentos_solicitud`, `leads`, `visitas`, `productos`, `inventario`, `listas_precio`, `lista_precio_items`, `sucursales` |

### 2.4 Estructura de Directorios

```
synnox-erp/
├── server.js                    # Entry point unificado
├── package.json                 # Dependencias raíz (v2.4.1)
├── .env                         # Variables de entorno
├── framework/
│   ├── base.css                 # CSS compartido (sidebar, layout, filtros)
│   ├── framework.js             # JS compartido (sidebar, auth, filtros, notificaciones)
│   ├── auth.mjs                 # Auth compartida (ESM)
│   ├── audit.js                 # Helper de auditoría central
│   ├── notify.js                # Helper de notificaciones
│   └── README.md                # Guía para crear módulos
├── launcher/
│   ├── server.js                # Auth, OAuth, MCP gateway, backups, admin (~4100 líneas)
│   └── shell/                   # Frontend SPA launcher
├── modules/
│   ├── proveedores/             # Facturas y proveedores
│   ├── logistica/               # Rutas, pedidos, devoluciones
│   ├── nomina/                  # Horas extra y calendario
│   ├── proyectos/               # Gestión de proyectos, tareas, archivo
│   └── crm/                     # CRM: clientes, pipeline, cotizaciones
├── scripts/
│   ├── backup_synnox.sh         # Backup DR unificado
│   ├── restore_synnox.sh        # Restore completo
│   ├── backup_drill.sh          # Drill mensual automatizado
│   ├── backup-sqlite.js         # Hot-backup SQLite
│   ├── backup-finalize.js       # Manifest SHA-256
│   └── backup-alert.js          # Alertas email
├── systemd/
│   ├── synnox-backup.service    # Servicio de backup
│   ├── synnox-backup.timer      # Timer diario (2 AM)
│   ├── synnox-drill.timer       # Timer mensual de drill
│   ├── install-backup.sh        # Instalador de timers
│   ├── install-fail2ban.sh      # Instalador fail2ban
│   └── fail2ban/                # Config fail2ban (filter + jail)
├── media/                       # Logo, assets compartidos
└── docs/
    ├── WORKFLOW.md              # Flujo de trabajo
    ├── SPRINT.md                # Estado del sprint
    └── DISASTER-RECOVERY.md     # Runbook de restore
```

---

## 3. Sistema de Autenticación

### 3.1 JWT Enriquecido

El launcher emite JWT con permisos de todos los módulos embebidos:

```javascript
{
  "id": 2,
  "email": "user@empresa.com",
  "nombre": "Usuario",
  "rol": "admin",
  "modulos": ["nomina", "proveedores", "logistica", "proyectos", "crm"],
  "modulos_permisos": {
    "nomina": ["aprobar", "editar", "ver_todos"],
    "proveedores": ["aprobar_factura"],
    "logistica": ["admin"],
    "proyectos": ["aprobar"],
    "crm": ["admin"]
  },
  "jti": "abc-123",
  "iat": 1783521697,
  "exp": 1783525297
}
```

### 3.2 Cookie httpOnly

- `httpOnly: true` — previene robo via XSS
- `sameSite: lax` — permite navegación entre módulos
- `secure: true` solo en HTTPS
- `path: '/'` — accesible desde todos los módulos

### 3.3 Refresh Token

- JWT expiry: 1 hour
- Refresh endpoint: `POST /api/auth/refresh`
- Frontend hace refresh cada 15 minutos + al volver visible la pestaña (`visibilitychange`)

### 3.4 OAuth Social

| Provider | Initiate | Callback |
|----------|----------|----------|
| Google | `GET /auth/google` | `GET /auth/google/callback` |
| GitHub | `GET /auth/github` | `GET /auth/github/callback` |
| Microsoft | `GET /auth/microsoft` | `GET /auth/microsoft/callback` |

- State parameter con cookie httpOnly (10 min expiry)
- Auto-crea usuario si no existe vinculado
- Blacklist check antes de emitir JWT
- 8 eventos auditados por provider (success, denied, state_mismatch, token_exchange_failed, no_email, blacklisted, auth_failed, oauth_error)

### 3.5 Tablas de Auth (Launcher SQLite)

| Tabla | Propósito |
|-------|-----------|
| `usuarios` | Usuarios con roles y perfiles |
| `config` | Configuración key-value |
| `modulos_plataforma` | Módulos registrados |
| `centros_operacion` | Centros de operación (fuente única) |
| `jwt_blacklist` | Tokens JWT revocados |
| `refresh_token_blacklist` | Refresh tokens usados |
| `oauth_accounts` | Cuentas OAuth vinculadas a usuarios internos |
| `oauth_clients` | Clientes OAuth registrados (MCP) |
| `oauth_codes` | Códigos de autorización (expiran) |
| `oauth_tokens` | Tokens de acceso OAuth |

---

## 4. Sedes/Centros Centralizados

### 4.1 Fuente Única de Verdad

El launcher es la fuente única de verdad para centros de operación. Tabla `centros_operacion` en `launcher.db`.

### 4.2 Consumo por Módulos

| Módulo | Método | Detalle |
|--------|--------|---------|
| Logística | `globalThis.__centrosCache` | Mismo proceso Node.js, cache 30s |
| Proyectos | `globalThis.__centrosCache` | Mismo proceso Node.js, cache 30s |
| CRM | `globalThis.__centrosCache` | Mismo proceso Node.js, cache 30s |
| Nómina | `launcherDb.js` (better-sqlite3) | Lee directo de launcher.db, read-only |
| Proveedores | HTTP fetch + sync local | POST /api/centros/sync, auto on-login |

### 4.3 API Pública

```
GET /api/centros → [{ id, nombre, codigo, ciudad, latitud, longitud, activo, ... }]
```

Sin autenticación, rate-limited (30 req/15min).

---

## 5. Sistema de Backups (DR Unificado)

### 5.1 Estrategia

El backup unificado reemplaza los backups por módulo. Ejecutado por **systemd timer**, no por Node.js cron.

| Componente | Archivo | Descripción |
|------------|---------|-------------|
| Script principal | `scripts/backup_synnox.sh` | pg_dump + SQLite + uploads + config |
| Restore | `scripts/restore_synnox.sh` | Restore completo con `--dry-run` |
| Drill | `scripts/backup_drill.sh` | Drill mensual con conteos verificados |
| SQLite helper | `scripts/backup-sqlite.js` | Hot-backup sin corrupción |
| Manifest | `scripts/backup-finalize.js` | Checksums SHA-256 + conteos de filas |
| Alertas | `scripts/backup-alert.js` | Email directo via nodemailer |
| systemd service | `systemd/synnox-backup.service` | oneshot, Persistent=true |
| systemd timer | `systemd/synnox-backup.timer` | Diario 2 AM |
| systemd drill | `systemd/synnox-drill.timer` | Mensual (día 1, 3 AM) |
| Instalador | `systemd/install-backup.sh` | Instala timers + config NAS |

### 5.2 Contenido del Backup

| Paso | Contenido | Método |
|------|-----------|--------|
| 1 | PostgreSQL (DDL + datos + secuencias + índices) | `pg_dump --format=custom --compress=6` |
| 2 | Roles PostgreSQL | `pg_dumpall --globals-only` |
| 3 | SQLite (launcher.db + horas_extra.db) | Hot-backup via better-sqlite3 `.backup()` |
| 4 | Uploads (proyectos, logística, media) | `tar` |
| 5 | Config bundle (.env, nginx, PM2, crontab, letsencrypt, systemd) | `tar` |
| 6 | Manifest SHA-256 + conteos de filas por tabla | Node.js |

### 5.3 Retención GFS

| Período | Cantidad |
|---------|----------|
| Diarias | 7 |
| Semanales | 4 |
| Mensuales | 3 |

### 5.4 Features

- **File lock** (`flock`) previene ejecución concurrente
- **Progress file** (`progress.json`) para UI polling
- **Alertas email** en fallo (siempre) y éxito (opcional)
- **Copia NAS** offsite via CIFS mount (configurable en `backups/.nas.conf`)
- **status.json** + **history.jsonl** para tracking
- **Backup drill mensual** verifica conteos de filas contra restore real

---

## 6. Calendario de Nómina

### 6.1 Configuración

Almacenada en tabla `configuracion` (key-value):
- `calendario_habilitado` — habilitar/deshabilitar
- `calendario_dias_quincenal` — días antes del fin (default: 2)
- `calendario_dias_mensual` — días antes del fin (default: 5)
- `calendario_dias_semanal` — días antes del fin (default: 1)

### 6.2 Por Período

Cada período en `nominas` tiene `fecha_limite` que se auto-calcula al generar períodos.

### 6.3 Flujo

1. Si `fecha > fecha_limite` → toast warning + flag `aprobacion_pendiente`
2. Badge "⏳ próximo" en historial y dashboard
3. Registros fuera de fecha van al próximo período

---

## 7. Actas de Cierre de Proyecto

### 7.1 Tabla

```sql
projects.actas_cierre (
  id SERIAL PRIMARY KEY,
  proyecto_id INTEGER REFERENCES projects.proyectos(id),
  cerrado_por INTEGER,
  observaciones TEXT,
  resumen_ejecutivo TEXT,
  created_at TIMESTAMPTZ
)
```

### 7.2 Flujo

1. Proyecto debe estar `aprobado` (estado_aprobacion = 'aprobada')
2. Admin/gerente hace clic en "Cerrar"
3. Modal con resumen ejecutivo y observaciones
4. Se genera acta + proyecto pasa a `completado`
5. PDF descargable con formato profesional

---

## 8. Filtros Dinámicos

### 8.1 Framework

CSS `.table-filters` + JS `initTableFilters()` en `base.css` y `framework.js`.

### 8.2 Uso

```html
<div class="table-filters">
  <div class="filter-group"><input type="text" class="filter-input" id="fil-q" placeholder="🔍 Buscar..."></div>
  <div class="filter-group"><select class="filter-select" id="fil-estado"><option value="">Todos</option>...</select></div>
  <div class="filter-actions"><span class="filter-count" id="count"></span></div>
</div>
```

```javascript
initTableFilters('mi-tabla', { searchId: 'fil-q', statusId: 'fil-estado', countId: 'count' });
```

---

## 9. Seguridad

### 9.1 Controles Implementados

| Control | Estado | Detalle |
|---------|--------|---------|
| JWT httpOnly cookies | ✅ | Token en cookie, no en headers |
| Refresh token | ✅ | 1h expiry, refresh cada 15min |
| OAuth state validation | ✅ | Cookie httpOnly + verificación server-side |
| Rate limiting login | ✅ | IP-based, configurable (default 20/60s) |
| Rate limiting API | ✅ | 500 req/15min general, 200/15min MCP, 5/hora DCR |
| Fail2ban | ✅ | 5 retries / 10 min / 30 min ban, exponential up to 1d |
| Input validation | ✅ | regex, sanitizePath |
| SQL injection prevention | ✅ | Parameterized queries |
| XSS prevention | ✅ | httpOnly, no secret logging |
| Command injection prevention | ✅ | execFileSync (no shell) |
| CORS configuration | ✅ | Origin whitelist |
| Server-side logout | ✅ | Limpia cookie + blacklist JWT |
| Encriptación logs | ✅ | AES-256-GCM para emails en login logs |
| Backup pre-import | ✅ | Backup automático antes de restore |
| Insert-only audit | ✅ | Trigger bloquea UPDATE/DELETE en auditoría_central |
| HMAC integridad | ✅ | Hash inmutabilidad en cada evento de auditoría |

### 9.2 Pendientes

- [ ] CSP headers con nonce (parcialmente en nginx)
- [ ] Frontend build obfuscation
- [ ] Penetration testing

---

## 10. Variables de Entorno

```bash
PORT=3002
JWT_SECRET=<64 chars hex>
LOG_ENCRYPTION_SECRET=<64 chars hex, distinto de JWT_SECRET>
ADMIN_EMAIL=admin@tudominio.com
ADMIN_PASS=<password>
NODE_ENV=production

# PostgreSQL
DB_USER=synnox
DB_PASSWORD=<password>
DB_HOST=localhost
DB_PORT=5432
DB_NAME=synnox_erp

# CORS
CORS_ORIGIN=https://tudominio.com

# SMTP (opcional)
SMTP_HOST=smtp.tudominio.com
SMTP_PORT=587
SMTP_USER=correo@tudominio.com
SMTP_PASS=password
SMTP_FROM=erp@tudominio.com

# OAuth (opcional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

---

## 11. CRM

### 11.1 Modelo de Datos

| Tabla | Descripción |
|-------|-------------|
| `crm.clientes` | Clientes (UUID PK, tipos: potencial/real/siesa, campos SIESA) |
| `crm.contactos` | Personas dentro de empresas cliente |
| `crm.oportunidades` | Pipeline Kanban: lead → calificado → propuesta → negociación → ganada/perdida |
| `crm.oportunidad_historial` | Historial de cambios de etapa |
| `crm.cotizaciones` | Cotizaciones con items, descuentos, IVA |
| `crm.cotizacion_items` | Líneas de cotización |
| `crm.descuentos_solicitud` | Workflow de aprobación de descuentos |
| `crm.leads` | Captura detallada de leads desde campo |
| `crm.visitas` | Visitas de campo con GPS (check-in/check-out) |
| `crm.productos` | Productos desde SIESA con GS1/EAN |
| `crm.inventario` | Stock por bodega desde SIESA |
| `crm.listas_precio` | Listas de precio |
| `crm.lista_precio_items` | Items de listas de precio |
| `crm.sucursales` | Sucursales por cliente |

### 11.2 Integración SIESA

- Importación de clientes, productos, inventario y listas de precio
- Lookup por código GS1/EAN
- Campos de ruta (`ruta_vehiculos`, `ruta_motos`) sincronizados desde SIESA

### 11.3 MCP Tools (15 herramientas)

`listar_clientes`, `buscar_cliente`, `crear_cliente`, `editar_cliente`, `obtener_cliente`, `estadisticas_clientes`, `listar_oportunidades`, `crear_oportunidad`, `actualizar_oportunidad`, `listar_cotizaciones`, `crear_cotizacion`, `aprobar_cotizacion`, `buscar_producto`, `listar_leads`, `registrar_visita`

---

## 12. Devoluciones (Logística)

### 12.1 Modelo de Datos

| Tabla | Descripción |
|-------|-------------|
| `logistics.devoluciones` | Devoluciones de producto ( Smart2Go o manual) |
| `logistics.causales_devolucion` | Catálogo configurable de causales (35+ causas) |

### 12.2 Campos Clave

- `fuente`: `smart2go` o `manual`
- `productos`: JSONB con `{nombre, cantidad, causa, causa_normalizada}`
- `causa`:_NORMALIZADA desde catálogo (CALIDAD/COMERCIAL/LOGISTICA/CLIENTE/FUERZA_MAYOR)
- `pedido_id`: FK nullable a `pedidos_logistica` (match por número de factura)
- `estado`: `registrada` → `en_proceso` → `resuelta` → `cerrada`

### 12.3 Import Smart2Go

Parser `smart2goDevolucionesParser.js`:
- Normalización de headers con fuzzy matching
- Parseo de productos (`"Filete basa(3)\nCamaron 650g"` → JSON)
- Valores monetarios (`$134.598` → `134598.00`)
- Coordenadas GPS
- Upsert por `fuente_id` (dedup)
- Match parcial con `pedidos_logistica.numero_factura`

### 12.4 Decisión Arquitectónica

Las devoluciones se mantienen en **Logística** (no CRM):
- Son operacionales (conductor, placa, ruta, mercaderista)
- Vinculadas a pedidos de entrega
- Causas son de cadena de suministro (vencimiento, choque térmico, error de despacho)
- Workflow operacional, no de relación con el cliente
- **Futuro**: FK nullable `cliente_crm_id` para vincular al CRM cuando aplique

---

## 13. Auditoría Central

### 13.1 Modelo de Datos

| Tabla | Descripción |
|-------|-------------|
| `public.auditoria_central` | Eventos cross-módulo (insert-only trigger) |
| `public.auditoria_config` | Config: retención (365 días), mascarar IP |

### 13.2 Helper (`framework/audit.js`)

| Función | Propósito |
|---------|-----------|
| `configureAudit(pool, options)` | Configurar al inicio |
| `auditarEvento(input)` | Insert normalizado con IP masking, HMAC |
| `sanitizeMetadata()` | Elimina campos sensibles (password, token, secret) |
| `diffSeguro()` | Diff seguro excluyendo campos sensibles |
| `ejecutarRetencion(pool)` | Job de retención (24h interval) |

### 13.3 Eventos Instrumentados

| Módulo | Cantidad | Ejemplos |
|--------|----------|----------|
| Launcher | ~37 | OAuth login/fail, session kill, invalidación admin, password reset |
| Proyectos | 10 | CRUD proyectos, CRUD tareas, aprobaciones |
| Logística | 14 | Pedidos CRUD, devoluciones CRUD, clientes CRUD |
| Proveedores | 14 | Facturas workflow, proveedores CRUD, áreas, categorías |
| Nómina | PENDIENTE | SQLite, necesita approach diferente |

### 13.4 Visor en Launcher

- `GET /api/admin/audit/central` — Query con filtros (módulo, categoría, acción, resultado, actor, entidad, search, fechas) + paginación
- `GET /api/admin/audit/central/:id` — Detalle de evento individual
- `GET /api/admin/audit/stats` — Stats: total, fallos 24h, por módulo, top acciones

---

## 14. Notificaciones

### 14.1 Arquitectura

Centralizadas en launcher (SQLite). Módulos envían vía HTTP con token interno.

| Componente | Archivo |
|------------|---------|
| Helper backend | `framework/notify.js` |
| Framework frontend | `framework/framework.js` (polling, bell, dropdown, browser) |
| Launcher UI | `launcher/shell/app.js` |

### 14.2 Endpoints

| Método | Ruta | Propósito |
|--------|------|-----------|
| GET | `/api/notificaciones` | Últimas 50 del usuario |
| GET | `/api/notificaciones/no-leidas` | Conteo de no leídas |
| DELETE | `/api/notificaciones/:id/leer` | Marcar como leída |
| DELETE | `/api/notificaciones/leer-todas` | Marcar todas |
| POST | `/api/notificaciones/crear` | Crear (token interno o admin JWT) |

### 14.3 Config

Tabla `email_notif_config`: toggle por módulo/evento. Admin puede habilitar/deshabilitar.

### 14.4 Browser Notifications

- Banner en dropdown hasta que usuario active
- Polling cada 15 segundos
- Click navega a URL, auto-cierra después de 8s
- Disponible en módulos via `framework.js` (no en launcher)

---

## 15. MCP Gateway

### 15.1 Arquitectura

Gateway central en `/mcp` que agrega herramientas de todos los módulos habilitados.

| Componente | Detalle |
|------------|---------|
| Gateway | `/mcp` — proxy con session management |
| OAuth 2.0 | DCR (RFC 7591) + PKCE + authorization code |
| Metadata | `/.well-known/oauth-authorization-server` (RFC 8414) |
| Rate limit | 200 req/15min en `/mcp` |

### 15.2 Herramientas por Módulo

| Módulo | Tools | Ejemplos |
|--------|-------|----------|
| Proyectos | 15 | `dashboard`, `listar_proyectos`, `crear_tarea`, `aprobar_tarea` |
| Logística | 10 | `dashboard`, `listar_pedidos`, `generar_rutas`, `buscar_clientes` |
| Proveedores | 15 | `listar_facturas`, `aprobar_factura`, `resumen_dashboard` |
| Nómina | 15 | `consultar`, `registros`, `aprobar_rechazar`, `reporte_mensual` |
| CRM | 15 | `listar_clientes`, `crear_oportunidad`, `buscar_producto` |
| **Total** | **~55** | |

### 15.3 Admin Panel

- `GET /api/admin/mcp` — Módulos con config MCP
- `PUT /api/admin/mcp/:id` — Actualizar config por módulo
- `GET /api/admin/mcp/stats` — Dashboard (tools, sessions, calls)
- `GET /api/admin/mcp-logs` — Logs de ejecución de herramientas
- `GET /api/admin/mcp-sessions` — Sesiones activas
- `GET /api/admin/mcp-oauth` — Status, clientes, tokens
- `DELETE /api/admin/mcp-oauth/tokens/:id` — Revocar token

---

## 16. Archivo de Tareas y Proyectos

### 16.1 Modelo de Datos

| Tabla | Descripción |
|-------|-------------|
| `projects.tareas_archivadas` | Snapshots JSONB de tareas completadas |
| `projects.proyectos_archivadas` | Snapshots JSONB de proyectos completados |
| `projects.archivo_config` | Config: meses para archivar (3), retención (24), habilitado |
| `projects.archivo_log` | Log de ejecuciones (automático/manual/proyecto) |

### 16.2 Service (`archivoService.js`)

| Función | Propósito |
|---------|-----------|
| `ejecutarMigracion()` | Archiva tareas completadas en lotes (advisory lock) |
| `archivarProyecto()` | Archiva proyecto con snapshot completo |
| `reactivarTareaArchivada()` | Restaura tarea como nueva entidad |
| `reactivarProyectoArchivado()` | Restaura proyecto + tareas + miembros + actas |

### 16.3 Job Automático

- Intervalo: 6 horas
- Mínimo 28 días entre ejecuciones automáticas
- `checkTareas()` + `checkProyectos()` secuenciales
- Configurable por tipo via `archivo_config`

### 16.4 Endpoints

| Método | Ruta | Propósito |
|--------|------|-----------|
| GET | `/archivo/` | Listar tareas archivadas |
| GET | `/archivo/stats` | Estadísticas |
| POST | `/archivo/migrar` | Migración manual |
| POST | `/archivo/:id/reactivar` | Restaurar tarea |
| GET | `/archivo/proyectos` | Listar proyectos archivados |
| POST | `/archivo/proyectos/migrar` | Migración manual proyectos |
| POST | `/archivo/proyectos/:id/reactivar` | Restaurar proyecto |

---

*Documento mantenido por el equipo de desarrollo SynnoxERP.*
