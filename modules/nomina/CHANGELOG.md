# Changelog

## Pendientes / Known Issues

### Medios
- [x] **URLs hardcodeadas** - Direcciones hardcoded reemplazadas por variables de entorno
- [ ] **CORS permisivo** - `server.js:21` usa `cors()` sin restricciones (acepta cualquier origen)

### Bajos
- [x] **Demasiados console.log** - Eliminados ~7 statements `console.log` de debug en `server.js` (migración, DEBUG req.body). Archivo: `server.js`
- [ ] **Backup incluye contraseñas** - El backup contiene passwords hasheadas, considerar encriptar el ZIP
- [ ] **Uso inconsistente de `var`** - Algunos loops usan `var` en lugar de `let/const`

## Issues del refactor — Rama `refactor/modularize`

### Alta Prioridad (Bloquean funcionalidad)
- [x] **BUG 1 — Dashboard: widgets "Período con más Horas" y año de chart nunca se renderizan**
  - Archivos: `public/js/modules/dashboard.js`
  - Causa: `dash-chart-anio`, `dash-periodo-anio`, `dash-periodo-content` no eran poblados por ningún código JS.
  - Fix: Se agregó lógica en `renderDashboard()` para poblar `dash-chart-anio` con el año actual, calcular el mes con más horas aprobadas y mostrar el resultado en `dash-periodo-anio` y `dash-periodo-content`.
  - Adicional: Se corrigió `setWidgetSize()` que removía clases `widget-*` inexistentes en lugar de `w-*`.
  - Adicional: Se corrigió `app.js` donde `/api/auth/me` sobrescribía `sesion` entera perdiendo el `token`, causando cierre de sesión al recargar.
- [x] **BUG 2 — Historial: el filtro `fil-nomina` no filtra registros**
  - Archivos: `public/js/modules/records.js` (función `renderHistorial`)
  - Causa: `renderHistorial()` leía todos los filtros excepto `fil-nomina`.
  - Fix: Se agregó lectura del filtro `fil-nomina` y condición `r.nominaId !== filtroNomina`.
  - Adicional: Se mejoró UI del historial con etiqueta de filtros, contador "Mostrando X de Y registros", y columna "Período" con nombre de nómina.
  - Adicional: Se restauró el renderizado de nóminas a como estaba en la versión monolítica (años colapsables, totales, fechas, registros, badge "Año actual").
- [x] **BUG 3 — Exportar CSV: los botones de historial y reportes no funcionan**
  - Archivos: `public/js/utils/helpers.js` (función `exportarCSV`)
  - Causa: `exportarCSV()` solo manejaba los modos `'empleados'`, `'registros'`, `'nominas'`.
  - Fix: Se agregaron modos `'historial'` y `'reporte'`. Se quitó columna `Activo` del CSV de empleados (no existe en BD).
- [x] **BUG 4 — Empleados: la búsqueda lanza `ReferenceError` por variable `sede` no definida**
  - Archivos: `public/js/modules/employees.js:44`
  - Causa: `const matchSede = !sede || e.sede === sede;` — `sede` nunca se declaraba.
  - Fix: Eliminado filtro `sede` de `buscarEmpleados()`. Además se removió `e.activo` de todos los filtros de empleados (la tabla no tiene esa columna) — afectaba `renderEmpleados()`, `buscarEmpleados()`, `filtrarEmpleados()` (registro), `populateRegistroSelects()`, y reports.js. Se agregó contador al grid de empleados. Se agregó visibilidad al dropdown de empleados en registro.
- [ ] **BUG 5 — Dashboard: `reloadDashboardData()` no se await en `navigate()`**
  - Archivos: `public/js/app.js:98`
  - Causa: `navigate()` no es `async`, llama a `reloadDashboardData()` (async) sin `await`, luego `renderDashboard()` corre inmediatamente con datos posiblemente obsoletos.
  - Impacto: El dashboard hace doble render con datos potencialmente inconsistentes.

### Media Prioridad
- [ ] **BUG 6 — Importar empleados: botón no muestra estado de carga**
  - Archivos: `public/js/modules/import.js:107,125` llama `setLoading('btn-confirmar-import', ...)` pero el HTML tiene `id="btn-confirmar-importar"`.
  - Impacto: Sin spinner/procesando durante la importación.
- [ ] **BUG 8 — SMTP: `cfg-tls` es `<select>` pero JS usa `.checked`**
  - Archivos: `public/js/modules/smtp.js:9,25`
  - Causa: `.checked` solo funciona en checkbox; en `<select>` siempre devuelve `false`.
  - Impacto: TLS siempre se guarda como `false` aunque el usuario seleccione "Sí".
- [ ] **BUG 9 — Historial: `resaltarRegistro()` no encuentra filas por falta de `data-id`**
  - Archivos: `public/js/modules/records.js:227`
  - Causa: La función busca `tr[data-id="..."]` pero `renderHistorial()` genera `<tr>` sin atributo `data-id`.
  - Impacto: El highlight por URL param `?registro=ID` no funciona.
- [ ] **BUG 10 — Reportes: filtro de nómina no filtra registros**
  - Archivos: `public/js/modules/reports.js:84-87`
  - Causa: El filtro solo verifica que la nómina exista, nunca compara `r.nominaId`.
  - Impacto: Seleccionar un período de nómina en reportes no cambia los datos mostrados.

### Baja Prioridad
- [ ] **BUG 11 — `rolLabel()` faltan mapeos para `rrhh` y `consulta`**
  - Archivos: `public/js/utils/helpers.js:48`
  - Impacto: Los roles aparecen como "rrhh"/"consulta" crudo en lugar de "RRHH"/"Consulta".
