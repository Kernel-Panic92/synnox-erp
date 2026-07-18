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
| Launcher | `usuarios`, `perfiles`, `perfil_permisos`, `modulos_plataforma` | PostgreSQL |
| Proveedores | `facturas`, `proveedores`, `categorias_compra`, `areas`, `eventos_flujo` | PostgreSQL |
| Logística | `vehiculos`, `pedidos`, `rutas`, `clientes`, `sedes` | PostgreSQL |
| Nómina | `empleados`, `registros`, `nominas`, `tipos`, `permisos_roles` | SQLite (pendiente migración) |

**Conexión:** Pool compartido via `DATABASE_URL`

```javascript
// framework/db.js
const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '5', 10),  // 5 por proceso
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
module.exports = pool;
```

**Pool sizing:**
- 4 procesos × 5 conexiones = 20 conexiones máximo
- Deja margen para: PgBouncer, backups, consultas manuales
- `max_connections=100` (default PostgreSQL) es suficiente

### 2.4 Estructura de Directorios

```
horix-erp/
├── server.js                    # Entry point principal
├── framework/
│   ├── auth.js                  # JWT verification + buildPayload
│   ├── auth.mjs                 # JWT verification (ESM, para logistica)
│   ├── db.js                    # PostgreSQL pool compartido
│   ├── internal-api.js          # API interna entre módulos
│   ├── cache.js                 # Caché simple con TTL
│   └── audit.js                 # Logger de auditoría
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

**Estructura del JWT:**

```javascript
{
  // Identidad
  "id": 2,
  "email": "edgar@horix.com",
  "nombre": "Edgar Velasquez",
  
  // Rol y módulos
  "rol": "admin",
  "modulos": ["nomina", "proveedores", "logistica"],
  
  // Perfil y permisos launcher
  "perfil_id": 1,
  "perfil_nombre": "ADMINISTRADOR",
  "permisos": [
    { "modulo_id": "nomina", "permiso": "crear" },
    { "modulo_id": "nomina", "permiso": "editar" },
    { "modulo_id": "proveedores", "permiso": "crear" }
  ],
  
  // Permisos funcionales por módulo (solo para módulos con acceso)
  "modulos_permisos": {
    "nomina": ["aprobar", "editar", "revertir", "ver_todos"],
    "proveedores": ["aprobar_factura", "causar", "pagar"],
    "logistica": ["admin"]
  },
  
  // Token metadata
  "jti": "abc-123-def-456",
  "iat": 1783521697,
  "exp": 1783525297
}
```

### 3.3 JWT Corto + Refresh Token

**Problema:** JWT de 8 horas crea ventana de seguridad cuando se revoca un permiso.

**Solución:** JWT de 1 hora + refresh token silencioso con rotación y reuse detection.

**Límites de diseño:**

| Límite | Valor | Acción si se supera |
|--------|-------|---------------------|
| JWT size | ~3KB | Mover permisos a endpoint separado |
| JWT expiry | 1 hora | Refresh automático |
| Refresh expiry | 7 días | Re-login |
| Grace period | 5 segundos | Request duplicado tolerado |
| Cache TTL | 5 segundos | Staleness aceptable |

### 3.4 Tablas de Auth

```sql
-- 1. user_modulos: Acceso a módulos por usuario
CREATE TABLE user_modulos (
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo_id VARCHAR(50) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (usuario_id, modulo_id)
);

