# Plan: Modulo CRM para SynnoxERP

## Contexto

Reemplazar el CRM de SIESA (AngularJS + DevExpress, abandonado por SIESA) con un
modulo propio dentro de Synnox. El CRM actual de SIESA tiene multiples errores
en consola y SIESA ha comunicado que dejara de desarrollarlo. Se requiere
migrar al menos los datos del ultimo ano via CSV.

**Usuarios:** ~30 vendedores + gerencia
**Modulos SIESA CRM a reemplazar:** Clientes, Clientes potenciales, Contactos,
Cotizaciones/Pedidos, Campanas, Items, Comercial

## Arquitectura

```
modules/crm/
├── backend/
│   ├── migrations/          (schema crm)
│   │   ├── 001_crm_clientes_contactos.sql
│   │   ├── 002_crm_pipeline.sql
│   │   ├── 003_crm_visitas_gps.sql
│   │   ├── 004_crm_cotizaciones.sql
│   │   ├── 005_crm_descuentos.sql
│   │   ├── 006_crm_campanas.sql
│   │   ├── 007_crm_siesa_scaffold.sql
│   │   └── 008_crm_configuracion.sql
│   ├── routes/
│   │   ├── contactos.js
│   │   ├── clientes.js
│   │   ├── oportunidades.js
│   │   ├── visitas.js
│   │   ├── cotizaciones.js
│   │   ├── descuentos.js
│   │   ├── campanas.js
│   │   ├── reportes.js
│   │   └── dashboard.js
│   ├── mcp/
│   │   └── index.js         (~12 tools MCP)
│   ├── utils/
│   │   ├── email.js          (hereda SMTP launcher)
│   │   ├── geocoding.js      (reutilizar de logistica)
│   │   ├── siesaCrmMigrator.js
│   │   └── siesaClient.js    (scaffold para API futura)
│   └── server.js
├── public/
│   ├── index.html
│   ├── base.css
│   └── js/modules/
│       ├── contactos.js
│       ├── clientes.js
│       ├── pipeline.js
│       ├── visitas.js
│       ├── cotizaciones.js
│       ├── descuentos.js
│       ├── campanas.js
│       ├── reportes.js
│       └── dashboard.js
└── package.json
```

## Modelo de Datos (Schema `crm`)

### 1. Clientes

Reemplaza "Clientes" y "Clientes potenciales" de SIESA CRM.

```sql
CREATE TABLE crm.clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(255) NOT NULL,
  nit VARCHAR(30),
  tipo VARCHAR(20) CHECK (tipo IN ('potencial','real','siesa')),
  sector VARCHAR(100),
  direccion TEXT,
  ciudad VARCHAR(100),
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  telefono VARCHAR(30),
  email VARCHAR(200),
  website VARCHAR(300),
  codigo_siesa VARCHAR(30),
  vendedor_asignado UUID,
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  origen VARCHAR(50),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clientes_nombre ON crm.clientes USING gin(nombre gin_trgm_ops);
CREATE INDEX idx_clientes_nit ON crm.clientes(nit);
CREATE INDEX idx_clientes_tipo ON crm.clientes(tipo);
CREATE INDEX idx_clientes_vendedor ON crm.clientes(vendedor_asignado);
CREATE INDEX idx_clientes_codigo_siesa ON crm.clientes(codigo_siesa);
```

### 2. Contactos

```sql
CREATE TABLE crm.contactos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  cargo VARCHAR(100),
  email VARCHAR(200),
  telefono VARCHAR(30),
  whatsapp VARCHAR(30),
  es_decision_maker BOOLEAN DEFAULT FALSE,
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contactos_cliente ON crm.contactos(cliente_id);
CREATE INDEX idx_contactos_nombre ON crm.contactos USING gin(nombre gin_trgm_ops);
CREATE INDEX idx_contactos_email ON crm.contactos(email);
```

### 3. Pipeline de Oportunidades

Reemplaza "Comercial" de SIESA CRM.

