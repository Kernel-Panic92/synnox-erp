# SynnoxERP — Arquitectura del Sistema

> Documento de referencia para desarrollo, mantenimiento y escalabilidad.
> Última actualización: 08 Jul 2026

---

## 1. Visión General

SynnoxERP es un sistema ERP modular de uso interno (no expuesto a terceros) diseñado para gestión de:
- **Nómina**: Horas extras, aprobaciones, reportes SIESA
- **Proveedores**: Facturas electrónicas DIAN, flujo de aprobación
- **Logística**: Rutas, pedidos, vehículos, clientes

### Principios de Diseño

| Principio | Decisión | Justificación |
|-----------|----------|---------------|
| **Monorepo** | Todo en un solo repositorio | Facilita desarrollo interno, despliegue atómico |
| **DB Centralizada** | PostgreSQL unificado (`horix_erp`) | Consistencia, consultas cruzadas, backups unificados |
| **Multi-proceso** | PM2 separa módulos | Aislamiento de fallos, escalabilidad independiente |
| **JWT Centralizado** | Launcher emite, módulos verifican | SSO simple, permisos embebidos |

---

## 2. Arquitectura Actual

### 2.1 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (80/443)                          │
│                    Reverse Proxy + SSL                          │
└──────────┬──────────────────┬──────────────────┬────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Launcher        │ │  Proveedores     │ │  Logística       │
│  PM2: horix-*    │ │  PM2: horix-*    │ │  PM2: horix-*    │
│  Puerto: 3002    │ │  Puerto: 3003    │ │  Puerto: 3004    │
│  Ruta: /         │ │  Ruta: /proveedores│ │  Ruta: /logistica│
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  PostgreSQL       │
                    │  horix_erp        │
                    │  (compartido)     │
                    └───────────────────┘
```

### 2.2 Multi-Proceso PM2

**Por qué multi-proceso (no monoproceso):**

Un error no capturado en un módulo (excepción síncrona, memory leak, bug en motor VRP) **no debe tumbar todo el ERP**. Con procesos separados:
- Si Logística crashea, Nómina y Proveedores siguen funcionando
- Cada módulo tiene su propio ciclo de vida (restart, logs, memoria)
- Fácil de escalar independientemente

**Configuración PM2 (`ecosystem.config.js`):**

```javascript
module.exports = {
  apps: [
    {
      name: 'horix-launcher',
      script: 'server.js',
      env: { MODULE: 'launcher', PORT: 3002 },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M'
    },
    {
      name: 'horix-proveedores',
      script: 'modules/proveedores/src/server.js',
      env: { MODULE: 'proveedores', PORT: 3003 },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M'
    },
    {
      name: 'horix-logistica',
      script: 'modules/logistica/backend/server.js',
      env: { MODULE: 'logistica', PORT: 3004 },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M'
    },
    {
      name: 'horix-nomina',
      script: 'modules/nomina/server.js',
      env: { MODULE: 'nomina', PORT: 3005 },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M'
    }
  ]
};
```

**Nginx routing:**

```nginx
upstream launcher { server 127.0.0.1:3002; }
upstream proveedores { server 127.0.0.1:3003; }
upstream logistica { server 127.0.0.1:3004; }
upstream nomina { server 127.0.0.1:3005; }