-- 2. jwt_blacklist: Tokens JWT revocados manualmente
CREATE TABLE jwt_blacklist (
  jti VARCHAR(255) PRIMARY KEY,
  expirado_en TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_jwt_blacklist_expirado ON jwt_blacklist(expirado_en);

-- 3. refresh_token_blacklist: Refresh tokens usados (single-use)
CREATE TABLE refresh_token_blacklist (
  jti VARCHAR(255) PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expirado_en TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_refresh_blacklist_expirado ON refresh_token_blacklist(expirado_en);
CREATE INDEX idx_refresh_blacklist_usuario ON refresh_token_blacklist(usuario_id);

-- 4. usuario_sesion_invalidada: Sesiones comprometidas
CREATE TABLE usuario_sesion_invalidada (
  usuario_id INTEGER PRIMARY KEY,
  invalidado_en TIMESTAMPTZ NOT NULL
);

-- 5. modulos_permisos_config: Permisos disponibles por módulo
CREATE TABLE modulos_permisos_config (
  id SERIAL PRIMARY KEY,
  modulo_id VARCHAR(50) NOT NULL,
  permiso_id VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL,
  tipo VARCHAR(50) DEFAULT 'action',
  activo BOOLEAN DEFAULT TRUE,
  UNIQUE(modulo_id, permiso_id)
);

-- 6. modulos_permisos_perfil: Permisos por perfil
CREATE TABLE modulos_permisos_perfil (
  id SERIAL PRIMARY KEY,
  perfil_id INTEGER REFERENCES perfiles(id) ON DELETE CASCADE,
  modulo_id VARCHAR(50) NOT NULL,
  permiso_id VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  UNIQUE(perfil_id, modulo_id, permiso_id)
);

-- 7. modulos_permisos_usuario: Permisos individuales
CREATE TABLE modulos_permisos_usuario (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo_id VARCHAR(50) NOT NULL,
  permiso_id VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  UNIQUE(usuario_id, modulo_id, permiso_id)
);
```

### 3.5 Jerarquía de Permisos

```
1. user_modulos           → ¿Puede acceder al módulo? (fuente de verdad)
2. modulos_permisos_perfil → ¿Qué puede hacer? (solo para módulos con acceso)
3. modulos_permisos_usuario → Excepciones individuales (solo para módulos con acceso)
```

**Regla:** `user_modulos` ES la fuente de verdad para acceso a módulos. El perfil NO determina a qué módulos tiene acceso un usuario.

### 3.6 buildPayload y getUserWithPermissions

```javascript
// framework/auth.js
const crypto = require('crypto');

function buildPayload(user, jti) {
  return {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    modulos: user.modulos,
    perfil_id: user.perfil_id,
    perfil_nombre: user.perfil_nombre,
    permisos: user.permisos,
    modulos_permisos: user.modulos_permisos,
    jti
  };
}

async function getUserWithPermissions(pool, userId) {
  // 1. Datos básicos del usuario
  const { rows: userRows } = await pool.query(
    `SELECT id, email, nombre, rol, perfil_id 
     FROM usuarios WHERE id = $1 AND activo = TRUE`,
    [userId]
  );
  
  if (userRows.length === 0) return null;
  const user = userRows[0];
  
  // 2. Módulos asignados (user_modulos es la fuente de verdad)
  if (user.rol === 'admin') {
    const { rows: allModulos } = await pool.query(
      'SELECT id FROM modulos_plataforma WHERE activo = TRUE'
    );
    user.modulos = allModulos.map(m => m.id);
  } else {
    const { rows: modulos } = await pool.query(
      `SELECT modulo_id FROM user_modulos 
       WHERE usuario_id = $1 AND activo = TRUE`,
      [userId]
    );
    user.modulos = modulos.map(m => m.modulo_id);
  }
  
  // 3. Perfil y permisos launcher
  if (user.perfil_id) {
    const { rows: perfil } = await pool.query(
      'SELECT nombre FROM perfiles WHERE id = $1',
      [user.perfil_id]
    );
    user.perfil_nombre = perfil[0]?.nombre || null;
    
    const { rows: permisos } = await pool.query(
      `SELECT modulo_id, permiso FROM perfil_permisos 
       WHERE perfil_id = $1 AND activo = TRUE`,
      [user.perfil_id]
    );
    user.permisos = permisos;
  } else {
    user.perfil_nombre = null;
    user.permisos = [];
  }
  
  // 4. Permisos funcionales por módulo
  user.modulos_permisos = {};
  
  // Permisos del perfil (solo para módulos con acceso)
  if (user.perfil_id) {
    const { rows: perfilPerms } = await pool.query(
      `SELECT modulo_id, permiso_id FROM modulos_permisos_perfil 
       WHERE perfil_id = $1 AND activo = TRUE`,
      [user.perfil_id]
    );
    
    for (const row of perfilPerms) {
      if (!user.modulos.includes(row.modulo_id)) continue;
      if (!user.modulos_permisos[row.modulo_id]) {
        user.modulos_permisos[row.modulo_id] = [];
      }
      user.modulos_permisos[row.modulo_id].push(row.permiso_id);
    }
  }
  
  // Permisos individuales (solo para módulos con acceso)
  const { rows: userPerms } = await pool.query(
    `SELECT modulo_id, permiso_id FROM modulos_permisos_usuario 
     WHERE usuario_id = $1 AND activo = TRUE`,
    [userId]
  );
  
  for (const row of userPerms) {
    if (!user.modulos.includes(row.modulo_id)) continue;
    if (!user.modulos_permisos[row.modulo_id]) {
      user.modulos_permisos[row.modulo_id] = [];
    }
    if (!user.modulos_permisos[row.modulo_id].includes(row.permiso_id)) {
      user.modulos_permisos[row.modulo_id].push(row.permiso_id);
    }
  }
  
  return user;
}

module.exports = { buildPayload, getUserWithPermissions };
```

### 3.7 Módulos: Lectura del JWT

```javascript
// Nomina: middleware/permisos.js
function requierePermiso(permiso) {
  return (req, res, next) => {
    if (req.usuario?.rol === 'admin') return next();
    
    const nominaPerms = req.usuario?.modulos_permisos?.nomina || [];
    if (nominaPerms.includes(permiso)) return next();
    
    return res.status(403).json({ 
      error: `Permiso requerido: ${permiso}` 
    });
  };
}
```

---

## 4. Autenticación: Endpoints

### 4.1 Login

```javascript
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const user = await authenticateUser(email, password);
  if (!user) return res.status(401).json({ error: 'Credenciales invalidas' });
  
  const fullUser = await getUserWithPermissions(pool, user.id);
  if (!fullUser) return res.status(401).json({ error: 'Usuario no encontrado' });
  
  const jti = crypto.randomUUID();
  const refreshJti = crypto.randomUUID();
  
  const jwt = sign(buildPayload(fullUser, jti), SECRET, { expiresIn: '1h' });
  const refreshToken = sign({
    userId: fullUser.id,
    jti: refreshJti
  }, SECRET, { expiresIn: '7d' });
  
  res.cookie('launcher_jwt', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600000
  });
  
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 604800000,
    path: '/api/auth'
  });
  
  res.json({ ok: true, usuario: { id: fullUser.id, email: fullUser.email, rol: fullUser.rol } });
});
```

### 4.2 Refresh (con reuse detection)

```javascript
app.post('/api/auth/refresh', async (req, res) => {
  const oldRefreshToken = req.cookies.refresh_token;
  if (!oldRefreshToken) return res.status(401).json({ error: 'No refresh token' });

  try {
    const decoded = verify(oldRefreshToken, SECRET);

    // 1. Verificar si la sesion fue invalidada
    const { rows: invalidada } = await pool.query(
      'SELECT 1 FROM usuario_sesion_invalidada WHERE usuario_id = $1 AND invalidado_en > to_timestamp($2)',
      [decoded.userId, decoded.iat]
    );

    if (invalidada.length > 0) {
      res.clearCookie('launcher_jwt');
      res.clearCookie('refresh_token');
      return res.status(401).json({ error: 'Sesion invalidada', reason: 'sesion_invalidada' });
    }

    // 2. Verificar si el refresh token ya fue usado
    const { rows } = await pool.query(
      'SELECT 1 FROM refresh_token_blacklist WHERE jti = $1',
      [decoded.jti]
    );

    if (rows.length > 0) {
      // Reuso detectado: ventana de gracia de 5 segundos
      const { rows: graceRows } = await pool.query(
        `SELECT 1 FROM refresh_token_blacklist 
         WHERE jti = $1 AND creado_en > NOW() - INTERVAL '5 seconds'`,
        [decoded.jti]
      );
      
      if (graceRows.length > 0) {
        // Dentro de ventana de gracia: request duplicado
        return res.status(401).json({ error: 'Token ya procesado' });
      }
      
      // Ataque real: invalidar toda la sesion
      await pool.query(
        `INSERT INTO usuario_sesion_invalidada (usuario_id, invalidado_en) 
         VALUES ($1, NOW()) 
         ON CONFLICT (usuario_id) 
         DO UPDATE SET invalidado_en = NOW()`,
        [decoded.userId]
      );
      
      sesionCache.invalidate(`sesion:${decoded.userId}`);
      
      res.clearCookie('launcher_jwt');
      res.clearCookie('refresh_token');
      
      return res.status(401).json({ 
        error: 'Sesion comprometida', 
        reason: 'refresh_token_reuse' 
      });
    }

    // 3. Todo OK: emitir nuevos tokens
    await pool.query(
      `INSERT INTO refresh_token_blacklist (jti, usuario_id, creado_en, expirado_en) 
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '7 days')`,
      [decoded.jti, decoded.userId]
    );

    const fullUser = await getUserWithPermissions(pool, decoded.userId);
    if (!fullUser) return res.status(401).json({ error: 'Usuario no encontrado' });

    const newJti = crypto.randomUUID();
    const newRefreshJti = crypto.randomUUID();
    
    const newJwt = sign(buildPayload(fullUser, newJti), SECRET, { expiresIn: '1h' });
    const newRefreshToken = sign({
      userId: fullUser.id,
      jti: newRefreshJti
    }, SECRET, { expiresIn: '7d' });

    res.cookie('launcher_jwt', newJwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600000
    });
    
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800000,
      path: '/api/auth'
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: 'Refresh token invalido' });
  }
});
```

### 4.3 Verify Token (con caché)

```javascript
const SimpleCache = require('./cache');
const sesionCache = new SimpleCache(5000);