- [ ] **BUG 12 — Empleados: campos `depto`, `email`, `tel` del formulario nunca se guardan**
  - Archivos: `public/js/modules/employees.js:94-98`
  - Impacto: Los campos existen en la UI pero sus valores se pierden al guardar.
- [ ] **BUG 13 — Adjuntos: `cargarAdjuntosEnCelda()` busca ID equivocado**
  - Archivos: `public/js/modules/attachments.js:74`
  - Causa: Busca `#adjuntos-${regId}` pero el modal tiene `#adjuntos-detalle`.
  - Impacto: Los adjuntos nunca se muestran en el modal de detalle.
- [ ] **BUG 14 — `navigate()` no es `async`; no puede secuenciar carga asíncrona de páginas**
  - Archivos: `public/js/app.js:79`
  - Impacto: Diseño propenso a race conditions en todas las páginas que cargan datos asíncronamente.

---

## Fixes Aplicados

### 2026-04-30
- **Limpieza de console.log** - Eliminados statements de debug innecesarios en `server.js`:
  - Migración smtp_password (línea 298)
  - DEBUG req.body (línea 879)
  - Logs de depuración en `public/index.html`
- **Flujo seguro de creación de usuarios** - Al crear usuario:
  - Ya no se requiere que el admin defina la contraseña
  - Se genera contraseña temporal aleatoria automáticamente
  - Se crea token de 7 días y se envía correo con enlace a `/reset-password.html`
  - Se fuerza cambio de contraseña en primer login (`cambio_password = 1`)
  - Archivo: `server.js:615-660`

### 2026-05-02
- **Fix permisos y sesión frontend** - Corregido el renderizado de la UI (panel izquierdo, menús) en la primera carga tras login:
  - Se corrigió la estructura de `sesion` (ahora `{ token, usuario: {...} }`) para que `sesion.usuario` contenga datos y permisos.
  - Se actualizaron referencias en `iniciarApp()` y funciones helper (`puedeEditar`, `puedeAprobar`, `puedeRegistrar`, `soyAdmin`, `soyGerencia`, `soyOperador`) para usar `sesion.usuario?.rol` en lugar de `sesion?.rol`.
  - Se añadió `applyPermControls()` y helper `hasPerm(perm)` para renderizar menús según permisos del login.
  - Se eliminaron logs de depuración (`console.log`) en `iniciarApp` y `applyPermControls`.
  - Archivos: `public/index.html:1586-1700`
- **Backend: permisos en login** - El endpoint `/api/auth/login` ahora devuelve `permisos` según el rol (`permisosPorRol(rol)`).
  - Se añadió alias `/api/me` que devuelve los mismos datos que `/api/auth/me` (incluyendo `permisos`).
  - Archivos: `server.js:301-321, 405-445, 1558-1640`

# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

## [2.4.3] - 2026-04-24

### Security Updates
- ✅ Updated all dependencies to fix vulnerabilities:
  - adm-zip: 0.5.10 → 0.5.17 (path traversal fix)
  - express: 4.18.2 → 4.21.0 (security headers)
  - multer: 1.4.5-lts.1 → 2.1.1 (8 DoS fixes)
  - nodemailer: 6.9.9 → 8.0.5 (SMTP injection fixes)
- ✅ 11 vulnerabilities resolved

## [2.4.2] - 2026-04-23

### Agregado (Backend - Módulo configuración avanzado)
- Configuración de seguridad (rate limit, fail2ban): `/api/configuracion/seguridad`
- Updater desde UI (check, update, restart): `/api/configuracion/updater/*`
- Backups automáticos configurables (cron, retención, NAS): `/api/configuracion/backups-auto/*`
- Tareas cron configurables: `/api/configuracion/cron`
- Script `src/scripts/backup-auto.js` para backups automáticos

### NUEVAS RUTAS API
```
/api/configuracion/seguridad    GET/PUT   - Config rate limiting y fail2ban
/api/configuracion/updater/status GET      - Estado del updater
/api/configuracion/updater/check POST   - Buscar actualizaciones
/api/configuracion/updater/update POST  - Ejecutar actualización
/api/configuracion/updater/restart POST - Reiniciar servicio
/api/configuracion/backups-auto    GET/PUT   - Config backup automático
/api/configuracion/backups-auto/ultimo GET   - Ver último backup
/api/configuracion/cron           GET/PUT   - Config tareas cron
```

### Archivos nuevos/incluidos
```
src/scripts/backup-auto.js   - Script para backup automático (cron)
```

## [2.4.1] - 2026-04-23

### Agregado
- Estructura modular (src/, routes/, middleware/, services/)
- Archivo `.env.example` para variables de entorno

### Cambiado
- Separado el código monolítico en módulos especializados
- `server.js` → `src/server.js` (entry point)
- Actualizado `update.sh` para buscar `src/server.js`

### Archivos nuevos
```
src/
├── server.js           # Entry point
├── db/index.js        # Setup DB + migraciones
├── routes/           # Endpoints API
│   ├── auth.js
│   ├── centros.js
│   ├── empleados.js
│   ├── registros.js
│   ├── nominas.js
│   ├── usuarios.js
│   ├── backup.js
│   └── config.js
├── middleware/        # Auth + rate limiting
│   ├── auth.js
│   └── ratelimit.js
├── services/         # Lógica de negocio
│   ├── mail.js      # SMTP
│   └── crypto.js     # Hash + AES
└── utils/
    └── helpers.js
```

## [2.3.3] - 2026-01-XX

### Agregado
- Backup automático en NAS SMB
- Alerta SMTP cuando falla backup

### Cambiado
-Mejoras en calendario

---

Formatos:
- [Agregado] para nuevas características
- [Cambiado] para cambios en funcionalidad existente
- [Corregido] para bug fixes
- [Removido] para características eliminadas