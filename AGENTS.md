# SynnoxERP — Contexto del proyecto

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

## Estado actual (6 Ago 2026)

### Últimos cambios
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
- [ ] **#94** — @hono/node-server path traversal en Windows (Dependabot)
- [ ] **#93** — brace-expansion DoS — 3 Dependabot alerts HIGH
- [ ] **#71** — Backup nómina no encuentra `backup_horasextra.sh`
- [ ] **#70** — Investigar backup nómina más pesado que backup launcher
- [ ] **#68** — Migrar Launcher a GCM + separar secretos
- [ ] **#65** — Implementar fail2ban óptimo — evitar falsos positivos

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

---

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

---

## Arquitectura

- **Servidor**: 1 PM2 process, puerto 3002, multi-módulo montado como sub-apps
- **Módulos**: Launcher + Proveedores + Logística + Nómina + Proyectos
- **Auth**: JWT cookie `launcher_jwt` (1h) + refresh token + `modulos_permisos` granulares
- **DB**: PostgreSQL centralizado (`synnox_erp`), Nómina SQLite local
- **Package manager**: pnpm (workspaces, strict mode)
- **Deploy**: Ubuntu 24.04, Node 20, PostgreSQL 16, nginx + Let's Encrypt
- **Repo**: Private, deploy via SSH key read-only, `git pull && pm2 restart`
- **Entorno**: 2 VMs dev + 1 prod. Flujo: dev local → PR → merge a `main` → prod git pull
- **Vulnerabilidades**: 0 (`pnpm audit --prod`)
