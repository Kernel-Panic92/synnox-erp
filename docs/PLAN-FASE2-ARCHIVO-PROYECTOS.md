# Plan: Fase 2 — Archivo de Proyectos

## Objetivo

Extender el submódulo de Archivo para soportar el archivado de proyectos completados/aprobados, incluyendo snapshot de tareas asociadas, miembros y actas de cierre.

---

## 1. Migración SQL

**Archivo:** `modules/proyectos/backend/migrations/010_proyectos_archivo.sql`

```sql
CREATE TABLE IF NOT EXISTS projects.proyectos_archivadas (
  id                      SERIAL PRIMARY KEY,
  proyecto_id_original    INTEGER NOT NULL UNIQUE,
  -- Snapshots
  proyecto_snapshot       JSONB NOT NULL,
  tareas_activas_snapshot JSONB DEFAULT '[]'::jsonb,
  tareas_archivadas_refs  JSONB DEFAULT '[]'::jsonb,  -- refs a tareas ya archivadas
  miembros_snapshot       JSONB DEFAULT '[]'::jsonb,
  actas_snapshot          JSONB DEFAULT '[]'::jsonb,
  -- Metadatos
  archivada_en            TIMESTAMPTZ DEFAULT NOW(),
  archivada_por           INTEGER,
  completado_en           TIMESTAMPTZ,
  meses_retencion         INTEGER DEFAULT 24,
  -- Restauración
  restaurada_como_id      INTEGER,
  restaurada_en           TIMESTAMPTZ
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_proy_archivadas_original
  ON projects.proyectos_archivadas(proyecto_id_original);
CREATE INDEX IF NOT EXISTS idx_proy_archivadas_fecha
  ON projects.proyectos_archivadas(archivada_en);
-- Búsqueda por nombre
CREATE INDEX IF NOT EXISTS idx_proy_archivadas_nombre
  ON projects.proyectos_archivadas
  USING gin ((proyecto_snapshot->>'nombre') gin_trgm_ops);

-- Config: clave para meses de retención de proyectos
INSERT INTO projects.archivo_config (clave, valor, descripcion) VALUES
  ('meses_para_archivar_proyectos', '3',
   'Meses desde aprobación para archivar un proyecto'),
  ('habilitado_proyectos', 'true',
   'Si el archivado automático de proyectos está activo')
ON CONFLICT (clave) DO NOTHING;
```

---

## 2. Backend — Servicio (`archivoService.js`)

Nuevas funciones exportadas:

### `archivarProyecto(pool, opts)`
- **Parámetros:** `{ proyectoId, ejecutadoPor, tipo, restaurarTareasArchivadas }`
- **Lógica:**
  1. Verificar que el proyecto existe y está `completado` + `aprobada`
  2. Dentro de transacción con `FOR UPDATE`:
     - `SELECT *` del proyecto
     - `SELECT *` de tareas activas (`projects.tareas` WHERE `proyecto_id = X`)
     - `SELECT *` de miembros (`projects.proyecto_miembros` WHERE `proyecto_id = X`)
     - `SELECT *` de actas (`projects.actas_cierre` WHERE `proyecto_id = X`)
     - `SELECT` de tareas ya archivadas (`tareas_archivadas` WHERE `proyecto_id_original = X`)
  3. Construir snapshots con `buildProyectoSnapshots()`
  4. INSERT en `proyectos_archivadas`
  5. DELETE proyecto (CASCADE elimina tareas activas, miembros, actas)
  6. Log en `archivo_log` con `tipo = 'proyecto'`
- **Retorna:** `{ exitosas, fallidas, duracionMs }`

### `reactivarProyectoArchivado(pool, archivoId, usuarioId)`
- **Lógica:**
  1. Leer de `proyectos_archivadas` con `FOR UPDATE`
  2. Verificar que no fue ya restaurado
  3. Dentro de transacción:
     a. INSERT nuevo proyecto desde `proyecto_snapshot` (nuevo ID)
     b. Restaurar miembros desde `miembros_snapshot`
     c. Restaurar tareas activas desde `tareas_activas_snapshot` (cada una获得 nuevo ID, mapeo old→new)
     d. Restaurar actas desde `actas_snapshot`
     e. Si `restaurarTareasArchivadas`:
        - Buscar en `tareas_archivadas` WHERE `proyecto_id_original = ID_ORIGINAL`
        - Para cada una: INSERT en `tareas` + `comentarios` + `evidencias` desde snapshots
        - Marcar como `restaurada_como_id` en `tareas_archivadas`
     f. Marcar `proyectos_archivadas.restaurada_como_id = nuevo_proyecto_id`
  4. Commit
- **Retorna:** `{ nuevoProyectoId, tareasRestauradas }`

### Helper: `buildProyectoSnapshots(proyecto, tareas, miembros, actas, tareasArchivadasRefs)`
- Serializa cada conjunto a JSONB

---

## 3. Backend — Job (`archivarJob.js`)

