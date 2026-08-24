# Sprint activo

## Identificacion

- **Nombre:** Seguridad y observabilidad
- **Inicio:** 2026-08-20
- **Branch:** `chore/open-issues-triage`
- **Estado:** completado

## Objetivo

Reducir deuda de seguridad y establecer la base persistente de auditoria
central antes de abordar los cambios de experiencia frontend.

## Issues incluidos

- #65 Fail2ban: implementado, cerrado temporalmente.
- #68 Criptografia del Launcher: implementado parcialmente; pendiente
  rotacion/versionado de claves.
- #93 y #94 Dependabot: corregidos y cerrados.
- #70 y #71 Backups legacy: obsoletos y cerrados.
- #111 Auditoria central: migracion, retencion y configuracion implementadas.
- #112 Helper de auditoria: implementado con pruebas.
- #113 Sesiones y autenticacion: completado — OAuth audit, session kill, invalidacion admin, password reset admin.

## Avances de la sesion 47

- PR #118 fusionado a `dev`.
- Workflow persistente de sprints agregado al repositorio y a OpenCode.
- Migracion y retencion de auditoria central verificadas en desarrollo.
- Eventos locales de autenticacion verificados en PostgreSQL.
- PM2 verificado en estado `online` despues de aplicar cambios.

## Avances de la sesion 48

- Eventos de auditoria OAuth implementados (Google, GitHub, Microsoft):
  - Login exitoso con provider, email, isNew, hasModules
  - Login fallido: oauth_denied, state_mismatch, token_exchange_failed, no_email, blacklisted, auth_failed, oauth_error
  - state_mismatch categorizado como `security` (posible CSRF)
- Session kill auditado: admin que revoca, usuario target, session_id
- Invalidacion de sesiones auditada en 4 call sites admin:
  - Edicion de usuario (rol/perfil/nombre/email)
  - Desactivacion de usuario
  - Cambio de modulos asignados
  - Cambio de permisos
- Reset de password por admin auditado (con y sin SMTP)
- Total de llamadas a `auditarEvento()`: 5 originales + 32 nuevas = 37 en launcher

## Criterios de cierre

- [x] Seguridad critica revisada.
- [x] Auditoria central creada y migrada en el entorno de desarrollo.
- [x] Helper de auditoria probado.
- [x] Cambios persistidos en commits y branch remota.
- [x] Completar eventos OAuth y rate-limit.
- [x] Abrir y fusionar PR contra `dev` (#118).

## Retrospectiva parcial

### Funciono

- Commits pequenos con push frecuente.
- Verificacion directa contra PM2 y PostgreSQL.
- Compatibilidad legacy mantenida para datos cifrados.

### Riesgos y pendientes

- La branch se creo desde `main`, aunque el flujo normal documentado debe usar
  `dev`.
- El entorno remoto debe ejecutar la migracion central antes del deploy.
- `AGENTS.md` historico necesita sincronizar sus issues cerrados.

## Siguiente paso

Instrumentar una ruta critica de cada modulo (nomina, logistica, proveedores,
proyectos) antes de construir el visor frontend de Logs (#114).

### Instrumentacion de modulos (completada parcialmente)
- **Proyectos**: 10 eventos (CRUD proyectos, CRUD tareas, aprobaciones)
- **Logistica**: 14 eventos (pedidos, devoluciones, vehiculos, clientes)
- **Proveedores**: 14 eventos (facturas workflow, proveedores, areas, categorias)
- **Nomina**: PENDIENTE — usa SQLite, necesita approach diferente para auditoria central

### Visor de auditoria central (completado)
- Endpoint `GET /api/admin/audit/central` con filtros: modulo, categoria, accion, resultado, actor_id, entidad_tipo, search, desde, hasta + paginacion
- Endpoint `GET /api/admin/audit/central/:id` para detalle de evento individual
- Endpoint `GET /api/admin/audit/stats` con stats: total, fallos 24h, por modulo, top acciones
- UI rediseñada: stats cards, tabla con filtros, busqueda, ordenamiento, paginacion
- Modal de detalle con metadata JSON completo
