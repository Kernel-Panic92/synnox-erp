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
│   ├── migrations/          (schema crm — 010 migraciones)
│   ├── routes/
│   │   ├── clientes.js      (CRUD + bulk delete)
│   │   ├── contactos.js     (CRUD + bulk delete)
│   │   ├── sucursales.js    (CRUD por cliente)
│   │   ├── oportunidades.js (CRUD + historial + drag & drop)
│   │   ├── visitas.js       (check-in/out GPS + foto)
│   │   ├── cotizaciones.js  (CRUD + items + descuentos)
│   │   ├── descuentos.js    (aprobar/rechazar)
│   │   ├── productos.js     (CRUD + busqueda + importar CSV)
│   │   └── importar.js      (importador unificado SIESA)
│   ├── utils/
│   │   └── siesaClient.js   (FUTURO: cliente API SIESA)
│   ├── config/db.js
│   └── server.js
├── public/
│   ├── index.html
│   ├── app.js
│   ├── framework.js
│   └── theme.js
└── package.json
```

## Modelo de Datos (Schema `crm`)

### 1. Clientes (21 campos SIESA)

```sql
CREATE TABLE crm.clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(255) NOT NULL,
  nit VARCHAR(30),
  tipo VARCHAR(20) CHECK (tipo IN ('potencial','real','siesa')),
  sector VARCHAR(100),
  direccion TEXT,
  ciudad VARCHAR(100),
  departamento VARCHAR(100),
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  telefono VARCHAR(30),
  email VARCHAR(200),
  website VARCHAR(300),
  codigo_siesa VARCHAR(30),
  codigo_ean VARCHAR(50),
  vendedor_asignado INTEGER,
  asesor_comercial VARCHAR(255),
  cobrador VARCHAR(100),
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  origen VARCHAR(50) DEFAULT 'manual',
  -- Campos SIESA adicionales
  canal VARCHAR(100),
  tipo_negocio VARCHAR(100),
  ruta_vehiculos VARCHAR(100),
  ruta_motos VARCHAR(100),
  lista_precios VARCHAR(100),
  correo_fe VARCHAR(200),
  sucursal_corporativa VARCHAR(50),
  razon_social VARCHAR(255),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Sucursales