location / { proxy_pass http://launcher; }
location /proveedores/ { proxy_pass http://proveedores; }
location /logistica/ { proxy_pass http://logistica; }
location /nomina/ { proxy_pass http://nomina; }
```

### 2.3 Base de Datos

**Motor:** PostgreSQL 14+ (compartido para todos los módulos)

**Esquema:** Unificado en `horix_erp`

| Módulo | Tablas Principales | Estado |
|--------|-------------------|--------|
| Launcher | `usuarios`, `perfiles`, `perfil_permisos`, `modulos_plataforma` | ✅ PostgreSQL |
| Proveedores | `facturas`, `proveedores`, `categorias_compra`, `areas`, `eventos_flujo` | ✅ PostgreSQL |
| Logística | `vehiculos`, `pedidos`, `rutas`, `clientes`, `sedes` | ✅ PostgreSQL |
| Nómina | `empleados`, `registros`, `nominas`, `tipos`, `permisos_roles` | ⚠️ SQLite (pendiente migración) |

**Conexión:** Pool compartido via `DATABASE_URL`

```javascript
// framework/db.js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
module.exports = pool;
```

### 2.4 Estructura de Directorios

```
horix-erp/
├── server.js                    # Entry point principal
├── framework/
│   ├── auth.mjs                 # JWT verification (ESM)
│   └── db.js                    # PostgreSQL pool compartido
├── launcher/
│   ├── server.js                # Auth, perfiles, módulos
│   └── shell/                   # Frontend SPA launcher
├── modules/
│   ├── proveedores/
│   │   ├── src/                 # Backend
│   │   └── public/              # Frontend
│   ├── logistica/
│   │   ├── backend/             # Backend
│   │   └── public/              # Frontend
│   └── nomina/
│       ├── src/                 # Backend
│       └── public/              # Frontend
├── media/                       # Logo, assets compartidos
└── .env                         # Variables de entorno
```

---

## 3. Sistema de Permisos

### 3.1 Estado Actual

| Módulo | Sistema | Granularidad | Almacenamiento |
|--------|---------|--------------|----------------|
| Launcher | `perfil_permisos` | Genérico (ver/crear/editar/eliminar) | PostgreSQL |
| Nómina | `permisos_roles` | 20+ permisos funcionales | SQLite (pendiente) |
| Proveedores | `requireRol()` | Solo roles (admin/contador/tesorero) | Ninguna |
| Logística | `soloAdmin` | Admin vs todos | Ninguna |

### 3.2 Diseño Propuesto: JWT Enriquecido

**Problema:** Cada módulo tiene su propio sistema de permisos, no hay orquestación central.

**Solución:** JWT con permisos funcionales de todos los módulos embebidos.

```
Login Flow:
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│ Launcher │────▶│ query permisos│────▶│  JWT firmado │
│          │     │ de todos los  │     │  con todos los│
│          │     │ módulos       │     │  permisos     │
└──────────┘     └──────────────┘     └──────────────┘
```

**Estructura del JWT:**

```javascript
{
  // Identidad
  id: 2,
  email: "edgar@horix.com",
  rol: "admin",                    // admin | operador
  
  // Launcher permissions
  modulos: ["nomina", "proveedores", "logistica"],
  perfil_id: 1,
  perfil_nombre: "ADMINISTRADOR",
  permisos: [
    { modulo_id: "nomina", permiso: "crear" },
    { modulo_id: "nomina", permiso: "editar" },
    // ...
  ],
  
  // Module-specific functional permissions (NUEVO)
  modulos_permisos: {
    nomina: ["aprobar", "editar", "revertir", "ver_todos"],
    proveedores: ["aprobar_factura", "causar", "pagar"],
    logistica: ["admin"]
  },
  
  // Metadata
  iat: 1783521697,
  exp: 1783525297  // 1 hora (no 8 horas)
}
```

### 3.3 JWT Corto + Refresh Token

**Problema:** JWT de 8 horas crea ventana de seguridad cuando se revoca un permiso.

**Solución:** JWT de 1 hora + refresh token silencioso.

```
Flujo de Refresh:
┌──────────┐     ┌──────────────┐
│ Frontend │────▶│ POST /refresh│
│ (timer)  │     │ cookie:      │
│ 50 min   │     │ refresh_token│
└──────────┘     └──────┬───────┘
                        │
                        ▼
               ┌──────────────┐
               │ Nuevo JWT    │
               │ (1h exp)     │
               │ + nuevos     │
               │ permisos     │
               └──────────────┘
```

**Implementación:**

```javascript
// launcher/server.js
const JWT_EXPIRY = '1h';
const REFRESH_EXPIRY = '7d';

// Login: emitir JWT + refresh token
app.post('/api/auth/login', (req, res) => {
  const jwt = sign({ ...payload }, SECRET, { expiresIn: JWT_EXPIRY });
  const refreshToken = sign({ userId: user.id }, SECRET, { expiresIn: REFRESH_EXPIRY });
  
  res.cookie('launcher_jwt', jwt, { 
    httpOnly: true, 
    maxAge: 3600000,  // 1 hora
    secure: process.env.NODE_ENV === 'production'
  });
  
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    maxAge: 604800000,  // 7 días
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth'  // Solo accesible por refresh endpoint
  });
  
  res.json({ ok: true });
});

// Refresh: generar nuevo JWT con permisos actualizados
app.post('/api/auth/refresh', (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });
  
  try {
    const decoded = verify(refreshToken, SECRET);
    const user = await getUserWithPermissions(decoded.userId);
    const newJwt = sign(buildPayload(user), SECRET, { expiresIn: JWT_EXPIRY });
    
    res.cookie('launcher_jwt', newJwt, { /* ... */ });
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: 'Refresh token inválido' });
  }
});
```

**Invalidación inmediata (para revocaciones críticas):**

```javascript
// Tabla de invalidación
CREATE TABLE jwt_blacklist (
  jti VARCHAR(255) PRIMARY KEY,
  expirado_en TIMESTAMPTZ DEFAULT NOW()
);