```sql
CREATE TABLE crm.oportunidades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id),
  contacto_id UUID REFERENCES crm.contactos(id),
  nombre VARCHAR(255) NOT NULL,
  monto_esperado DECIMAL(15,2),
  probabilidad SMALLINT DEFAULT 10,
  etapa VARCHAR(30) CHECK (etapa IN (
    'lead','calificado','propuesta',
    'negociacion','ganada','perdida'
  )),
  motivo_perdida TEXT,
  vendedor_id UUID,
  fecha_cierre_estimada DATE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_oportunidades_cliente ON crm.oportunidades(cliente_id);
CREATE INDEX idx_oportunidades_vendedor ON crm.oportunidades(vendedor_id);
CREATE INDEX idx_oportunidades_etapa ON crm.oportunidades(etapa);
CREATE INDEX idx_oportunidades_fecha ON crm.oportunidades(fecha_cierre_estimada);
```

### 4. Historial de Cambios de Etapa

```sql
CREATE TABLE crm.oportunidad_historial (
  id SERIAL PRIMARY KEY,
  oportunidad_id UUID REFERENCES crm.oportunidades(id) ON DELETE CASCADE,
  etapa_anterior VARCHAR(30),
  etapa_nueva VARCHAR(30),
  cambiado_por UUID,
  comentario TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_historial_oportunidad ON crm.oportunidad_historial(oportunidad_id);
```

### 5. Visitas GPS

```sql
CREATE TABLE crm.visitas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id),
  contacto_id UUID REFERENCES crm.contactos(id),
  oportunidad_id UUID REFERENCES crm.oportunidades(id),
  vendedor_id UUID NOT NULL,
  tipo VARCHAR(20) CHECK (tipo IN ('checkin','checkout')),
  latitud DECIMAL(10,8) NOT NULL,
  longitud DECIMAL(10,8) NOT NULL,
  notas TEXT,
  evidencia_foto VARCHAR(500),
  fecha TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visitas_vendedor ON crm.visitas(vendedor_id);
CREATE INDEX idx_visitas_cliente ON crm.visitas(cliente_id);
CREATE INDEX idx_visitas_fecha ON crm.visitas(fecha);
CREATE INDEX idx_visitas_tipo ON crm.visitas(tipo);
```

### 6. Cotizaciones

Reemplaza "Cotizaciones/Pedidos" de SIESA CRM.

```sql
CREATE TABLE crm.cotizaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oportunidad_id UUID REFERENCES crm.oportunidades(id),
  cliente_id UUID REFERENCES crm.clientes(id),
  numero VARCHAR(50) UNIQUE,
  estado VARCHAR(20) CHECK (estado IN (
    'borrador','enviada','aprobada','rechazada',
    'vencida','enviada_siesa'
  )),
  valor_subtotal DECIMAL(15,2),
  valor_iva DECIMAL(15,2),
  valor_total DECIMAL(15,2),
  moneda VARCHAR(3) DEFAULT 'COP',
  validez_dias SMALLINT DEFAULT 30,
  notas TEXT,
  archivo_pdf VARCHAR(500),
  enviado_en TIMESTAMPTZ,
  aprobada_en TIMESTAMPTZ,
  vencimiento DATE,
  creado_por UUID,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cotizaciones_cliente ON crm.cotizaciones(cliente_id);
CREATE INDEX idx_cotizaciones_estado ON crm.cotizaciones(estado);
CREATE INDEX idx_cotizaciones_numero ON crm.cotizaciones(numero);

CREATE TABLE crm.cotizacion_items (
  id SERIAL PRIMARY KEY,
  cotizacion_id UUID REFERENCES crm.cotizaciones(id) ON DELETE CASCADE,
  producto_siesa VARCHAR(50),
  descripcion VARCHAR(500),
  cantidad DECIMAL(10,2),
  precio_unitario DECIMAL(15,2),
  descuento_pct DECIMAL(5,2) DEFAULT 0,
  subtotal DECIMAL(15,2)
);

CREATE INDEX idx_cotizacion_items_cotizacion ON crm.cotizacion_items(cotizacion_id);
```

### 7. Aprobacion de Descuentos

