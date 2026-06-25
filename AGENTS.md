# SynnoxERP — Contexto del proyecto

## Estado actual (25 Jun 2026)

### Arquitectura
- **Servidor unificado**: 1 proceso PM2 (synnoxerp) en puerto 3002
- **1 solo .env** en raíz con todas las configuraciones
- **1 solo package.json** con todas las dependencias
- **Módulos estáticos**: las rutas están hardcodeadas en server.js, no requieren registro vía API

### Módulos

| Ruta | Nombre | DB | Estado |
|------|--------|----|--------|
| `/` | Launcher (login, dashboard, admin) | SQLite | ✅ |
| `/proveedores/` | Proveedores (facturas) | PostgreSQL (`horix_erp`) | ✅ |
| `/logistica/` | Logística (rutas) | PostgreSQL (`horix_erp`, schema `logistics`) | ✅ |
| `/nomina/` | Nómina (novedades) | SQLite (`modules/nomina/horas_extra.db`) | ✅ |

### Bugs resueltos
- DocFlow → Proveedores: bucle infinito por columna `creado` vs `creado_en` ✅
- Horix → Nómina: typo `podeAprovar` vs `podeAprobar` en middleware ✅
- Logística: catch-all interceptaba rutas antes de montar el módulo ESM ✅
- Nómina: `const API` duplicado anulaba prefijo BASE en frontend ✅
- DBs unificadas: `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` para todos los módulos ✅

### Pendientes
- [ ] Verificar dashboards y funcionalidad de cada módulo migrado
- [ ] Revisar submódulos de configuración de cada módulo (SMTP, backup, etc.)
- [ ] Simplificar admin del launcher (remover gestión de módulos vía API)
- [ ] Limpiar tablas `modulos_plataforma` del launcher (obsoletas)
- [ ] Renombrar proyecto a SynnoxERP
- [ ] Agregar `"type": "module"` a package.json (eliminar warning de ESM)
