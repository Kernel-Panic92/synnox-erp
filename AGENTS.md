# SynnoxERP — Contexto del proyecto

## Estado (25 Jun 2026 — fin de sesión 2)

### Arquitectura final
- **Servidor unificado**: 1 proceso PM2 (`synnoxerp`), puerto 3002
- **1 solo .env**, **1 solo package.json**
- **Módulos como plugins**: montados en `server.js` con path prefix
- **Auth centralizada**: JWT compartido vía cookie `launcher_jwt`
- **Tema universal**: `synnox_theme` en localStorage, toggle en el launcher
- **Login único** en el launcher, módulos sin login propio

### Módulos

| Ruta | Nombre | Función | DB |
|------|--------|---------|----|
| `/` | Launcher | Login, dashboard, admin usuarios | SQLite |
| `/proveedores/` | Proveedores | Facturas y proveedores | PostgreSQL |
| `/logistica/` | Logística | Rutas y vehículos | PostgreSQL |
| `/nomina/` | Nómina | Horas extra y novedades | SQLite |

### Cambios realizados esta sesión
- Servidor unificado (merge de 4 procesos en 1)
- Módulos exportan `app` sin `listen()` propio
- Auth centralizada: se removieron logins, CRUD usuarios, sesiones locales
- Instalador refactorizado: single .env, single npm, single PM2
- Renombrado: horix→nomina, docflow→proveedores, logistics→logistica
- DBs unificadas: todas las migraciones en `horix_erp`
- Launcher con módulos estáticos (sin registro vía API)
- Toggle de tema universal `synnox_theme` en localStorage
- Logo SynnoxERP en login y dashboard
- Modo claro por defecto
- `sesiones` table removed from Nómina (telemetry, auditoria, backup, restore, migrations)
- `fetchCSRF()` auto-prepends `window.BASE` to centralize path prefix logic
- Per-module updaters removed (actualizador routes + frontend tabs from nomina, proveedores, logistica)
- Telemetry dashboard route fixed (missing `try` block → SyntaxError)
- Restore button `id="btn-restaurar"` added (was missing, button never enabled after file select)
- Dashboard layout restore filters unknown columns (backwards-compat with legacy `layout` column)
- Centros table included in backup/restore (was missing from both export and import)

### Bugs resueltos
- Bucle infinito DocFlow por columna `creado` vs `creado_en`
- Typo `podeAprovar`→`podeAprobar` en middleware de Nómina
- Catch-all interceptaba Logística (montado después)
- `const API` duplicado anulaba prefijo BASE en Nómina
- Migraciones no se ejecutaban al importar módulos
- Backup usaba `localStorage.vd_t` (token legacy) en vez de cookie
- NAS backup: `cfgRows.rows` vs `cfgRows` (pg devuelve `{rows:[]}`)
- Logout no limpiaba cookie `launcher_jwt`
- CSP bloqueaba inline script de `window.BASE` en Nómina (nonce)
- Theme toggles locales removidos (ahora es universal)
- Proveedores crash: `$('theme-btn')` null → TypeError → catch → `doLogout()` → redirect
- Nómina pantalla negra: `aplicarTema()` crasheaba con `null.textContent` de `theme-icon`/`theme-text` fuera del try/catch del IIFE
- Nómina theme default: `|| 'light'` fallback para concordar con launcher
- ESM warning: `auth.js` → `auth.mjs` para evitar `MODULE_TYPELESS_PACKAGE_JSON`
- User identity: todos los módulos sincronizan `nombre`/`rol` desde JWT en cada `/me`
- Nómina permisos: `/api/auth/me` ahora incluye `permisos` array desde `permisos_roles`
- `sesiones` table removed: telemetry usa JWT, auditoria retorna vacío, backup/restore limpios
- `fetchCSRF()` ahora antepone `window.BASE` automáticamente
- Telemetry dashboard: `try` block faltante causaba SyntaxError al arrancar
- Restore button: sin `id="btn-restaurar"` → `getElementById` null → botón nunca se habilitaba
- Restore dashboard_layout: filtra columnas inválidas (`layout`) que no existen en la tabla actual
- Backup: faltaba exportar/importar `centros`

### Pendientes próxima sesión
- [ ] Permisos de usuario para acceder a los módulos (launcher → módulos)
- [ ] Revisar módulo de configuración en Logística
- [ ] Revisar módulo de configuración en Proveedores
- [ ] Proveedores: aún aparece el módulo de usuarios (remover)
- [ ] Vectorizar logo (SVG)