```sql
CREATE TABLE crm.sucursales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL REFERENCES crm.clientes(id) ON DELETE CASCADE,
  codigo VARCHAR(30),
  nombre VARCHAR(255) NOT NULL,
  direccion TEXT,
  ciudad VARCHAR(100),
  departamento VARCHAR(100),
  telefono VARCHAR(30),
  email VARCHAR(200),
  contacto_nombre VARCHAR(255),
  es_principal BOOLEAN DEFAULT FALSE,
  notas TEXT,
  activa BOOLEAN DEFAULT TRUE,
  siesa_id VARCHAR(100),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Contactos

```sql
CREATE TABLE crm.contactos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES crm.sucursales(id),
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
```

### 4. Pipeline de Oportunidades

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

CREATE TABLE crm.oportunidad_historial (
  id SERIAL PRIMARY KEY,
  oportunidad_id UUID REFERENCES crm.oportunidades(id) ON DELETE CASCADE,
  etapa_anterior VARCHAR(30),
  etapa_nueva VARCHAR(30),
  cambiado_por INTEGER,
  comentario TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. Visitas GPS

```sql
CREATE TABLE crm.visitas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id),
  contacto_id UUID REFERENCES crm.contactos(id),
  oportunidad_id UUID REFERENCES crm.oportunidades(id) ON DELETE SET NULL,
  vendedor_id INTEGER NOT NULL,
  tipo VARCHAR(20) CHECK (tipo IN ('checkin','checkout')),
  latitud DECIMAL(10,8) NOT NULL,
  longitud DECIMAL(10,8) NOT NULL,
  precision_gps DECIMAL(10,2),
  notas TEXT,
  evidencia_foto VARCHAR(500),
  fecha TIMESTAMPTZ DEFAULT NOW()
);
```

### 6. Cotizaciones

```sql
CREATE TABLE crm.cotizaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oportunidad_id UUID REFERENCES crm.oportunidades(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES crm.clientes(id),
  sucursal_id UUID REFERENCES crm.sucursales(id),
  numero VARCHAR(50) UNIQUE,
  estado VARCHAR(20) DEFAULT 'borrador',
  valor_subtotal DECIMAL(15,2) DEFAULT 0,
  valor_descuento DECIMAL(15,2) DEFAULT 0,
  valor_iva DECIMAL(15,2) DEFAULT 0,
  valor_total DECIMAL(15,2) DEFAULT 0,
  moneda VARCHAR(3) DEFAULT 'COP',
  validez_dias SMALLINT DEFAULT 30,
  notas TEXT,
  vencimiento DATE,
  -- Campos SIESA
  orden_compra VARCHAR(50),
  fecha_entrega DATE,
  centro_operacion VARCHAR(100),
  bodega VARCHAR(100),
  condicion_pago VARCHAR(100),
  lista_precios VARCHAR(100),
  documento_erp VARCHAR(50),
  estado_erp VARCHAR(50),
  vendedor_nombre VARCHAR(255),
  motivo VARCHAR(100),
  aprobado BOOLEAN DEFAULT FALSE,
  enviado_erp BOOLEAN DEFAULT FALSE,
  creado_por UUID,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm.cotizacion_items (
  id SERIAL PRIMARY KEY,
  cotizacion_id UUID REFERENCES crm.cotizaciones(id) ON DELETE CASCADE,
  referencia VARCHAR(50),
  descripcion VARCHAR(500) NOT NULL,
  unidad_medida VARCHAR(20) DEFAULT 'UND',
  cantidad DECIMAL(10,2) DEFAULT 1,
  precio_unitario DECIMAL(15,2) DEFAULT 0,
  descuento_pct DECIMAL(5,2) DEFAULT 0,
  subtotal DECIMAL(15,2) DEFAULT 0,
  orden SMALLINT DEFAULT 0
);
```

### 7. Descuentos

```sql
CREATE TABLE crm.descuentos_solicitud (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cotizacion_id UUID REFERENCES crm.cotizaciones(id),
  cliente_id UUID REFERENCES crm.clientes(id),
  solicitado_por UUID NOT NULL,
  tipo VARCHAR(20) CHECK (tipo IN ('porcentaje','monto_fijo')),
  valor_descuento DECIMAL(15,2) NOT NULL,
  monto_original DECIMAL(15,2) NOT NULL,
  monto_final DECIMAL(15,2) NOT NULL,
  justificacion TEXT,
  estado VARCHAR(20) DEFAULT 'pendiente',
  aprobado_por UUID,
  motivo_rechazo TEXT,
  umbral_aplicado DECIMAL(5,2),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  resuelto_en TIMESTAMPTZ
);
```

### 8. Productos + Inventario

```sql
CREATE TABLE crm.productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  unidad_medida VARCHAR(20) DEFAULT 'UND',
  precio_unitario DECIMAL(15,2) DEFAULT 0,
  tasa_impuesto DECIMAL(5,2) DEFAULT 0,
  categoria VARCHAR(100),
  bodega VARCHAR(100),
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm.inventario (
  id SERIAL PRIMARY KEY,
  producto_id UUID REFERENCES crm.productos(id),
  bodega VARCHAR(100) NOT NULL,
  precio DECIMAL(15,2) DEFAULT 0,
  disponibilidad DECIMAL(10,2) DEFAULT 0,
  existencia DECIMAL(10,2) DEFAULT 0,
  comprometida DECIMAL(10,2) DEFAULT 0,
  unidad_medida VARCHAR(20),
  UNIQUE(producto_id, bodega)
);
```

### 9. Listas de Precio

```sql
CREATE TABLE crm.listas_precio (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  moneda VARCHAR(3) DEFAULT 'COP',
  activa BOOLEAN DEFAULT TRUE
);

CREATE TABLE crm.lista_precio_items (
  id SERIAL PRIMARY KEY,
  lista_id INTEGER REFERENCES crm.listas_precio(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES crm.productos(id),
  precio DECIMAL(15,2) NOT NULL,
  UNIQUE(lista_id, producto_id)
);
```

### 10. Configuracion

```sql
CREATE TABLE crm.configuracion (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT,
  descripcion TEXT
);
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

## Decision: No usar Scaffold del Launcher

El launcher tiene un scaffold que genera un modulo externo con Express propio,
JWT independiente y puerto separado. No es suitable para CRM porque no comparte
auth, framework ni auditoria. Se uso el patron built-in (como proyectos, logistica).

---

## Estado Actual (26 Ago 2026)

### Completado ✅

| Fase | Feature | Detalle |
|------|---------|---------|
| **1A** | Schema + CRUD clientes/contactos | 21 campos SIESA por tercero |
| **1A** | Importador unificado SIESA | 6 tipos: clientes, contactos, leads, cotizaciones, items, inventario |
| **1A** | Barra de progreso SSE | Streaming con progreso en tiempo real |
| **1A** | Sucursales | CRUD + importacion desde CSV + sucursal 001 = principal |
| **1A** | Listas de precio | 22 listas creadas desde CSV |
| **1A** | Campos SIESA completos | departamento, cobrador, correo_fe, asesor, codigo_ean, etc. |
| **1B** | Pipeline kanban | Drag & drop entre etapas |
| **1B** | Oportunidades CRUD | + historial de cambios de etapa |
| **1C** | Visitas GPS | Check-in/out + foto + mapa Leaflet |
| **1C** | Visitas agrupadas | Por cliente + duracion (checkin→checkout) |
| **1D** | Cotizaciones | CRUD + items + tabs estilo SIESA |
| **1D** | Aprobacion descuentos | Auto-aprobado si ≤ umbral, pendiente si > |
| **1D** | Catalogo productos | Busqueda + agregar al carrito |
| **—** | Bulk delete | En todas las tablas (seleccion o todos) |
| **—** | Paginacion | 20/100/500/1000 registros por pagina |

### Pendiente 🔜

| Fase | Feature | Prioridad | Estimacion |
|------|---------|-----------|------------|
| **2A** | **API SIESA** — Sincronizar clientes, precios, productos | 🔴 Alta | 2-3 sesiones |
| **2A** | Job de sincronizacion automatica | 🔴 Alta | 1 sesion |
| **2B** | **Leads** — CRUD + conversion a clientes | 🔴 Alta | 1 sesion |
| **2C** | **Reporteria** — Dashboard, graficas, metricas | 🟡 Media | 2 sesiones |
| **2D** | **MCP Tools** — 12 tools para IA | 🟡 Media | 2 sesiones |
| **3** | **Campanas email** (SendGrid/Mailchimp) | 🟢 Baja | 3 sesiones |
| **4** | **Integracion completa SIESA** (pedidos, facturas) | 🟢 Baja | 5+ sesiones |
| **5** | **Reporteria avanzada** + analytics | 🟢 Baja | 2 sesiones |

---

## Fase 2A — API SIESA (Proxima Prioridad)

### Objetivo
Sincronizar datos del ERP de SIESA automaticamente via API REST.

### Endpoints necesarios de SIESA
```
GET /api/siesa/clientes          → Clientes con sucursales
GET /api/siesa/productos         → Catalogo de productos
GET /api/siesa/listas-precio     → Listas de precio
GET /api/siesa/listas-precio/:id → Items con precios
GET /api/siesa/cotizaciones      → Cotizaciones historicas
GET /api/siesa/inventario        → Stock por bodega
```

### Archivos a crear
```
modules/crm/backend/utils/
├── siesaClient.js       (cliente HTTP para API SIESA)
├── siesaSync.js         (logica de sincronizacion)
└── siesaScheduler.js    (job automatico cada 6h)

modules/crm/backend/routes/
└── siesa.js             (endpoints de sync manual)
```

### Flujo
```
1. Usuario hace clic "Sincronizar con SIESA"
2. Backend llama a API SIESA
3. Upsert en tablas locales
4. Retorna estadisticas
5. Job automatico cada 6 horas
```

---

## Fase 2B — Leads

### Funcionalidades
- CRUD de leads (tabla ya existe)
- Pipeline: nuevo → contactado → calificado → convertido/perdido
- Conversion lead → cliente
- Asignacion de asesor comercial
- Fuentes: CSV, formulario web, manual

---

## Fase 2C — Reporteria

### Dashboard ejecutivo
- Ventas por vendedor
- Conversion lead → cliente
- Tiempo promedio de ciclo de venta
- Cotizaciones por estado
- Visitas por zona

### Graficas
- Funnel de conversion
- Tendencia de ventas mensual
- Mapa de calor de visitas
- Top 10 clientes por volumen

---

## Fase 2D — MCP Tools

| Tool | Descripcion |
|------|-------------|
| `crm_buscar_cliente` | Buscar por nombre, NIT, sector |
| `crm_buscar_contacto` | Buscar por nombre, email, cliente |
| `crm_listar_oportunidades` | Pipeline filtrado |
| `crm_crear_oportunidad` | Crear deal |
| `crm_mover_oportunidad` | Cambiar etapa |
| `crm_registrar_visita` | Check-in con GPS |
| `crm_historial_visitas` | Visitas de un contacto/vendedor |
| `crm_dashboard` | Resumen ejecutivo |
| `crm_cotizaciones_pendientes` | Cotizaciones por aprobar |
| `crm_solicitar_descuento` | Crear solicitud |
| `crm_aprobar_descuento` | Aprobar/rechazar |
| `crm_metricas_conversion` | Tasa lead→real |

---

## Fase 3 — Campanas Email

- Integracion con SendGrid/Mailchimp
- Crear campana desde el CRM
- Seleccionar destinatarios (leads, clientes)
- Plantillas de email
- Tracking de aperturas y clics

---

## Fase 4 — Integracion Completa SIESA

- Sincronizar cotizaciones como pedidos en SIESA
- Estado del pedido en ERP (Retenido, Aprobado, etc.)
- Sincronizar facturas generadas
- Actualizar estados automaticamente

---

## Fase 5 — Reporteria Avanzada

- Reportes PDF exportables
- Analisis de tendencias
- Comparativas por periodo
- KPIs automaticos
- Alertas de vencimiento

---

## Metricas de Exito

| Metrica | Meta |
|---------|------|
| Tiempo de carga pagina | < 2s |
| Importacion 2000 registros | < 30s |
| Sincronizacion SIESA | < 60s |
| Uptime modulo | 99.5% |
| Satisfaccion vendedores | > 8/10 |

## Riesgos y Mitigaciones

| Riesgo | Mitigacion |
|--------|------------|
| API SIESA no disponible | Importar CSV como fallback |
| Volumen alto de datos | Paginacion + cache |
| Cambios en estructura SIESA | Mapeo flexible de columnas |
| Multi-device (mobile) | UI responsive, GPS funcional |
