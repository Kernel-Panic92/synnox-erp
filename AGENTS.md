# SynnoxERP — Contexto del proyecto

## Estado (09 Sep 2026 — sesión 56 — build mode)

### Cambios Sesión 56 — Cotización a lead (simulación) + payloads SIESA para Gemini

Sesión en `feat/crm-module` (build). Flujo completo oportunidad → cotización
sintética con validaciones de perfil, y cotización a lead con envío bloqueado.

#### Cotizaciones sintéticas fieles (`scripts/genera_cotizaciones.js`)
- Réplica del POST real: permiso `crear_cotizacion`, centro/bodega/lista/motivo
  contra config del perfil, precio desde `lista_precio_items` (sin fallback
  inventado), totales como `recalcularTotales`, numero secuencial `COT-xxxxx`.
- Solo crea las 100% limpias: omite oportunidades sin precio en lista.
- Exporta payload dual a `scripts/payloads/` (ignorado en git) con flags
  `missing`, `warnings` y `envio422` para validar con Gemini (f350/f351).
- Hallazgos: 2/4 iniciales en $0 (sin precio en lista ni base); bodegas de
  5 dígitos sin mapeo `bodega_co` → 422 (solo 4 mapeos a nivel CO); ruta
  enviable hoy = bodega vacía + fallback por CO.
- Limpieza: `DELETE items + cotizaciones WHERE notas LIKE 'Sintética de OPORT-%'`.

#### Cotización a lead — Migración 037 + backend + UI
- `037_crm_cotizacion_lead.sql`: `lead_id` en `cotizaciones` + índice.
- `POST /cotizaciones`: `cliente_id` **o** `lead_id`; con lead usa asesor/lista
  del lead y omite validación de sucursales. `PUT`/list/detail/stats con
  `lead_nombre`.
- Envío bloqueado con 422 claro en ruta y `enviarPedidoAlHub` (convertir lead
  a cliente formal). Preview arma tercero desde el lead.
- UI sin toggle (confundía): búsqueda unificada clientes+leads, aviso ámbar
  de simulación al elegir lead, prefill desde oportunidad con lead, badge
  `lead` en tabla y detalle.

#### Próxima sesión
- Verificar flujo lead end-to-end en UI (requiere `pm2 restart` por migración 037).
- Completar mapeos `bodega_co` (24 bodegas) con códigos SIESA.
- Completar `Precios por item` (SKUs en $0).
- Validar payloads con Gemini contra spec f350/f351 del Hub.

## Estado (09 Sep 2026 — sesión 55 — build mode)

### Cambios Sesión 55 — Installer hardening, sidebar gold standard y saldos iniciales

Sesión en `feat/crm-module` (build). Instalación limpia en dev, restore de backup
prod, importación de saldos iniciales SIESA y unificación del sidebar de los 5
módulos con el CRM como referencia gold.

#### Installer — Instalación limpia + restore prod
- `install.sh`: converge password PG (`ALTER USER` contra `.env`, evita 28P01),
  genera `INTERNAL_API_TOKEN`, git no-interactivo + `SKIP_GIT`, schema/extensiones/
  migraciones CRM, log de migraciones con resumen (`ON_ERROR_STOP=1` en
  `.install-migrations.log`), smoke test post-PM2 (health de los 5 módulos) y
  bloque nginx `/api/admin/backup/restore` sin límite (evita 413).
- Migración `030` reescrita idempotente (bloque `DO`: solo altera si la columna
  aún es UUID, vía `::text`, no-nulos no numéricos → NULL). El 030 original
  abortaba el auto-migrate y dejaba 031–036 sin aplicar en limpio.
- `pnpm-workspace.yaml` + lockfile incluyen `modules/crm` (`csv-parse`/`xlsx`;
  sin esto el CRM no montaba → 404 en `/crm/api/*`).
- Restore de backup prod a dev verificado (10GB, multer a disco, PM2 restart).

#### CRM — Importación saldos iniciales + auth FormData
- `importar.js`: inventario acepta `xlsx,csv` (el backend ya parseaba CSV latin-1;
  solo la etiqueta `extensiones` lo bloqueaba) y el validador acepta `referencia`
  como clave de producto.
- Saldos: `inventario.csv` (1035 filas) → 769 registros iniciales; 266 filas
  (128 SKUs en bodegas x15/x90, 826.445 unds) sin maestro → se generó
  `items_faltantes_saldos.csv` desde el propio inventario y se importó (1065
  productos). Reimportar inventario rescata el resto (upsert idempotente).
- `app.js`: los 5 POST FormData (importar, actividades, checkin/checkout,
  adjuntos ×2) ahora mandan `Bearer` además de cookie (solo-cookie daba 401
  'Token requerido' tras el restore) + manejo de errores HTTP sin colgar el
  spinner SSE.

#### Sidebar — CRM como gold standard del framework
- Estándar: secciones `.sidebar-section-title`, tooltips `data-tooltip`, toggle
  fantasma ❮/❯ (26px, sin óvalo), `aria-current`/`aria-expanded`/labels,
  `focus-visible`, footer colapsado con geometría de nav-item, iconos 20px,
  `Cerrar sesión` con tilde, `?v=` bump en scripts.
- Aplicado a `framework/` (canon: `framework.js`, `base.css`, `init.sh`,
  `README.md`) y replicado en logística (12 items → 4 secciones, mapa 🗺️→🧭),
  proyectos (7 items → 3 secciones), nómina (fix `data-page nominas→nomina`) y
  proveedores (secciones al canon 11px, badges intactos).
- `scripts/genera_oportunidades.js`: modo `--dias N` (mes simulado: 50
  `OPORT-*` 10-ago→9-sep, etapas coherentes con antigüedad, historial fechado,
  `motivo_perdida` en perdidas). Limpieza: 3 DELETEs por `nombre LIKE 'OPORT-%'`.

#### Commits sesión 55 (desde `471658e`)
- `0f6746d` — `fix(installer): instalación limpia compatible con CRM y restore sin 413`

## Estado (07 Sep 2026 — sesión 54 — build mode)

### Cambios Sesión 54 — CRM: Places por proxy, Dashboard gerencial y Analítica Avanzada

Sesión en `feat/crm-module` (build). Se arregló Google Places en leads, se unificó el combobox en actividades, se aplicó GPS a visitas y se construyó un Dashboard con widgets y pestaña de Analítica Avanzada.

#### Google Places en Lead — Proxy backend (fix definitivo)
- **Problema**: cargar `maps.googleapis.com/maps/api/js` en frontend causaba `gmp-internal-* already defined` + `Module common has been provided more than once` y no desplegaba opciones.
- **Fix** (`6d15074`→`5239080`→`2fa5302`→`4d860f8`): ya NO se carga el JS de Google Maps. Backend proxy `routes/places.js` (`GET /api/places/autocomplete?input=&components=country:co` + `GET /api/places/details?place_id=` usando `google_maps_key` del Launcher). Frontend `_initLeadPlacesAutocomplete` con dropdown propio `position:fixed z-index:300` append a `document.body` (evita clipping por `overflow-y:auto` del `.modal`), posicionado con `getBoundingClientRect()`, DANE auto + lat/lng + place_id. **IMPORTANTE**: las llamadas estaban comentadas en `abrirModalLead` — descomentadas.
- `places.js` montado en `server.js` como `/api/places` con `protect`.

#### Combobox unificado y GPS en Actividades
- **Nueva Actividad** (`9df7ae3`): cliente combobox pasa de `✓ ... ✕` debajo a selección **dentro del input** (`readOnly` + clic para cambiar), con `filtrarActClientes` usando debounce API (300ms) en vez de cache local. `guardarActividad` sigue leyendo del `<select>` hidden.
- **GPS en visitas** (`5100387`): condición `tipo === 'reunion'` → `['reunion','visita'].includes(tipo)` en `actualizarActGPSGroup` y `guardarActividad`. Mapa + captura GPS auto para Visita en Proceso/Realizada igual que Reunión. `llamada/nota` siguen sin GPS.

#### Pipeline — KPIs con feedback de Gemini
- **3 KPIs nuevos** (`1eb839d`): Vencidas clicable (toggle resalta tarjetas `data-vencida`, badge `⏰ VENCIDA fecha` + borde rojo), Conversión por etapa (funnel `L→C·C→P·P→N`), Pérdida por causal (mini-barras por `motivo_perdida`). Backend `/oportunidades/stats` agrega `perdida_por_motivo`.
- **Pulido visual** (`87820c9`→`cf3a511`→`7924715`): `#stats-pipeline` flex con `overflow-x:auto` + scroll suave; funnel vertical con `funnel-row` (texto izq, % der) y badges dinámicos (verde ≥50%, naranja 30-49%, rojo <30%, `—` sin base); `kpi-chips` para fuente/prioridad/etapa; títulos arriba (`stat-label-top`); tooltips `title` con fórmula; `formatMoneyShort` montos compactos en headers Kanban (`$152,3 M`).

#### Dashboard — Widgets y filtros de periodo
- **4 widgets** (`2b3adce`→`bbe8f44`): Embudo de ventas (barras por etapa, Perdida gris), Rendimiento de asesores (top 10 por monto ganado), Tendencia mensual (SVG nativo con `generate_series` rellenando meses vacíos + `<title>` tooltip), Distribución geográfica (top 8 ciudades, scroll 220px). Sin `better-sqlite3` en backend (fix `dd57117` ERR_DLOPEN_FAILED ABI 115 vs 127 → nombres de asesores resueltos en frontend vía `_pipelineVendedorCache`).
- **Filtros de periodo** (`3705a80`): barra `Periodo` con `desde/hasta` + botones `Mes actual`, `Mes anterior`, `Trimestre`, `✕ Limpiar`. Backend `/api/dashboard` respeta `desde/hasta` en funnel/ranking/tendencia/ciudades con casting `::date + INTERVAL '1 day'`. Se eliminó la tabla de Clientes Recientes.

#### Analítica Avanzada — pestaña 3×2 (9 widgets)
- **Tabs** `Resumen`/`Analítica Avanzada` en dashboard (`d91c0f8`→`072e96f`), comparten filtros de periodo.
- **Endpoint** `GET /api/dashboard/analytics` con 9 métricas:
  - **ACV** (promedio ganadas), **Pipeline coverage** (pipeline÷meta editable `window._metaMensual`; rojo <1x, naranja 1-3x, verde 3-4x), **Forecast ponderado** (Σ monto×prob ÷ meta, `window._forecastActual`), **Velocidad por etapa** (días entre cambios de `oportunidad_historial`, orden cronológico), **Pérdida por causal** (%), **Slippage** (vencidas/abiertas, rojo ≥40%), **Recurrencia de clientes** (ganadas recurrentes vs nuevos), **Ticket promedio por canal** (AVG ganadas por fuente), **LTV estimado** (ACV × recurrencia).
- **Drag & drop a PERDIDA** (`072e96f`): si la oportunidad no tiene `motivo_perdida`, `prompt` obligatorio con 5 opciones (Precio, Competencia, Sin presupuesto, No responde, Otro) — alimenta Pérdida por causal.
- **Descartado** (sin datos): CAC, Deal Slippage (historial de fechas), quota real por vendedor (no existe `crm.metas`).

