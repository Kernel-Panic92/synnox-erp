# Flujo de trabajo SynnoxERP

## Metodologia

El proyecto usa **Kanban iterativo con ciclos ligeros de sprint**. No requiere
Scrum formal, pero mantiene objetivos, criterios de terminado y una revision al
cierre de cada ciclo.

Cada sprint dura entre una y dos semanas, o termina antes si se completa su
objetivo. El tamano se adapta al riesgo y al alcance, no solo al numero de
issues.

## Roles

- **Product Owner:** Edgar, define prioridad, alcance y aceptacion.
- **Implementacion y verificacion:** OpenCode, ejecuta cambios, pruebas y
  documentacion siguiendo las reglas del repositorio.
- **Backlog:** GitHub Issues es la fuente de verdad para trabajo pendiente.
- **Estado persistente:** `docs/SPRINT.md` resume el sprint activo y debe
  actualizarse al comenzar, durante y al cerrar un sprint.

## Flujo de un sprint

1. **Inicio:** revisar `AGENTS.md`, `docs/WORKFLOW.md`, `docs/SPRINT.md`,
   estado de GitHub y estado del worktree.
2. **Objetivo:** definir un objetivo verificable y seleccionar issues
   relacionados.
3. **Branch:** crear una branch desde `dev` con nombre `feat/`, `fix/` o
   `chore/` segun corresponda.
4. **Implementacion:** trabajar en bloques pequenos, actualizar el sprint y
   mantener cambios reversibles.
5. **Verificacion:** ejecutar pruebas, lint/build cuando existan, revisar
   `git diff --check` y confirmar criterios de aceptacion.
6. **Persistencia:** hacer commits pequenos con mensajes claros y push despues
   de cada bloque estable o cuando el usuario lo solicite.
7. **Revision:** abrir PR contra `dev`, revisar diff completo y resolver
   observaciones.
8. **Cierre:** actualizar issues, `docs/SPRINT.md` y `AGENTS.md` si cambio el
   estado del proyecto. La retrospectiva debe registrar que funciono, riesgos
   y siguiente paso.

## Definition of Done

Un item esta terminado cuando:

- Cumple sus criterios de aceptacion.
- Tiene validacion automatizada o manual documentada.
- No deja errores de sintaxis ni `git diff --check` pendientes.
- La documentacion y configuracion necesarias estan actualizadas.
- El commit esta en la branch correcta y fue publicado si corresponde.
- El issue tiene comentario de resultado y se cierra solo si no quedan
  pendientes concretos.

## Versionado semantico

El proyecto sigue **semver** (`major.minor.patch`):

- **Major**: cambios breaking (migraciones de DB, auth, API incompatible).
- **Minor**: features nuevas sin breaking changes.
- **Patch**: bugs fixes, mejoras menores, documentacion.

### Reglas de branch

| Branch | Version | Ejemplo |
|--------|---------|---------|
| `main` | Ultimo release estable | `2.4.0` |
| `dev` | Siempre +1 patch (o +1 minor) sobre main | `2.4.1` |

### Flujo de release

1. Actualizar `package.json` version en `main`.
2. Crear tag anotado: `git tag -a vX.Y.Z -m "release: descripcion"`.
3. Push: `git push origin main && git push origin vX.Y.Z`.
4. Actualizar `package.json` version en `dev` (+1 patch sobre main).

### Reglas

- `main` **nunca** tiene version igual o menor que `dev`.
- `dev` puede tener cambios sin versionar (version temporal).
- Al hacer merge `dev` → `main`, ambas versiones se alinean y `dev` sube +1.
- No hacer force push a `main`.

## Reglas para OpenCode

- No asumir que el contexto de conversacion existe; leer siempre los tres
  archivos persistentes del inicio.
- No crear una branch desde `main` para trabajo normal; usar `dev` salvo que el
  usuario indique otra cosa.
- No cerrar issues parcialmente resueltos: comentar avance y dejar pendientes
  explicitos.
- No hacer merge, deploy, push forzado ni modificar secretos sin confirmacion
  explicita del usuario.
- Antes de editar, revisar worktree y conservar cambios ajenos.
- Al terminar un bloque, reportar branch, commits, pruebas y pendientes.

## Comandos de OpenCode

- `/sprint-start [objetivo]`: prepara o inicia el sprint actual.
- `/sprint-status`: sincroniza estado local, GitHub y `docs/SPRINT.md`.
- `/sprint-close`: ejecuta checklist de cierre sin hacer merge ni deploy.