async function verifyToken(req, res, next) {
  const token = req.cookies.launcher_jwt;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = verify(token, SECRET);
    const userId = decoded.id;

    // Verificar invalidacion de sesion (con cache)
    let sesionInvalida = sesionCache.get(`sesion:${userId}`);
    
    if (sesionInvalida === null) {
      const { rows } = await pool.query(
        'SELECT 1 FROM usuario_sesion_invalidada WHERE usuario_id = $1 AND invalidado_en > to_timestamp($2)',
        [userId, decoded.iat]
      );
      sesionInvalida = rows.length > 0;
      sesionCache.set(`sesion:${userId}`, sesionInvalida);
    }

    if (sesionInvalida) {
      res.clearCookie('launcher_jwt');
      res.clearCookie('refresh_token');
      return res.status(401).json({ error: 'Sesion invalidada' });
    }

    // Verificar blacklist individual
    const { rows: blacklisted } = await pool.query(
      'SELECT 1 FROM jwt_blacklist WHERE jti = $1',
      [decoded.jti]
    );

    if (blacklisted.length > 0) {
      return res.status(401).json({ error: 'Token invalidado' });
    }

    req.usuario = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token invalido' });
  }
}
```

### 4.4 Flujos de Seguridad

```
LOGIN
  → Autenticar usuario
  → getUserWithPermissions (filtra por user_modulos)
  → buildPayload (incluye modulos_permisos filtrados)
  → Emitir JWT (1h) + refresh token (7d)
  → NO tocar ninguna blacklist

