# SynnoxERP — Contexto del proyecto

## Estado (30 Jul 2026 — sesión 27)

### Cambios Sesión 27 — Seguridad notificaciones, rendimiento launcher

#### Seguridad: endpoint POST /api/notificaciones/crear
- **INTERNAL_API_TOKEN**: Nuevo token interno obligatorio en producción (`process.exit(1)` si falta)
- **Validación con timingSafeEqual**: Comparación de token en tiempo constante (previene timing attacks)
- **Auth interna**: Todas las llamadas desde módulos requieren header `X-Internal-Token`
- **Auth externa**: Solo admin puede crear notificaciones (verifica `decoded.rol === 'admin'`)
- **Validaciones**: usuario_id debe existir y estar activo; longitudes máximas (modulo≤30, tipo≤50, titulo≤200, mensaje≤500, url≤300)
- **Idempotency_key**: Columna nueva UNIQUE en tabla notificaciones; previene duplicados en reintentos
- **Logs seguros**: No se imprime body completo, solo internal/tipo/usuario_id

#### Retención correcta de notificaciones
- Eliminada sentencia DELETE global que borraba todo excepto últimas 200
- Nueva limpieza por fecha: `DELETE WHERE created_at < datetime('now', '-30 days')`
- Ejecución al startup + intervalo cada 24h
- Nuevo índice: `idx_notif_fecha ON notificaciones(usuario_id, created_at DESC)`
- Notificaciones no leídas recientes nunca se eliminan por volumen

#### Helper reutilizable: framework/notify.js (CJS)
- Función `notificarInterna({ usuario_id, modulo, tipo, titulo, mensaje, url, evento_id })`
- Siempre retorna `{ ok, id?, error? }` — nunca lanza excepciones
- Timeout 5s por intento, 1 reintento en errores transitorios (5xx/network)
- No reintenta en 4xx (token inválido, validación fallida)
- `evento_id` opcional: si se provee, se usa como idempotency key
- Configuración via `LAUNCHER_URL` e `INTERNAL_API_TOKEN` del entorno

#### Migración de módulos al helper
- **Nómina**: Reemplazado `crearNotificacion()` local por `notificarInterna()` con `evento_id` determinista
- **Proveedores**: Reemplazado fetch inline por `notificarInterna()`
- **Logística**: Reemplazado fetch inline por `notificarInterna()` (import CJS via createRequire)
- **Proyectos**: Reemplazado fetch en `notify.js` por `notificarInterna()` (import CJS via createRequire)

#### Rendimiento: execSync → execFile async
- `GET /api/admin/server/stats`: Reemplazado `execSync('df -h / | tail -1')` por `execFileAsync('df', ['-h', '/'], { timeout: 3000 })`
- Ya no bloquea el event loop de Node
- Fallback `disk: null` si falla (frontend ya lo maneja)

#### Optimización de polling en launcher
- **_serverStatsInFlight**: Evita solicitudes solapadas de server stats
- **_notifInFlight**: Evita solicitudes solapadas de notificaciones
- **visibilitychange**: Listener instalado una sola vez (guard `_visibilityListenerInstalled`)
- **Pausa automática**: Polling se pausa cuando `document.visibilityState !== 'visible'`
- **Al volver visible**: Ejecuta notificaciones y versión inmediatamente
- **Version check**: Solo ejecuta si hay sesión activa (`jwtToken` existe)
- **Intervalo versión**: 30s (antes 15s)
- **Cleanup en logout()**: Limpia `_notifPollTimer`, `_versionCheckTimer`, `_serverStatsTimer`
- **Click-outside**: Listener instalado una sola vez (guard `_clickOutsideListenerInstalled`)

### Pendientes nuevos
- [ ] Integrar notificaciones con cron jobs (vencimientos, recordatorios)
- [ ] Preferencias de notificaciones por usuario
- [ ] Actualizar docs restantes

### Pendientes anteriores (actualizados)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~2800 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy

### Convenciones del Framework (SEGUIR SIEMPRE)
- **MCP**: Endpoints de proyectos y nómina ahora requieren autenticación
- **Frontend**: Botones CRUD ocultos según permisos del JWT (`tienePermiso()`)

#### Nuevo permiso `ver_propios` (Proyectos)
- **Launcher**: Nuevo permiso `ver_propios` en módulo Proyectos
- **Backend**: Si usuario tiene `ver_propios`, solo ve proyectos/tareas asignadas a él
- **Frontend**: `tienePermiso('ver_propios')` controla filtrado en UI
- **Admin/Gerente**: Ven todo (bypass por `requirePermiso`)

#### Flujo de revisión obligatorio (Proyectos)
- **Solo admin/gerente** pueden marcar tareas como completadas
- Botón "completar rápida" oculto para operadores
- Drag & drop restringido: completada solo para admin/gerente
- Dropdown de edición: opción completada solo para admin/gerente
- Backend valida transiciones en `PUT /:id` y `PUT /reordenar`
- **Tareas en revisión bloqueadas**: operadores no pueden editar ni mover tareas en estado `revision`
- Flujo obligatorio: `en_progreso → revision → (aprobación) → completada`

#### Fix URLs email (Issue #69)
- Renombrada `getBaseUrl()` OAuth a `getMcpBaseUrl()` para no sobreescribir la de emails
- Emails ahora usan `https://COMPANY_DOMAIN` sin puerto

#### Fix dashboard tareas por operador
- Dashboard filtra por `asignado_a` cuando usuario tiene `ver_propios`
- GET /tareas y GET /tareas/:id filtran por asignado_a

#### Campo `asignado_a` en proyectos
- Migración: columna `asignado_a` en tabla `projects.proyectos`
- Backend: POST y PUT manejan `asignado_a`
- Frontend: dropdown de asignación en formulario de proyectos
- Frontend: muestra usuario asignado en tarjeta del proyecto

#### UI Proyectos
- Filtro de búsqueda en tabla de proyectos (nombre, descripción, asignado)
- Botones de acción standardizados a solo iconos (✓ ✗ 📌 ✎ ✕)
- Click en card de proyecto → navega a tareas filtradas por ese proyecto
- Click en stat-cards del dashboard → navega a tareas filtradas por estado

#### Sistema de notificaciones global (Issue #81)
- **Tabla**: `notificaciones` en SQLite (launcher) con índices
- **API**: GET/PUT/DELETE notificaciones, conteo no leídas, crear (interno)
- **UI**: Campana 🔔 con badge, dropdown con lista, auto-poll 60s
- **Proyectos**: Notificaciones en tarea asignada, aprobada, rechazada
- **Framework**: Funciones reutilizables (`initNotifications`, `toggleNotifDropdown`, etc.)
- **CSS**: Estilos para campana, dropdown, items en `base.css`
- **Auth**: Endpoints internos (localhost) sin auth para llamadas entre módulos

#### Eliminados del admin
- **Nginx**: Endpoint y UI eliminados (generador rompía HTTPS en producción)
- **Apariencia**: Tab de gradientes eliminado, keys `grad_*` removidas de config

#### Fix Issues cerrados
- **#72**: Descripción de tarea editable inline + placeholder aclaratorio evidencias
- **#73**: Z-index modal confirmación sobre modal detalle (framework-level)
- **#76**: Widgets del launcher no bloquean sidebar + cache localStorage
- **#77**: Validación de roles en todos los módulos
- **#69**: URLs de email correctas (sin puerto 9443)

### Pendientes nuevos
- [ ] Integrar notificaciones con otros módulos (nómina, proveedores, logística)
- [ ] Preferencias de notificaciones por usuario (desactivar tipos)
- [ ] Limpieza automática de notificaciones antiguas (>30 días)

### Pendientes anteriores (actualizados)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~2800 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes

### Convenciones del Framework (SEGUIR SIEMPRE)

#### Fix seguridad: acceso no autorizado a módulos + UX sesión invalidada
- **Logística**: `/api/auth/me`, `/api/dashboard/resumen`, `/api/rutas/diagnostico` ahora usan `protect`
- **Proyectos**: `/api/auth/me` y `/api/dashboard` ahora usan `protect`
- **Nómina**: Ya tenía `requireModule('nomina')` en middleware global — correcto
- **Framework**: Nuevo `createProtect(moduleId)` helper
- **Frontend** (3 módulos): Error splash diferenciado para 403/401/genérico
- **Launcher**: `PUT /api/admin/usuarios/:id/modulos` devuelve `sesionInvalidada: true`; `/api/auth/me` verifica `seq`
- **Convención**: `createProtect(moduleId)` mandatorio para futuros módulos

