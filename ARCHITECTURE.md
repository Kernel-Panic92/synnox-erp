# SynnoxERP — Arquitectura del Sistema

> Documento de referencia para desarrollo, mantenimiento y escalabilidad.
> Última actualización: 27 Jul 2026 — v1.1.0

---

## 1. Visión General

SynnoxERP es un sistema ERP modular de uso interno diseñado para gestión de:
- **Nómina**: Horas extras, aprobaciones, reportes SIESA, calendario con fechas límite
- **Proveedores**: Facturas electrónicas DIAN, flujo de aprobación
- **Logística**: Rutas optimizadas, pedidos, vehículos, clientes
- **Proyectos**: Gestión de proyectos, tareas, tablero Kanban, actas de cierre

### Principios de Diseño

| Principio | Decisión | Justificación |
|-----------|----------|---------------|
| **Monorepo** | Todo en un solo repositorio | Despliegue atómico, desarrollo simplificado |
| **Servidor Unificado** | 1 proceso PM2, 4 módulos montados | Simplifica deployment, comparten memoria |
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
        ┌─────────┬───────┼───────┬─────────┐
        │         │       │       │         │
   /proveedores /logistica /nomina /proyectos  /
   (PostgreSQL) (PostgreSQL) (SQLite) (PostgreSQL) (SQLite)