```sql
CREATE TABLE crm.descuentos_solicitud (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cotizacion_id UUID REFERENCES crm.cotizaciones(id),
  oportunidad_id UUID REFERENCES crm.oportunidades(id),
  cliente_id UUID REFERENCES crm.clientes(id),
  solicitado_por UUID NOT NULL,
  tipo VARCHAR(20) CHECK (tipo IN ('porcentaje','monto_fijo')),
  valor_descuento DECIMAL(15,2) NOT NULL,
  monto_original DECIMAL(15,2) NOT NULL,
  monto_final DECIMAL(15,2) NOT NULL,
  justificacion TEXT,
  estado VARCHAR(20) CHECK (estado IN (
    'pendiente','aprobado','rechazado','auto_aprobado'
  )),
  aprobado_por UUID,
  motivo_rechazo TEXT,
  umbral_aplicado DECIMAL(5,2),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  resuelto_en TIMESTAMPTZ
);

CREATE INDEX idx_descuentos_estado ON crm.descuentos_solicitud(estado);
CREATE INDEX idx_descuentos_cliente ON crm.descuentos_solicitud(cliente_id);
```

### 8. Campanas Email

```sql
CREATE TABLE crm.campanas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(255) NOT NULL,
  tipo VARCHAR(30),
  estado VARCHAR(20) CHECK (estado IN (
    'borrador','activa','pausada','completada'
  )),
  provider VARCHAR(50),
  provider_campaign_id VARCHAR(100),
  segmento_filtro JSONB,
  creado_por UUID,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm.campanas_eventos (
  id SERIAL PRIMARY KEY,
  campana_id UUID REFERENCES crm.campanas(id) ON DELETE CASCADE,
  contacto_id UUID,
  evento VARCHAR(30),
  metadata JSONB,
  fecha TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campanas_eventos_campana ON crm.campanas_eventos(campana_id);
```

### 9. SIESA Sync (Scaffold)

```sql
CREATE TABLE crm.siesa_sync_log (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50),
  direccion VARCHAR(10),
  registros_procesados INT,
  registros_exitosos INT,
  registros_fallidos INT,
  detalles JSONB,
  ejecutado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm.productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo_siesa VARCHAR(50) UNIQUE,
  nombre VARCHAR(255),
  descripcion TEXT,
  precio_unitario DECIMAL(15,2),
  unidad_medida VARCHAR(20),
  categoria VARCHAR(100),
  activo BOOLEAN DEFAULT TRUE,
  sincronizado_en TIMESTAMPTZ
);
```

### 10. Configuracion

```sql
CREATE TABLE crm.configuracion (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT,
  descripcion TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO crm.configuracion (clave, valor, descripcion) VALUES
  ('descuento_umbral_aprobacion', '10', 'Porcentaje maximo para aprobacion automatica'),
  ('numero_cotizacion_prefijo', 'COT', 'Prefijo para numeracion de cotizaciones'),
  ('numero_cotizacion_anio', EXTRACT(YEAR FROM NOW())::TEXT, 'Anio actual para numeracion');
```

## Permisos del Modulo

```javascript
crm: [
  ['ver',                    'Ver dashboard y listados'],
  ['crear_contacto',         'Crear contactos y clientes'],
  ['editar_contacto',        'Editar contactos y clientes'],
  ['eliminar_contacto',      'Eliminar contactos y clientes'],
  ['ver_pipeline',           'Ver pipeline de oportunidades'],
  ['editar_pipeline',        'Mover oportunidades entre etapas'],
  ['crear_oportunidad',      'Crear oportunidades'],
  ['registrar_visita',       'Check-in/out GPS'],
  ['ver_visitas',            'Ver visitas de todos'],
  ['ver_mis_visitas',        'Ver solo propias'],
  ['crear_cotizacion',       'Crear cotizaciones'],
  ['aprobar_descuento',      'Aprobar solicitudes de descuento'],
  ['campanas',               'Gestionar campanas email'],
  ['reportes',               'Ver reportes y metricas'],
  ['configurar',             'Configurar modulo'],
  ['siesa_sync',             'Sincronizar datos con SIESA']
]
```

### Roles de usuario tipicos

| Rol | Permisos CRM |
|-----|-------------|
| **Asesor comercial** | ver, crear_contacto, editar_contacto, ver_pipeline, crear_oportunidad, editar_pipeline, registrar_visita, ver_mis_visitas, crear_cotizacion |
| **Gerente de ventas** | Todos los del asesor + ver_visitas, aprobar_descuento, reportes, campanas |
| **Director/Admin** | Todos |
| **Soporte** | ver, ver_pipeline (solo lectura) |

