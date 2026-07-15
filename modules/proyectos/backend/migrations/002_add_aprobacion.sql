CREATE TABLE IF NOT EXISTS projects.evidencias (
    id            SERIAL PRIMARY KEY,
    tarea_id      INTEGER REFERENCES projects.tareas(id) ON DELETE CASCADE,
    usuario_id    INTEGER NOT NULL,
    descripcion   TEXT DEFAULT '',
    archivo_nombre TEXT,
    archivo_path  TEXT,
    archivo_tipo  TEXT,
    archivo_tamanio INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects.tareas ADD COLUMN IF NOT EXISTS estado_aprobacion TEXT DEFAULT 'pendiente';
ALTER TABLE projects.tareas ADD COLUMN IF NOT EXISTS aprobado_por INTEGER;
ALTER TABLE projects.tareas ADD COLUMN IF NOT EXISTS aprobado_en TIMESTAMPTZ;
ALTER TABLE projects.tareas ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;

ALTER TABLE projects.proyectos ADD COLUMN IF NOT EXISTS estado_aprobacion TEXT DEFAULT 'pendiente';
ALTER TABLE projects.proyectos ADD COLUMN IF NOT EXISTS aprobado_por INTEGER;
ALTER TABLE projects.proyectos ADD COLUMN IF NOT EXISTS aprobado_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_evidencias_tarea ON projects.evidencias(tarea_id);
CREATE INDEX IF NOT EXISTS idx_tareas_aprobacion ON projects.tareas(estado_aprobacion);