REFRESH
  → Verificar refresh token
  → ¿Sesion invalidada? → SÍ: rechazar
  → ¿Refresh token usado?
     → NO: insertar en blacklist + emitir nuevos tokens
     → SÍ: ¿creado_en > NOW() - INTERVAL '5 seconds'?
            → SÍ (duplicado): rechazar
            → NO (ataque): invalidar sesion + caché + rechazar

REQUEST
  → verifyToken (cache 5s)
  → proceed
```

### 4.5 Frontend Handling

```javascript
async function silentRefresh() {
  const res = await fetch('/api/auth/refresh', { method: 'POST' });
  
  if (res.ok) return true;
  
  if (res.status === 401) {
    const data = await res.json();
    
    if (data.reason === 'refresh_token_reuse' || data.reason === 'sesion_invalidada') {
      showSecurityAlert('Tu sesion fue comprometida. Inicia sesion nuevamente.');
      logout();
      return false;
    }
    
    if (data.error === 'Token ya procesado') {
      return true;  // Reintentar request
    }
    
    logout();
    return false;
  }
  
  return false;
}
```

---

## 5. Internal API

### 5.1 Seguridad

```javascript
// framework/internal-api.js
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

router.use((req, res, next) => {
  // Exigir secret SIEMPRE (AND, no OR)
  const secret = req.headers['x-internal-secret'];
  
  if (!INTERNAL_SECRET) {
    console.error('[Internal API] INTERNAL_API_SECRET no configurado');
    return res.status(500).json({ error: 'Internal API no configurada' });
  }
  
  if (secret !== INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }
  
  next();
});
```

### 5.2 Contratos de Datos

```typescript
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

---

## 6. Observabilidad

### 6.1 Tabla de Auditoría

```sql
CREATE TABLE auditoria_central (
  id BIGSERIAL PRIMARY KEY,
  modulo VARCHAR(50) NOT NULL,
  evento VARCHAR(100) NOT NULL,
  usuario_id INTEGER,
  usuario_email VARCHAR(255),
  entidad VARCHAR(100),
  entidad_id VARCHAR(255),
  accion VARCHAR(50),
  datos_anteriores JSONB,
  datos_nuevos JSONB,
  ip INET,
  user_agent TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auditoria_modulo ON auditoria_central(modulo);
CREATE INDEX idx_auditoria_usuario ON auditoria_central(usuario_id);
CREATE INDEX idx_auditoria_fecha ON auditoria_central(creado_en);
```

### 6.2 Retención de Datos

**Corto plazo:** No implementar retención.

**Mediano plazo (6-12 meses):** Evaluar volumen.

**Largo plazo (si es necesario):**
- Opción A: Particionar por mes
- Opción B: Archivar a tabla historica
- Opción C: Exportar a S3/parquet

**Trigger:** Si la tabla supera 10M de filas o las consultas tardan >2s.

---

## 7. Migración Nómina SQLite → PostgreSQL

### 7.1 Impacto

| Aspecto | Cantidad |
|---------|----------|
| Archivos a modificar | 26 |
| Llamadas síncronas → asíncronas | ~160 |
| Transacciones a reescribir | 5 |
| Tablas a migrar | 13 |
| Sintaxis SQLite específica | ~25 tipos |

### 7.2 Sintaxis SQLite → PostgreSQL

