# SynnoxERP — Contexto del proyecto

## Estado actual (5 Ago 2026)

### Últimos cambios
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