Extender `check()` para ejecutar archivado de proyectos después del de tareas:

```
1. Ejecutar archivado de tareas (existente)
2. Ejecutar archivado de proyectos:
   - SELECT proyectos WHERE estado = 'completado' AND estado_aprobacion = 'aprobada'
     AND aprobado_en < NOW() - INTERVAL '1 month' * meses_para_archivar_proyectos
     AND NOT EXISTS (SELECT 1 FROM proyectos_archivadas WHERE proyecto_id_original = p.id)
   - Para cada proyecto: llamar archivarProyecto()
```

El log se distingue por `tipo = 'proyecto'` vs `tipo = 'automatico'`.

---

## 4. Backend — Routes (`archivo.js`)

Nuevos endpoints:

| Método | Ruta | Permisos | Descripción |
|---|---|---|---|
| GET | `/archivo/proyectos` | `ver` | Listar proyectos archivados (paginado + filtros) |
| GET | `/archivo/proyectos/stats` | `ver` | Stats de proyectos archivados |
| GET | `/archivo/proyectos/:id` | `ver` | Detalle de proyecto archivado |
| POST | `/archivo/proyectos/migrar` | admin/gerente | Archivar proyectos manualmente |
| POST | `/archivo/proyectos/:id/reactivar` | admin/gerente | Reactivar proyecto archivado |

**GET `/archivo/proyectos`** — Filtros:
- `q` — búsqueda por nombre (pg_trgm)
- `desde` / `hasta` — rango de archivado
- `page` / `limit`

**POST `/archivo/proyectos/:id/reactivar`** — Body:
- `{ restaurarTareasArchivadas: boolean }` — si true, restaura tareas que estaban archivadas individualmente

---

## 5. Frontend — Página de Archivo (`archivo.js` + `index.html`)

### Cambios en HTML
- Agregar tabs "Tareas" / "Proyectos" al inicio de `#page-archivo`
- Duplicar la estructura de tabla para proyectos archivados (con columnas: Nombre, Aprobado, Archivada, Restaurada)

### Cambios en `archivo.js`
- Variable `_archivoTab = 'tareas'` para controlar tab activo
- Nuevas funciones:
  - `cambiarTabArchivo(tab)` — alterna entre tareas y proyectos
  - `cargarProyectosArchivados()` — fetch + render de proyectos archivados
  - `renderProyectosArchivados()` — tabla de proyectos
  - `abrirModalProyectoArchivado(id)` — modal de detalle con snapshot completo
  - `reactivarProyectoArchivo(id)` — reactivación con checkbox de tareas archivadas
  - `ejecutarMigracionProyectos()` — archivado manual

### Modal de detalle de proyecto archivado
- Datos del proyecto (nombre, descripción, estado, prioridad, fechas)
- Lista de tareas activas archivadas con el proyecto
- Referencias a tareas archivadas individualmente (con link para restaurar por separado)
- Miembros
- Actas de cierre
- Botón "Reactivar" (solo admin/gerente)

---

## 6. Flujo completo de reactivación

```
1. Usuario hace clic en "Reactivar" en un proyecto archivado
2. Modal preguntaa: "¿Restaurar también las tareas archivadas individualmente?"
3. Si confirma:
   a. Crear nuevo proyecto (nuevo ID)
   b. Restaurar tareas activas del snapshot
   c. Restaurar miembros
   d. Restaurar actas
   e. (Opcional) Restaurar tareas individualmente archivadas
   f. Marcar como restaurado
4. Toast: "Proyecto restaurado como #X"
5. Recargar lista
```

---

## 7. Archivos a crear/modificar

| Archivo | Acción | Líneas estimadas |
|---|---|---|
| `migrations/010_proyectos_archivo.sql` | **Nuevo** | ~40 |
| `utils/archivoService.js` | **Modificar** | +~180 (2 funciones nuevas + helper) |
| `utils/archivarJob.js` | **Modificar** | +~40 (extender check) |
| `routes/archivo.js` | **Modificar** | +~160 (5 endpoints nuevos) |
| `public/js/modules/archivo.js` | **Modificar** | +~250 (tabs, tabla proyectos, modales) |
| `public/index.html` | **Modificar** | +~40 (tabs + tabla proyectos) |

---

## 8. Verificación

1. Ejecutar migración: `010_proyectos_archivo.sql`
2. Probar archivado manual: `POST /api/archivo/proyectos/migrar`
3. Verificar que el proyecto + tareas activas se movieron al archivo
4. Verificar que tareas individualmente archivadas quedaron intactas
5. Probar reactivación: `POST /api/archivo/proyectos/:id/reactivar`
6. Verificar que se creó nuevo proyecto con tareas, miembros, actas
7. Probar reactivación con `restaurarTareasArchivadas: true`
8. Verificar UI: tabs, filtros, modal detalle, botón reactivar
9. Verificar que el job automático archiva proyectos completados >3 meses
10. Verificar permisos: solo admin/gerente pueden migrar/reactivar