| SQLite | PostgreSQL | Ocurrencias |
|--------|------------|-------------|
| `INSERT OR REPLACE INTO ...` | `INSERT INTO ... ON CONFLICT (pk) DO UPDATE SET ...` | 10 |
| `INSERT OR IGNORE INTO ...` | `INSERT INTO ... ON CONFLICT DO NOTHING` | 1 |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` | 1 |
| `datetime('now','-30 days')` | `NOW() - INTERVAL '30 days'` | 7 |
| `DATE(creado)` | `creado::date` | 1 |
| `substr(r.fecha,1,7)` | `LEFT(r.fecha,7)` | 3 |
| `PRAGMA table_info(...)` | `information_schema.columns` | 1 |
| `sqlite_master` | `information_schema.tables` | 1 |
| `INTEGER` (boolean 0/1) | `BOOLEAN` (true/false) | ~12 |
| `BLOB` | `BYTEA` | 1 |
| `.changes` on run result | `result.rowCount` | 1 |

### 7.3 Tablas a Migrar (13 tablas)

| Tabla | Columnas | Relaciones | Complejidad |
|-------|----------|------------|-------------|
| `usuarios` | 9 | - | Baja |
| `configuracion` | 2 (key-value) | - | Baja |
| `empleados` | 9 | -> usuario_empleados | Media |
| `nominas` | 5 | -> registros | Baja |
| `registros` | 17 | -> empleados, nominas, tipos | **Alta** |
| `usuario_empleados` | 2 (composite PK) | -> usuarios, empleados | Baja |
| `centros` | 4 | - | Baja |
| `telemetria` | 7 | - | Media |
| `tipos` | 4 | -> registros | Baja |
| `permisos_roles` | 2 (composite PK) | -> roles | Baja |
| `roles` | 1 | -> permisos_roles | Baja |
| `adjuntos` | 7 (BLOB) | -> registros | Media |
| `dashboard_layout` | 3 | - | Baja |

**NOTA:** La tabla `usuarios` NO se migra en el script ETL. Los usuarios se reconcilian manualmente con `reconcile-usuarios.js` porque el launcher YA tiene su propia tabla `usuarios` con el esquema correcto (`perfil_id`, `user_modulos`, etc.).

### 7.4 Plan por Fases

#### Fase 0: Preparación (1 día)

**Objetivo:** Backup fresco + script de rollback probado.

```bash
# 1. Backup SQLite
curl -X GET http://localhost:3005/api/backup -o backup_pre_migracion.zip

# 2. Script de rollback (rollback-nomina.sh)
#!/bin/bash
echo "ROLLBACK: Restaurando Nomina a SQLite..."
pm2 stop horix-nomina
cp ~/.local/share/synnoxerp/backups/horas_extra.db.pre-migration \
   ~/.local/share/synnoxerp/modules/nomina/horas_extra.db
git checkout HEAD~1 -- modules/nomina/
pm2 start horix-nomina
echo "Rollback completado"
```

**Verificar:**
- [ ] Backup generado
- [ ] Script de rollback probado
- [ ] Datos verificados post-rollback

#### Fase 1: Tablas PostgreSQL (1 día)

**Objetivo:** Crear tablas con esquema correcto y FKs.

```sql
-- Ver archivo: modules/nomina/src/db/migrations_pg.sql
```

**Verificar:**
- [ ] Todas las tablas creadas
- [ ] Indices creados
- [ ] Foreign keys configuradas

#### Fase 2: Refactorización DB (2-3 días)

**Objetivo:** Reemplazar `better-sqlite3` por `pg`.

```javascript
// modules/nomina/src/db/index.js (NUEVO)
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

const uid = () => crypto.randomUUID();

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
  uid
};
```

**Verificar:**
- [ ] Pool funciona
- [ ] Migraciones ejecutan
- [ ] Seeds ejecutan

#### Fase 3: Rutas Async/Await (3-4 días)

**Objetivo:** Convertir todas las rutas + FOR UPDATE en batch approve.

```javascript
// Patrón de migración
// ANTES (SQLite)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM registros').all();
  res.json(rows);
});

// DESPUÉS (PostgreSQL)
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

**Batch approve con FOR UPDATE:**

```javascript
router.post('/batch-aprobar', podeAprobar, async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    for (const id of ids) {
      // SELECT ... FOR UPDATE para locking pesimista
      const { rows } = await client.query(
        `SELECT r.id, r.estado, r.creado_por, e.sede 
         FROM nomina_registros r 
         LEFT JOIN nomina_empleados e ON r.empleado_id = e.id 
         WHERE r.id = $1 FOR UPDATE`,
        [id]
      );
      // ... logica de aprobacion
    }
    
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
```

**Verificar:**
- [ ] Todas las rutas funcionan
- [ ] Transacciones con BEGIN/COMMIT/ROLLBACK
- [ ] Batch approve con FOR UPDATE

#### Fase 3.5: ETL - migrate-nomina.js (1 día)

**Objetivo:** Migrar datos existentes de SQLite a PostgreSQL.

**Script:** `modules/nomina/src/scripts/migrate-nomina.js`

**Flujo de Ejecución:**

```bash
# 1. Generar backup desde SQLite
curl -X GET http://localhost:3005/api/backup -o /tmp/nomina_backup.zip

# 2. Extraer backup.json
cd /tmp && unzip -o nomina_backup.zip backup.json

# 3. Ejecutar migración (con verificación integrada)
node modules/nomina/src/scripts/migrate-nomina.js /tmp/backup.json
```

**Características del script:**
- Recibe ruta del backup como argumento
- Valida que `app === 'HorasExtra'`
- Migra 12 tablas (sin usuarios)
- Pre-carga IDs válidos en memoria para validación
- Verifica counts con `Number()` (node-pg devuelve COUNT como string)
- `process.exit(1)` si la verificación falla

**Verificación Post-Migración:**

