# SynnoxERP — Contexto del proyecto

## Estado (08 Jul 2026 — sesión 5)

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

### Pendientes
- [ ] Migración Nómina SQLite → PostgreSQL (ver ARCHITECTURE.md §4)
- [ ] Sistema de permisos centralizado (JWT enriquecido)
- [ ] Observabilidad centralizada (tabla `auditoria_central`)
- [ ] Multi-proceso PM2 (separar módulos)
- [ ] JWT corto (1h) + refresh token
- [ ] APIs internas entre módulos
- [ ] Probar HTTPS en producción

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