#### Nota técnica
- El server corre como root en PM2 (`/root/.pm2`). El binario `better-sqlite3@11.10.0` está compilado para Node ABI 115 pero el runtime pide 127 → `ERR_DLOPEN_FAILED`. Evitar `import('better-sqlite3')` en rutas del CRM; resolver nombres de usuarios en frontend o vía endpoint `/perfiles-venta/*`.

#### Commits sesión 54 (desde `ace122b`)
- `4d860f8` — `fix(crm): lead Places proxy estaba comentado — descomenta _initLeadPlacesAutocomplete`
- `2fa5302` — `fix(crm): lead direccion dropdown via fixed positioning (overflow modal clipping)`
- `5239080` — `fix(crm): SyntaxError expected expression got ')' (app.js:1389)`
- `6d15074` — `feat(crm): lead direccion via proxy Places (no gmaps js multiple)`
- `9df7ae3` — `feat(crm): actividades cliente combobox con seleccion dentro del input`
- `5100387` — `feat(crm): GPS auto tambien para visitas en proceso/realizada`
- `1eb839d` — `feat(crm): pipeline KPIs — vencidas clicable, funnel conversion, perdida por causal`
- `87820c9`/`cf3a511`/`7924715` — `style(crm): pipeline KPIs legibles/perfect/scroll + montos compactos`
- `2b3adce` — `feat(crm): dashboard widgets — embudo, ranking asesores, tendencia SVG, geografica`
- `dd57117` — `fix(crm): dashboard 500 — quita import better-sqlite3 (ERR_DLOPEN_FAILED)`
- `fc1cd4f` — `fix(crm): dashboard asesores — espera cache vendedores para nombre`
- `3705a80` — `feat(crm): dashboard filtro fechas (mes actual/anterior/trimestre)`
- `bbe8f44` — `style(crm): dashboard — perdida gris, tendencia meses completos, ciudades scroll, sin clientes recientes`
- `d91c0f8` — `feat(crm): dashboard Analitica Avanzada — ACV, coverage, velocity, loss, recurrencia, LTV`
- `072e96f` — `feat(crm): analitica 3x2 — slippage, ticket por canal, forecast ponderado, motivo obligatorio`

## Estado (04 Sep 2026 — sesión 53 — build mode)

### Cambios Sesión 52-53 — CRM: Hub SIESA mock, payload f350/f351 y Pipeline pulido

Sesión en `feat/crm-module` (build). Se dejó el CRM listo para SIESA Hub sin docs oficiales, se corrigieron precios/condición de pago y se pulió Pipeline/Oportunidades con combobox buscables.

#### Hub SIESA — Mock y payload dual
- Migraciones `025` `crm.vendedores` + `usuario_perfil_venta.codigo_vendedor`, `026` `crm.hub_config` + `crm.hub_envios` (UUID fix `a67ef8b`), `027` `crm.siesa_mapeos` (cond_pago, unidad_negocio, centro_costo, bodega_co), `028/029` campos SIESA en clientes/productos, `030` `creado_por INTEGER` fix `500` en crear cotización (`5262821`), `031` `bodega_co`, `032/033` `oportunidades.fuente/prioridad/lista_precios`.
- `utils/hubClient.js` (`2ba454e`): `buildHubPayload` (payload limpio) + `toSiesaPayload` (mapea vía `siesa_mapeos` a `Encabezado{f350_id_co,f350_id_tipo_docto,f350_id_tercero,f350_id_sucursal_fact/desp,f430_id_vendedor,f430_id_cond_pago,f430_id_lista_precios,f430_id_bodega,f350_id_unidad_negocio}` + `Movimientos[{f351_consecutivo,f351_id_item,f351_cant_pedida,f351_precio_unitario,f351_porc_descuento,f351_porc_iva,f351_subtotal}]` con liquidación por línea). `totales {bruto,descuento,subtotal,iva,total}` coherente (ej. `COT-134311` 430k→46k→384k→34.960→418.960) y `iva` sumado por renglón (`5cb9e67` fix exento 0 vs 19).
- `routes/hub.js` (`2ef2714`): `GET/PUT /hub/config`, `POST /hub/sync`, `POST /hub/enviar/:id`, `GET /hub/payload/:id` dual (`payload_crm + payload_siesa`), `GET /hub/envios`. `POST /cotizaciones/:id/enviar-erp` ahora genera `CPV-MOCK-xxxxx` y actualiza `documento_erp`.
- Validación por perfil en `POST /cotizaciones` (`centro/bodega/lista/motivo` vs `getPerfilConfigForUser`) y `requireVentasPerfil` extendido a `PUT/DELETE/items/estado/enviar-erp` (`4c9fc97`).
- UI `Admin → SIESA Hub` con toggle mock, base_url/client_id/secret y lista de envíos.

#### Cotizaciones — Precios y condición
- `GET /productos/buscar?lista=200` hace `COALESCE(lista_precio_items.precio, cualquier lista, base)` (`2b87c6a`) + frontend envía `lista` actual — fix `0303 Kg $10.000` que salía `$0`. `0303` insertado a `200` para demo.
- `Vendedor` ahora resuelve nombre vía `GET /perfiles-venta/vendedores` (`0c98cee`) y `Condición de pago` autocompleta desde `medio_pago_desc` (`eaaeb1e` → `EFECTIVO`).

#### Oportunidades / Pipeline — Combobox y negocio
- Mig `032/033` añade `fuente/prioridad/lista_precios` a `crm.oportunidades`; backend `POST/PUT` y precio por lista al agregar producto (`efd82c7`).
- Modal `Nueva Oportunidad`: `Cliente/Lead` buscables con debounce (`filtrarOportunidadClientes/Leads` + `✓ seleccionado ✕`), `Contacto` con filtro, `Fuente`/`Prioridad`/`Motivo pérdida` selects, `Lista de precios` combobox por defecto del perfil (`2af4b05`, `5866072` quita filtro contacto sobrante, `f300741` no pisa monto si producto sin precio).
- `Vendedor` en combobox buscable solo con perfil ventas (`79910cc` backend 403 si no admin, frontend disabled; `120e83b` combobox con `✓`, `5131c47` solo nombre, `32e0c7f` solo asesores via `GET /perfiles-venta/asesores`).
- Widgets Pipeline ampliados a 8 (`6e347c1`): `Vencidas`, `Ticket promedio`, `Ciclo promedio`, `por etapa/fuente/prioridad`, `Top vendedor` (fix path 4 niveles `09c1655`, solo asesores `d2d74cf`, solo nombre `a27e10c`).
- Filtro global pipeline poblado (`1b09ed7`): `Buscar`, `Etapa`, `Fuente`, `Prioridad`, `Desde/Hasta` + `Vendedor` combobox buscable (solo asesores) con estilo Nómina (`8ae621d` absolute dropdown, tiempo real).
- Drag & drop `PUT /oportunidades/:id/mover` fix `inconsistent types $1` con `::varchar/::uuid` (`ccc5735`, `db79ef6`).
- Framework `components.css` Widgets estilo Nómina (`dee271b` + `6f3b091` pipeline con colores `blue/orange/purple/green`).

#### Sintéticas y datos
- `scripts/genera_oportunidades.js` (`5c89e41` 50/50 aleatorio cliente/lead): 42 oportunidades sintéticas para un mes, vendedor aleatorio entre 10 asesores 2440, 1-2 productos con precio de lista (`072ab0d` real-time + `261533a` fix `030 USING ::integer` que había borrado `vendedor_id`).

#### Commits clave sesión 52-53 (desde `2af4b05`)
- `4c9fc97` — `feat(crm): perfiles venta listos para SIESA Hub (vendedores + enforcement)`
- `2ef2714` — `feat(crm): SIESA Hub mock adapter listo sin docs`
- `a67ef8b` — `fix(crm): hub UUID fix`
- `2ba454e` — `fix(crm): hub payload sucursales tabla correcta + fallback`
- `eaaeb1e` — `fix(crm): cotizacion trae condicion pago + precios catalogo fallback`
- `0c98cee` — `fix(crm): muestra vendedor con nombre SIESA y precio 0303 demo`
- `d6b5110` — `feat(crm): adaptador SIESA Hub f350/f351 dual payload + mapeos`
- `5262821` — `fix(crm): creado_por integer (500 crear cotizacion)`
- `820f51f` — `fix(crm): payload siesa coherente (totales descuento, iva por linea)`
- `11a0bd4` — `fix(crm): totales con bruto + iva por linea`
- `5cb9e67` — `fix(crm): iva totales = sum linea (0 si exento)`
- `416bdab` — `feat(crm): hub final listo — fechas YYYYMMDD, bodega por CO`
- `2af4b05` — `feat(crm): pipeline interno pulido con combobox buscables`
- `f300741` — `fix(crm): oportunidad no pisa monto con producto sin precio`
- `efd82c7` — `feat(crm): oportunidad con lista precios por defecto del perfil`
- `6e347c1` — `feat(crm): widgets pipeline completos (8/8)`
- `6f3b091` — `style(crm): pipeline widgets con estilo Nomina`
- `dee271b` — `style(framework): widgets Nómina-style en framework`
- `79910cc` — `feat(crm): pipeline usuarios con perfil ventas`
- `120e83b` — `feat(crm): vendedor oportunidad en combobox buscable`
- `1b09ed7` — `feat(crm): filtro global pipeline poblado`
- `d2d74cf` — `fix(crm): pipeline vendedor solo asesores comerciales`
- `e167d47` — `fix(crm): pipeline vendedor combobox sin desborde`
- `a27e10c` — `fix(crm): pipeline vendedor solo nombre`
- `5131c47` — `fix(crm): modal vendedor solo nombre`
- `32e0c7f` — `fix(crm): modal vendedor solo usuarios con perfil ventas`
- `261533a` — `fix(crm): pipeline vendedor filtro y 030 USING cast correcto`
- `09c1655` — `fix(crm): top vendedor nombre (path 4 niveles)`
- `804f2a7` — `fix(crm): combobox cierra al clic fuera`

## Estado (31 Ago 2026 — sesión 51)

### Cambios Sesión 51 — CRM: Maestros SIESA, Pipeline con productos y pulido masivo del flujo comercial

Sesión larga en `feat/crm-module` (continuación de la 50). Se llevaron a dinámico todos los datos de cotización, se corrigió el CRUD de productos, se estabilizó el perfil de ventas para no depender de hardcode y se centralizó el framework de acciones accesibles.

#### Productos — CRUD y precios
- `GET /productos/:id` + `PUT /:id` (código no editable `readOnly` + tooltip) — fix `6002` que aparecía en tabla pero daba `Producto no encontrado` por `find` sobre `limit 500` sin `search` (`184a58e`).
- Parseo de precios formato colombiano `parsePrecio()` (`$2.300` → 2300): fix en `importar.js` (`items`, `inventario`, `precios`) y `productos.js` (`ef6e3aa`). Botón temporal `POST /importar/reparar-precios` (`f772db9`) usado una vez y retirado (`6283558`).

#### Cotizaciones — Estados y flujo ERP
- Filas sin `CPV`/`documento_erp` en rojo (`row-no-erp`), `Estado ERP` → badge `No enviado` y botón `🚀 Enviar al ERP` (`POST /cotizaciones/:id/enviar-erp` con auditoría, placeholder Hub) (`029f0f1`).
- `GET /cotizaciones/stats` ahora respeta `search`/`estado` (+ `monto_total` filtrado) (`d55edef`).