// Al cambiar permisos críticos
app.put('/api/admin/usuarios/:id/permisos', async (req, res) => {
  // 1. Actualizar permisos
  await updatePermissions(req.params.id, req.body);
  
  // 2. Invalidar JWT actual del usuario
  const currentJwt = req.cookies.launcher_jwt;
  const decoded = verify(currentJwt, SECRET);
  await pool.query(
    'INSERT INTO jwt_blacklist (jti, expirado_en) VALUES ($1, NOW())',
    [decoded.jti]
  );
  
  // 3. El frontend detectará 401 y redirigirá a login
  res.json({ ok: true, message: 'Permisos actualizados. Sesión requiere re-login.' });
});

// Middleware: verificar blacklist
function verifyToken(req, res, next) {
  const token = req.cookies.launcher_jwt;
  const decoded = verify(token, SECRET);
  
  // Verificar si está en blacklist
  const blacklisted = await pool.query(
    'SELECT 1 FROM jwt_blacklist WHERE jti = $1 AND expirado_en > NOW()',
    [decoded.jti]
  );
  
  if (blacklisted.rows.length > 0) {
    return res.status(401).json({ error: 'Sesión invalidada' });
  }
  
  req.usuario = decoded;
  next();
}
```

### 3.4 Tablas de Permisos

```sql
-- Configuración de permisos disponibles por módulo
CREATE TABLE modulos_permisos_config (
  id SERIAL PRIMARY KEY,
  modulo_id VARCHAR(50) NOT NULL,
  permiso_id VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL,
  tipo VARCHAR(50) DEFAULT 'action',  -- action, visibility, page
  activo BOOLEAN DEFAULT TRUE,
  UNIQUE(modulo_id, permiso_id)
);

-- Permisos por perfil (rol)
CREATE TABLE modulos_permisos_perfil (
  id SERIAL PRIMARY KEY,
  perfil_id INTEGER REFERENCES perfiles(id) ON DELETE CASCADE,
  modulo_id VARCHAR(50) NOT NULL,
  permiso_id VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  UNIQUE(perfil_id, modulo_id, permiso_id)
);

-- Permisos individuales por usuario (sobreescriben los del perfil)
CREATE TABLE modulos_permisos_usuario (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo_id VARCHAR(50) NOT NULL,
  permiso_id VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  UNIQUE(usuario_id, modulo_id, permiso_id)
);
```

### 3.5 Módulos: Lectura del JWT

```javascript
// Nomina: middleware/permisos.js
function requierePermiso(permiso) {
  return (req, res, next) => {
    // Admin tiene todos los permisos
    if (req.usuario?.rol === 'admin') return next();
    
    const nominaPerms = req.usuario?.modulos_permisos?.nomina || [];
    if (nominaPerms.includes(permiso)) return next();
    
    return res.status(403).json({ 
      error: `Permiso requerido: ${permiso}` 
    });
  };
}

