# SynnoxERP — Contexto del proyecto

## Estado actual (25 Jun 2026)

### Arquitectura
- **Servidor unificado**: 1 proceso, 1 .env, 1 package.json
- **Módulos como plugins**: montados en server.js con path prefix
- **Auth centralizada**: JWT compartido, login único en el launcher
- **Tema universal**: `synnox_theme` en localStorage, toggle en launcher

### Módulos

| Ruta | Nombre | DB | Estado |
|------|--------|----|--------|
| `/` | Launcher (login, dashboard, admin) | SQLite | ✅ |
| `/proveedores/` | Proveedores (facturas) | PostgreSQL | ✅ |
| `/logistica/` | Logística (rutas) | PostgreSQL | ✅ |
| `/nomina/` | Nómina (novedades) | SQLite | ⚠️ |

### Bugs conocidos

1. **Nómina**: API calls sin prefijo `/nomina/` → los JS están cacheados en el browser. Forzar hard refresh o esperar a que venza el caché.
2. **Nómina**: CSP bloquea inline script de `window.BASE` — agregado `nonce="__NONCE__"`.
3. **Proveedores**: Algunas URLs absolutas en backup y auditoría ya corregidas.
4. **Logística**: Tabla `logistics.usuarios` restaurada.

### Pendientes próxima sesión
- [ ] Verificar Nómina después de hard refresh (F12 → network → disable cache)
- [ ] Probar flujos completos: crear factura, ruta, registro de nómina
- [ ] Revisar submódulos de configuración de cada módulo
- [ ] Verificar sesión: logout del launcher debe invalidar acceso a módulos