```

| Módulo | Función | DB | Ruta | Puerto |
|--------|---------|-----|------|--------|
| **Launcher** | Login, dashboard, admin, backups | SQLite (launcher.db) | `/` | 3002 |
| **Proveedores** | Facturas, compras, proveedores | PostgreSQL (public) | `/proveedores/` | 3002 |
| **Logística** | Rutas, pedidos, vehículos, clientes | PostgreSQL (logistics) | `/logistica/` | 3002 |
| **Nómina** | Horas extra, novedades, calendario | SQLite (horas_extra.db) | `/nomina/` | 3002 |
| **Proyectos** | Proyectos, tareas, actas de cierre | PostgreSQL (projects) | `/proyectos/` | 3002 |

### 2.2 Servidor Unificado

Un solo proceso PM2 ejecuta todos los módulos. El root `server.js` monta cada módulo en su prefijo de ruta:

```javascript
// server.js
app.use('/proveedores', express.static('modules/proveedores/public'));
app.use('/nomina', require('./modules/nomina/server'));
app.use('/nomina', express.static('modules/nomina/public'));
app.use('/logistica', logisticaApp); // ESM import
app.use('/proyectos', proyectosApp); // ESM import
```

**Ventajas:**
- Un solo proceso PM2 que管理ar
- Módulos comparten `globalThis.__centrosCache` (logística y proyectos)
- Un solo `.env` compartido
- Deploy simple: `git pull && pm2 restart synnoxerp`

### 2.3 Base de Datos

**Motor:** PostgreSQL 14+ (logística, proyectos, proveedores) + SQLite (nómina, launcher)

| Módulo | Engine | Schema | Tablas Principales |
|--------|--------|--------|-------------------|
| Launcher | SQLite | default | `usuarios`, `config`, `modulos_plataforma`, `centros_operacion` |
| Proveedores | PostgreSQL | `public` | `facturas`, `proveedores`, `categorias_compra`, `areas`, `centros_operacion` |
| Logística | PostgreSQL | `logistics` | `vehiculos`, `pedidos_logistica`, `rutas`, `paradas_ruta`, `clientes` |
| Nómina | SQLite | default | `usuarios`, `empleados`, `registros`, `nominas`, `tipos`, `configuracion` |
| Proyectos | PostgreSQL | `projects` | `proyectos`, `tareas`, `comentarios`, `evidencias`, `actas_cierre` |

### 2.4 Estructura de Directorios

```
synnox-erp/
├── server.js                    # Entry point unificado
├── package.json                 # Dependencias raíz (v1.1.0)
├── .env                         # Variables de entorno
├── framework/
│   ├── base.css                 # CSS compartido (sidebar, layout, filtros)
│   ├── framework.js             # JS compartido (sidebar, auth, filtros)
│   ├── auth.mjs                 # Auth compartida (ESM)
│   └── README.md                # Guía para crear módulos
├── launcher/
│   ├── server.js                # Auth, perfiles, módulos, backups
│   └── shell/                   # Frontend SPA launcher
├── modules/
│   ├── proveedores/             # Facturas y proveedores
│   ├── logistica/               # Rutas y pedidos
│   ├── nomina/                  # Horas extra y calendario
│   └── proyectos/               # Gestión de proyectos y actas
└── media/                       # Logo, assets compartidos
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
  "modulos": ["nomina", "proveedores", "logistica", "proyectos"],
  "modulos_permisos": {
    "nomina": ["aprobar", "editar", "ver_todos"],
    "proveedores": ["aprobar_factura"],
    "logistica": ["admin"],
    "proyectos": ["aprobar"]
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

### 3.3 Logout Server-Side

Los módulos redirigen a `GET /logout` que limpia la cookie httpOnly server-side:

```javascript
app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`);
  res.redirect('/');
});
```

### 3.4 Tablas de Auth (Launcher SQLite)

| Tabla | Propósito |
|-------|-----------|
| `usuarios` | Usuarios con roles y perfiles |
| `config` | Configuración key-value |
| `modulos_plataforma` | Módulos registrados |
| `centros_operacion` | Centros de operación (fuente única) |
| `jwt_blacklist` | Tokens JWT revocados |
| `refresh_token_blacklist` | Refresh tokens usados |

---

## 4. Sedes/Centros Centralizados

### 4.1 Fuente Única de Verdad

El launcher es la fuente única de verdad para centros de operación. Tabla `centros_operacion` en `launcher.db`.

### 4.2 Consumo por Módulos

| Módulo | Método | Detalle |
|--------|--------|---------|
| Logística | `globalThis.__centrosCache` | Mismo proceso Node.js, cache 30s |
| Proyectos | `globalThis.__centrosCache` | Mismo proceso Node.js, cache 30s |
| Nómina | `launcherDb.js` (better-sqlite3) | Lee directo de launcher.db, read-only |
| Proveedores | HTTP fetch + sync local | POST /api/centros/sync, auto on-login |

### 4.3 API Pública

```
GET /api/centros → [{ id, nombre, codigo, ciudad, latitud, longitud, activo, ... }]
```

Sin autenticación, rate-limited (30 req/15min).

---

## 5. Sistema de Backups

### 5.1 Estrategia Híbrida

| Tipo | Endpoint | Uso |
|------|----------|-----|
| **General** | `GET /api/admin/backup/general` | Respaldar todo el sistema |
| **Nómina** | `GET /nomina/api/backup` | Backup individual nómina |
| **Logística** | `GET /logistica/api/backup` | Backup individual logística |
| **Proveedores** | `GET /proveedores/api/backup` | Backup individual proveedores |
| **Proyectos** | `GET /proyectos/api/backup` | Backup individual proyectos |

### 5.2 Backup General

Endpoint `GET /api/admin/backup/general` genera un ZIP con:
- `launcher/data.json` — config, usuarios, módulos, centros (SQLite)
- `nomina/data.json` — 10 tablas (SQLite)
- `logistica/data.json` — 6 tablas (PostgreSQL)
- `proyectos/data.json` — 4 tablas (PostgreSQL)
- `proveedores/data.json` — 7 tablas (PostgreSQL)
- `manifest.json` — metadata con fecha y módulos

### 5.3 Restore

- **General**: `POST /api/admin/backup/restore` — restaura todos los módulos
- **Por módulo**: Cada módulo tiene su propio endpoint de restore

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

| Control | Estado |
|---------|--------|
| JWT httpOnly cookies | ✅ |
| Rate limiting (express-rate-limit) | ✅ |
| Input validation (regex, sanitizePath) | ✅ |
| SQL injection prevention (parameterized queries) | ✅ |
| XSS prevention (httpOnly, no secret logging) | ✅ |
| Command injection prevention (execFileSync) | ✅ |
| CORS configuration | ✅ |
| Server-side logout | ✅ |
| Backup pre-import | ✅ |

### 9.2 Pendientes

- [ ] CSRF protection tokens
- [ ] CSP headers with nonce
- [ ] OAuth 2.0 con client registration
- [ ] Penetration testing
- [ ] Frontend build obfuscation

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
```

---

*Documento mantenido por el equipo de desarrollo SynnoxERP.*