// Uso en rutas
router.post('/:id/aprobar', requierePermiso('aprobar'), async (req, res) => {
  // ...
});
```

---

## 4. Migración Nómina SQLite → PostgreSQL

### 4.1 Impacto Estimado

| Aspecto | Cantidad |
|---------|----------|
| Archivos a modificar | 26 |
| Llamadas síncronas → asíncronas | ~175 |
| Transacciones a reescribir | 4 |
| Tablas a migrar | 13 |
| Sintaxis específica SQLite | ~15 tipos |

### 4.2 Cambios Críticos

**Síncrono → Asíncrono:**

```javascript
// ANTES (SQLite - better-sqlite3)
const rows = db.prepare('SELECT * FROM registros').all();
db.prepare('INSERT INTO registros VALUES (?,?)').run(id, fecha);

// DESPUÉS (PostgreSQL - pg)
const { rows } = await pool.query('SELECT * FROM registros');
await pool.query('INSERT INTO registros VALUES ($1,$2)', [id, fecha]);
```

**Sintaxis SQLite → PostgreSQL:**

| SQLite | PostgreSQL |
|--------|------------|
| `INSERT OR REPLACE INTO ...` | `INSERT INTO ... ON CONFLICT (pk) DO UPDATE SET ...` |
| `INSERT OR IGNORE INTO ...` | `INSERT INTO ... ON CONFLICT DO NOTHING` |
| `AUTOINCREMENT` | `SERIAL` o `GENERATED AS IDENTITY` |
| `datetime('now','-30 days')` | `NOW() - INTERVAL '30 days'` |
| `PRAGMA table_info(...)` | `information_schema.columns` |
| `LIKE ?` (case-insensitive) | `ILIKE ?` |
| `INTEGER` (0/1 boolean) | `BOOLEAN` (true/false) |

### 4.3 Plan de Migración por Fases

#### Fase 0: Preparación y Rollback (1 día)

**Objetivo:** Tener backup fresco y script de rollback probado.

```bash
# 1. Generar backup de SQLite
curl -X GET http://localhost:3005/api/backup -o backup_pre_migracion.zip

# 2. Verificar backup
unzip -l backup_pre_migracion.zip

# 3. Script de rollback (rollback.sh)
#!/bin/bash
echo "⚠️  ROLLBACK: Restaurando SQLite..."
# Detener módulo nómina
pm2 stop horix-nomina
# Restaurar SQLite desde backup
cp backups/horas_extra.db.pre-migration backups/horas_extra.db
# Reiniciar
pm2 start horix-nomina
echo "✅ Rollback completado"
```

**Verificar:**
- [ ] Backup generado correctamente
- [ ] Script de rollback ejecuta sin errores
- [ ] Datos verificados post-rollback

#### Fase 1: Tablas PostgreSQL (1 día)

**Objetivo:** Crear tablas en PostgreSQL con esquema correcto.

```sql
-- migrations/nomina_to_pg.sql

-- Empleados
CREATE TABLE IF NOT EXISTS nomina_empleados (
  id UUID PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  cedula VARCHAR NOT NULL,
  cargo VARCHAR NOT NULL,
  departamento VARCHAR NOT NULL,
  sede VARCHAR NOT NULL DEFAULT 'Principal',
  email VARCHAR,
  telefono VARCHAR,
  tipo_vinculacion VARCHAR NOT NULL DEFAULT 'vinculado',
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Registros
CREATE TABLE IF NOT EXISTS nomina_registros (
  id UUID PRIMARY KEY,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id),
  nomina_id UUID NOT NULL,
  fecha DATE NOT NULL,
  horas NUMERIC NOT NULL,
  tipo VARCHAR NOT NULL,
  aprobador VARCHAR NOT NULL,
  motivo TEXT NOT NULL,
  creado TIMESTAMPTZ NOT NULL,
  concepto TEXT DEFAULT '',
  observaciones TEXT DEFAULT '',
  transporte NUMERIC DEFAULT 0,
  sede VARCHAR DEFAULT 'Principal',
  estado VARCHAR DEFAULT 'pendiente',
  aprobado_por VARCHAR DEFAULT '',
  fecha_aprobado TIMESTAMPTZ,
  creado_por VARCHAR DEFAULT ''
);