## Flujo de Aprobacion de Descuentos

```
Vendedor crea cotizacion con descuento
         |
         v
   Descuento <= umbral? (default: 10%)
         |
    +----+----+
    | SI      | NO
    v         v
Auto-aprobado  Pendiente aprobacion
    |         |
    |         v
    |    Gerencia recibe notificacion
    |         |
    |    +----+----+
    |    | APRUEBA | RECHAZA
    |    v         v
    |  Aprobado  Rechazado
    |    |         |
    |    |         v
    |    |    Notifica al vendedor
    |    |
    v    v
Cotizacion lista para enviar a SIESA
```

## Georeferenciacion de Visitas

```
Vendedor abre visita -> "Check-in"
  -> navigator.geolocation.getCurrentPosition()
  -> POST /api/crm/visitas { lat, lng, contacto_id, cliente_id }
  -> Backend guarda: vendedor_id + GPS + timestamp
  -> Gerencia ve mapa con pins de visitas + filtro por vendedor/fecha
```

Reutiliza patrones existentes de logistica:
- `modules/logistica/public/app.js` (lines 1927-1977): Pin picker Leaflet
- `modules/logistica/public/app.js` (lines 2040-2074): "Locate me" button
- `modules/logistica/public/app.js` (lines 81-89): Themed tile layer
- `modules/logistica/backend/utils/geocoding.js`: Geocoding with cache
- `framework/base.css` (lines 297-303): Dark mode map CSS

## Migracion desde SIESA CRM

### Archivos CSV esperados

| CSV | Tabla destino | Mapeo clave |
|-----|--------------|-------------|
| `clientes.csv` | `crm.clientes` | tipo='real' o 'siesa' |
| `clientes_potenciales.csv` | `crm.clientes` | tipo='potencial' |
| `contactos.csv` | `crm.contactos` | FK a cliente por NIT o nombre |
| `cotizaciones.csv` | `crm.cotizaciones` | FK a cliente |
| `items.csv` | `crm.productos` | codigo_siesa como unique key |

### Script de migracion

`modules/crm/backend/utils/siesaCrmMigrator.js`

- Lee CSVs con `csv-parser` o `papaparse`
- Normaliza headers (patron similar a Smart2Go parser en logistica)
- Dedup por NIT o nombre
- Log de importacion en `crm.siesa_sync_log`
- Dry-run mode para verificar antes de insertar
- Endpoints: `POST /api/crm/migrar/:tipo`, `GET /api/crm/migrar/preview/:tipo`

## Dashboard Principal

```
+-----------------------------------------------------------+
|  Dashboard CRM                                             |
+----------+----------+----------+----------+----------------+
| Deals    | Pipeline | Visitas  | Cotiz.   | Tasa           |
| abiertos | Value    | hoy      | pend.    | conversion     |
|   24     | $45.2M   |   8      |   12     |   18%          |
+----------+----------+----------+----------+----------------+
|  Mapa de Visitas (Leaflet)  |  Pipeline Kanban             |
|  [pins de check-in/out GPS] |  [drag & drop etapas]        |
+-----------------------------+------------------------------+
|  Funnel de Conversion        |  Proximas visitas            |
|  lead -> calificado -> ...   |  agenda del dia              |
+-----------------------------+------------------------------+
|  Top vendedores / Descuentos pendientes                    |
+-----------------------------------------------------------+
```

## MCP Tools

| Tool | Descripcion |
|------|-------------|
| `crm_buscar_cliente` | Buscar por nombre, NIT, sector |
| `crm_buscar_contacto` | Buscar por nombre, email, cliente |
| `crm_listar_oportunidades` | Pipeline filtrado por etapa/vendedor |
| `crm_crear_oportunidad` | Crear deal en pipeline |
| `crm_mover_oportunidad` | Cambiar etapa del deal |
| `crm_registrar_visita` | Check-in con GPS |
| `crm_historial_visitas` | Visitas de un contacto/vendedor |
| `crm_dashboard` | Resumen ejecutivo |
| `crm_cotizaciones_pendientes` | Cotizaciones por aprobar |
| `crm_solicitar_descuento` | Crear solicitud de descuento |
| `crm_aprobar_descuento` | Aprobar/rechazar descuento |
| `crm_metricas_conversion` | Tasa lead->real, por vendedor/periodo |