```sql
SELECT 
  (SELECT COUNT(*) FROM nomina_empleados) as empleados,
  (SELECT COUNT(*) FROM nomina_registros) as registros,
  (SELECT COUNT(*) FROM nomina_nominas) as nominas,
  (SELECT COUNT(*) FROM nomina_tipos) as tipos,
  (SELECT COUNT(*) FROM nomina_centros) as centros,
  (SELECT COUNT(*) FROM nomina_adjuntos) as adjuntos,
  (SELECT COUNT(*) FROM nomina_usuario_empleados) as usuario_empleados,
  (SELECT COUNT(*) FROM nomina_dashboard_layout) as dashboard_layout,
  (SELECT COUNT(*) FROM nomina_telemetria) as telemetria;
```

#### Fase 4: Reconciliación de Usuarios (1 día)

**Objetivo:** Reconciliar usuarios de Nómina con el launcher.

**Script:** `modules/nomina/src/scripts/reconcile-usuarios.js`

**Flujo de Ejecución:**

```bash
# 1. Dry run (sin cambios)
node modules/nomina/src/scripts/reconcile-usuarios.js /tmp/backup.json

# 2. Revisar el reporte

# 3. Aplicar cambios
node modules/nomina/src/scripts/reconcile-usuarios.js /tmp/backup.json --apply
```

**Características del script:**
- Lee `backup.json` (no tabla fantasma)
- Para usuarios existentes: verifica `user_modulos` y agrega acceso a nomina si falta
- Para usuarios nuevos: resuelve `perfil_id` dinámicamente desde `perfiles`
- Modo dry run por defecto, `--apply` para ejecutar
- Reporte completo: creados, existentes, modulos asignados, sin perfil, omitidos

**NOTA:** La tabla `usuarios` de Nómina está obsoleta. El launcher YA tiene su propia tabla con el esquema correcto (`perfil_id`, `user_modulos`, `password_hash`).

#### Fase 5: Validación Pre-Cutover (1 día)

**Checklist:**

```bash
# 1. Roles orphanos en permisos
SELECT DISTINCT pr.rol 
FROM nomina_permisos_roles pr 
WHERE pr.rol NOT IN (SELECT nombre FROM perfiles);

# 2. UUIDs invalidos - Empleados
SELECT id FROM nomina_empleados 
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

# 3. UUIDs invalidos - Registros
SELECT id FROM nomina_registros 
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

# 4. usuario_empleados orphanos
SELECT ue.usuario_id 
FROM nomina_usuario_empleados ue 
WHERE ue.usuario_id NOT IN (SELECT id FROM usuarios);

# 5. adjuntos orphanos
SELECT a.id 
FROM nomina_adjuntos a 
WHERE a.registro_id NOT IN (SELECT id FROM nomina_registros);

# 6. Usuarios de nomina sin对应 en launcher
SELECT n.email, n.nombre
FROM nomina.usuarios_backup n
LEFT JOIN usuarios l ON l.email = n.email
WHERE l.id IS NULL
  AND n.email IS NOT NULL
  AND n.email != '';
```

#### Fase 6: Testing (1-2 días)

**Checklist:**
- [ ] Login/Logout
- [ ] CRUD Empleados
- [ ] CRUD Registros
- [ ] Aprobación de registros
- [ ] Batch approve con FOR UPDATE
- [ ] Revertir registros
- [ ] Generar nómina
- [ ] Exportar SIESA
- [ ] Dashboard y reportes
- [ ] Backup/Restore
- [ ] Permisos por rol

### 7.5 DDL Completo

