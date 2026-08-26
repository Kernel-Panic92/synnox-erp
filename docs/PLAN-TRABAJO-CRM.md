# Plan de Trabajo — Modulo CRM

## Estado Actual (26 Ago 2026)

### Completado ✅

| Fase | Feature | Estado |
|------|---------|--------|
| 1A | Schema + CRUD clientes/contactos | ✅ |
| 1A | Migrador CSV SIESA (encoding latin-1) | ✅ |
| 1A | Importador unificado (6 tipos: clientes, contactos, leads, cotizaciones, items, inventario) | ✅ |
| 1A | Barra de progreso SSE en importaciones | ✅ |
| 1A | Validacion de columnas por tipo | ✅ |
| 1A | Campos SIESA completos (21 campos por tercero) | ✅ |
| 1A | Sucursales (CRUD + importacion desde CSV) | ✅ |
| 1A | Listas de precio (catálogo desde CSV) | ✅ |
| 1B | Pipeline kanban + drag & drop | ✅ |
| 1B | Oportunidades CRUD + historial etapas | ✅ |
| 1B | Eliminar oportunidades (boton en modal) | ✅ |
| 1C | Visitas GPS (check-in/out + foto) | ✅ |
| 1C | Mapa Leaflet en modal detalle | ✅ |
| 1C | Visitas agrupadas por cliente + duracion | ✅ |
| 1D | Cotizaciones CRUD + items | ✅ |
| 1D | Flujo aprobacion descuentos | ✅ |
| 1D | Tabs estilo SIESA (datos, catalogo, carrito) | ✅ |
| 1D | Busqueda de productos en catalogo | ✅ |
| — | Bulk delete en todas las tablas | ✅ |
| — | Selector registros por pagina (20/100/500/1000) | ✅ |

### Pendiente 🔜

| Fase | Feature | Prioridad | Estimacion |
|------|---------|-----------|------------|
| **2A** | **API SIESA** — Cliente REST para sincronizar datos | Alta | 2-3 sesiones |
| 2A | Sincronizar clientes, precios, productos via API | Alta | 1 sesion |
| 2A | Job de sincronizacion automatica | Alta | 1 sesion |
| **2B** | **Leads** — Pagina CRUD + conversion a clientes | Alta | 1 sesion |
| 2C | **Reporteria** — Dashboard con metricas, graficas | Media | 2 sesiones |
| 2D | **MCP Tools** — 12 tools para IA | Media | 2 sesiones |
| 3 | **Campanas email** (SendGrid/Mailchimp) | Baja | 3 sesiones |
| 4 | **Integracion completa SIESA** (pedidos, facturas) | Baja | 5+ sesiones |
| 5 | **Reporteria avanzada** + analytics | Baja | 2 sesiones |

---

## Fase 2A — API SIESA (Proxima)

### Objetivo
Conectar el CRM con el ERP de SIESA para sincronizar datos automaticamente.

### Endpoint necesarios de SIESA
```
GET /api/siesa/clientes          → Clientes con sucursales
GET /api/siesa/productos         → Catalogo de productos
GET /api/siesa/listas-precio     → Listas de precio
GET /api/siesa/listas-precio/:id → Items con precios
GET /api/siesa/cotizaciones      → Cotizaciones的历史
GET /api/siesa/inventario        → Stock por bodega
```

### Archivos a crear
```
modules/crm/backend/
├── utils/
│   ├── siesaClient.js          (cliente HTTP para API SIESA)
│   ├── siesaSync.js            (logica de sincronizacion)
│   └── siesaScheduler.js       (job automatico)
└── routes/
    └── siesa.js                (endpoints de sincronizacion manual)
```

### Flujo de sincronizacion
```
1. Usuario hace clic "Sincronizar con SIESA"
2. Backend llama a API SIESA
3. Upsert en tablas locales (clientes, productos, precios)
4. Retorna estadisticas: actualizados, nuevos, errores
5. Job automatico cada 6 horas
```

---

## Fase 2B — Leads (Siguiente)

### Objetivo
Gestionar clientes potenciales y convertirlos en clientes.

### Funcionalidades
- CRUD de leads (ya tenemos la tabla)
- Pipeline de leads: nuevo → contactado → calificado → convertido/perdido
- Conversion lead → cliente (copia datos, crea registro)
- Asignacion de asesor comercial
- Fuentes de lead (CSV, formulario web, manual)

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
- Metricas de campana

---

## Fase 4 — Integracion Completa SIESA

- Sincronizar cotizaciones como pedidos en SIESA
- Estado del pedido en ERP (Retenido, Aprobado, etc.)
- Sincronizar facturas generadas
- Actualizar estados automaticamente
- Manejo de errores y reintentos

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

---

## Riesgos y Mitigaciones

| Riesgo | Mitigacion |
|--------|------------|
| API SIESA no disponible | Importar CSV como fallback |
| Volumen alto de datos | Paginacion + cache |
- Cambios en estructura SIESA | Mapeo flexible de columnas |
| Multi-device (mobile) | UI responsive, GPS funcional |
