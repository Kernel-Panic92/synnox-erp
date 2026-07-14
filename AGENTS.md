# SynnoxERP — Contexto del proyecto

## Estado (14 Jul 2026 — sesión 8)

### Arquitectura
- **Package manager**: pnpm (workspaces, strict mode, lockfile trackeado)
- **Workspaces**: 6 módulos (root, launcher, proveedores, nómina, logística, wordpress-mcp)
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

### Cambios Sesión 8 — seguridad (3 CVEs high cerrados)
- **xlsx → exceljs**: Migrados 2 parsers de logística (`widgetechExcelParser.js`, `maestroClientesParser.js`). `xlsx` (SheetJS) abandonado en npm sin parche disponible. Reemplazado por `exceljs` (ya usado en root/nómina). Cierra CVE-2023-30533 (Prototype Pollution) y CVE-2024-22363 (ReDoS).
- **nodemailer ^8.0.5 → ^9.0.1**: Actualizado en root, launcher, proveedores, nómina y logística. Cierra GHSA-p6gq (raw message bypass — arbitrary file read + SSRF en ≤9.0.0).
- **pnpm-lock.yaml**: Generado y pusheado al repo, habilitando `--frozen-lockfile` en install.sh.
- **Resultado**: `pnpm audit --prod` reporta 0 vulnerabilidades.

### Pendientes
- [x] Primera ejecución de `pnpm install --prod` en servidor para generar `pnpm-lock.yaml`
- [x] Verificar que el servidor unificado arranca correctamente con `node server.js`
- [ ] Ejecutar migración Nómina (Fase 0)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción

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
