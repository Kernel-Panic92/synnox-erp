# SynnoxERP — Contexto del proyecto

## Estado (25 Jun 2026 — fin de sesión)

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

### Pendientes próxima sesión
- [ ] Probar Nómina con hard refresh (Ctrl+Shift+R) para caché nuevo
- [ ] Probar flujos completos: crear factura, ruta, registro de nómina
- [ ] Revisar submódulos de configuración de cada módulo
- [ ] Vectorizar logo (SVG)