#### Framework — Acciones accesibles
- Nuevo estándar en `framework/framework.js` + `framework/components.css` y espejos en `modules/crm/public/`: clase `btn-action` (32×32) + contenedor `tbl-actions` y helpers `actionBtn({icon,title,ariaLabel,onclick,variant})` / `actionGroup()` (`785c005`). Documentado en `AGENTS.md: Convenciones`.
- `Cotización Enviar al ERP` pasa a icono solo con `btn-action` + `aria-label` (`9cf17b4`).

#### Pipeline — Widgets y productos en oportunidad
- Widgets ejecutivos filtrados por vendedor en `#stats-pipeline`: **Oportunidades**, **Pipeline abierto** (`SUM monto`), **Forecast ponderado** (`SUM monto×probabilidad/100`) y **Win rate** (`ganada/(ganada+perdida)`) vía `GET /oportunidades/stats?vendedor=` (`e67e0b4`).
- Nueva tabla `crm.oportunidad_productos` (migración `018`) + endpoints `GET/POST/DELETE /oportunidades/:id/productos` con recálculo de `monto_esperado` (`4921c42`). Modal oportunidad con buscador del maestro (`GET /productos/buscar`), lista con `×` y total vivo.
- Al elegir oportunidad en **Nueva Cotización**, se auto-carga su cliente (`setClienteCotizacion`) y se sugieren sus productos al carrito (`ccaa0dc`). Fix guardado de `monto_esperado`/`fecha_cierre_estimada` con `split('T')[0]` (`b8549bd`).
- Oportunidad puede ligarse a **lead alternativo**: columna `lead_id` (migración `019`), backend acepta `cliente_id` **o** `lead_id`, kanban muestra `cliente_nombre || lead_nombre` (`c86da2d` + fix validación `0ad29cb` quita `required` y añade helper `* Requerido: cliente o lead`).

#### Cotización — Datos dinámicos
- **Cliente** buscable (`#cotizacion-cliente-search` + `filtrarCotizacionClientes` → `GET /clientes?search=&limit=20`, debounce 300ms) con `GET /clientes/:id` y `✓ Cliente — NIT ✕` (`8de352b`).
- **Contacto** dependiente: `GET /contactos?cliente_id=` al seleccionar cliente (`cargarContactosCotizacion`).
- **Centro de Operación** y **Bodega** pasan de `input` a `select` dinámicos (`GET /centros` del Launcher con `codigo` como `value` y `GET /inventario/bodegas-all` → `codigo — nombre`) (`b1cb281` + `07bf929` muestra `100 — ITAGUI`).
- **Carrito Referencia** autocompleta: `onReferenciaChange` → `GET /productos/buscar?q=6002` y rellena descripción/UM/precio (`fd49b2b`).

#### Maestros SIESA y centros
- Centros del ERP (`Centros de operacion.csv` 6 filas `100/101/200/201/300/301`) upsertados en `launcher.db` y disponibles vía `GET /api/centros` para el CRM.
- Migración `020` crea `crm.motivos_venta`, `crm.tipos_documento`, `crm.centros_costo`, `crm.unidades_negocio` + `perfiles_venta.config JSONB` y seeds (`VENTAS`, `PEDIDO_VENTA_CRM`, 7 centros costo...).
- Endpoint `GET /api/maestros?tipo=` + `POST /maestros/sync` (stub Hub) y fix `activa` vs `activo` (`2d668be`).
- Importadores nuevos `motivos_venta`, `tipos_documento`, `centros_costo`, `unidades_negocio` con XML Crystal para motivos (`Motivos_de_venta.xml` 22 filas) y CSV latín1 (`37d1d9c`) e importados (71 centros costo, 19 tipos doc como `CPE/CPV/CPR`, 23 motivos).

#### Perfil de ventas — 100% configurable (sin hardcode)
- Migración `021` limpia `16 → 6` permisos comerciales (`crear_cotizacion`, `aprobar_descuento`, `configurar`, `siesa_sync`, `ver_pipeline`, `editar_pipeline`); `CRM - Gerencia 6/6`, `Comercial 3/6`, `Aprobador 2/6`, `Vendedor Generico 3/6` (`1d646cf`).
- Modal `perfil-venta` con 4 tabs (`Datos básicos`, `Descuentos`, `Permisos`, `Márgenes`) y sin hardcode (`2bd63f2`):
  - **Datos básicos**: 8 combos SIESA-style (`multi-combo` con tags `×`, buscador, `Todos/Ninguno`, `fixed` dropdown 280px) cargados vía `GET /maestros`/`GET /centros` con `cache: 'no-store'` y `Set` persistente (`79f16e0` + fixes `da3bdd5`, `a873a2a`, `4ebd005` evita `304 cached`, `a791897` fix `set is not defined`).
  - **Descuentos**: `modalidad`, `Rango 1/2/3` (1/60/70), `Permite Global` y 4 combos de aprobadores (`GET /perfiles-venta/usuarios-all`) (`bb20bba`).
  - **Permisos**: grid `1fr 1fr` con 6 checkboxes estilizados (`e94504a` fix overflow vertical).
  - **Márgenes**: grid `1fr 1fr 1fr` con 10 switches (`¿Mostrar columna/fila Margen Bruto %`...).
- Correcciones de layout: sin cuadros concéntricos (`e1dcf8a`), tags `max-height:110px` scrollable (`431f7f6`) y dropdown `fixed` con reposicionamiento y cierre en scroll/click fuera.

#### Commits sesión 51 (desde `eb99ee5`)
- `184a58e` — `fix(crm): productos 6002 no encontrado — GET/PUT por id y codigo no editable`
- `ef6e3aa` — `fix(crm): parseo de precios formato colombiano .300 -> 2300`
- `f772db9` / `6283558` — `feat/chore(crm): boton temporal reparar precios truncados x1000` (usado y retirado)
- `029f0f1` — `feat(crm): cotizaciones sin CPV en rojo, estado No enviado y boton Enviar al ERP`
- `785c005` — `feat(framework): botones de accion accesibles icon-only con aria-label`
- `9cf17b4` — `fix(crm): cotizacion Enviar al ERP icon-only con btn-action y aria`
- `e67e0b4` — `feat(crm): widgets pipeline ejecutivo (monto, forecast ponderado, win rate) filtrados por vendedor`
- `8de352b` — `fix(crm): cotizacion cliente buscable dinamico y contactos por cliente`
- `b1cb281` — `feat(crm): centro de operacion y bodega dinamicos en cotizacion`
- `07bf929` — `feat(crm): bodega con nombre (codigo — nombre) en cotizacion`
- `fd49b2b` — `fix(crm): carrito referencia autocompleta producto al digitar codigo`
- `4921c42` — `feat(crm): productos en oportunidad (maestro) con busqueda y sync monto`
- `ccaa0dc` — `feat(crm): sugerir productos de oportunidad al elegirla en cotizacion`
- `b8549bd` — `fix(crm): oportunidad guarda monto y fecha (formato date y monto productos)`
- `c86da2d` — `feat(crm): oportunidad con cliente potencial (lead) alternativo a cliente`
- `0ad29cb` — `fix(crm): oportunidad requiere cliente o lead (uno de los dos)`
- `2cb6227` — `feat(crm): maestros SIESA (motivos, tipos doc, centros costo, unidades negocio) y endpoint /maestros`
- `2bd63f2` — `feat(crm): perfil de ventas configurable con maestros, descuentos y margenes (sin hardcode)`
- `bfcbae9` — `feat(crm): importadores maestros faltantes para perfil`
- `2d668be` — `fix(crm): maestros activa vs activo column`
- `4c86fe6` — `fix(crm): perfil maestros checklist legible con Todos/Ninguno y layout`
- `79f16e0` — `feat(crm): perfil maestros combobox multi-select SIESA-style con tags y filtro`
- `da3bdd5` — `fix(crm): combobox maestros lista todas las opciones al hacer clic`
- `a873a2a` — `fix(crm): maestros combobox SIESA-style sin checkboxes, badges con × y lista al hacer clic`
- `37d1d9c` — `fix(crm): importadores maestros soportan XML (Motivos) y columnas flexibles + upsert activo`
- `4ebd005` — `fix(crm): maestros combobox evita 304 cached (cache busting) que mostraba Error`
- `8aab2d9` — `fix(crm): muestra error real en maestros para debug`
- `a791897` — `fix(crm): define set in renderMaestroDropdown (ReferenceError)`
- `e1dcf8a` — `fix(crm): perfil maestros sin cuadros concentricos, dropdown 280px y modal overflow visible`
- `431f7f6` — `fix(crm): perfil maestros tags scrollable (110px) y dropdown fixed sin cortes`
- `bb20bba` — `fix(crm): aprobadores descuentos multi-combo SIESA-style con usuarios-all`
- `1d646cf` — `refactor(crm): perfil ventas solo permisos comerciales (6) sin duplicar launcher`
- `e94504a` — `fix(crm): permisos grid 1fr 1fr y labels sin overflow vertical`

## Estado (29 Ago 2026 — sesión 50)

### Cambios Sesión 50 — CRM: UX accesible y widgets filtrados

Sesión de pulido en `feat/crm-module` enfocada en accesibilidad,
responsividad y widgets que reflejan los filtros activos.

#### Leads — Botones de acción
- Botones de la tabla de leads ahora son **icono solo** (✏️ 🔄 ✅ 🗑️),
  alineados horizontalmente y del mismo tamaño (32×32px).
- Atributos ARIA en todas las acciones: `title` + `aria-label` descriptivos
  que incluyen el nombre del lead (ej: "Convertir lead ACME").
- La columna de acciones usa `inline-flex` para mantener la alineación de
  los renglones de la tabla.

#### Cotizaciones — Botones de acción
- Botones de la tabla de cotizaciones ahora son **icono solo**
  (✏️ 🗑️ 📤 ✅), alineados horizontalmente y con el mismo tamaño que los
  demás botones de acción del CRM.
- Atributos ARIA en todas las acciones: `title` + `aria-label` descriptivos
  que incluyen el número de la cotización (ej: "Aprobar cotización COT-0012").

#### Clientes — Tabla de sucursales responsive
- Modal de detalle cliente: lista de sucursales ahora es **scrollable**
  verticalmente (máx. 420px) con header fijo.
- Se eliminó el scroll horizontal usando `table-layout: fixed` y anchos de
  columna definidos para Código, Nombre, Dirección, Ciudad, Teléfono,
  Principal y Acciones.
- El texto de las celdas se ajusta con `break-word`; en viewports estrechos
  se ocultan progresivamente las columnas Teléfono (<680px) y Ciudad (<560px)
  mediante `@container` queries.
- Botones de acción de sucursales con `title` y `aria-label`.

#### Widgets filtrados en tiempo real
- **Inventario, Leads y Cotizaciones**: los endpoints `/inventario/stats`,
  `/leads/stats` y `/cotizaciones/stats` ahora aplican los mismos filtros que
  la tabla, y el frontend los pasa desde `cargarStats*()`.
- **Productos, Contactos y Clientes**: nuevos endpoints `/productos/stats`,
  `/contactos/stats` y `/clientes/stats` que respetan filtros; se añadieron
  contenedores `.stats-row` y funciones `cargarStats*()` en el frontend.
- **Clientes**: fix del filtro por ciudad que no se enviaba al backend;
  limpieza de filtros ahora incluye también los filtros por columna.