#### Fix UNIQUE constraint en auth middleware de nómina
- **Problema**: SELECT con `AND activo=1` no encontraba usuarios inactivos, INSERT fallaba por UNIQUE email
- **Fix**: Separar try/catch de JWT vs DB; SELECT sin filtro activo; reactivar usuarios inactivos

#### Diagnóstico auth desde admin
- **Endpoint**: `GET /api/admin/diagnostico/auth/:userId` — muestra usuario, módulos, JWT payload simulado, permisos
- **Test**: `GET /api/admin/diagnostico/test-auth/:userId` — simula flujo auth paso a paso
- **UI**: Botón 🔍 Auth en tabla de usuarios del launcher

#### Launcher: reset password por admin + botones icon-only
- **Endpoint**: `POST /api/admin/usuarios/:id/reset-password` — genera token, envía email
- **UI**: Botones de tabla usuarios convertidos a icon-only (✏️🔑🔍🗑️♻️❌)
- **CSS**: Clases `.btn-icon` y `.btn-icon-danger`

#### URLs de email: COMPANY_DOMAIN como fuente única
- **Launcher**: `getBaseUrl()` → `https://{COMPANY_DOMAIN}` (eliminó lectura de config.env)
- **Nómina**: `BASE_URL` deriva de `COMPANY_DOMAIN` → `https://{domain}/nomina`
- **Proveedores**: `APP_URL` y `getBaseUrl()` derivan de `COMPANY_DOMAIN`
- **Proyectos**: `BASE_URL` deriva de `COMPANY_DOMAIN` → `https://{domain}/proyectos`
- **Proyectos aprobacion.js**: Fix hardcode `localhost:3002` → `LAUNCHER_URL`

#### Simplificar gestión de usuarios en nómina
- **Página Usuarios**: Solo lectura + asignar empleados (eliminado CRUD)
- **Modal**: Nuevo modal enfocado en asignación de empleados (checkboxes)
- **Backend**: Eliminados 5 endpoints muertos (crear, editar, eliminar, reset, forzar cambio)
- **Cleanup**: ~80 líneas de código muerto eliminadas

### Estado (28 Jul 2026 — sesión 23)

### Cambios Sesión 23 — Deploy producción + fixes

#### Deploy a producción (192.168.168.95)
- **Servidor**: Ubuntu 24.04, Node 20.20.2, PostgreSQL 16, nginx + Let's Encrypt
- **URL**: `https://horixvitamar.fortiddns.com`
- **Path**: `/opt/synnoxerp` (repo clonado via SSH deploy key read-only)
- **PM2**: `synnoxerp` process, auto-start via `pm2-root.service`
- **Nginx**: HTTPS con Let's Encrypt existente, HTTP→HTTPS redirect
- **DB**: PostgreSQL `synnox_erp`, usuario `synnox`
- **Módulos**: Launcher + Proveedores + Logística + Nómina + Proyectos

#### Fixes durante deploy
- **CORS theme.js**: `modules/proyectos/public/theme.js` usaba `http://localhost:3002` hardcodeado → `window.location.origin`
- **PostgreSQL permissions**: `synnox` user no tenía permisos en schemas `public`, `projects`, `logistics` → GRANT ALL + ALTER DEFAULT PRIVILEGES
- **Migraciones**: Ejecutadas manualmente para proveedores (40 tablas), proyectos (4 migrations), logística (17 migrations)
- **install.sh**: Agregado GRANT de PostgreSQL después de crear DB (evita permission denied en installs futuros)
- **Updater SSH**: PM2 corre como `root`, llave SSH estaba en `~coordinadorsistemas/.ssh/` → copiada a `/root/.ssh/` + `GIT_SSH_COMMAND` en `.env`

#### Fixes pre-deploy
- **Nginx paths**: `launcher/server.js` generador nginx usaba `/etc/ssl/platform/` (legacy) y puerto `8445` → `/etc/ssl/synnoxerp/` y `443`
- **platform-test.conf**: Mismos paths/puerto legacy corregidos
- **Dropdown asignación**: `<select size="4">` (listbox roto por CSS) → combobox searchable con input + dropdown nativo
- **Actas PDF**: Query SQL a `centros_operacion` (sin columna `ciudad`) → lookup desde `globalThis.__centrosCache`

#### Convenciones actualizadas
- **Deploy key SSH**: Read-only, solo para `git fetch/pull`. Llave en `/root/.ssh/id_ed25519_synnox`
- **GIT_SSH_COMMAND**: Configurado en `.env` de producción para que PM2 (root) pueda hacer fetch
- **PostgreSQL grants**: `install.sh` ejecuta GRANTs después de crear DB — no depender de superuser para migraciones
- **Combobox searchable**: Usar `selectBuscador()` + `initSelectBuscador()` del framework en vez de `<select size="4">` con `filtrarSelectUsuarios()`

### Pendientes nuevos
- [ ] **Fix updater**: La migración de proveedores falla al restart si DB ya tiene tablas (reintentable)
- [ ] **Ofuscar builds frontend** — Evaluar `javascript-obfuscator` o similar

### Pendientes anteriores (actualizados)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~2700 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes

### Convenciones del Framework (SEGUIR SIEMPRE)