```sql
-- modules/nomina/src/db/migrations_pg.sql

-- Configuracion
CREATE TABLE IF NOT EXISTS nomina_configuracion (
  clave VARCHAR PRIMARY KEY,
  valor TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_nomina_empleados_cedula ON nomina_empleados(cedula);
CREATE INDEX IF NOT EXISTS idx_nomina_empleados_sede ON nomina_empleados(sede);

-- Nominas
CREATE TABLE IF NOT EXISTS nomina_nominas (
  id UUID PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  tipo VARCHAR NOT NULL,
  inicio DATE NOT NULL,
  fin DATE NOT NULL
);

-- Registros (tabla principal)
CREATE TABLE IF NOT EXISTS nomina_registros (
  id UUID PRIMARY KEY,
  empleado_id UUID NOT NULL REFERENCES nomina_empleados(id),
  nomina_id UUID NOT NULL REFERENCES nomina_nominas(id),
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
CREATE INDEX IF NOT EXISTS idx_nomina_registros_empleado ON nomina_registros(empleado_id);
CREATE INDEX IF NOT EXISTS idx_nomina_registros_fecha ON nomina_registros(fecha);
CREATE INDEX IF NOT EXISTS idx_nomina_registros_estado ON nomina_registros(estado);
CREATE INDEX IF NOT EXISTS idx_nomina_registros_sede ON nomina_registros(sede);

-- Tipos
CREATE TABLE IF NOT EXISTS nomina_tipos (
  id VARCHAR PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  es_valor BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Roles
CREATE TABLE IF NOT EXISTS nomina_roles (
  nombre VARCHAR PRIMARY KEY
);

-- Permisos roles
CREATE TABLE IF NOT EXISTS nomina_permisos_roles (
  rol VARCHAR NOT NULL,
  permiso VARCHAR NOT NULL,
  PRIMARY KEY (rol, permiso)
);

-- Centros
CREATE TABLE IF NOT EXISTS nomina_centros (
  id UUID PRIMARY KEY,
  nombre VARCHAR NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado TIMESTAMPTZ NOT NULL
);

-- Telemetria
CREATE TABLE IF NOT EXISTS nomina_telemetria (
  id SERIAL PRIMARY KEY,
  evento VARCHAR NOT NULL,
  pagina VARCHAR,
  usuario_id UUID,
  datos TEXT,
  ua TEXT,
  ip VARCHAR,
  creado TIMESTAMPTZ NOT NULL
);

-- Adjuntos
CREATE TABLE IF NOT EXISTS nomina_adjuntos (
  id UUID PRIMARY KEY,
  registro_id UUID NOT NULL REFERENCES nomina_registros(id) ON DELETE CASCADE,
  nombre VARCHAR NOT NULL,
  mime VARCHAR NOT NULL,
  tamano BIGINT NOT NULL,
  datos BYTEA NOT NULL,
  subido TIMESTAMPTZ NOT NULL,
  subido_por UUID NOT NULL
);

-- Usuario empleados
CREATE TABLE IF NOT EXISTS nomina_usuario_empleados (
  usuario_id UUID NOT NULL,
  empleado_id UUID NOT NULL,
  PRIMARY KEY (usuario_id, empleado_id)
);

-- Dashboard layout
CREATE TABLE IF NOT EXISTS nomina_dashboard_layout (
  usuario_id UUID PRIMARY KEY,
  orden TEXT NOT NULL DEFAULT '[]',
  tamanos TEXT NOT NULL DEFAULT '{}'
);
```

### 7.6 Script de Cutover

```bash
#!/bin/bash
# migrate-cutover.sh

set -e

echo "=========================================================="
echo "  MIGRACION NOMINA: SQLite -> PostgreSQL"
echo "=========================================================="

# 1. Backup final (con servicio corriendo)
echo ""
echo "[1/7] Tomando backup final..."
curl -s -X GET http://localhost:3005/api/backup -o /tmp/nomina_backup_final.zip
echo "   Backup guardado en /tmp/nomina_backup_final.zip"

# 2. Detener nomina
echo ""
echo "[2/7] Deteniendo modulo nomina..."
pm2 stop horix-nomina
echo "   Nomina detenida"

# 3. Extraer backup.json
echo ""
echo "[3/7] Extrayendo datos del backup..."
cd /tmp
unzip -o nomina_backup_final.zip backup.json
echo "   backup.json extraido"

# 4. git pull (traer codigo nuevo ANTES de ejecutar)
echo ""
echo "[4/7] Actualizando codigo..."
cd ~/.local/share/synnoxerp
git pull origin refactor/monorepo-auth
echo "   Codigo actualizado"

# 5. Ejecutar migracion (con verificacion integrada)
echo ""
echo "[5/7] Ejecutando migracion a PostgreSQL..."
node modules/nomina/src/scripts/migrate-nomina.js /tmp/backup.json

# 6. Reconciliar usuarios
echo ""
echo "[6/7] Reconciliando usuarios..."
node modules/nomina/src/scripts/reconcile-usuarios.js /tmp/backup.json --apply

# 7. Iniciar nomina
echo ""
echo "[7/7] Iniciando modulo nomina..."
cd ~/.local/share/synnoxerp
pm2 start horix-nomina

# Verificar salud
echo ""
echo "Verificando salud del modulo..."
sleep 3
HEALTH=$(curl -s http://localhost:3005/api/health 2>/dev/null || echo '{"ok":false}')
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "   Nomina respondiendo correctamente"
else
  echo "   Nomina puede no estar lista. Verificar: pm2 logs horix-nomina"
fi

echo ""
echo "=========================================================="
echo "  MIGRACION COMPLETADA"
echo "=========================================================="
echo ""
echo "Si hay problemas, ejecutar: ./rollback-nomina.sh"
```

### 7.7 Script de Rollback

```bash
#!/bin/bash
# rollback-nomina.sh

echo "ROLLBACK: Restaurando Nomina a SQLite..."
pm2 stop horix-nomina
cp ~/.local/share/synnoxerp/backups/horas_extra.db.pre-migration \
   ~/.local/share/synnoxerp/modules/nomina/horas_extra.db
git checkout HEAD~1 -- modules/nomina/
pm2 start horix-nomina
echo "Rollback completado"
```

### 7.8 Bugs Corregidos