## Decision: No usar Scaffold del Launcher

El launcher tiene un scaffold (`Admin → Modulos → ⚡ Crear`) que genera un modulo
externo con Express propio, JWT independiente y puerto separado. **No es suitable**
para CRM porque:

| Aspecto | Scaffold | Built-in (lo que necesitamos) |
|---------|----------|------------------------------|
| Puerto | Puerto separado (ej: 3008) | Comparte 3002 via nginx proxy |
| Auth | JWT propio o copia estatica | Comparte JWT del launcher |
| Framework | Copia estatica de archivos | Importa del `framework/` compartido |
| DB | Sin configuracion PostgreSQL | Schema propio con migraciones |
| Auditoria | No integrada | `auditarEvento()` compartido |
| Notificaciones | No integradas | `notificar()` compartido |
| Permisos | No granulares | `requirePermiso()` con catalogo |

**Decision:** Crear el modulo manualmente siguiendo el patron de built-in
(proyectos, logistica, proveedores). El modulo se monta como sub-app del launcher
en el mismo puerto 3002 via `server.js` root.

## Fases de Implementacion

| Fase | Alcance | Dependencia |
|------|---------|-------------|
| **1A** | Schema + CRUD contactos/clientes + migrador CSV SIESA | Ninguna |
| **1B** | Pipeline kanban + oportunidades + historial etapas | 1A |
| **1C** | Visitas GPS (check-in/out + mapa Leaflet + reporte vendedor) | 1A |
| **1D** | Cotizaciones + flujo aprobacion descuentos | 1A |
| **2** | MCP tools + metricas conversion + funnel chart | 1A-1D |
| **3** | Campanas email (SendGrid/Mailchimp) | 1A |
| **4** | SIESA ERP sync (catalogo, pedidos, facturas via API) | Negociacion SIESA |
| **5** | Reporteria avanzada + analytics | 1A-1D |

### Fase 1A — Detalle de Implementacion

**Objetivo:** CRUD completo de clientes y contactos + migrador CSV desde SIESA CRM.

**Archivos a crear:**

```
modules/crm/
├── package.json
├── backend/
│   ├── server.js                    (Express sub-app, ESM, montada en server.js root)
│   ├── config/
│   │   └── db.js                    (Pool PostgreSQL)
│   ├── migrations/
│   │   ├── 001_crm_clientes_contactos.sql
│   │   └── run.js
│   ├── routes/
│   │   ├── clientes.js              (CRUD + busqueda + filtros)
│   │   └── contactos.js             (CRUD + busqueda por cliente)
│   └── mcp/
│       └── index.js                 (Stub MCP)
├── public/
│   ├── index.html
│   ├── base.css
│   ├── components.css
│   ├── framework.js
│   ├── theme.js
│   └── js/
│       └── modules/
│           ├── clientes.js
│           └── contactos.js
```

**Archivos a modificar en launcher:**

```
launcher/server.js
├── Array modules[]: agregar entrada crm
├── Array builtin[]: agregar 'crm'
├── defaultPermisosConfig: agregar permisos crm
└── Seed modulos_plataforma: INSERT OR IGNORE crm
```

**Pasos de implementacion:**

1. Crear estructura de directorios `modules/crm/`
2. Crear `package.json` con dependencias (express, cors, pg, uuid)
3. Crear `backend/server.js`:
   - Express sub-app con ESM
   - `createProtect(MODULE_ID)` para auth
   - `requirePermiso()` en cada ruta
   - Montar routes en `/api/clientes`, `/api/contactos`
   - Ejecutar migraciones al iniciar
4. Crear migracion `001_crm_clientes_contactos.sql`:
   - `CREATE SCHEMA IF NOT EXISTS crm`
   - Tablas `crm.clientes` y `crm.contactos` con indices
   - Extension `pg_trgm` para busqueda fuzzy