-- ... más tablas
```

**Verificar:**
- [ ] Todas las tablas creadas
- [ ] Índices creados
- [ ] Foreign keys configuradas

#### Fase 2: Refactorización DB (2-3 días)

**Objetivo:** Reemplazar `better-sqlite3` por `pg` en capa de datos.

```javascript
// modules/nomina/src/db/index.js (NUEVO)
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool
};
```

**Verificar:**
- [ ] Pool de conexiones funciona
- [ ] Migraciones ejecutan correctamente
- [ ] Seeds ejecutan correctamente

#### Fase 3: Rutas Async/Await (3-4 días)

**Objetivo:** Convertir todas las rutas a async/await.

```javascript
// ANTES (sync)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM registros').all();
  res.json(rows);
});

// DESPUÉS (async)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM nomina_registros');
    res.json(rows);
  } catch (err) {
    console.error('[registros]', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Verificar:**
- [ ] Todas las rutas funcionan
- [ ] Transacciones con BEGIN/COMMIT/ROLLBACK
- [ ] No hay errores de concurrencia

#### Fase 4: Integración Permisos (1 día)

**Objetivo:** Migrar `permisos_roles` a tablas centrales del launcher.

```javascript
// 1. Migrar datos existentes
INSERT INTO modulos_permisos_perfil (perfil_id, modulo_id, permiso_id)
SELECT 
  p.id,
  'nomina',
  pr.permiso
FROM permisos_roles pr
JOIN perfiles p ON p.nombre = pr.rol;

// 2. Actualizar middleware
function requierePermiso(permiso) {
  return (req, res, next) => {
    if (req.usuario?.rol === 'admin') return next();
    const perms = req.usuario?.modulos_permisos?.nomina || [];
    if (perms.includes(permiso)) return next();
    res.status(403).json({ error: `Permiso requerido: ${permiso}` });
  };
}
```

**Verificar:**
- [ ] Permisos migrados correctamente
- [ ] JWT incluye permisos de nómina
- [ ] Restricciones funcionan

#### Fase 5: Testing (1-2 días)

**Objetivo:** Validar cada funcionalidad.

**Checklist de Testing:**
- [ ] Login/Logout
- [ ] CRUD Empleados
- [ ] CRUD Registros (crear, editar, eliminar)
- [ ] Aprobación de registros
- [ ] Revertir registros
- [ ] Generar nómina
- [ ] Exportar SIESA
- [ ] Dashboard y reportes
- [ ] Backup/Restore
- [ ] Permisos por rol

### 4.4 Estrategia de Rollback

**Si algo falla en Fase 3 o posterior:**

```bash
# 1. Detener módulo nómina
pm2 stop horix-nomina

# 2. Restaurar código anterior
git checkout HEAD~1 -- modules/nomina/

# 3. Restaurar SQLite desde backup
cp backups/horas_extra.db.pre-migration modules/nomina/horas_extra.db

# 4. Reiniciar
pm2 start horix-nomina

# 5. Verificar
curl http://localhost:3005/api/health
```

---

## 5. Backup/Restore

### 5.1 Formato Actual

**Archivo:** ZIP con `backup.json` + CSVs

```json
{
  "version": "1.0",
  "generado": "2026-07-08T...",
  "app": "HorasExtra",
  "configuracion": { "smtp_host": "...", ... },
  "usuarios": [...],
  "empleados": [...],
  "nominas": [...],
  "registros": [...],
  "tipos": [...],
  "usuario_empleados": [...],
  "dashboard_layout": [...],
  "centros": [...]
}
```

### 5.2 Compatibilidad SQLite ↔ PostgreSQL

**Detección automática de motor:**

```javascript
// modules/nomina/src/routes/backup.js
const isPostgreSQL = !!process.env.DATABASE_URL;

router.post('/restore', soloAdmin, async (req, res) => {
  const data = parseBackup(req.file);
  
  if (isPostgreSQL) {
    const resumen = await restoreDataPG(data, req.usuario.id, pool);
  } else {
    const resumen = restoreData(data, req.usuario.id);
  }
  
  res.json({ ok: true, resumen });
});
```

**Función restoreDataPG:**

```javascript
async function restoreDataPG(data, currentUserId, pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Configuracion
    if (data.configuracion) {
      for (const [clave, valor] of Object.entries(data.configuracion)) {
        await client.query(
          `INSERT INTO configuracion (clave, valor) 
           VALUES ($1, $2) 
           ON CONFLICT (clave) 
           DO UPDATE SET valor = EXCLUDED.valor`,
          [clave, clave === 'smtp_password' ? encryptSmtp(valor) : valor]
        );
      }
    }
    
    // Empleados
    if (data.empleados?.length) {
      await client.query('DELETE FROM nomina_empleados');
      for (const e of data.empleados) {
        await client.query(
          `INSERT INTO nomina_empleados 
           (id, nombre, cedula, cargo, departamento, sede, email, telefono) 
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [e.id, e.nombre, e.cedula, e.cargo, e.departamento, 
           e.sede || 'Principal', e.email || '', e.telefono || '']
        );
      }
    }
    
    // Registros (con transformación de tipos)
    if (data.registros?.length) {
      await client.query('DELETE FROM nomina_registros');
      for (const r of data.registros) {
        await client.query(
          `INSERT INTO nomina_registros 
           (id, empleado_id, nomina_id, fecha, horas, tipo, aprobador, 
            motivo, creado, concepto, sede, creado_por, observaciones, 
            transporte, estado, aprobado_por, fecha_aprobado) 
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            r.id, r.empleadoId, r.nominaId, r.fecha, r.horas, r.tipo,
            r.aprobador, r.motivo, r.creado, r.concepto || '',
            r.sede || 'Principal', r.creadoPor || '', r.observaciones || '',
            parseFloat(r.transporte || 0), r.estado || 'pendiente',
            r.aprobadoPor || '', r.fechaAprobado || null
          ]
        );
      }
    }
    
    await client.query('COMMIT');
    return { success: true, counts: { ... } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

---

## 6. Observabilidad Centralizada

### 6.1 Problemática

Con 4+ módulos compartiendo DB, cuando algo falla necesitas trazar rápido:
- ¿De qué módulo vino el error?
- ¿Qué usuario ejecutó la acción?
- ¿Cuándo ocurrió exactamente?

### 6.2 Solución: Tabla Unificada de Auditoría

```sql
-- Tabla central de auditoría (en launcher)
CREATE TABLE auditoria_central (
  id BIGSERIAL PRIMARY KEY,
  modulo VARCHAR(50) NOT NULL,
  evento VARCHAR(100) NOT NULL,
  usuario_id INTEGER,
  usuario_email VARCHAR(255),
  entidad VARCHAR(100),
  entidad_id VARCHAR(255),
  accion VARCHAR(50),  -- CREATE, UPDATE, DELETE, LOGIN, etc.
  datos_anteriores JSONB,
  datos_nuevos JSONB,
  ip INET,
  user_agent TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX idx_auditoria_modulo ON auditoria_central(modulo);
CREATE INDEX idx_auditoria_usuario ON auditoria_central(usuario_id);
CREATE INDEX idx_auditoria_fecha ON auditoria_central(creado_en);
CREATE INDEX idx_auditoria_entidad ON auditoria_central(entidad, entidad_id);
```

### 6.3 SDK de Auditoría

```javascript
// framework/audit.js
class AuditLogger {
  constructor(pool) {
    this.pool = pool;
  }

  async log({ modulo, evento, usuario, entidad, entidadId, accion, 
              datosAnteriores, datosNuevos, ip, userAgent }) {
    await this.pool.query(
      `INSERT INTO auditoria_central 
       (modulo, evento, usuario_id, usuario_email, entidad, entidad_id, 
        accion, datos_anteriores, datos_nuevos, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [modulo, evento, usuario?.id, usuario?.email, entidad, entidadId,
       accion, datosAnteriores ? JSON.stringify(datosAnteriores) : null,
       datosNuevos ? JSON.stringify(datosNuevos) : null, ip, userAgent]
    );
  }
}

module.exports = AuditLogger;
```

**Uso en módulos:**

```javascript
// modules/proveedores/src/routes/facturas.js
const audit = require('../../../framework/audit');

router.patch('/:id/aprobar', requireRol('admin', 'contador'), async (req, res) => {
  const { rows: antes } = await db.query(
    'SELECT * FROM facturas WHERE id = $1', [req.params.id]
  );
  
  await db.query(
    'UPDATE facturas SET estado = $1 WHERE id = $2',
    ['aprobada', req.params.id]
  );
  
  await audit.log({
    modulo: 'proveedores',
    evento: 'factura_aprobada',
    usuario: req.usuario,
    entidad: 'facturas',
    entidadId: req.params.id,
    accion: 'UPDATE',
    datosAnteriores: antes[0],
    datosNuevos: { estado: 'aprobada' },
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  res.json({ ok: true });
});
```

### 6.4 Dashboard de Auditoría

```sql
-- Últimas 24 horas por módulo
SELECT 
  modulo,
  COUNT(*) as eventos,
  COUNT(DISTINCT usuario_id) as usuarios_unicos
FROM auditoria_central
WHERE creado_en > NOW() - INTERVAL '24 hours'
GROUP BY modulo
ORDER BY eventos DESC;

-- Actividad sospechosa (muchos deletes)
SELECT 
  usuario_email,
  COUNT(*) as deletes
FROM auditoria_central
WHERE accion = 'DELETE'
  AND creado_en > NOW() - INTERVAL '1 hour'
GROUP BY usuario_email
HAVING COUNT(*) > 10;
```

---

## 7. Contratos de API Internos

### 7.1 Problemática

Los módulos pueden necesitar comunicarse entre sí:
- ¿Logística consulta proveedores para obtener datos de facturación?
- ¿Nómina consulta logística para viáticos?
- ¿Proveedores necesita datos de empleados de nómina?

### 7.2 Diseño: API Interna via HTTP

**Principio:** Los módulos se comunican via HTTP usando el pool de conexiones compartido, no via archivos o IPC.

**Endpoints internos (solo accesibles desde localhost):**

```javascript
// framework/internal-api.js
const express = require('express');
const router = express.Router();

// Middleware: solo permitir requests de localhost
router.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!ip.includes('127.0.0.1') && !ip.includes('::1')) {
    return res.status(403).json({ error: 'Solo accesible internamente' });
  }
  next();
});

// Obtener datos de empleado (para logística, proveedores, etc.)
router.get('/api/internal/empleados/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nombre, email, departamento, sede FROM nomina_empleados WHERE id = $1',
    [req.params.id]
  );
  res.json(rows[0] || null);
});

// Obtener datos de proveedor (para logística)
router.get('/api/internal/proveedores/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nombre, nit, email FROM proveedores WHERE id = $1',
    [req.params.id]
  );
  res.json(rows[0] || null);
});

module.exports = router;
```

### 7.3 Contrato de Datos

**Formato estándar de respuesta:**

```typescript
// Tipos TypeScript para contratos internos
interface InternalResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface Empleado {
  id: string;
  nombre: string;
  email: string;
  departamento: string;
  sede: string;
}

interface Proveedor {
  id: string;
  nombre: string;
  nit: string;
  email: string;
}
```

### 7.4 Documentación de Contratos

Cada módulo que expone endpoints internos debe documentarlos en:

```markdown
# modules/{nombre}/INTERNAL_API.md

## Endpoints Internos

### GET /api/internal/empleados/:id
- **Descripción:** Obtener datos básicos de empleado
- **Parámetros:** id (UUID)
- **Respuesta:** Empleado o null
- **Uso:** Logística (viáticos), Proveedores (asignación)

### GET /api/internal/proveedores/:id
- **Descripción:** Obtener datos de proveedor
- **Parámetros:** id (UUID)
- **Respuesta:** Proveedor o null
- **Uso:** Logística (rutas de entrega)
```

---

## 8. Seguridad

### 8.1 JWT

| Aspecto | Configuración |
|---------|---------------|
| Algoritmo | HS256 |
| Secret | Compartido via `JWT_SECRET` en `.env` |
| Expiración | 1 hora (access token) |
| Refresh | 7 días (refresh token) |
| Cookie | `httpOnly: true`, `secure: true` (producción) |
| Invalidación | Blacklist en `jwt_blacklist` table |

### 8.2 Permisos

| Regla | Implementación |
|-------|----------------|
| Admin | Todos los permisos implícitos |
| Perfil | Permisos base por rol |
| Individual | Sobreescriben perfil (para excepciones) |
| Auditoría | Todos los cambios se registran |

### 8.3 Datos Sensibles

| Dato | Protección |
|------|------------|
| Passwords | bcrypt (12 rounds) |
| SMTP password | AES-256 encryption |
| JWT secret | Nunca en código, solo en `.env` |
| API keys | Solo en `.env`, nunca en logs |

### 8.4 Network

| Aspecto | Configuración |
|---------|---------------|
| HTTPS | Obligatorio en producción |
| CORS | `CORS_ORIGIN` en `.env` |
| Rate limiting | Login: 5 intentos/15min |
| Internal API | Solo accesible desde localhost |

---

## 9. Decisiones de Arquitectura

### 9.1 Monorepo vs Multi-repo

**Decisión:** Monorepo

**Justificación:**
- Uso interno, no se exponen módulos a terceros
- Despliegue atómico (un solo `git pull`)
- DB compartida facilita consultas cruzadas
- Permisos centralizados en un solo JWT

### 9.2 Multi-proceso vs Monoproceso

**Decisión:** Multi-proceso (PM2)

**Justificación:**
- Aislamiento de fallos
- Un módulo crashear no afecta a otros
- Fácil de escalar independientemente
- Logs separados por módulo

### 9.3 PostgreSQL vs SQLite

**Decisión:** PostgreSQL (migración Nómina pendiente)

**Justificación:**
- Consistencia en todos los módulos
- Mejor concurrencia (multi-writer)
- Funcionalidades avanzadas (JSONB, FULL TEXT SEARCH)
- Backups unificados con `pg_dump`

### 9.4 JWT Enriquecido vs API Calls

**Decisión:** JWT Enriquecido

**Justificación:**
- 0 latencia adicional en cada request
- JWT firmado, no tamperable
- Permisos siempre frescos (1h expiry + refresh)
- Simple de implementar en módulos

---

## 10. Roadmap de Implementación

### Corto Plazo (1-2 semanas)

- [ ] **Migración Nómina SQLite → PostgreSQL**
  - Fase 0: Backup y rollback
  - Fase 1: Tablas PostgreSQL
  - Fase 2: Refactorización DB
  - Fase 3: Rutas async/await
  - Fase 4: Integración permisos
  - Fase 5: Testing

### Mediano Plazo (2-4 semanas)

- [ ] **Sistema de Permisos Centralizado**
  - Crear tablas `modulos_permisos_*`
  - JWT corto (1h) + refresh token
  - Migrar permisos de nómina
  - UI de gestión de perfiles

- [ ] **Observabilidad**
  - Tabla `auditoria_central`
  - SDK de auditoría
  - Dashboard de auditoría

### Largo Plazo (1-2 meses)

- [ ] **APIs Internas**
  - Documentar contratos
  - Implementar endpoints internos
  - Testing de integración

- [ ] **Multi-proceso PM2**
  - Separar módulos en procesos
  - Configurar Nginx routing
  - Monitoreo de procesos

---

## Apéndice A: Variables de Entorno

```bash
# Base de datos
DATABASE_URL=postgresql://user:pass@localhost:5432/horix_erp

# JWT
JWT_SECRET=tu_secret_aqui
JWT_EXPIRY=1h
REFRESH_EXPIRY=7d

# Servidor
PORT=3002
NODE_ENV=production

# CORS
CORS_ORIGIN=https://erp.horix.com

# IMAP (Proveedores)
IMAP_HOST=mail.example.com
IMAP_PORT=993
IMAP_USER=inbox@horix.com
IMAP_PASS=password
IMAP_FOLDER=INBOX

# OSRM (Logística)
OSRM_URL=https://router.project-osrm.org
```

---

## Apéndice B: Comandos Útiles

```bash
# Ver estado de procesos PM2
pm2 list

# Logs de un módulo específico
pm2 logs horix-nomina

# Restart un módulo
pm2 restart horix-nomina

# Backup de PostgreSQL
pg_dump -U synnox_user horix_erp > backup.sql

# Restore de PostgreSQL
psql -U synnox_user horix_erp < backup.sql

# Verificar conexión a DB
psql -h localhost -U synnox_user -d horix_erp -c "SELECT 1"
```

---

*Documento mantenido por el equipo de desarrollo SynnoxERP.*
*Para sugerencias o correcciones, abrir un issue en el repositorio.*