| # | Bug | Solucion |
|---|-----|----------|
| 1 | DELETEs en orden incorrecto rompe FKs | Invertir orden: hijos primero |
| 2 | Cutover ejecuta migrate ANTES de git pull | Reordenar: git pull -> migrate |
| 3 | Comparacion `5 !== '5'` falla siempre | Usar `Number(pg.count)` |
| 4 | Tablas faltantes (adjuntos, etc.) | Agregar secciones de INSERT |
| 5 | 2 queries por registro en validacion | Pre-cargar IDs en Set |
| 6 | Usuarios existentes sin acceso a nomina | Verificar user_modulos |

### 7.9 Archivos Clave

| Archivo | Proposito |
|---------|-----------|
| `modules/nomina/src/db/migrations_pg.sql` | DDL de tablas PostgreSQL |
| `modules/nomina/src/scripts/migrate-nomina.js` | ETL: migracion de 12 tablas |
| `modules/nomina/src/scripts/reconcile-usuarios.js` | Reconciliacion de usuarios |
| `migrate-cutover.sh` | Script de cutover |
| `rollback-nomina.sh` | Script de rollback |

### 7.10 Timeline

| Fase | Dias | Acumulado |
|------|------|-----------|
| Fase 0: Preparacion | 1 | 1 |
| Fase 1: Tablas PostgreSQL | 1 | 2 |
| Fase 2: Refactorizacion DB | 2-3 | 4-5 |
| Fase 3: Rutas Async/Await | 3-4 | 7-9 |
| Fase 3.5: ETL migrate-nomina.js | 1 | 8-10 |
| Fase 4: Reconciliacion usuarios | 1 | 9-11 |
| Fase 5: Validacion pre-cutover | 1 | 10-12 |
| Fase 6: Testing | 1-2 | 11-14 |
| Buffer imprevistos | 3-5 | **14-19** |
| **Total** | | **3-4 semanas** |

---

## 8. Backup/Restore

### 8.1 Formato

ZIP con `backup.json` + CSVs. Formato agnóstico a motor de DB.

### 8.2 Compatibilidad SQLite ↔ PostgreSQL

```javascript
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

---

## 9. Cron de Purga

```javascript
// framework/cron/purge-blacklist.js
const cron = require('node-cron');

cron.schedule('0 3 * * *', async () => {
  const { rowCount: jwt } = await pool.query(
    'DELETE FROM jwt_blacklist WHERE expirado_en < NOW()'
  );
  const { rowCount: refresh } = await pool.query(
    'DELETE FROM refresh_token_blacklist WHERE expirado_en < NOW()'
  );
  const { rowCount: sesiones } = await pool.query(
    'DELETE FROM usuario_sesion_invalidada WHERE invalidado_en < NOW() - INTERVAL \'30 days\''
  );
  console.log(`[Purge] JWT: ${jwt}, Refresh: ${refresh}, Sesiones: ${sesiones}`);
});
```

| Tabla | Purga |
|-------|-------|
| `jwt_blacklist` | Diario (>1h) |
| `refresh_token_blacklist` | Diario (>7d) |
| `usuario_sesion_invalidada` | Mensual (>30d) |

---

## 10. Decisiones de Arquitectura

### 10.1 Monorepo vs Multi-repo

**Decisión:** Monorepo

**Justificación:** Uso interno, despliegue atómico, DB compartida, permisos centralizados.

### 10.2 Multi-proceso vs Monoproceso

**Decisión:** Multi-proceso (PM2)

**Justificación:** Aislamiento de fallos, escalabilidad independiente, logs separados.

### 10.3 PostgreSQL vs SQLite

**Decisión:** PostgreSQL (migración Nómina pendiente)

**Justificación:** Consistencia, concurrencia, funcionalidades avanzadas, backups unificados.

### 10.4 JWT Enriquecido vs API Calls

**Decisión:** JWT Enriquecido

**Justificación:** 0 latencia adicional, JWT firmado, simple de implementar.

---

## 11. Roadmap de Implementación

### Corto Plazo (3-4 semanas)

- [ ] Migración Nómina SQLite → PostgreSQL
- [ ] Sistema de permisos centralizado (JWT enriquecido)

### Mediano Plazo (2-4 semanas)

- [ ] Observabilidad centralizada (tabla auditoria_central)
- [ ] Multi-proceso PM2 (separar módulos)

### Largo Plazo (1-2 meses)

- [ ] APIs internas entre módulos
- [ ] JWT corto (1h) + refresh token

---

## Apéndice A: Variables de Entorno

```bash
# Base de datos
DATABASE_URL=postgresql://user:pass@localhost:5432/horix_erp
PG_POOL_MAX=5

# JWT
JWT_SECRET=tu_secret_aqui
JWT_EXPIRY=1h
REFRESH_EXPIRY=7d

# Internal API
INTERNAL_API_SECRET=uuid-v4-aqui

# Servidor
PORT=3002
NODE_ENV=production

# CORS
CORS_ORIGIN=https://erp.horix.com
```

---

*Documento mantenido por el equipo de desarrollo SynnoxERP.*
