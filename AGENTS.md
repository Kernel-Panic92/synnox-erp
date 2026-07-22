# SynnoxERP — Contexto del proyecto

## Estado (22 Jul 2026 — sesión 19)

### Cambios Sesión 19 — Layout responsive & root cause fixes

- **Root cause — `.main` sin `flex:1`**: Cuando `.sidebar` tiene `position:fixed`, sale del flujo flex. `.main` como único hijo flex se encoge al tamaño del contenido sin `flex:1;min-width:0`. Fix: agregar `flex:1;min-width:0;width:calc(100% - var(--sidebar-w))` a `.main` en nómina y proveedores.
- **Login flash (#21)**: Agregado `#loading-screen` con branding visible mientras se valida sesión. `#app-screen` ahora inicia con `display:none`. PR [#23](https://github.com/Kernel-Panic92/synnox-erp/pull/23).
- **Widgets launcher (#20)**: Skeleton loaders con animación `skel-pulse`, fix race condition en `cargarServerStats()` con `_serverStatsTimer` guard, error states visibles en 6 widgets. PR [#24](https://github.com/Kernel-Panic92/synnox-erp/pull/24).
- **Dashboard 21:9/4K (#22)**: Eliminado `overflow-x:hidden` de `.main`, limpiadas ~154 líneas de dead code del sistema de widgets viejo. PR [#26](https://github.com/Kernel-Panic92/synnox-erp/pull/26).
- **Layout consistency nómina**: `.table-wrap` overflow:hidden → auto, `.form-grid` 2cols → auto-fill, `.report-summary` 3cols → auto-fill.
- **Empleados redesign**: Grid `minmax(260px)` → `minmax(220px)`, card compacta (avatar+nombre en fila, badges, stats inline).
- **Configuración responsive**: Todos los grids fijos (`1fr 1fr`, `1fr 1fr 1fr`) → `auto-fit, minmax()`. SMTP cards sin `max-width:600px`, envueltas en grid responsive.
- **`auto-fill` vs `auto-fit`**: `auto-fill` crea columnas vacías que dejan espacio en blanco. `auto-fit` colapsa columnas vacías y estira los items. Usar `auto-fit` cuando hay pocos items por grid.

### Convenciones de Layout (AGREGADAS SESIÓN 19)

- **`.main` en módulos con sidebar fijo**: Siempre `flex:1;min-width:0;width:calc(100% - var(--sidebar-w))`. El sidebar `position:fixed` sale del flujo flex, y sin `flex:1` el contenido se encoge.
- **`auto-fit` vs `auto-fill`**: Usar `auto-fit` para grids con pocos items (1-5). `auto-fill` solo cuando se necesitan columnas vacías reservadas.
- **`overflow-x:auto` en tablas**: Nunca `overflow:hidden` en `.table-wrap` — recorta contenido. Usar `overflow-x:auto` para scroll horizontal.
- **Grids responsive**: Siempre `repeat(auto-fit, minmax(Xpx, 1fr))` nunca `repeat(N, 1fr)` fijo. El `minmax` define el ancho mínimo de cada item.
- **Skeleton loaders**: Widgets que hacen fetch deben mostrar skeleton mientras cargan, no `display:none`.

### Pendientes nuevos
- [ ] **Ofuscar builds frontend** — Evaluar `javascript-obfuscator` o similar. Verificar que no rompa nada antes de implementar. **No hacer sin probar en staging primero.**

### Pendientes anteriores (actualizados)
- [x] ~~Dashboard responsive 21:9/4K~~ — Resuelto sesión 19 (root cause: `.main` sin `flex:1`)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción
- [ ] SSH `execSync` → `ssh2` (test-ssh)
- [ ] CSP nonce en proveedores
- [ ] Dividir `launcher/server.js` (~1950 líneas → routers separados)
- [ ] ESLint + Prettier config
- [ ] Limpiar `.env` legacy
- [ ] Actualizar docs restantes

### Convenciones del Framework (SEGUIR SIEMPRE)

- **Modales**: Definir en HTML con `class="modal-overlay"`, mostrar/ocultar con `display: block/none`. NO crear modales dinámicamente con `document.createElement`.
- **Confirmaciones**: Usar `confirmModal(msg, title)` del framework, NUNCA `confirm()` del navegador.
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **Layout `.main`**: Siempre `flex:1;min-width:0;width:calc(100% - var(--sidebar-w))` cuando el sidebar es `position:fixed`.
- **Grids**: Siempre `repeat(auto-fit, minmax(Xpx, 1fr))`. NUNCA `repeat(N, 1fr)` fijo. Usar `auto-fit` para pocos items, `auto-fill` para muchos.
- **Tablas overflow**: `.table-wrap` siempre `overflow-x:auto`, NUNCA `overflow:hidden`.
- **Skeletons**: Widgets con fetch deben mostrar skeleton loader mientras cargan.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`.
- **Versión**: Todos los módulos leen `/api/version` del root `package.json` (versión unificada `1.0.0`). NO usar `package.json` del módulo. NO mostrar rama git. Frontend: `el.textContent = 'v' + data.version`.
- **Instalación**: Path default `~/.local/share/synnoxerp` (XDG). NO usar `/opt/`.
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
- **Confirmaciones**: Usar `confirmModal(msg, title)` del framework, NUNCA `confirm()` del navegador.
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`.
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
- **Confirmaciones**: Usar `confirmModal(msg, title)` del framework, NUNCA `confirm()` del navegador.
- **Mensajes**: Usar `toast(msg, type)` del framework para feedback al usuario.
- **CSS**: Usar variables del framework (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--success)`, `var(--danger)`).
- **Botones**: Seguir clases existentes: `btn`, `btn-sm`, `btn-secondary`, `btn-danger`.
- **Tablas**: Usar estructura `<table id="xxx-table"><thead><tr>...</tr></thead><tbody></tbody></table>` con `overflow-x:auto`.
- **API**: Todas las rutas usan `verificarToken, soloAdmin`. Respuestas: `{ ok: true }` o `{ error: 'msg' }`.
- **DB**: Migraciones con `try { db.exec("ALTER TABLE...") } catch {}` para columnas nuevas. Seeds con `INSERT OR IGNORE`.
- **Auth**: Siempre via `verificarToken` middleware. JWT incluye `modulos_permisos` para permisos granulares.
- **Sidebar (módulos nuevos)**: Usar `<aside class="sidebar">`, importar `base.css` + `framework.js`, llamar `initFramework({ themeKey: 'synnox_theme' })`. Incluir `<div class="sidebar-toggle" onclick="toggleSidebarCollapse()">◀</div>`. Nav items con `.nav-item[data-page]`. Overlay con `.sidebar-overlay.show`. Colapsado persistido en `localStorage('sidebar_collapsed')`.
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
