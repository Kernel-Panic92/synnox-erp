# Sprint activo

## Identificacion

- **Nombre:** Seguridad y observabilidad
- **Inicio:** 2026-08-20
- **Branch:** `chore/open-issues-triage`
- **Estado:** en progreso

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
- #113 Sesiones y autenticacion: revocacion selectiva e instrumentacion local
  implementadas; faltan OAuth y cobertura completa.

## Criterios de cierre

- [x] Seguridad critica revisada.
- [x] Auditoria central creada y migrada en el entorno de desarrollo.
- [x] Helper de auditoria probado.
- [x] Cambios persistidos en commits y branch remota.
- [ ] Completar eventos OAuth y rate-limit.
- [ ] Abrir PR contra `dev`.

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

Completar auditoria OAuth y rate-limit de #113; despues instrumentar una ruta
critica de cada modulo antes de construir el visor frontend de Logs.