5. Crear `routes/clientes.js`:
   - GET `/api/clientes` (lista con filtros, busqueda, paginacion)
   - GET `/api/clientes/:id` (detalle con contactos)
   - POST `/api/clientes` (crear)
   - PUT `/api/clientes/:id` (editar)
   - DELETE `/api/clientes/:id` (soft delete)
   - DELETE `/api/clientes/seleccionados` (bulk delete)
6. Crear `routes/contactos.js`:
   - GET `/api/contactos` (lista con filtro por cliente)
   - GET `/api/contactos/:id` (detalle)
   - POST `/api/contactos` (crear)
   - PUT `/api/contactos/:id` (editar)
   - DELETE `/api/contactos/:id` (soft delete)
7. Registrar en `launcher/server.js`:
   - Agregar `crm` al array `modules[]`
   - Agregar `'crm'` al array `builtin[]`
   - Agregar permisos `crm` a `defaultPermisosConfig`
8. Crear frontend basico:
   - `index.html` con sidebar, nav items, paginas
   - `app.js` con navigate, api, carga de modulos
   - `js/modules/clientes.js` con tabla, filtros, modales
   - `js/modules/contactos.js` con tabla, filtros, modales
9. Ejecutar migracion en PostgreSQL
10. Verificar: listar, crear, editar, eliminar clientes y contactos

**Criterios de aceptacion:**

- [ ] Tabla `crm.clientes` creada con indices
- [ ] Tabla `crm.contactos` creada con FK a clientes
- [ ] CRUD clientes funciona (GET, POST, PUT, DELETE)
- [ ] CRUD contactos funciona (GET, POST, PUT, DELETE)
- [ ] Busqueda fuzzy por nombre funciona (pg_trgm)
- [ ] Paginacion funciona
- [ ] Filtros por tipo, vendedor, ciudad funcionan
- [ ] Soft delete funciona (activo = FALSE)
- [ ] Permisos CRM registrados en launcher
- [ ] Modulo visible en sidebar del launcher
- [ ] Auth compartida funciona (mismo JWT)

## Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `server.js` (root) | Montar CRM como sub-app ESM en `/crm/` + SPA catch-all |
| `launcher/server.js` | Agregar modulo `crm` al array `modules[]` y `builtin[]` |
| `launcher/server.js` | Seed de permisos `crm` en `defaultPermisosConfig` |
| `launcher/shell/index.html` | Nav item "CRM" en sidebar |
| `launcher/shell/app.js` | Ruta `#page-crm` y ocultar botones admin para asesores |

## Convenciones a Seguir

- **Modales**: Definir en HTML con `class="modal-overlay"`, NO crear dinamicamente
- **Confirmaciones**: Usar `confirmModal()` del framework, NUNCA `confirm()`
- **Mensajes**: Usar `toast()` del framework
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, etc.)
- **API**: Todas las rutas usan `verificarToken, requirePermiso`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`
- **DB**: Migraciones con `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **Auth**: Siempre via `createProtect(MODULE_ID)`
- **Leaflet en modales**: Limpiar `el._leaflet_id = null` antes de `L.map(el)`. Usar `invalidateSize()` con timeout
- **GPS coordinates**: `DECIMAL(10,8)` (consistente con logistica)
- **UUIDs**: `uuid_generate_v4()` en PostgreSQL
- **Timestamps**: `TIMESTAMPTZ DEFAULT NOW()`
- **Soft delete**: `activo BOOLEAN DEFAULT TRUE`
- **Auditoria**: Usar `auditarEvento()` de framework/audit.js
- **Notificaciones**: Usar `notificar()` de framework/notify.js

## Estado Actual

- [x] Plan aprobado por el usuario
- [x] Branch `feat/crm-module` creada
- [x] Documentacion formal creada
- [x] Decision: No usar scaffold (usar patron built-in)
- [x] Fase 1A: Detalle de implementacion documentado
- [ ] Fase 1A: Schema + CRUD contactos/clientes + migrador CSV
- [ ] Fase 1B: Pipeline kanban + oportunidades
- [ ] Fase 1C: Visitas GPS
- [ ] Fase 1D: Cotizaciones + aprobacion descuentos
- [ ] Fase 2: MCP tools + metricas
- [ ] Fase 3: Campanas email
- [ ] Fase 4: SIESA ERP sync
- [ ] Fase 5: Reporteria avanzada
