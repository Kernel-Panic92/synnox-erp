# SynnoxERP — Contexto del proyecto

## Estado (30 Jun 2026 — fin de sesión 3)

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
| `/logistica/` | Logística | Rutas, pedidos, vehículos | PostgreSQL |
| `/nomina/` | Nómina | Horas extra y novedades | SQLite |

### Cambios realizados esta sesión
- Servidor unificado (merge de 4 procesos en 1)
- Módulos exportan `app` sin `listen()` propio
- Auth centralizada: se removieron logins, CRUD usuarios, sesiones locales
- Instalador refactorizado: single .env, single npm, single PM2
- Renombrado: horix→nomina, docflow→proveedores, logistics→logistica
- DBs unificadas: todas las migraciones en `horix_erp`
- Launcher con módulos estáticos (sin registro vía API)
- Toggle de tema universal `synnox_theme`, modo claro por defecto
- Logo SynnoxERP en login y dashboard
- Removida tabla `sesiones` de Nómina
- `fetchCSRF()` antepone `window.BASE` automáticamente
- Removidos actualizadores por módulo (orquestación centralizada en launcher)
- Migración automática de IDs viejos (horix→nomina, docflow→proveedores, logistics→logistica)
- Permisos de módulo: `requireModule()` en backend para todos los módulos
- Perfiles de permisos: sistema completo CRUD con permisos por módulo
- Botones de acción estandarizados: btn-secondary (editar), btn-danger (eliminar), btn-success (aprobar)
- `confirmModal()` personalizado en todos los módulos (reemplaza `confirm()` nativo)
- IMAP sync: dos pasos (descarga + procesamiento), paralelo, con ETA
- SIESA export: fix columnas, dropdown funcional, BASE prefix
- Proveedores: bulk delete con checkboxes, filtros, records per page
- Logística: dashboard con widgets (clima, vehículos, alertas), mapa con geolocation
- PDF de rutas con branding, logo, firma, observaciones
- Google Maps API key guardada en servidor (no en localStorage)

### Bugs resueltos
- Bucle infinito DocFlow por columna `creado` vs `creado_en`
- Typo `podeAprovar`→`podeAprobar` en middleware de Nómina
- Catch-all interceptaba Logística
- CSP bloqueaba inline script de `window.BASE`
- Theme toggles locales removidos (ahora universal)
- Proveedores crash: `$('theme-btn')` null
- Nómina pantalla negra: `aplicarTema()` crasheaba con `null.textContent`
- Nómina theme default: `|| 'light'` fallback
- ESM warning: `auth.js` → `auth.mjs`
- User identity: sincronización desde JWT en cada `/me`
- Nómina permisos: `/api/auth/me` incluye `permisos` array
- `sesiones` table removed
- `fetchCSRF()` auto-prepends `window.BASE`
- Telemetry dashboard: missing `try` block
- Restore button: sin `id="btn-restaurar"`
- Dashboard_layout restore: filtra columnas inválidas
- Backup: faltaba exportar/importar `centros`
- IMAP sync stuck recovery, parallel downloads, ETA
- SIESA export: column B should be SUCURSAL
- Facturas: bulk delete, records per page, action buttons estandarizados
- Confirm modal personalizado en todos los módulos
- PDF checklist con branding, firma, observaciones
- Google Maps API key guardada en servidor
- Admin bugs: XSS, null guard, module deletion cleanup
- Button colors: proveedores now matches nomina solid style

### Pendientes próxima sesión
- [ ] Probar HTTPS en producción
- [ ] Revisar performance con muchos registros
- [ ] Vectorizar logo (SVG)
- [ ] Widgets de launcher: resumen por módulo, tareas pendientes