- **Productos**: botones de acciones en icono con `aria-label`.

#### Commits
- `225c238` — `feat(crm): botones de acciones de leads en icono con aria-label y alineación horizontal`
- `f498bdd` — `feat(crm): tabla de sucursales scrollable con header fijo y aria en acciones`
- `c948ac3` — `feat(crm): tabla de sucursales responsive sin scroll horizontal`
- `04a1c20` — `feat(crm): botones de acciones de cotizaciones en icono con aria-label`
- `7dcb2af` — `feat(crm): stats de inventario y leads respetan filtros activos`
- `ced1b87` — `feat(crm): widgets filtrados en inventario/leads y nuevos widgets en productos/contactos/clientes`
- `bba1eba` — `feat(crm): aria-label en botones de acciones de productos`
- `d55edef` — `feat(crm): stats de cotizaciones respetan filtros activos`

## Estado (28 Ago 2026 — sesión 49)

### Cambios Sesión 49 — CRM: Leads, Actividades, Admin, Perfiles de Venta y alineación con SIESA Hub

Sesión larga en `feat/crm-module` (rama de trabajo del CRM). Se consolidó el
CRM como módulo core de datos (clientes/productos) y se preparó para SIESA Hub
(propuesta comercial revisada: REST/JSON + OAuth2, SaaS $2.05M/mes, kick-off
$1.67M; se decidió usarlo como bus para todo Synnox). Importación CSV se
mantiene como plan B hasta credenciales.

#### Leads (Clientes Potenciales)
- Nuevo módulo `crm.leads` con página, CRUD, filtros por estado y stats.
- Estados: nuevo → contactado → calificado → enviado_erp → convertido (y perdido).
- Botón "Convertir" intenta llamar API SIESA; sin API devuelve 503 con toast
  "Solicita a contabilidad la creación del tercero" (el vendedor no ve el ERP).
- `PUT /leads/:id/confirmar` lo usa contabilidad para marcar convertido tras
  crear el tercero (crea cliente real + `erp_tercero_id`).
- `POST /leads/reconciliar` compara NIT de leads vs clientes existentes y marca
  convertidos automáticamente (0 coincidencias iniciales: leads del CRM SIESA
  vs clientes del ERP tienen formatos distintos).
- Campo `erp_tercero_id` (migración 013).

#### Actividades (antes Visitas)
- Renombrado: sidebar "📋 Actividades". Tipos: visita, reunion, llamada, nota.
- Nuevo modal "Nueva Actividad": cliente combobox (busca por NIT/nombre, single),
  asunto, descripción, lugar, fechas inicio/fin, estado, recordatorio, foto,
  mapa no editable (Leaflet).
- Auto check-in GPS al pasar a En Proceso, check-out al pasar a Realizada
  (solo Reunión); otros tipos solo checkin. Estados: no_iniciada, asignada,
  en_proceso, realizada, no_realizada.
- Anti-fraude: fechas pasadas bloqueadas (min=now en picker + validación).
- Botón eliminar en modal detalle (`DELETE /visitas/:id`).
- Migración 015 y 016 (campos asunto, lugar, tipo_actividad, estado,
  descripcion, fecha_inicio/fin, recordatorio, propietario_nombre).

#### Submódulo Admin (perfiles de venta internos)
- Decisión: RBAC híbrido — launcher sigue para auth global (`perfil_id`),
  CRM maneja internamente permisos comerciales (aprobación de descuentos).
- Migración 017: `crm.perfiles_venta`, `crm.perfil_venta_permisos`,
  `crm.usuario_perfil_venta`. Seed 3 perfiles: Gerencia(16), Comercial(9),
  Aprobador(3) — sin usuarios asignados.
- `routes/perfilesVenta.js`: CRUD perfiles + `PUT /:id/usuarios` transaccional
  (lee `launcher.db` read-only) + `GET /me/mis-permisos`.
- Middleware `requireVentasPerfil(permiso)`: si el usuario no tiene perfil de
  ventas → 403 en creación de cotizaciones (admin pasa). Aplicado a
  `POST /cotizaciones`.
- IMPORTANTE: `requireVentasPerfil` NO es `async` (retorna middleware; si es
  async retorna Promise y rompe el montaje → 404 en `/crm/api/*`).
- Frontend `#page-admin`: centro de gestión con tarjetas (Perfiles de Venta,
  Importar SIESA, Descuentos pendientes, Sincronizar ERP). Tarjetas según
  permisos (configurar/siesa_sync/aprobar_descuento/admin). Sidebar depurado:
  Importar SIESA y Descuentos ya no están en el nav, se acceden desde Admin.
- Botón volver unificado en header ("← Volver a Admin" para páginas externas,
  "← Volver" para sub-vistas internas).

#### Importación SIESA (plan B CSV hasta API)
- Importadores: clientes, contactos, leads, cotizaciones, items, inventario,
  codigos_barra (EAN), bodegas, precios, vendedores.
- Datos del ERP cargados: 2,599 clientes, 1,259 productos, 1,069 inventario,
  108 EANs, 75+ listas de precio, 1,162 precios, 24 bodegas, 88 vendedores.
- Importador de clientes crea sucursales (001 = principal) y contactos desde
  tercero; maneja encoding latin-1; validación flexible de columnas.
- Inventario: busca producto por código exacto/sin ceros/referencia.
- Barra de progreso SSE en importaciones (text/event-stream cada 10 filas).

#### Productos, EAN y GS1
- Tabla `crm.productos_ean` (múltiples EANs por producto), endpoints CRUD y
  `GET /productos/ean/buscar/:gtin`.
- `utils/gs1Client.js`: `lookupByGTIN()` / `lookupBatch()` (API GS1, gratis).
  Migración 011 (gtin, foto_url, marca, descripcion_gs1) + 012 (productos_ean).
- Modal producto con tabs estilo SIESA: Info, Precios, Inventario, EANs.
- Módulo Inventario por Bodega (`routes/inventario.js`): tabla, filtros, stats.

#### Cotizaciones y ERP
- Webhook `PUT /cotizaciones/erp-update` para que SIESA Hub empuje
  `{ numero, documento_erp, estado_erp, estado_crm }` (preparado, sin API aún).
- Tabla Cotizaciones con columnas Estado ERP y Doc. ERP (CPV).
- Tablas nuevas: `crm.facturas` (014), `crm.clientes` con 21 campos SIESA (010).
- Modal detalle cliente con tabs: Datos Básicos, Sucursales, Contactos,
  Cotizaciones, Facturas.
- Filtros por columna estilo SIESA en tabla clientes.

#### Bugs resueltos
- `import createProtect` se ejecutaba antes de `dotenv.config()` → 500 en todo
  `/crm/api/*`; fix con `await import()` dinámico tras cargar `.env`.
- `app.use('/api', protect, sucursalesRoutes)` capturaba `/api/version`,
  `/api/dashboard` como `/:clienteId/sucursales` → 500; fix: montar en
  `/api/clientes` y `/api/sucursales`.
- Rutas específicas DELETE (`/seleccionados`, `/todos`, `/ean/todos`) deben ir
  ANTES de `/:id` (Express matchea primero la paramétrica).
- FK a `oportunidades` sin CASCADE → bloqueaba DELETE; fix `ON DELETE SET NULL`
  (migración 009).
- `confirmModal` no existe en framework.js del CRM → usar `confirmar()`.
- `abrirModal`/`cerrarModal` del CRM colisionaban con framework → renombrados a
  `showModal`/`hideModal`.
- Permiso `eliminar` no existe → usar `editar_pipeline` en DELETE oportunidad.

#### Documentación
- `docs/PLAN-MODULO-CRM.md` unificado (un solo plan, eliminado PLAN-TRABAJO-CRM.md).
- Revisada propuesta SIESA Hub: `~/Downloads/PROPUESTA siesa hub.pdf`.

#### Perfiles creados en launcher (plantillas, sin asignar)
- `CRM - Gerencia` (16 perms crm), `CRM - Comercial` (9), `CRM - Aprobador
  Descuentos` (3). Quedan como respaldo; gestión diaria pasa a CRM → Admin.

## Estado (18 Ago 2026 — sesión 46)

### Cambios Sesión 46 — Archivo de Proyectos Completados (Fase 2)