- **Modales**: Definir en HTML con `class="modal-overlay"`, mostrar/ocultar con `display: block/none`. NO crear modales dinámicamente con `document.createElement`.
- **Z-index modales**: `#modal-overlay` (confirmaciones/acciones) SIEMPRE z-index MAYOR que `#modal-detalle` (panel de detalle). Framework: overlay=300, detalle=200. Evita que confirmaciones queden detrás del modal de detalle.
- **Confirmaciones**: Usar `confirmModal(msg, title, type)` del framework, NUNCA `confirm()` del navegador. Tipos: `'delete'` (default, rojo 🗑️), `'update'` (azul 🔄), `'restart'` (amarillo ♻️), `'info'` (gris ℹ️).
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **Layout `.main`**: Siempre `margin-left: var(--sidebar-w)` cuando el sidebar es `position:fixed`. NO usar `padding-right` ni `width:calc`.
- **Grids**: Siempre `repeat(auto-fit, minmax(Xpx, 1fr))`. NUNCA `repeat(N, 1fr)` fijo. Usar `auto-fit` para pocos items, `auto-fill` para muchos.
- **Tablas overflow**: `.table-wrap` siempre `overflow-x:auto`, NUNCA `overflow:hidden`.
- **Skeletons**: Widgets con fetch deben mostrar skeleton loader mientras cargan.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`.
- **Footer del sidebar (MANDATORIO)**: DEBE seguir esta estructura HTML: `<div class="sidebar-footer"><a class="sidebar-home" href="/"><span class="icon">🏠</span> <span>Home</span></a><div class="user-name" id="sidebar-user-name"></div><div class="user-role" id="sidebar-user-role"></div><div class="version" id="app-version">v—</div><button class="btn-logout" onclick="...">⏻ Cerrar sesión</button></div>`. Poblar `sidebar-user-name` y `sidebar-user-role` desde `/api/auth/me`. NO usar `injectSidebarHome()` — el Home link es HTML estático. Orden: Home → Usuario → Versión → Logout.
- **Sidebar secciones**: Usar `.sidebar-section` con `.sidebar-section-title` para agrupar nav items. Ejemplo: `<div class="sidebar-section"><div class="sidebar-section-title">Grupo</div><div class="nav-item">...</div></div>`.
- **Error splash**: Cuando un módulo falle al cargar (auth, red), mostrar `.error-splash` en vez de redirigir al launcher. Usar clases `.error-splash`, `.error-splash-card`, `.error-splash-icon`, `.error-splash-title`, `.error-splash-msg`, `.error-splash-btn`.
- **Navegación same-tab**: Módulos y Home button SIEMPRE abren en la misma pestaña (`href="/"` sin `target="_blank"`). Launcher también abre módulos en la misma pestaña.
- **Versión**: Todos los módulos leen `/api/version` del root `package.json` (versión unificada `1.0.0`). NO usar `package.json` del módulo. NO mostrar rama git. Frontend: `el.textContent = 'v' + data.version`.
- **Instalación**: `install.sh` usa `$(pwd)` como INSTALL_DIR — ejecutar desde el directorio del repo clonado. NO copiar a otro path.
- **Centros de operación**: Launcher es fuente única de verdad. CRUD en launcher, módulos consumen via `GET /api/centros` (caché 30s). NO crear tablas locales de centros. Mismos IDs en footer del sidebar: `sidebar-user-name`, `sidebar-user-role`.
- **Roles**: `admin` (acceso total), `gerente` (aprobaciones + acceso completo), `operador` (usa perfiles). CSV import mapea `gerencia` → `gerente`.
- **Telemetría**: Todos los módulos DEBEN incluir `<script src="/telemetry.js"></script>` antes de `</body>`. Script trackea page_view, errores JS y heartbeats. Endpoints públicos (sin auth). Datos centralizados en launcher.db.
- **Licencia**: Propietaria (LICENSE.md). NO redistribuir código fuente.
- **Combobox searchable**: Para selects con búsqueda, usar `selectBuscador()` + `initSelectBuscador()` en vez de `<select size="4">` con `filtrarSelectUsuarios()`. El size=4 rompe por CSS global.
- **Deploy SSH**: Llave read-only en `/root/.ssh/id_ed25519_synnox`. Configurar `GIT_SSH_COMMAND` en `.env` para que PM2 (root) pueda hacer git fetch.

---

### Cambios Sesión 21 — Issues #36, #31, #37, #38, #41 + Framework Home button

#### PR #39 — Reactivar usuarios, botón launcher, filtro asignación (Issues #36, #31, #37)
- **Issue #36 — Reactivar usuario**: Botón "♻️ Reactivar" en tabla de usuarios del launcher para cuentas inactivas. Llama a `PUT /api/admin/usuarios/:id` con `{ activo: true }`
- **Issue #31 — Botón regresar**: Enlace "Home" en sidebar de los 4 módulos (nómina, proveedores, logística, proyectos)
- **Issue #37 — Dropdown asignación**: Pre-selecciona usuario actual al crear tarea nueva + campo de búsqueda con filtro en tiempo real por nombre/email

#### PR #40 — Mejorar flujo de actualización (Issue #38)
- **Frontend**: Validación `res.ok` antes de parsear JSON, spinner + barra de progreso con pasos, polling de logs cada 3s
- **Backend**: Try/catch individual por paso (git fetch, git reset, npm install) con campo `step` en respuesta
- **CSS**: Animación `@keyframes spin` para spinner

#### PR #42 — Widgets stuck loading + redirect para operadores (Issue #41)
- **Launcher**: Ocultar widgets admin-only (`display: none`) para usuarios no-admin en vez de dejar skeletons visibles
- **Nómina**: Pantalla "🔒 Acceso denegado" en vez de redirect silencioso al launcher para 403

#### PR #43 — Cookie path + updater 502
- **Cookie fix**: Agregado `path: '/'` en login (`server.js`) y refresh token (`middleware/auth.js`). Sin esto, la cookie solo se enviaba a la ruta del request original, no a módulos como `/nomina/`
- **Updater fix**: `res.json()` se envía ANTES de ejecutar git reset. Previene 502 si el proceso crashea durante actualización
- **pnpm**: Cambiado `npm install --production` por `pnpm install --prod --frozen-lockfile`

#### PR #44 — Home button + separador en framework
- **Framework `base.css`**: Nuevas clases `.sidebar-home`, `.sidebar-separator` para botón Home y separador visual
- **Framework `framework.js`**: Función `injectSidebarHome()` inyecta automáticamente el botón Home en el footer del sidebar
- **CSS collapsed**: Home link se oculta correctamente en sidebar colapsado
- **Módulos**: Eliminado HTML duplicado de Home en los 4 módulos

#### PR #45 — Updater 502 (rama separada)
- Fix del updater: respuesta antes de git reset + pnpm install

#### PR #46 — Fix manual nómina público (sin auth)
- **Bug**: `manual.html` no podía cargar los manuales porque el endpoint `/api/manual/:rol` requería autenticación JWT y el fetch no enviaba token
- **Fix `server.js`**: Excluidas rutas `/manual/` del middleware auth global (`req.path.startsWith('/manual/')`)
- **Fix `misc.js`**: Eliminado middleware `todosRoles` del endpoint `/manual/:rol` (ahora público)
- **Fix `manual.html`**: Corregida URL de fetch de `/api/manual/` a `/nomina/api/manual/` (módulo montado en `/nomina`)
- **Archivos**: Manuales `.md` ya existían replicados con branding "SynnoxERP" + screenshots en `public/screenshots/`

### Cambios Sesión 22 — UI/UX Launcher y Framework

#### PR #47 — Fix manual nómina público + logística versión sidebar
- **Manual nómina**: `manual.html` no podía cargar manuales (endpoint requería auth). Fix: excluir `/manual/` del middleware auth global
- **Logística versión**: `cargarVersion()` definida pero nunca llamada en `init()`. Fix: agregada llamada

#### PR #48 — Fix URL de ayuda en nómina
- **Bug**: `abrirManual()` abría `/manual.html` (raiz) en vez de `/nomina/manual.html`. Fix: corregida URL

#### PR #49 — confirmModal con tipos visuales (delete/update/restart/info)
- **`confirmModal(msg, title, type)`**: Nuevo 3er parámetro `type` para cambiar apariencia del modal
- **Tipos**: `'delete'` (🗑️ rojo), `'update'` (🔄 azul), `'restart'` (♻️ amarillo), `'info'` (ℹ️ gris)
- **Backward compatible**: 3er parámetro opcional, default `'delete'`

#### PR #50 — Admin sidebar con pestañas agrupadas
- **Reemplazado** tab bar horizontal por sidebar fijo a la izquierda
- **13 pestañas** agrupadas en 3 categorías: Gestión, Sistema, Operaciones
- **Sidebar**: logo, nav items con iconos, footer con usuario/Home/logout
- **CSS**: clases `.admin-sidebar` → `.sidebar` (estándar)
- **Responsive**: sidebar colapsable en móvil

#### Sidebar unificado (commits directos en main)
- **Home button**: Eliminado HTML estático de los 4 módulos. Cada módulo inyecta via `injectSidebarHome()`
- **Admin**: Migrado de `.admin-sidebar` a `.sidebar` (clase estándar del framework)
- **Proveedores**: Fix layout (`padding-right:120px` → `margin-left` de base.css)
- **Error splash**: Nuevo componente `.error-splash` para errores de carga (en vez de redirect al launcher)
- **Mismas pestañas**: Launcher abre módulos en la misma pestaña (eliminado `target="_blank"`)
- **Admin flash fix**: Eliminada regla CSS `display:flex` que forzaba visibilidad del admin
- **base.css**: Agregados estilos `.sidebar-section` y `.sidebar-section-title`

### Fix adicional — UNIQUE constraint en nómina
- **Bug**: Usuarios existentes en `horas_extra.db` con `activo=0` causaban `UNIQUE constraint failed` al intentar INSERTAR un duplicado
- **Fix**: `autenticar()` ahora verifica si el usuario existe pero está inactivo y lo reactiva con `UPDATE` en vez de INSERT

### Convenciones del Framework (ACTUALIZADO)

#### PR #32 — Centralizar sedes/centros desde launcher (Issue #28)
- **Schema enriquecido**: `centros_operacion` con codigo, descripcion, direccion, ciudad, telefono, email, responsable_id, latitud, longitud, actualizado
- **API pública**: `GET /api/centros` (sin auth, caché 30s) para consumo de módulos remotos
- **API admin**: CRUD completo con todos los campos + audit trail (`centros_historial`)
- **UI CRUD en launcher**: Formulario grid 2 columnas con todos los campos
- **Proveedores**: Centros ahora son read-only, sincronizados desde launcher via `POST /api/centros/sync`
- **Logística**: Dropdown de centros poblado desde launcher, validación contra API en POST/PUT
- **Cache in-memory**: TTL 30s + invalidación en writes

#### PR #33 — Aprobación por gerente + emails y alertas (Issues #27 + #25)
- **Nuevo rol 'gerente'**: En launcher (JWT, UI, CSV import) con permisos de aprobación
- **Aprobación**: Admin Y gerente pueden aprobar/rechazar tareas y proyectos
- **Email infrastructure**: `backend/utils/email.js` con SMTP heredado del launcher, 6 templates HTML
- **Templates**: aprobación, rechazo, tarea en revisión, vencimiento, resumen semanal
- **Alertas de vencimiento**: `POST /api/alertas/vencimiento/enviar` — emails a asignados y gerentes
- **Resumen semanal**: `POST /api/alertas/resumen/enviar` — digest automático
- **Frontend**: Botones de aprobación visibles para gerentes en tabla y Kanban
- **Solicitar revisión**: Notifica a gerentes/admins por email

#### PR #34 — Mapa Google Maps + Leaflet en centros
- **Schema**: Columnas `latitud`/`longitud` (REAL) en `centros_operacion`
- **Leaflet 1.9.4**: CDN para mapa interactivo (sin API key)
- **Google Maps Places**: Autocomplete de direcciones (requiere API key)
- **Mapa**: Click para posicionar marcador, drag para reajustar
- **Config**: Tab "Mapas" en admin para gestionar API key de Google Maps
- **Endpoints**: `GET/PUT/DELETE /api/config/gmaps/*` para API key

#### PR #35 — Instalador desde directorio del repo
- **install.sh**: `INSTALL_DIR=$(pwd)` en vez de `~/.local/share/synnoxerp`
- **Eliminado clone/copy**: El instalador usa el directorio actual del repo
- **PM2**: `pm2 start server.js --name synnoxerp --cwd $(pwd)`
- **Fallback INSTALL_DIR**: `path.resolve(__dirname, '..')` en launcher/server.js
- **Ruta /media**: Agregada para logos estáticos
- **config.env.example**: Eliminado `INSTALL_DIR` hardcoded

#### Bugs corregidos
- **Merge conflicts residuales**: Duplicación de `_centrosCache` (líneas 38 y 965) + marker `=======` en delete gmaps endpoint
- **PostgreSQL password mismatch**: install.sh generaba password nueva pero no actualizaba user PostgreSQL existente
- **Launcher.db stale**: DB vieja con hash de contraseña antiguo — fix: borrar DB para regeneración

### Pendientes nuevos
- [ ] **Fix install.sh**: Actualizar password PostgreSQL cuando user ya existe (no solo crear)
- [ ] **Fix install.sh**: Agregar verificación de que PM2 arrancó correctamente
- [ ] **Ofuscar builds frontend** — Evaluar `javascript-obfuscator` o similar
- [ ] **Fix CORS**: Módulos internos (proyectos, logística) necesitan `CORS_ORIGIN` configurado

### Pendientes anteriores (actualizados)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~2200 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes

### Convenciones del Framework (SEGUIR SIEMPRE)

- **Modales**: Definir en HTML con `class="modal-overlay"`, mostrar/ocultar con `display: block/none`. NO crear modales dinámicamente con `document.createElement`.
- **Confirmaciones**: Usar `confirmModal(msg, title, type)` del framework, NUNCA `confirm()` del navegador. Tipos: `'delete'` (default, rojo 🗑️), `'update'` (azul 🔄), `'restart'` (amarillo ♻️), `'info'` (gris ℹ️).
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **Layout `.main`**: Siempre `margin-left: var(--sidebar-w)` cuando el sidebar es `position:fixed`. NO usar `padding-right` ni `width:calc`.
- **Grids**: Siempre `repeat(auto-fit, minmax(Xpx, 1fr))`. NUNCA `repeat(N, 1fr)` fijo. Usar `auto-fit` para pocos items, `auto-fill` para muchos.
- **Tablas overflow**: `.table-wrap` siempre `overflow-x:auto`, NUNCA `overflow:hidden`.
- **Skeletons**: Widgets con fetch deben mostrar skeleton loader mientras cargan.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`.
- **Footer del sidebar (MANDATORIO)**: DEBE seguir esta estructura HTML: `<div class="sidebar-footer"><a class="sidebar-home" href="/"><span class="icon">🏠</span> <span>Home</span></a><div class="user-name" id="sidebar-user-name"></div><div class="user-role" id="sidebar-user-role"></div><div class="version" id="app-version">v—</div><button class="btn-logout" onclick="...">⏻ Cerrar sesión</button></div>`. Poblar `sidebar-user-name` y `sidebar-user-role` desde `/api/auth/me`. NO usar `injectSidebarHome()` — el Home link es HTML estático. Orden: Home → Usuario → Versión → Logout.
- **Sidebar secciones**: Usar `.sidebar-section` con `.sidebar-section-title` para agrupar nav items. Ejemplo: `<div class="sidebar-section"><div class="sidebar-section-title">Grupo</div><div class="nav-item">...</div></div>`.
- **Error splash**: Cuando un módulo falle al cargar (auth, red), mostrar `.error-splash` en vez de redirigir al launcher. Usar clases `.error-splash`, `.error-splash-card`, `.error-splash-icon`, `.error-splash-title`, `.error-splash-msg`, `.error-splash-btn`.
- **Navegación same-tab**: Módulos y Home button SIEMPRE abren en la misma pestaña (`href="/"` sin `target="_blank"`). Launcher también abre módulos en la misma pestaña.
- **Versión**: Todos los módulos leen `/api/version` del root `package.json` (versión unificada `1.0.0`). NO usar `package.json` del módulo. NO mostrar rama git. Frontend: `el.textContent = 'v' + data.version`.
- **Instalación**: `install.sh` usa `$(pwd)` como INSTALL_DIR — ejecutar desde el directorio del repo clonado. NO copiar a otro path.
- **Centros de operación**: Launcher es fuente única de verdad. CRUD en launcher, módulos consumen via `GET /api/centros` (caché 30s). NO crear tablas locales de centros. Mismos IDs en footer del sidebar: `sidebar-user-name`, `sidebar-user-role`.
- **Roles**: `admin` (acceso total), `gerente` (aprobaciones + acceso completo), `operador` (usa perfiles). CSV import mapea `gerencia` → `gerente`.
- **Telemetría**: Todos los módulos DEBEN incluir `<script src="/telemetry.js"></script>` antes de `</body>`. Script trackea page_view, errores JS y heartbeats. Endpoints públicos (sin auth). Datos centralizados en launcher.db.
- **Licencia**: Propietaria (LICENSE.md). NO redistribuir código fuente.

---

## Estado (21 Jul 2026 — sesión 18)

### Cambios Sesión 18 — SIESA export, dashboard layout

- **SIESA export**: Columna B cambiada de `r.sede` a `r.empleadoNombre` para coincidir con Horix.
- **Dashboard simplificado**: Eliminado sistema de widgets complejo (S/M/G per-card, drag-and-drop, ResizeObservers). Reemplazado por `chart-card` simple (título + canvas), como proveedores.
- **Grid responsive**: Cambiado de `repeat(12, 1fr)` a `auto-fit, minmax(360px, 1fr)` para adaptarse al ancho de pantalla.
- **S/M/G global**: Botones S/M/G ahora controlan el `minmax` del grid completo (no per-card). S: 260px, M: 360px, L: 520px.
- **`initGridSize()`**: Resetea el grid a `sz-m` al cargar el dashboard para limpiar clases stale.
- **`crearOActualizar()`**: Agregado `requestAnimationFrame + setTimeout(300)` para resize post-creación de charts.
- **CSS cleanup**: Eliminadas ~150 líneas de CSS de widgets (.widget, .widget-header, .widget-controls, drag states, etc.)
- **HTML cleanup**: Eliminados S/M/G per-card buttons, drag-hint, widget structure. Simplificado a chart-card inline.

### Pendientes nuevos
- [ ] **Dashboard responsive 21:9/4K** — Issue #XX abierto. El grid `auto-fit` no adapta correctamente en pantallas ultra-anchas. Revisar en nómina, logística y proyectos. Verificar CSS specificity, viewport meta, y `auto-fit` behavior.
- [ ] **Ofuscar builds frontend** — Evaluar `javascript-obfuscator` o similar. Verificar que no rompa nada antes de implementar. **No hacer sin probar en staging primero.**

### Pendientes anteriores (actualizados)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~1950 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes

---

## Estado (18 Jul 2026 — sesión 16)

### Cambios Sesión 16 — Licencia, paths XDG & repo privado

- **LICENSE.md**: Licencia propietaria/privada (Copyright © 2026 Edgar Velasquez). Prohíbe redistribución, venta y publicación del código fuente. Documento completo con 12 secciones.
- **INSTALL_DIR XDG**: Default cambiado de `/opt/synnoxerp` a `~/.local/share/synnoxerp` (estándar XDG Base Directory). Actualizado en `config.env.example`, `install.sh`, `launcher/server.js`, `installer/server.js`, `installer/public/*`.
- **Fix — INSTALL_DIR undefined**: `launcher/shell/app.js` usaba `INSTALL_DIR` sin definirlo. Agregado fallback a `~/.local/share/synnoxerp`.
- **Docs paths**: Actualizados `ARCHITECTURE.md` (6 refs), `MIGRATION_NOMINA.md` (5 refs), `README.md`, `framework/README.md` con nuevos paths.
- **Repo privado**: Cambiado visibilidad de GitHub de public → private para proteger código fuente.
- **PR**: `feat/license-and-xdg-paths` → `main` ([#12](https://github.com/Kernel-Panic92/synnox-erp/pull/12))

### Pendientes nuevos
- [ ] **Ofuscar builds frontend** — Evaluar `javascript-obfuscator` o similar. Verificar que no rompa nada antes de implementar. **No hacer sin probar en staging primero.**

### Pendientes anteriores (actualizados)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~1950 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes

### Depreciados
- [x] ~~Migración Nómina SQLite → PostgreSQL~~ — **DEPRECIADA** (sesión 16). Demasiado compleja, alto riesgo de romper funcionalidad existente. SQLite funciona correctamente para el caso de uso actual. Documentación histórica en `MIGRATION_NOMINA.md` y `ARCHITECTURE.md §7` se mantiene como referencia.

### Convenciones del Framework (SEGUIR SIEMPRE)

- **Modales**: Definir en HTML con `class="modal-overlay"`, mostrar/ocultar con `display: block/none`. NO crear modales dinámicamente con `document.createElement`.
- **Confirmaciones**: Usar `confirmModal(msg, title, type)` del framework, NUNCA `confirm()` del navegador. Tipos: `'delete'` (default, rojo 🗑️), `'update'` (azul 🔄), `'restart'` (amarillo ♻️), `'info'` (gris ℹ️).
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`. **Home button**: El framework inyecta automáticamente el botón "🏠 Home" en `.sidebar-footer` via `injectSidebarHome()`. NO agregar HTML estático del Home. Si el módulo NO usa `initFramework()`, agregar función `injectSidebarHome()` propia y llamarla en el init.
- **Sidebar secciones**: Usar `.sidebar-section` con `.sidebar-section-title` para agrupar nav items.
- **Error splash**: Cuando un módulo falle al cargar, mostrar `.error-splash` en vez de redirigir al launcher.
- **Navegación same-tab**: Módulos y Home button SIEMPRE abren en la misma pestaña (`href="/"` sin `target="_blank"`).
- **Versión**: Todos los módulos leen `/api/version` del root `package.json` (versión unificada `1.0.0`). NO usar `package.json` del módulo. NO mostrar rama git. Frontend: `el.textContent = 'v' + data.version`.
- **Instalación**: Path default `~/.local/share/synnoxerp` (XDG). NO usar `/opt/`.
- **Licencia**: Propietaria (LICENSE.md). NO redistribuir código fuente.

---

## Estado (17 Jul 2026 — sesión 15)

### Cambios Sesión 15 — Sidebar consistente + features

- **Framework — sidebar colapsable**: Agregado a `base.css` (estilos `.sidebar.collapsed`, `.sidebar-toggle`, transiciones) y `framework.js` (`toggleSidebarCollapse()` + restauración desde `localStorage`).
- **Proyectos — theme**: Cambiado `themeKey` de `'proyectos_theme'` a `'synnox_theme'` (ahora lee del launcher). Eliminado botón de toggle de tema.
- **Proyectos — sidebar**: Agregado botón de colapsado, sincronizado `base.css` y `framework.js` con versión canónica.
- **Logística — sidebar**: Sincronizado `base.css`/`framework.js` con framework. Eliminado CSS duplicado del sidebar en inline `<style>`. Agregado botón de colapsado.
- **Nomina — sidebar**: `<nav>` → `<aside>`, `.mob-overlay` → `.sidebar-overlay`, IDs estandarizados (`user-name`, `user-role`, `user-badge`), `.nav-icon` → `.icon`, `.role-badge` → `.badge`, nav container → `<nav id="sidebar-nav">`.
- **Proveedores — sidebar**: `<div>` → `<aside>`, `.mob-overlay` → `.sidebar-overlay`, IDs estandarizados, `.role-badge` → `.badge`, nav → `<nav id="sidebar-nav">`, funciones sidebar actualizadas.
- **Versión unificada**: Todos los módulos ahora leen `/api/version` del root `package.json` (versión `1.0.0`). Eliminados `readBranch()`, `readRepoUrl()`, display de rama git.
- **Auth exemption**: `/api/version` exento de auth global en nomina y proveedores.
- **Root catch-all**: SPA catch-all movido después de todos los mounts de módulos (fix para que sub-apps funcionen correctamente).
- **Documentación**: Actualizado README.md root (paths, arquitectura, proyectos), framework/README.md (sidebar conventions, version), AGENTS.md (version convention).

---

## Estado (17 Jul 2026 — sesión 14)

### Cambios Sesión 14 — Unificación catálogo centros nómina→launcher + fix 404

- **Bug fix — 502 tras restart máquina**: Nginx proxy a puerto 3003, PM2 estaba vacío. Fix: `pm2 start server.js --name synnoxerp` con .env `PORT=3003`. Root process en `/opt/synnoxerp` (puerto 3002) es instalación vieja.
- **Bug fix — 404 en `/api/admin/centros`**: El route existía correctamente en `launcher/server.js:834` pero el servidor PM2 tenía código stale. Fix: `pm2 restart synnoxerp`.
- **Nuevo `launcherDb.js`**: Helper en `modules/nomina/src/utils/launcherDb.js` que abre `launcher.db` en modo read-only para consultar `centros_operacion`. Cache singleton con TTL de 30s.
- **Refactor — centros.js (nómina)**: GET lee del launcher; POST/PUT/DELETE devuelven 400 con mensaje "Los centros se gestionan desde el panel de administración del Launcher".
- **Refactor — misc.js `/sedes`**: Ahora lee de launcher en vez de tabla local `centros`.
- **Refactor — empleados.js y usuarios.js**: Validación de `sede` ahora usa `validarSede()` del launcher en lugar de `SELECT id FROM centros`.
- **Cleanup — migrations.js**: Eliminada creación de tabla `centros` (ya no se usa).
- **Cleanup — seeds.js**: Eliminado seed de centros y permiso `eliminar_centros`.
- **Cleanup — restore.js**: Eliminada restauración de centros.
- **Frontend — centros page read-only**: Sin botón "Nuevo Centro", sin columna Acciones, sin modal CRUD. Mensaje: "Los centros se gestionan desde el panel de administración del Launcher".
- **Frontend — employees.js**: Eliminadas funciones `abrirModalCentro`, `editarCentro`, `guardarCentro`, `eliminarCentro`.
- **Chore — .gitignore**: Agregados patrones `*.db`, `*.db-shm`, `*.db-wal`, `logs/`, `uploads/`.

### Convenciones del Framework (SEGUIR SIEMPRE)

- **Modales**: Definir en HTML con `class="modal-overlay"`, mostrar/ocultar con `display: block/none`. NO crear modales dinámicamente con `document.createElement`.
- **Confirmaciones**: Usar `confirmModal(msg, title, type)` del framework, NUNCA `confirm()` del navegador. Tipos: `'delete'` (default, rojo 🗑️), `'update'` (azul 🔄), `'restart'` (amarillo ♻️), `'info'` (gris ℹ️).
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`. **Home button**: El framework inyecta automáticamente el botón "🏠 Home" en `.sidebar-footer` via `injectSidebarHome()`. NO agregar HTML estático del Home. Si el módulo NO usa `initFramework()`, agregar función `injectSidebarHome()` propia y llamarla en el init.
- **Sidebar secciones**: Usar `.sidebar-section` con `.sidebar-section-title` para agrupar nav items.
- **Error splash**: Cuando un módulo falle al cargar, mostrar `.error-splash` en vez de redirigir al launcher.
- **Navegación same-tab**: Módulos y Home button SIEMPRE abren en la misma pestaña (`href="/"` sin `target="_blank"`).
- **Versión**: Todos los módulos leen `/api/version` del root `package.json` (versión unificada `1.0.0`). NO usar `package.json` del módulo. NO mostrar rama git. Frontend: `el.textContent = 'v' + data.version`.

---


## Estado (17 Jul 2026 — sesión 13)

### Cambios Sesión 13 — Code Review, Security Hardening & Branding

- **Bug fix — `spawnSync` no importado**: `launcher/server.js` importaba solo `execSync` pero usaba `spawnSync` en `/api/admin/commits` y `/api/admin/config/test-ssh`. Fix: importar `execFileSync` + migrar llamadas a `execFileSync` con array args (más seguro). Eliminado import duplicado dentro del handler de nginx.
- **Bug fix — Admin password overwrite**: El admin se re-siembraba con `admin123` en cada restart, sobreescribiendo cambios del usuario. Fix: solo INSERT si no existe, UPDATE solo rol (no password).
- **Bug fix — JWT 24h → 1h**: Token de sesión duraba 24h. Fix: vuelto a 1h (diseño original documentado). Cookie `maxAge` sincronizado a 1h.
- **Security — Import con backup**: `POST /api/admin/import` ahora crea backup pre-import en `launcher/backups/pre-import-{timestamp}.json` antes de ejecutar DELETEs. Transacción atómica con `db.transaction()`.
- **Security — Rate limit en reset**: `GET/POST /api/auth/reset` ahora tienen `loginRateLimit` (antes sin protección).
- **Security — `encryptEmail` sin fallback**: Eliminado `|| 'fallback'` de la key de encriptación. JWT_SECRET ya es obligatorio (process.exit en startup).
- **Security — JWT_SECRET enforcement**: Nómina y proveedores ahora hacen `process.exit(1)` si falta `JWT_SECRET` (antes solo log.warn).
- **Security — JWT_SECRET random en scaffold**: Módulos generados ahora usan `crypto.randomBytes(32).toString('hex')` en vez de `change-me-${id}`.
- **Security — CORS restricción**: Proyectos y logística ahora usan `cors({ origin: process.env.CORS_ORIGIN || true, credentials: true })`.
- **Security — Error messages**: Logística y proyectos ahora ocultan `err.message` en producción.
- **Branding — Package names**: `horix-erp` → `synnoxerp-launcher`, `horix-logistics` → `synnoxerp-logistica`, `horix` → `synnoxerp-nomina`, `docflow` → `synnoxerp-proveedores`.
- **Branding — PM2 names**: `horix-erp` → `synnoxerp`, `docflow` → `synnoxerp-proveedores` en launcher, scripts, ecosystem.config.js.
- **Branding — Backup filenames**: `docflow_backup_*` → `proveedores_backup_*` en scripts, routes, frontend.
- **Branding — MCP servers**: `docflow-mcp` → `proveedores-mcp`.
- **Branding — DB defaults**: `docflow_db` → `synnox_proveedores` en .env.example.
- **Branding — Docs**: AGENTS.md de logística actualizado.

### Arquitectura de desarrollo
- **Entorno**: 2 VMs independientes (1 por dev) + servidor de producción
- **Flujo**: dev local → push rama feature → PR a GitHub → CI pasa → merge a `main` → prod hace `git pull`
- **Producción**: Solo maneja `main` vía `git pull && pm2 restart synnoxerp`
- **Base de datos**: PostgreSQL centralizado (producción), SQLite local para Nómina

### Pendientes nuevos
- [x] ~~PR~~: `fix/install-sh` → `main` ([#7](https://github.com/Kernel-Panic92/synnox-erp/pull/7)) — merged 17 Jul 2026
- [x] ~~PR~~: `feat/csv-user-import` → `main` ([#8](https://github.com/Kernel-Panic92/synnox-erp/pull/8)) — merged 17 Jul 2026
- [x] ~~PR~~: `fix/csv-import-modules` → `main` ([#9](https://github.com/Kernel-Panic92/synnox-erp/pull/9))
- [x] ~~PR~~: `fix/proyectos-theme` → `main` ([#10](https://github.com/Kernel-Panic92/synnox-erp/pull/10))
- [x] ~~PR~~: `feat/sidebar-standardization` → `main` ([#11](https://github.com/Kernel-Panic92/synnox-erp/pull/11)) — merged 18 Jul 2026
- [x] ~~Licencia~~: Redactar y agregar licencia de software al repo (LICENSE.md) — merged sesión 16
- [x] ~~Paths~~: Revisar renombrado `/opt/horix-platform` → `~/.local/share/synnoxerp` — sesión 16
- [ ] **PR**: `fix/bugs-session-attachments-kanban` → `main` ([#15](https://github.com/Kernel-Panic92/synnox-erp/pull/15))

### Pendientes anteriores
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [x] ~~Dividir `launcher/server.js`~~ — En progreso (sesión 13+)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes (README, MIGRATION_NOMINA.md, ARCHITECTURE.md, etc.)

### Depreciados
- [ ] **Migración Nómina SQLite → PostgreSQL** — postponida. Documentación en `MIGRATION_NOMINA.md` y `ARCHITECTURE.md §7`.

---

## Estado (15 Jul 2026 — sesión 11)

### Cambios Sesión 11 — Módulo de Gestión de Proyectos y Tareas

- **Nuevo módulo**: `modules/proyectos/` — gestión de proyectos y tareas tipo Jira con Kanban
- **20 archivos creados**: backend (ESM), frontend modular (SPA con sidebar), 5 páginas
- **DB**: PostgreSQL schema `projects.*` — tablas `proyectos`, `tareas`, `comentarios`
- **Kanban**: Drag & drop HTML5 con 4 columnas fijas (Pendiente → En Progreso → Revisión → Completada)
- **Vistas**: Dashboard (gráfico pie + stats + tabla por asignado), Proyectos (tarjetas con %), Tareas (tabla con filtros/paginación), Tablero Kanban, Reportes
- **Auth**: `framework/auth.mjs` — `verifyToken`, `verifySession`, `requireModule('proyectos')` + 10 permisos granulares
- **API REST**: CRUD proyectos, CRUD tareas con filtros/paginación, comentarios, reordenar Kanban, dashboard
- **Integración**: Montado en root `server.js` como ESM, registrado en `pnpm-workspace.yaml`, `modulos_plataforma`, `MODULOS_FIJOS`, `SUBMODULOS`, widget en `cargarModuleSummary()`
- **Usuarios compartidos**: FK lógico a `usuarios.id` de SQLite (launcher), nombres consultados vía `GET /api/usuarios` (better-sqlite3)
- **Framework**: `loadVersion()` estándar en framework.js + clase `.version` en sidebar
- **Features**: Asignación de tareas a usuarios, botón ✓ completar rápido (tabla + Kanban), métricas por usuario

### Arquitectura (sin cambios vs sesión 10)

### Bugs corregidos Sesión 11
- **SCRAM password**: `pg` Pool recibía `''` (string vacío) — fix: `undefined` + `dotenv.config()` en db.js y run.js
- **httpOnly cookie**: Frontend intentaba leer cookie httpOnly via JS — fix: quitar chequeo `getToken()` en init()
- **HF.api()**: Llamadas a `HF.api()` que no existe — fix: usar `api()` global del framework
- **mostrarApp()**: Framework accedía a `#login-screen` inexistente — fix: función `mostrarAppInterno()`
- **Sidebar inconsistente**: Estructura diferente a logística — fix: reestructurar para coincidir con framework
- **Path launcher.db**: Necesitaba 4 `../` no 3 — fix: corregir ruta en usuarios.js
- **better-sqlite3**: Dependencia faltante en package.json — fix: agregarla
- **Doble estado**: UPDATE asignaba `estado` dos veces — fix: `columna` toma precedencia
- **modal-detalle-content**: ID inexistente — fix: usar `modal-detalle-body`
- **Dropdown duplicado**: `selectUsuarios()` + HTML ambos incluían "Sin asignar" — fix: quitar del HTML
- **Botones detalle**: Usaban `cerrarModal()` en vez de `cerrarModalDetalle()` — fix: corregir función

## Estado (14 Jul 2026 — sesión 10)

### Arquitectura
- **Package manager**: pnpm (workspaces, strict mode, lockfile trackeado)
- **Workspaces**: 7 módulos (root, launcher, proveedores, nómina, logística, proyectos, wordpress-mcp)
- **Servidor unificado**: 1 PM2 process, puerto 3002 (sin cambios)
- **Auth/Docs/DB**: Sin cambios vs sesión 6
- **Vulnerabilidades**: 0 (pnpm audit --prod)

### Cambios Sesión 7 — pnpm migration
- **pnpm-workspace.yaml**: Creado con los 6 workspace packages
- **.npmrc**: Configuración pnpm (strict-peer-dependencies, auto-install-peers, shamefully-hoist=false)
- **Root package.json**: Agregado `engine: >=20.0.0`, `packageManager: pnpm@9.15.4`, `pnpm.overrides` consolidado, devDeps nodemon, script `audit`
- **Normalización de versiones**: Alineados todos los `package.json` anidados para usar las mismas versiones que root (eliminando duplicación potencial con pnpm strict mode). Paquetes con breaking changes corregidos: `multer ^1.x→^2.1.1`, `bcrypt ^5.x→^6.0.0`, `nodemailer ^6.x→^8.0.5` en logistica
- **Overrides migradas**: `overrides` de proveedores y nómina eliminados — ahora vía `pnpm.overrides` en root
- **install.sh**: Agregada instalación de pnpm, reemplazado `npm install --omit=dev` por `pnpm install --prod --frozen-lockfile`
- **.gitignore**: Agregado `package-lock.json` (global), `.pnpm-store/`
- **Stale lockfile eliminado**: `modules/nomina/package-lock.json` (versión desincronizada 2.14.1 vs 2.16.2)
- **`pnpm audit --prod`** disponible vía `npm run audit`

### Cambios Sesión 9 — code review, security hardening & installer genérico

- **Instalador WebUI rediseñado**: Ahora con 9 pasos que capturan toda la configuración de la empresa:
  - Paso 1: Información de empresa (nombre, dominio, admin email/pass, email from)
  - Paso 2: Base de datos (host, puerto, nombre DB, usuario, password)
  - Paso 3: SMTP (host, puerto, seguridad, usuario, password, remitente)
  - Paso 4: Avanzado (puerto servidor, directorio instalación, repo URL)
  - Paso 5: Módulos (proveedores, logística, nómina)
- **.env genérico**: `installer/server.js` ahora genera un `.env` completo con `COMPANY_NAME`, `COMPANY_DOMAIN`, `SMTP_*`, `INSTALL_DIR` y todas las variables de la empresa, sin valores hardcodeados de Vitamar/Horix.
- **Sin branding**: Eliminadas todas las referencias a "Horix ERP", "Horix Platform" del instalador. El título ahora es "SynnoxERP".

- **httpOnly: true**: Cookie `launcher_jwt` ahora con `httpOnly: true` (era `false`), `secure` condicional según `NODE_ENV=production`. Elimina vector de robo de JWT via XSS.
- **JWT_SECRET**: Eliminado fallback `'dev-secret'` en `src/auth.js` — ahora `process.exit(1)` si no está configurado (consistente con `framework/auth.mjs` y `launcher/server.js`).
- **parseCookies centralizada**: Eliminada duplicación en 5 lugares. Ahora en `framework/auth.js` (CJS) y `framework/auth.mjs` (ESM). Launcher, proveedores y nómina importan desde framework.
- **bcrypt → bcryptjs**: Eliminada dependencia duplicada. Root, logística y nómina ahora usan solo `bcryptjs` (pure JS, sin native bindings). Eliminado `bcrypt` de root y logística.
- **loginAttempts memory leak**: Agregado `setInterval` cada 5 min que purga entradas stale del rate limiter in-memory.
- **Hardcoded values eliminados**: Eliminados `'dev-secret'` en templates de módulos externos (3 ocurrencias), `'dev_secret_not_for_prod'` en crypto.js (HE_SECRET), `vitamar2024` en docker-compose.yml, emails hardcodeados `@vitamar.com` (7 ocurrencias → `smtp@localhost`), `noreply@tu-dominio.com` y `noreply@horix-platform.local`.
#### Cambios posteriores — CodeQL security hardening

- **command-line-injection (16)**: `execSync` string → `spawnSync`/`execFileSync` con array args en launcher, installer y proveedores.
- **path-injection (35)**: Helper `sanitizePath(input, base)` en 8 archivos (proveedores, logística, launcher).
- **sql-injection (2)**: MCP Nómina reescrito con input estructurado y placeholders.
- **request-forgery/SSRF (2)**: Validación regex de URLs solo localhost en `fetch()`.
- **email en login logs**: Encryptado con AES-256-CBC en launcher.
- **missing-rate-limiting (~260)**: `express-rate-limit` middleware global en los 5 servidores.

#### Cambios Sesión 9 (14 Jul 2026) — Fase 2: Refactor hardcoded branding

- **COMPANY_NAME como fuente única**: `launcher/server.js` ahora inyecta `COMPANY_NAME` (desde env o `SMTP_FROM_NAME`) como fallback de `smtp_from_name`. Todos los módulos leen `process.env.COMPANY_NAME` o `process.env.APP_NAME` donde antes tenían strings hardcodeados.
- **COMPANY_DOMAIN**: Creado y usado en lugar de `'admin@horix.com'` → `admin@${COMPANY_DOMAIN}`.
- **INSTALL_DIR**: Nuevo default `/opt/synnoxerp` (era `/opt/horix-platform`). Todas las rutas en launcher/server.js lo usan.
- **launcher/mail.js**: HTML de emails ahora dinámico con `getFromName()` en lugar de `'Horix Platform'` hardcodeado.
- **modules/nomina/**: `Horix` → `APP_NAME` en emails, `wb.creator`, subjects, headers HTML; `horix_backup_*` → `backup_*`; `@horix.demo` → `@ejemplo.com`; `horix-mcp` → `synnox-nomina-mcp`.
- **modules/proveedores/**: `DocFlow` → `COMPANY_NAME` en SMTP, backup, health check; DB default `horix_erp` → `synnox_erp` (consistente con root).
- **modules/logistica/**: `vitamar-*` → `synnox-*` en docker-compose; DB default `horix_erp` → `synnox_erp`; `HorixLogistics` → `SynnoxERP Logistics`.
- **nginx/**: `horix.app` → `synnoxerp.app`.
- **framework/**: `initHorixFramework` → `initFramework`; URLs GitHub de Kernel-Panic92 eliminadas.
- **installer/**: URLs `Kernel-Panic92/synnox-erp.git` → `synnoxerp/synnox-erp.git`.
- **`.gitignore`**: Rutas legacy `modules/horix/` → `modules/nomina/`, etc.
- **Resultado**: 0 referencias a `Horix`, `vitamar`, `Kernel-Panic92`, `DocFlow` en código fuente (solo en AGENTS.md).

#### Correcciones en producción (sesión 9)

- **express-rate-limit**: Eliminado `trustProxy` inválido de opciones; usado `app.set('trust proxy', 1)` en su lugar. Fix a `ERR_ERL_PERMISSIVE_TRUST_PROXY` y `ERR_ERL_UNKNOWN_OPTION`.
- **Cookie Secure**: Cambiado de `NODE_ENV === 'production'` a verificación dinámica del protocolo real (`req.protocol`). Fix a cookie no visible en navegador por `secure: true` + HTTP.
- **HE_SECRET**: Fallback a `JWT_SECRET` en lugar de `process.exit(1)` cuando no está configurado.
- **verifySessionValid**: Refactorizado de HTTP fetch a SQLite directo (elimina llamadas internas backend→backend).
- **Password DB**: pg_hba.conf cambiado de `scram-sha-256` a `md5` para compatibilidad con Node pg driver.
- **Dashboard widgets**: Backport desde repo Horix — widgets ahora muestran mes vencido (mes anterior) en vez del mes actual; gráfico excluye mes en curso.

### Cambios Sesión 10 (14 Jul 2026) — Reportes logística + UX rutas

- **Rutas — filtro de fecha**: Default a hoy al cargar la página. Nuevo checkbox "Todas" que deshabilita el filtro y muestra todas las rutas sin restricción de fecha.
- **Rutas — botón Completar**: Botón ✓ por fila (solo visible si estado ≠ completada/fallida). Confirma con modal y llama a PUT con `estado: 'completada'` + `hora_fin_real`.
- **historico_eficiencia auto-poblado**: Al marcar ruta como completada via PUT, se inserta automáticamente en `logistics.historico_eficiencia` con: `tasa_exito` (50% peso), `eficiencia_distancia` (25%), `eficiencia_tiempo` (25%). Se actualiza `r.eficiencia` en la ruta.
- **PUT /:id mejorado**: Acepta `hora_inicio_real` y `hora_fin_real` además de los campos existentes.
- **Módulo de reportes**: Nuevo `backend/routes/reportes.js` con 4 endpoints:
  - `GET /api/reportes/rutas` — rutas con filtros (fecha, sede, estado), resumen y paginación server-side
  - `GET /api/reportes/pedidos` — pedidos por estado/ciudad, valor total agregado
  - `GET /api/reportes/vehiculos` — flota con capacidad y pedidos activos por vehículo
  - `GET /api/reportes/eficiencia` — desde `historico_eficiencia` con filtros por fecha y vehículo
  - `POST /api/reportes/exportar` — Excel (exceljs) con cabecera azul, auto-filtro, fila congelada, formato moneda COP
- **Página Reportes en frontend**: 4 tabs (Rutas/Pedidos/Vehículos/Eficiencia), filtros dinámicos según el tipo, tarjetas de resumen, tabla paginada con columnas sorteables, selector de registros por página, botón Exportar Excel.
- **Fix export**: No depende de `getToken()` (cookie httpOnly no legible desde JS). Usa `fetch` directo con cookie automática.

### Cambios Sesión 8 — seguridad (3 CVEs high cerrados)
- **xlsx → exceljs**: Migrados 2 parsers de logística (`widgetechExcelParser.js`, `maestroClientesParser.js`). `xlsx` (SheetJS) abandonado en npm sin parche disponible. Reemplazado por `exceljs` (ya usado en root/nómina). Cierra CVE-2023-30533 (Prototype Pollution) y CVE-2024-22363 (ReDoS).
- **nodemailer ^8.0.5 → ^9.0.1**: Actualizado en root, launcher, proveedores, nómina y logística. Cierra GHSA-p6gq (raw message bypass — arbitrary file read + SSRF en ≤9.0.0).
- **pnpm-lock.yaml**: Generado y pusheado al repo, habilitando `--frozen-lockfile` en install.sh.
- **Resultado**: `pnpm audit --prod` reporta 0 vulnerabilidades.

### Pendientes
- [x] Primera ejecución de `pnpm install --prod` en servidor para generar `pnpm-lock.yaml`
- [x] Verificar que el servidor unificado arranca correctamente con `node server.js`
- [x] Fase 2 — Refactor hardcoded branding (~350 referencias eliminadas)
- [x] CodeQL: fix 56 high-severity + 260 rate-limiting alerts
- [ ] Ejecutar migración Nómina (Fase 0)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~1950 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy (`modules/docflow/`, `modules/logistics/`, `modules/horix/`)

---

## Estado Anterior (08 Jul 2026 — sesión 6)

### Arquitectura
- **Servidor multi-proceso**: PM2 por módulo (launcher:3002, proveedores:3003, logística:3004, nómina:3005)
- **Módulos**: Launcher + Proveedores + Logística + Nómina
- **Auth**: JWT cookie `launcher_jwt` (1h expiry) + refresh token (7d) con rotación
- **Permisos**: JWT enriquecido con `modulos_permisos` por módulo
- **DB**: PostgreSQL unificado (`horix_erp`), Nómina pendiente migración SQLite

### Auth System (Sesión 6)
- **Reuse detection**: Refresh token reuse detectado con ventana de gracia de 5 segundos
- **Invalidación masiva**: `usuario_sesion_invalidada` check en `/refresh` Y en requests
- **Cache**: SimpleCache con TTL de 5 segundos (por proceso)
- **Internal API**: Secret header (AND, no OR con IP-check)
- **Cookies**: `sameSite: 'lax'` en todas las cookies de auth
- **Tablas auth**: `jwt_blacklist`, `refresh_token_blacklist`, `usuario_sesion_invalidada`

### Migración Nómina (Sesión 6)
- **ETL**: `migrate-nomina.js` (12 tablas, sin usuarios)
- **Reconciliación**: `reconcile-usuarios.js` (dry run + --apply)
- **Cutover**: Script con git pull ANTES de ejecutar migrate
- **Rollback**: Script documentado y probado
- **Validación**: Checklist pre-cutover (roles huérfanos, UUIDs, FKs)

### Documentación Creada (Sesión 6)
- `ARCHITECTURE.md` §7 — Plan completo de migración Nómina
- `MIGRATION_NOMINA.md` — Guía de ejecución paso a paso
- Incluye: DDL, scripts, cutover, rollback, bugs corregidos, timeline

### Cambios Sesión 6
- **Auth**: Fix verifyToken async (bug de sintaxis)
- **Auth**: Fix expirado_en consistency (NOW() + INTERVAL)
- **Auth**: Fix refresh token reuse detection (ventana de gracia 5s)
- **Auth**: Fix usuario_sesion_invalidada check en /refresh
- **Auth**: Fix buildPayload con modulos_permisos
- **Auth**: Fix sameSite: 'lax' en cookies
- **Auth**: Fix jwt_blacklist purge (diario >1h)
- **Auth**: Fix refresh_token_blacklist purge (diario >7d)
- **Nomina**: Fix syntax error en employees.js (faltaba })
- **Docs**: ARCHITECTURE.md §7 reescrito con plan completo
- **Docs**: MIGRATION_NOMINA.md creado
- **Docs**: AGENTS.md actualizado con sesión 6

### Pendientes
- [ ] Ejecutar Fase 0: Backup + rollback probado
- [ ] Ejecutar checklist pre-cutover (1-2 días antes)
- [ ] Ejecutar migración en PostgreSQL de prueba
- [ ] Ejecutar cutover real en producción
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción

---

## Estado Anterior (08 Jul 2026 — sesión 5)

### Arquitectura
- **Servidor multi-proceso**: PM2 por módulo (launcher:3002, proveedores:3003, logística:3004, nómina:3005)
- **Módulos**: Launcher + Proveedores + Logística + Nómina
- **Auth**: JWT cookie `launcher_jwt` (1h expiry) + refresh token (7d)
- **Permisos**: JWT enriquecido con `modulos_permisos` por módulo
- **DB**: PostgreSQL unificado (`horix_erp`), Nómina pendiente migración SQLite

### Documentación Creada (Sesión 5)
- `ARCHITECTURE.md` — Documento completo de arquitectura del sistema
- `ROADMAP.md` — Reescrito como roadmap de producto (funcionalidades)
- Incluye: multi-proceso PM2, JWT corto + refresh, migración Nómina por fases, observabilidad centralizada, contratos de API internos

### Cambios Sesión 5
- **IMAP**: Fix ApplicationResponse - ahora crea facturas desde PDF cuando XML es acuse
- **IMAP**: Eliminado límite de 100 mensajes (`IMAP_MAX_MESSAGES=0` por defecto)
- **IMAP**: Replicada lógica de parseo XML de docflow (sin detección ApplicationResponse)
- **CSS**: Tabla facturas con `overflow-x:auto`, `table-layout:fixed`, `text-overflow:ellipsis`
- **Proveedores**: Eliminado botón "Ver Acuse" del modal de facturas
- **Proveedores**: Delete limpio `archivo_acuse` además de PDF/XML/soporte
- **Docs**: Creado ARCHITECTURE.md con arquitectura completa
- **Docs**: ROADMAP.md reescrito como roadmap de producto

---

## Estado Anterior (01 Jul 2026 — sesión 4)

### Arquitectura
- **Servidor unificado**: 1 PM2 process, puerto 3002
- **Módulos**: Launcher + Proveedores + Logística + Nómina
- **Auth**: JWT cookie `launcher_jwt`, perfiles con permisos por módulo
- **Roles simplificados**: `admin` (acceso total) / `operador` (usa perfiles)

### Cambios sesión 4
- Sidebar estandarizado en todos los módulos (estilo Nómina)
- Perfiles de permisos con árbol expandible
- Dynamic quick access (trackea uso por submódulo)
- Launcher: widgets de sistema, commits, actividad
- IMAP sync: dos pasos (descarga + procesamiento), paralelo, ETA
- Proveedores: bulk delete, records per page, XML download
- Logística: dashboard widgets, geolocation, PDF con branding
- Nómina: backup/restore incluye tabla `tipos`
- 8 CVEs corregidos, 15 confirm() → confirmModal()
- Button standardization across all modules