Merge de `feat/proyectos-archivo-fase2` (PR #117) a `dev`. Branch feature eliminada.

#### Migración `010_proyectos_archivo.sql`
- Tabla `projects.proyectos_archivadas` con snapshots JSONB: proyecto, tareas activas, referencias a tareas archivadas, miembros, actas.
- 3 índices: `proyecto_id_original`, `archivada_en`, GIN pg_trgm sobre `proyecto_snapshot->>'nombre'`.
- Config: `meses_para_archivar_proyectos` (3) y `habilitado_proyectos` (true).

#### Backend — Servicio (`archivoService.js`)
- `archivarProyecto(pool, opts)`: archiva proyecto completado+aprobado con snapshot de tareas activas, miembros y actas. Referencia tareas ya archivadas individualmente. DELETE cascade elimina el proyecto original.
- `reactivarProyectoArchivado(pool, archivoId, usuarioId, opts)`: restaura proyecto con nuevo ID, tareas, miembros, actas. Opción `restaurarTareasArchivadas` para restaurar tareas que estaban en `tareas_archivadas`.
- `getUltimaEjecucionProyectos(pool)`: para el job automático.

#### Backend — Job (`archivarJob.js`)
- Job único para tareas y proyectos. `checkTareas()` + `checkProyectos()` en el mismo intervalo (6h).
- Proyectos: busca completados+aprobados con >3 meses desde `aprobado_en`.
- Config `habilitado_proyectos` para desactivar archivado automático de proyectos.

#### Backend — Routes (`archivo.js`)
- 5 endpoints nuevos: GET `/proyectos`, GET `/proyectos/stats`, GET `/proyectos/:id`, POST `/proyectos/migrar`, POST `/proyectos/:id/reactivar`.
- Permisos: `ver` para lectura, `soloAdminGerente` para migrar/reactivar.

#### Frontend
- **Tabs** "Tareas" / "Proyectos" en `#page-archivo`.
- Tabla de proyectos archivados: nombre, prioridad, tareas activas/archivo, fechas, restauración.
- Modal detalle: snapshot completo + miembros + actas + tareas.
- Reactivación con doble confirmación: crear proyecto + restaurar tareas archivadas individualmente.
- Botones admin ocultos para usuarios no-admin/gerente.

#### Fix
- `FOR UPDATE SKIP LOCKED` con `LEFT JOIN` causaba error. Cambiado a subquery correlacionada en `ejecutarMigracion()`.

#### Archivos creados
- `modules/proyectos/backend/migrations/010_proyectos_archivo.sql`
- `docs/PLAN-FASE2-ARCHIVO-PROYECTOS.md`

#### Archivos modificados
- `modules/proyectos/backend/utils/archivoService.js` — +`archivarProyecto()`, +`reactivarProyectoArchivado()`, +`getUltimaEjecucionProyectos()`, fix subquery.
- `modules/proyectos/backend/utils/archivarJob.js` — extensible para proyectos.
- `modules/proyectos/backend/routes/archivo.js` — +5 endpoints de proyectos.
- `modules/proyectos/public/index.html` — tabs Tareas/Proyectos + tabla proyectos.
- `modules/proyectos/public/js/modules/archivo.js` — +tabs, tabla proyectos, modal, reactivación.
- `modules/proyectos/public/app.js` — ocultar botones admin en tab proyectos.

#### Pendiente
- [ ] Migrar a `main` + deploy a producción.
- [ ] Policy de retención legal/operativa (informativa en Fase 2).

---

## Estado (17 Ago 2026 — sesión 45)

### Cambios Sesión 45 — Archivo de Tareas Completadas (Fase 1)

Nueva branch `feat/tareas-archivo-fase1` (commit `0948c2e`) con el submódulo **Archivo** dentro de Proyectos.

#### Diseño aprobado
- Archivar solo tareas completadas con `completada_en` real.
- Persistencia en **JSONB nativo** (consultable, PostgreSQL comprime internamente).
- Tablas de archivo: `projects.tareas_archivadas`, `projects.archivo_log`, `projects.archivo_config`.
- El archivo es **solo lectura**; la reactivación crea una copia activa con nuevo ID y deja enlace a la original.
- No se reutilizan IDs: `tarea_id_original` + `restaurada_como_id`.
- Archivos físicos de evidencia se mantienen; sin limpieza automática de disco en esta fase.
- Distinción clara: `meses_para_archivar` (3) vs `meses_retencion` (24, informativo).

#### Migración `009_tareas_archivo.sql`
- `CREATE EXTENSION IF NOT EXISTS pg_trgm` + índice GIN sobre `tarea_snapshot->>'titulo'`.
- Columna `completada_en` en `projects.tareas` con trigger `BEFORE INSERT OR UPDATE`.
- Backfill: tareas ya completadas sin fecha usan `updated_at` como aproximación documentada.
- `UNIQUE(tarea_id_original)` como red de seguridad.

#### Backend
- `utils/archivoService.js`: lógica compartida `ejecutarMigracion()` y `reactivarTareaArchivada()`.
  - Advisory lock `hashtext('tareas_archivo')::bigint`.
  - Selección por lotes con `FOR UPDATE SKIP LOCKED`.
  - Cada tarea se migra en su propia transacción; fallos individuales no detienen el lote.
- `utils/archivarJob.js`: job automático cada 6h; ejecuta si han pasado >28 días desde la última ejecución automática exitosa (consulta `archivo_log` con `tipo = 'automatico'`).
- `routes/archivo.js`: endpoints `/archivo`, `/archivo/stats`, `/archivo/config`, `/archivo/:id`, `/archivo/migrar`, `/archivo/:id/reactivar`, `/archivo/exportar/json`.

#### Frontend
- Nuevo nav item **"📦 Archivo"** en sidebar de Proyectos.
- Página `#page-archivo` con:
  - Stats cards (total, restauradas, espacio BD, última migración).
  - Resumen de configuración de retención.
  - Filtros por proyecto, rango de fechas y búsqueda por título.
  - Tabla paginada con detalle read-only.
  - Botones: Migrar ahora, Configurar retención, Exportar JSON (admin/gerente los de gestión).
- Modal de detalle muestra tarea, comentarios, evidencias e historial de restauración.

#### Archivos creados
- `modules/proyectos/backend/migrations/009_tareas_archivo.sql`
- `modules/proyectos/backend/routes/archivo.js`
- `modules/proyectos/backend/utils/archivoService.js`
- `modules/proyectos/backend/utils/archivarJob.js`
- `modules/proyectos/public/js/modules/archivo.js`

#### Archivos modificados
- `modules/proyectos/backend/server.js` — monta `/api/archivo` e inicia `startArchivarJob(pool)`.
- `modules/proyectos/public/index.html` — nav item, página `#page-archivo`, script tag.
- `modules/proyectos/public/app.js` — registro de ruta `archivo` y ocultamiento de botones admin.

#### Pendiente (Fase 2 — archivo de proyectos)
- [x] Archivar proyectos completados/aprobados con snapshot de tareas asociadas.
- [x] Tabla `projects.proyectos_archivados` y reactivación segura de proyecto + tareas.
- [ ] Definir política de retención legal/operativa y posible limpieza automática de disco.

---

## Estado (13 Ago 2026 — sesión 44)

### Cambios Sesión 44 — Backup fixes, Members & Code Review

#### Backup — Uploads corregidos
- **Fix**: `scripts/backup_synnox.sh` ahora incluye `modules/proyectos/uploads` y `uploads/`
- **Antes**: Solo incluía `modules/proveedores/uploads` (ya no existe) y `modules/logistica/uploads`

#### Backup — Restore de archivos grandes
- **Frontend**: Error handling mejorado (check `res.ok` antes de `res.json()`)
- **nginx**: Location block dedicado para `/api/admin/backup/restore` con `client_max_body_size 0` y `proxy_request_buffering off`
- **Backend**: multer `memoryStorage` → `diskStorage` (archivos a disco, no RAM)
- **Backend**: `fs.renameSync` con fallback `copyFileSync` para EXDEV (cross-filesystem)
- **Límite**: 10GB para uploads de restore

#### Backup — Progress bar para restore
- Barra de progreso con estimación basada en tamaño del archivo (~50MB/s)
- Tres fases: subiendo, restaurando PostgreSQL, finalizando
- Botón deshabilitado durante la operación

#### Proyectos — Miembros al crear
- Sección de miembros visible en modal de creación (no solo edición)
- `abrirModalMiembros()` soporta proyecto nuevo (`null`)
- Backend acepta `miembros` array en POST
- Validación de `m.rol` contra `['lider', 'miembro', 'observador']`
- Inserción de miembros en transaction con ROLLBACK
- Toast informativo si se intenta guardar miembros sin proyecto
- Badges se actualizan después de seleccionar miembros

#### Code Review — 9 Fixes
**Critical/High:**
- C1+H2: nginx config — `client_max_body_size 0` y `proxy_request_buffering off` solo para restore
- H1: Modal miembros muestra toast para proyectos nuevos
- H3: `fs.renameSync` con fallback para EXDEV

**Medium:**
- M2: Validación de roles
- M3: Transaction para inserción de miembros
- M4: Reset de `_miembrosSeleccionados` al abrir modal nuevo
- M5: `actualizarBadgesMiembros()` al cerrar modal
- M9: `textContent` en vez de `innerHTML` para errores

**Low:**
- L6: Botón deshabilitado durante restore

#### Archivos modificados
- `scripts/backup_synnox.sh` — uploads corregidos
- `launcher/server.js` — nginx config, multer diskStorage, restore endpoint
- `launcher/shell/app.js` — error handling, progress bar, button disable
- `launcher/shell/index.html` — progress bar HTML
- `modules/proyectos/backend/routes/proyectos.js` — POST con miembros, transaction
- `modules/proyectos/public/js/modules/proyectos.js` — miembros en crear, badges

#### Tags
- `v2.1.0` — Merge branches + code review + Dependabot fixes
- `v2.1.1` — Backup fixes + members + code review fixes

---

## Estado (13 Ago 2026 — sesión 43)

### Cambios Sesión 43 — Merge de branches a dev + Code Review + Fixes

#### Merge de branches pendientes a dev
- **Eliminado**: `fix/proyectos-operador-filter` (debug log temporal, branch obsoleto basado en código antiguo — revertiría 18K líneas de progreso)
- **Merged** (7 branches, 8 commits total):
  - `feat/issue-52-widgets-other-roles` — Widgets del launcher accesibles para gerente y operador
  - `feat/nomina-layout-consistency` — Fix layout nómina, revert stats-row a flexbox
  - `feat/proyectos-tipo-tarea-dropdown` — SMTP tab fix, wrap cards en auto-fit grid
  - `fix/all-modules-permisos` — Operador solo ve sus tareas asignadas (proyectos)
  - `fix/dashboard-responsive-21-9` — Employees grid responsive + compact card redesign
  - `fix/nomina-manual-public` — Botón Home al sidebar de los 4 módulos
  - `session/13-code-review-security-branding` — Fix install.sh (branch main, ADMIN_PASS typo)

#### Code review — Issues encontrados y resueltos

**CRITICAL (3)**
- C1: 5 `</div>` sobrantes en `launcher/shell/index.html` — rompían estructura del admin panel
- C2: `var(--primary)` en progress bar no existía → cambiado a `var(--accent)`
- C3: `_backupPollActive` nunca se reseteaba → polling muere después del 1er backup

**HIGH (3)**
- H1: `toggleAll()` en framework.js tenía firma incompatible con app.js → soporta ambos patrones
- H2: Escape en `modal-detalle` cerraba `modal-overlay` → trapFocus cierra contenedor correcto
- H3: PUT devoluciones requería `edit_comentario` pero frontend no lo validaba

**MEDIUM (5 revisados, ninguno causa breakage)**
- M1: `clearSelection()` selector funciona (checkboxes usan clase simple)
- M2: framework.js en nomina/proveedores es dead code (no se carga)
- M3: `show(null)` está definido en app.js
- M4: pg_restore error handling es pre-existente
- M5: Resuelto con fix C3

#### Limpieza de branches
- 34 branches locales eliminados (ya mergeados en dev)
- 2 branches remotos eliminados (`feat/backup-dr`, `feat/replace-prompt-alert-main`)
- Estado final: solo `dev` y `main` permanecen

#### Archivos modificados (fixes)
- `launcher/shell/index.html` — C1 (stray divs), C2 (CSS variable)
- `launcher/shell/app.js` — C3 (_backupPollActive reset)
- `framework/framework.js` — H1 (toggleAll), H2 (trapFocus Escape)
- `modules/logistica/public/framework.js` — sincronizado con framework principal
- `modules/proyectos/public/framework.js` — sincronizado con framework principal
- `modules/logistica/public/app.js` — H3 (edit_comentario validation)

#### Fix vulnerabilidades Dependabot (13 → 0)
- **hono** 4.12.31 → ≥4.12.34 (4 medium: SSR leak, ReDoS, DoS, Proxy headers)
- **@hono/node-server** 1.19.14 → ≥1.19.15 (1 medium: path traversal Windows)
- **fast-uri** 3.1.4 → ≥3.1.5 (1 high: host confusion SSRF)
- **ip-address** 10.2.0 → ≥10.3.0 (3 high: SSRF via octal/CIDR/IPv4-mapped)
- **brace-expansion** 1.1.16/2.1.2/5.0.7 → ≥5.0.9 (2 high: DoS unbounded arrays/expansion)
- **adm-zip** 0.5.18 → ≥0.6.0 (1 high: 4GB memory allocation via crafted ZIP)
- **Solución**: pnpm overrides en `package.json` para todas las dependencias transitive

---

## Estado (12 Ago 2026 — sesión 42)

### Cambios Sesión 42 — Backup unificado DR (Fase 1)

#### Nuevo sistema de backup (reemplaza backups por módulo)
- **Script**: `scripts/backup_synnox.sh` — backup completo ejecutado por systemd timer (NO dentro de Node)
  - pg_dump -Fc de toda la DB `synnox_erp` (DDL + datos + secuencias + índices, todos los schemas)
  - pg_dumpall --globals-only (roles, intenta como superuser `postgres` si el usuario de app no tiene acceso)
  - SQLite hot-backup via better-sqlite3 `.backup()` (launcher.db + horas_extra.db)
  - tar de uploads y media
  - Config bundle: .env, nginx, PM2 dump, crontab, letsencrypt
  - Manifest con checksums SHA-256 + conteos exactos de filas (para restore drill)
  - Retención GFS: 7 diarias / 4 semanales / 3 mensuales
  - Copia offsite a NAS opcional (Phase 2, config en backups/.nas.conf)
  - Alertas email directas via nodemailer (funciona con launcher caído)
- **systemd**: `synnox-backup.service` + `synnox-backup.timer` (diario 2 AM, Persistent=true)
  - Funciona incluso con PM2 caído (ventaja clave sobre el cron anterior)
- **Helpers**: `backup-sqlite.js` (hot-backup + conteos), `backup-finalize.js` (manifest), `backup-alert.js` (email)
- **Instalación**: `systemd/install-backup.sh` (sudo, instala unidades, siembra config NAS)
- **Verificado**: backup completo en 2s, restore drill con conteos idénticos (35 tablas, 3 schemas)

#### Bugs encontrados y resueltos
- `backup_logistics.sh` inexistente → obsoleto (reemplazado por backup unificado)
- Issue #71 (backup nómina no encuentra script) → obsoleto
- `Database` indefinido en `/api/admin/backup/general` → eliminado (endpoints reescritos)
- `cron.schedule` de node-cron en server.js → eliminado (reemplazado por systemd timer)

#### Archivos creados
- `scripts/backup_synnox.sh` — script principal de backup
- `scripts/backup-sqlite.js` — hot-backup SQLite + conteos
- `scripts/backup-finalize.js` — manifest con checksums SHA-256
- `scripts/backup-alert.js` — alertas email directas
- `scripts/restore_synnox.sh` — restore completo con --dry-run
- `scripts/backup_drill.sh` — drill mensual con conteos verificados
- `systemd/synnox-backup.service` + `synnox-backup.timer`
- `systemd/synnox-drill.timer` — timer mensual (día 1, 3 AM)
- `systemd/install-backup.sh` — instalador de unidades systemd
- `systemd/nas.conf.example` — plantilla para copia NAS
- `docs/DISASTER-RECOVERY.md` — runbook completo paso a paso

#### Archivos modificados
- `launcher/server.js` — eliminados ~600 líneas de backup JSON, reemplazados por 6 endpoints nuevos
- `launcher/shell/index.html` — tab de respaldo rediseñado (status, lista, ejecutar, historial, restore)
- `launcher/shell/app.js` — funciones de backup reescritas

#### Pendiente (Fases 2-4)
- [ ] Fase 2: copia offsite a NAS (config backups/.nas.conf)
- [x] Fase 3: script restore_synnox.sh + drill automático mensual
- [x] Fase 4: UI en launcher + eliminar backups por módulo + fixes endpoints

---

## Estado (5 Ago 2026 — sesión 37)

### Cambios Sesión 37 — Submódulo de Devoluciones en Logística

#### Nuevo feature: Devoluciones (CRUD + import Smart2Go + dashboard)
- **Migración**: `019_create_devoluciones.sql` — tabla `logistics.devoluciones` + 8 índices
- **Parser**: `utils/smart2goDevolucionesParser.js` — parseo CSV/Excel de Smart2Go
  - Normalización de causas: `F.v`, `Fecha` → `Fecha vencimiento`
  - Parseo de productos: `"Filete basa(3)\nCamarón 650g"` → `[{nombre:"Filete basa",cantidad:3},{nombre:"Camarón 650g",cantidad:1}]`
  - Valores monetarios: `$134.598` → `134598.00`
  - Coordenadas GPS: `"7.0618402, -73.1176042"` → lat/lng
  - Upsert por `fuente_id` para evitar duplicados
  - Match parcial con `pedidos_logistica.numero_factura`
- **Backend**: `routes/devoluciones.js` — 10 endpoints
  - CRUD: GET (lista con filtros/paginación), GET /:id, POST, PUT /:id, DELETE /:id, DELETE /seleccionados (bulk)
  - Stats: GET /resumen (total, por causa, por cliente, tendencia, por estado)
  - Import: POST /importar-smart2go (multer upload, upsert, log en importaciones)
  - Utils: GET /clientes, GET /centros (para filtros), PUT /:id/estado
- **Frontend**: Dashboard completo con:
  - Stats cards: Total devoluciones, Valor total, Top causa, Con conductor
  - Gráficas canvas: Barras por causa + tendencia temporal
  - Tabla paginada con filtros (fecha, cliente, causa, estado, búsqueda)
  - Ordenamiento por columnas
  - Selección múltiple + bulk delete
  - Modales: Crear/Editar, Detalle (con cambio de estado), Importar Excel (drag & drop)
- **Sidebar**: Nav item "↩️ Devoluciones" visible para todos los usuarios

#### Archivos creados
- `modules/logistica/backend/migrations/019_create_devoluciones.sql`
- `modules/logistica/backend/routes/devoluciones.js`
- `modules/logistica/backend/utils/smart2goDevolucionesParser.js`

#### Archivos modificados
- `modules/logistica/backend/server.js` — import + mount `/api/devoluciones`
- `modules/logistica/public/index.html` — página devoluciones + 3 modales
- `modules/logistica/public/app.js` — sidebar + navigate + ~300 líneas lógica

#### Pendiente: Google Forms
- Fase 2: cuando se tenga la estructura del Google Forms, crear parser similar
- Schema JSONB de `productos` soporta estructuras diferentes
- Mismo endpoint de import o uno separado

---

## Estado (6 Ago 2026 — sesión 40)

### Cambios Sesión 40 — Miembros de Proyecto con Roles + Restricción de Aprobación

#### Nuevo feature: Gestión de miembros de proyecto
- **Migración**: `007_create_proyecto_miembros.sql` — tabla `projects.proyecto_miembros` con roles
- **Backend**: `routes/miembros.js` — CRUD completo de miembros
  - GET /proyectos/:id/miembros — listar miembros con nombres
  - POST /proyectos/:id/miembros — agregar miembro (body: `{ usuario_id, rol }`)
  - PUT /proyectos/:id/miembros/:userId — cambiar rol
  - DELETE /proyectos/:id/miembros/:userId — quitar miembro
  - Solo el creador o admin/gerente pueden gestionar miembros
- **Roles**: `lider` (puede todo), `miembro` (crea/edita tareas), `observador` (solo ve)
- **Backend**: `routes/proyectos.js`
  - GET /proyectos retorna array de miembros por proyecto
  - POST /proyecto crea al asignado automáticamente como `lider`
  - ver_propios ahora incluye proyectos donde el usuario es miembro
- **Backend**: `routes/tareas.js`
  - ver_propios ahora incluye tareas de proyectos donde el usuario es miembro
- **Backend**: `server.js` — dashboard incluye tareas de proyectos miembro
- **Frontend**: `proyectos.js`
  - Cards muestran badges de miembros (máx 4 + "+N")
  - Modal de edición incluye sección de gestión de miembros
  - Funciones: agregarMiembroProyecto, cambiarRolMiembro, quitarMiembroProyecto
- **Frontend**: `tareas.js`
  - Select "Asignado a" filtra por miembros del proyecto seleccionado
  - onchange en select de proyecto actualiza el select de asignado
  - Cache de miembros por proyecto

#### Archivos creados
- `modules/proyectos/backend/migrations/007_create_proyecto_miembros.sql`
- `modules/proyectos/backend/routes/miembros.js`

#### Archivos modificados
- `modules/proyectos/backend/server.js` — import + mount miembrosRoutes
- `modules/proyectos/backend/routes/proyectos.js` — GET retorna miembros, POST crea lider, ver_propios incluye miembros
- `modules/proyectos/backend/routes/tareas.js` — ver_propios incluye miembros
- `modules/proyectos/backend/routes/aprobacion.js` — restricción: no aprobar si hay tareas pendientes
- `modules/proyectos/public/js/modules/proyectos.js` — cards miembros + modal gestión + funciones CRUD
- `modules/proyectos/public/js/modules/tareas.js` — filtrar select por miembros del proyecto

#### Restricción de aprobación de proyectos
- `routes/aprobacion.js:152-168` — antes de aprobar, verifica `COUNT(*) FILTER (WHERE estado != 'completada')` en tareas del proyecto
- Si hay tareas pendientes, retorna 400 con mensaje descriptivo
- Botón de aprobar solo se muestra cuando `total_tareas === 0 || tareas_completadas === total_tareas`
- Aplica para todos los usuarios sin importar rol o perfil

#### UI de miembros estilo nómina
- Modal con checkbox list + filtro de texto + selector de rol por fila
- Botones "Todos" / "Ninguno" para selección masiva
- PUT `/proyectos/:id/miembros` para reemplazar todos los miembros en transacción
- Solo el creador o admin/gerente pueden gestionar miembros

#### Notificaciones de miembros
- Al agregar un miembro: notifica con mensaje según rol (líder=responsable, miembro=hace parte)
- Bulk: solo notifica a miembros nuevos

#### Fixes varios
- Email evidencia: `detallesExtra` debe ser objeto, no string
- Templates email: gramática correcta el/la según género de la entidad
- Label "Asignado a" → "Responsable del proyecto"
- Modal miembros z-index:350 (sobre modal de proyecto)

---

## Estado (6 Ago 2026 — sesión 39)

### Cambios Sesión 39 — Proyectos: fixes y mejoras

#### Fix: Cambiar proyecto al editar tarea
- **Bug**: El endpoint `PUT /tareas/:id` no desestructuraba `proyecto_id` del body ni lo incluía en el query UPDATE.
- **Fix**: `routes/tareas.js:197` — agregado `proyecto_id` a desestructuración + línea 249 nuevo `if` para actualizarlo.

#### Feature: Auto-cambiar estado a "en_progreso"
- Al comentar o subir evidencia en una tarea con estado `pendiente`, esta se cambia automáticamente a `en_progreso`.
- **Backend**: `routes/comentarios.js:41-46` — verifica `tarea.estado === 'pendiente'` y ejecuta UPDATE.
- **Backend**: `routes/evidencias.js:60,77-81` — misma lógica, SELECT ahora trae `estado`.

#### Feature: Pre-seleccionar proyecto al crear tarea
- Al hacer clic en un proyecto y luego en "+ Nueva Tarea", el modal pre-selecciona el proyecto padre.
- **Frontend**: `tareas.js:3` — nueva variable global `_proyectoFiltroActual`.
- **Frontend**: `proyectos.js:69` — `verTareasProyecto()` setea `_proyectoFiltroActual`.
- **Frontend**: `tareas.js:174-175,182` — `abrirModalTarea()` usa la variable para pre-seleccionar y la limpia.

#### Feature: Creador puede aprobar/rechazar sus proyectos
- Antes solo admin/gerente podían aprobar. Ahora el usuario asignado (`asignado_a`) también puede.
- **Backend**: `routes/aprobacion.js:152-157,196-201` —两端点 verifican `esAdminGerente || esCreador`.
- **Frontend**: `proyectos.js:54-55` — botones se muestran si `['admin','gerente'].includes(rol) || p.asignado_a === usuario?.id`.

#### Archivos modificados
- `modules/proyectos/backend/routes/tareas.js` — fix `proyecto_id` en PUT
- `modules/proyectos/backend/routes/comentarios.js` — auto en_progreso
- `modules/proyectos/backend/routes/evidencias.js` — auto en_progreso
- `modules/proyectos/backend/routes/aprobacion.js` — permisos de creador
- `modules/proyectos/public/js/modules/tareas.js` — variable contexto + pre-selección
- `modules/proyectos/public/js/modules/proyectos.js` — setear contexto + botones

---

## Estado (6 Ago 2026 — sesión 41)

### Cambios Sesión 41 — Filtros, paginación, deep-linking y notificaciones

#### Filtros en tablas
- **Tareas**: Filtro por usuario asignado (combobox searchable `selectBuscador()`)
- **Proyectos**: 5 filtros nuevos (estado, aprobación, centro operación, asignado a, ordenar por)
- **Botón "✕ Limpiar"**: En todas las tablas con filtros (Dashboard, Tareas, Proyectos)
- **CSS**: `.filters .select-buscador` para consistencia visual

#### Paginación mejorada en Tareas
- Select para elegir 10/20/50/100 tareas por página
- Botones Anterior/Siguiente se deshabilitan automáticamente
- Reset a página 1 al cambiar items por página

#### Deep-linking en emails
- **Función helper**: `tareasUrl(base, proyectoId)` genera URLs con `?proyecto=X`
- **Backend**: Todos los emails de tareas incluyen `?proyecto=id` cuando aplica
- **Frontend**: `mostrarAppInterno()` lee parámetros de URL y aplica filtros
- **Archivos**: `tareas.js`, `aprobacion.js`, `comentarios.js`, `evidencias.js`

#### Notificaciones in-app con deep-link
- **Fix HTTP method**: `marcarNotifLeida()` usa `DELETE` (antes usaba `PUT` y fallaba)
- **Dropdown**: Usa `data-url` en vez de string en `onclick` (evita problemas con caracteres especiales)
- **Navegación**: Primero navega, luego borra notificación en background

#### Notificaciones del navegador
- **Banner**: "🔔 Activa las notificaciones" en dropdown hasta que usuario active
- **Funciones**: `mostrarNotificacionBrowser()`, `activarNotificaciones()`, `checkNotifPermission()`
- **Polling**: Cada 15 segundos (antes 60s)
- **Sincronización**: Todos los módulos (framework.js + nomina/proveedores app.js)

#### Fixes varios
- `selectBuscador()` soporta objetos sin campo `email`
- `initSelectBuscador()` dispara evento `change` al seleccionar
- `verTareasProyecto()` es async y espera a `cargarProyectosSelect(forceReload)`
- `cargarProyectosSelect()` tiene flag `_filtroProyectoInit` para no resetear select
- Scheduler de recordatorios usa URL correcta `/proyectos/#tareas?proyecto=X`
- Modales de confirmación para aprobar/completar tareas y proyectos

#### Prioridad en proyectos
- **Migración**: `008_add_proyecto_prioridad.sql` — campo `prioridad` (baja/media/alta/critica)
- **Backend**: POST y PUT soportan campo `prioridad`
- **Frontend**: Select en modal crear/editar
- **Filtro**: Select de prioridad en barra de filtros de proyectos
- **Cards**: Badge de prioridad con colores (critica=danger, alta=warning, media=info, baja=muted)
- **Ordenar**: Opción "Mayor prioridad" en select de orden

#### Mejoras en vista de Tareas para escalar
- **Filtro por defecto**: "No completadas" excluye tareas completadas automáticamente
- **Recordar filtros**: Guarda estado, prioridad, proyecto, asignado en localStorage (`sy_tareas_filtros`)
- **Vista agrupada por proyecto**: Botón toggle "📁 Vista agrupada" que muestra tareas agrupadas
- **Colapsar/expandir**: Click en header del proyecto alterna visibilidad de la tabla
- **Colores fijos**: Tareas=`#00A86B` (verde), Proyectos=`#f7944f` (naranja) - no dependen del tema
- **Badges legibles**: Colores más oscuros en tema claro para better contrast

#### Unificación de localStorage
- Eliminada clave `sy_tareas_proyecto` (redundante)
- Todo usa `sy_tareas_filtros` para filtros de tareas
- `verTareasProyecto()` y `mostrarAppInterno()` guardan en `sy_tareas_filtros`

#### Fix sesión: refresh periódico
- **Refresh token**: `setInterval` cada 15min llama `POST /api/auth/refresh`
- **Visibilitychange**: Refresca token al volver visible la pestaña
- **Problema anterior**: JWT expiraba en 1h sin refresh periódico

#### Cache centralizado (mejora UX)
- **Helpers**: `cacheGet(key, ttlMs)`, `cacheSet(key, data)`, `cacheCleanAll()`
- **Prefijo**: `sf_` para distinguir de claves de módulo
- **Datos cacheados**: `/api/version` (1h), centros (5min), usuarios (5min)
- **Logout**: `cacheCleanAll()` invalida todos los caches

#### Filtros recordados en todas las vistas
- **Tareas**: `sy_tareas_filtros` + `sy_tareas_limit`
- **Dashboard**: `sy_dash_filtros`
- **Proyectos**: `sy_proy_filtros`
- **Botón "✕ Limpiar"**: Limpia localStorage y resetea filtros

#### Fix notificaciones (URL incorrecta)
- `cargarNotificaciones()` usaba `/proyectos/api/notificaciones` (404)
- **Fix**: `notifApi = HF.API.replace(/\/proyectos\/api$/, '/api')`
- Sincronizado framework.js con logística y proyectos

---

## Estado actual (21 Ago 2026)
### Últimos cambios
- **Sesión 48**: Instrumentación completa de auditoría OAuth (Google, GitHub, Microsoft), session kill, invalidación de sesiones admin y reset de password por admin. Issue #113 completado. Instrumentación de módulos: Proyectos (10 eventos), Logística (14 eventos), Proveedores (14 eventos). Nómina pendiente (SQLite). Visor de auditoría central: endpoint con filtros, stats cards, tabla paginada, detalle con metadata.
- **Sesión 48**: nombres de módulos cargados desde el Launcher mediante `GET /api/modulos` en Proyectos, Logística, Nómina y Proveedores, con fallback seguro y actualización del título del navegador.
- **Release v2.3.0**: commit `1cdb847`, tag anotado y release de GitHub publicados; deploy de producción verificado correctamente.
- **Copyright**: referencias legales actualizadas a `Kernel-Panic92` en licencias, documentación, footer y metadata de Nómina.
- **Sesión 47**: Workflow persistente de sprints, auditoría central, retención diaria, revocación selectiva de sesiones e instrumentación local de autenticación. PR #118 fusionado a `dev`.
- **Sprint actual**: Seguridad y observabilidad — branch `chore/open-issues-triage`; workflow persistente en `docs/WORKFLOW.md` y estado en `docs/SPRINT.md`.
- **Issues #65, #70, #71, #93 y #94**: cerrados o marcados obsoletos tras verificación.
- **Issues #111 y #112**: base de auditoría central, retención y helper implementados.
- **Issue #113**: completado — OAuth audit events, session kill audit, invalidación admin audit, password reset admin audit.
- **Sesión 46**: Archivo de proyectos completados Fase 2 — merge PR #117 a dev, branch feature eliminada
- **Sesión 45**: Archivo de tareas completadas Fase 1 — branch `feat/tareas-archivo-fase1`, commit `0948c2e`
- **Sesión 44**: Backup fixes + Members & Code Review + v2.1.1
- **Sesión 43**: Merge de branches a dev + Code Review + Fixes (CRITICAL/HIGH issues resueltos) + Fix vulnerabilidades Dependabot (13 → 0)
- **Sesión 42**: Backup unificado DR — pg_dump + SQLite + uploads + config bundle, systemd timer
- **Sesión 41**: Filtros en tablas, paginación, deep-linking emails, notificaciones in-app + navegador.
- **Sesión 40**: Miembros de proyecto con roles (lider/miembro/observador), filtrado de tareas por miembros, gestión de miembros en modal.
- **Sesión 39**: Fixes y mejoras en Proyectos — cambiar proyecto al editar tarea, auto-en_progreso al comentar/evidencia, pre-seleccionar proyecto padre, creador aprueba sus proyectos.
- **Sesión 38**: Fix OAuth error feedback (invalid_state message + logging + stack traces). MCP OAuth admin: mostrar usuario propietario de tokens y clientes activos.
- **Sesión 37**: Eliminado login de sesión expirada del launcher, se usa el login principal. Proveedores redirige a `/` en vez de overlay propio. Limpiado `jwtToken`/`user` al mostrar login por expiración.
- **Sesión 36**: Fix `/api/auth/me` — ahora retorna `modulos_permisos` en todos los módulos (nómina, logística, proveedores, proyectos).
- **Sesión 35**: OAuth login (Google, GitHub, Microsoft), MCP para IA (15 herramientas), notificaciones in-app, session expired modal mejorado.
- **Sesión 34**: Scheduler de vencimientos (proyectos), fixes seguridad (#91-#97), JWT expiry 1h.

### Pendientes consolidados

#### Issues GitHub abiertos
- [ ] **#116** — Observabilidad y alertas de seguridad
- [ ] **#115** — Instrumentar operaciones de negocio en módulos existentes
- [ ] **#114** — Menú central Logs en el Launcher
- [x] **#113** — Mejorar auditoría de sesiones y autenticación (COMPLETADO)
- [x] **#112** — Helper/SDK compartido para emisión de eventos de auditoría (COMPLETADO)
- [x] **#111** — Auditoría central: modelo de datos y contrato de eventos (COMPLETADO)
- [ ] **#109–#99** — Bloque UX/UI y accesibilidad
- [ ] **#68** — Migrar Launcher a GCM + separar secretos; pendiente rotación de claves

#### Técnicos
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Dividir `launcher/server.js` (~3700 líneas → routers separados)
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Ofuscar builds frontend
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Dashboard responsive 21:9/4K
- [ ] Integrar notificaciones con otros módulos (nómina, proveedores, logística)
- [ ] Preferencias de notificaciones por usuario
- [ ] Fix updater: migración proveedores falla al restart si DB ya tiene tablas

### Depreciados
- [x] ~~Migración Nómina SQLite → PostgreSQL~~ — DEPRECIADA (sesión 16). SQLite funciona correctamente.
- [x] ~~Backups por módulo~~ — DEPRECIADOS (sesión 42). Reemplazados por `scripts/backup_synnox.sh` (pg_dump). Se eliminarán en Fase 4.

---

## Metodologia de trabajo

El proyecto usa **Kanban iterativo con ciclos ligeros de sprint**. Las reglas
persistentes estan en `docs/WORKFLOW.md` y el estado del sprint actual en
`docs/SPRINT.md`. Toda nueva sesion debe leer ambos archivos junto con este
documento.

- GitHub Issues es la fuente de verdad del backlog.
- El sprint debe tener un objetivo verificable y criterios de aceptacion.
- El flujo normal crea branches desde `dev`, no desde `main`.
- El trabajo se divide en bloques pequenos, verificables y reversibles.
- No cerrar issues parcialmente resueltos; comentar avances y pendientes.
- Definition of Done: pruebas, diff limpio, documentacion, commit y estado del
  issue actualizados.
- No hacer merge, deploy ni modificar secretos sin confirmacion explicita.
- Al iniciar o cerrar un sprint actualizar `docs/SPRINT.md`; actualizar esta
  guia si cambian las reglas del proceso.

## Convenciones del Framework (SEGUIR SIEMPRE)

- **Modales**: Definir en HTML con `class="modal-overlay"`, mostrar/ocultar con `display: block/none`. NO crear modales dinámicamente con `document.createElement`.
- **Z-index modales**: `#modal-overlay` (confirmaciones/acciones) SIEMPRE z-index MAYOR que `#modal-detalle` (panel de detalle). Framework: overlay=300, detalle=200.
- **Leaflet en modales**: Limpiar `el._leaflet_id = null` antes de `L.map(el)`. Usar `invalidateSize()` con timeout (200ms + 500ms).
- **Confirmaciones**: Usar `confirmModal(msg, title, type)` del framework, NUNCA `confirm()`. Tipos: `'delete'` (🗑️), `'update'` (🔄), `'restart'` (♻️), `'info'` (ℹ️).
- **Mensajes**: Usar `toast(msg, type)` del framework.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **Layout `.main`**: Siempre `margin-left: var(--sidebar-w)` cuando sidebar es `position:fixed`. NO usar `padding-right` ni `width:calc`.
- **Grids**: Siempre `repeat(auto-fit, minmax(Xpx, 1fr))`. NUNCA `repeat(N, 1fr)` fijo.
- **Tablas overflow**: `.table-wrap` siempre `overflow-x:auto`, NUNCA `overflow:hidden`.
- **Skeletons**: Widgets con fetch deben mostrar skeleton loader.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos`.
- **`/api/auth/me`**: DEBE retornar `modulos_permisos`. Sin esto, TODOS los usuarios no-admin fallan en verificaciones de permisos.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir sidebar toggle, nav items con `.nav-item[data-page]`, overlay.
- **Footer del sidebar (MANDATORIO)**: `<div class="sidebar-footer"><a class="sidebar-home" href="/"><span class="icon">🏠</span> <span>Home</span></a><div class="user-name" id="sidebar-user-name"></div><div class="user-role" id="sidebar-user-role"></div><div class="version" id="app-version">v—</div><button class="btn-logout" onclick="...">⏻ Cerrar sesión</button></div>`. Poblar desde `/api/auth/me`.
- **Sidebar secciones**: `.sidebar-section` con `.sidebar-section-title`.
- **Error splash**: Mostrar `.error-splash` en vez de redirigir al launcher cuando un módulo falle al cargar.
- **Navegación same-tab**: Módulos y Home SIEMPRE abren en la misma pestaña.
- **Versión**: Todos los módulos leen `/api/version` del root `package.json`. NO usar `package.json` del módulo. NO mostrar rama git.
- **Instalación**: `install.sh` usa `$(pwd)` como INSTALL_DIR.
- **Centros de operación**: Launcher es fuente única de verdad. CRUD en launcher, módulos consumen via `GET /api/centros` (caché 30s).
- **Roles**: `admin` (acceso total), `gerente` (aprobaciones + acceso completo), `operador` (usa perfiles).
- **Telemetría**: `<script src="/telemetry.js"></script>` antes de `</body>` en todos los módulos.
- **Licencia**: Propietaria (LICENSE.md). NO redistribuir código fuente.
- **Combobox searchable**: Usar `selectBuscador()` + `initSelectBuscador()` en vez de `<select size="4">`.
- **Deploy SSH**: Llave read-only en `/root/.ssh/id_ed25519_synnox`.
- **Dark mode maps**: CSS filter `invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)` en `.map-dark`.
- **OAuth login**: Botones siempre visibles, verifican provider al click.
- **MCP OAuth**: Habilitado por defecto. Tokens vinculados a usuarios internos via login cookie.
- **Workflow de módulos**: Scaffold (Admin → Módulos → ⚡ Crear) → Desarrollo → Built-in (mover al repo, registrar en `builtin` array, montar como sub-app).
- **Multi-selección (checkbox list)**: Para seleccionar múltiples elementos, usar modal con checkboxes + filtro de texto + botones "Todos/Ninguno". NO usar `<select multiple>`. Ejemplo: `routes/miembros.js` + `proyectos.js:abrirModalMiembros()`.
- **Backup**: NO crear lógica de backup propia en módulos. Todo backup/restore es responsabilidad del launcher via `scripts/backup_synnox.sh` (systemd timer). Los módulos solo pueden ofrecer "export" de datos (CSV/JSON) para uso manual, sin cron, sin restore, sin NAS.
- **Notificaciones por rol/contexto**: Personalizar mensaje según el rol del usuario. Ej: líder → "eres el responsable", miembro → "haces parte del proyecto". Usar `notificar()` de `utils/notify.js`.
- **Templates de email (género)**: `templateAsignacion()` y `templateCambioEstado()` detectan género según entidad. "proyecto" = el/Asignado, "tarea" = la/Asignada. Siempre pasar `entidad` en minúsculas.
- **Queries resilientes**: Si una tabla puede no existir (migración pendiente), verificar con `SELECT 1 FROM tabla LIMIT 1` antes de usar. Ejemplo: `routes/proyectos.js` con `proyecto_miembros`.
- **Aprobación condicional**: Botón de aprobar solo se muestra cuando se cumplen las condiciones. Ej: proyecto solo cuando todas las tareas están completadas. Validación backend como red de seguridad.
- **Auto-cambio de estado**: Al realizar una acción en un elemento pendiente, cambiarlo automáticamente a "en progreso". Ej: comentar o subir evidencia en tarea pendiente → `en_progreso`.
- **Variables de contexto para pre-selección**: Usar variables globales como `_proyectoFiltroActual` para pasar contexto entre vistas. Setear en la vista origen, leer y limpiar en el modal destino.
- **Persistencia de página**: Guardar `localStorage.setItem('sy_last_page', page)` en `navigate()`. Restaurar al cargar: `hash || localStorage.getItem('sy_last_page') || 'dashboard'`. Validar con array de páginas válidas.
- **Combobox searchable en filtros**: Para filtros de usuario en tablas, usar `selectBuscador()` + `initSelectBuscador()` con flag de init para no re-renderizar.
- **Filtros en tablas**: Todos los filtros deben tener botón "✕ Limpiar" que resetee todos los valores y recargue los datos.
- **Paginación**: Select de items por página + botones Anterior/Siguiente que se deshabilitan automáticamente.
- **Deep-linking en emails**: Usar función helper `tareasUrl(base, proyectoId)` para generar URLs con `?proyecto=X`. Incluir en TODOS los emails de tareas.
- **Notificaciones in-app**: `marcarNotifLeida()` debe usar `DELETE` (no `PUT`). Primero navegar, luego borrar notificación en background.
- **Notificaciones del navegador**: Banner en dropdown hasta que usuario active. Polling cada 15 segundos. Usar `data-url` en vez de string en `onclick`.
- **Sincronización de framework.js**: Si se modifica `framework/framework.js`, sincronizar con `modules/*/public/framework.js` y `modules/*/public/app.js` (nomina/proveedores).
- **selectBuscador()**: Soporta objetos sin campo `email`. El `initSelectBuscador()` dispara `change` event automáticamente.
- **toggleAll()**: Soportar firma `(tipo, checked)` y `(source)` para compatibilidad entre framework.js y app.js.
- **trapFocus()**: Escape cierra el contenedor que tiene el trap (no siempre `modal-overlay`). Verificar `container.id` antes de cerrar.
- **Botones de acción en tablas (accesibles)**: Usar **icono solo + `title` + `aria-label`** con clase `btn-action` (32×32) y contenedor `tbl-actions`. Helper del framework: `actionBtn({icon,title,ariaLabel,onclick,variant})` y `actionGroup([...])`. Ejemplo: `actionBtn({icon:'✏️',title:'Editar lead',ariaLabel:'Editar lead ACME',onclick:"editarLead('123')",variant:'secondary'})`. Nunca usar texto dentro del botón de acción. Ver `framework/framework.js:actionBtn` y `framework/components.css:.btn-action/.tbl-actions`.

---

## Arquitectura

- **Servidor**: 1 PM2 process, puerto 3002, multi-módulo montado como sub-apps
- **Módulos**: Launcher + Proveedores + Logística + Nómina + Proyectos
- **Auth**: JWT cookie `launcher_jwt` (1h) + refresh token + `modulos_permisos` granulares
- **DB**: PostgreSQL centralizado (`synnox_erp`), Nómina SQLite local
- **Package manager**: pnpm (workspaces, strict mode)
- **Backup**: systemd timer `synnox-backup.timer` (diario 2 AM), script `scripts/backup_synnox.sh`
  - pg_dump -Fc (todos los schemas), SQLite hot-backup, uploads, config bundle
  - Retención GFS: 7 diarias / 4 semanales / 3 mensuales
  - Alertas email directas, copia NAS opcional (backups/.nas.conf)
  - NO usar cron dentro de Node para backups — usar systemd timer
- **Deploy**: Ubuntu 24.04, Node 20, PostgreSQL 16, nginx + Let's Encrypt
- **Repo**: Private, deploy via SSH key read-only, `git pull && pm2 restart`
- **Entorno**: 2 VMs dev + 1 prod. Flujo: dev local → PR → merge a `main` → prod git pull
- **Vulnerabilidades**: 0 (`pnpm audit --prod`)

---

## Proceso de merge dev → main

### Pre-merge (checklist)
1. `pnpm audit --prod` → 0 vulnerabilidades
2. `git status` → working tree limpio
3. `git log --oneline main..dev` → revisar commits pendientes
4. Verificar que no hay ramas feature pendientes en dev

### Pasos del merge
```bash
# 1. Actualizar main localmente
git checkout main
git pull origin main

# 2. Merge dev a main
git merge dev --no-edit

# 3. Si hay conflictos, resolver y commit
# git add . && git commit --no-edit

# 4. Push a origin
git push origin main

# 5. Verificar en servidor (producción)
ssh root@server "cd /opt/synnoxerp && git pull && pm2 restart all"
```

### Post-merge (verificación)
1. Verificar que el servidor PM2 levantó correctamente
2. Probar login y módulos principales
3. `pnpm audit --prod` en servidor para confirmar 0 vulnerabilidades
4. Verificar logs: `pm2 logs --lines 50`

### Crear tag (punto de restauración)
```bash
# Determinar versión (seguir semver)
# Major: cambios breaking (DB, auth, API)
# Minor: features nuevas
# Patch: fixes

# 1. Actualizar package.json version
# 2. Crear tag anotado
git tag -a v2.1.0 -m "release: [descripción breve]"

# 3. Push tag
git push origin v2.1.0
```

### Rollback (si algo falla)
```bash
# Opción A: Rollback a tag específico (recomendado)
sudo scripts/rollback.sh v2.1.0

# Opción B: Rollback manual
git checkout v2.1.0
pnpm install --prod
pm2 restart all

# Opción C: Revertir merge (mantener código actual)
git revert -m 1 HEAD
git push origin main
```

### Versionado semántico
```
v{major}.{minor}.{patch}

Ejemplos:
- v2.1.0 → v2.1.1 (patch: fix de bug)
- v2.1.0 → v2.2.0 (minor: feature nueva)
- v2.1.0 → v3.0.0 (major: breaking change)
```

### Notas importantes
- **NO hacer force push a main** — historia debe ser preservada
- **Backup antes del merge** — systemd timer corre a las 2 AM, pero verificar
- **Ventana de deploy** — preferiblemente horario laboral para monitoreo
- **Dependencias**: Si `pnpm install` falla en servidor, ejecutar `sudo chown -R root:root node_modules && pnpm install`
- **Tags**: Siempre crear tag después de verificar que el deploy funciona en producción
