CREATE SCHEMA IF NOT EXISTS projects;

CREATE TABLE IF NOT EXISTS projects.proyectos (
    id            SERIAL PRIMARY KEY,
    nombre        TEXT NOT NULL,
    descripcion   TEXT DEFAULT '',
    estado        TEXT NOT NULL DEFAULT 'activo',
    fecha_limite  DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects.tareas (
    id               SERIAL PRIMARY KEY,
    proyecto_id      INTEGER REFERENCES projects.proyectos(id) ON DELETE CASCADE,
    titulo           TEXT NOT NULL,
    descripcion      TEXT DEFAULT '',
    tipo             TEXT DEFAULT 'tarea',
    prioridad        TEXT DEFAULT 'media',
    estado           TEXT DEFAULT 'pendiente',
    columna          TEXT DEFAULT 'pendiente',
    asignado_a       INTEGER,
    reportero        INTEGER,
    fecha_limite     DATE,
    estimacion_horas NUMERIC(5,1),
    horas_invertidas NUMERIC(5,1) DEFAULT 0,
    orden            INTEGER DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects.comentarios (
    id            SERIAL PRIMARY KEY,
    tarea_id      INTEGER REFERENCES projects.tareas(id) ON DELETE CASCADE,
    usuario_id    INTEGER NOT NULL,
    contenido     TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tareas_proyecto ON projects.tareas(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_tareas_asignado ON projects.tareas(asignado_a);
CREATE INDEX IF NOT EXISTS idx_tareas_estado ON projects.tareas(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_prioridad ON projects.tareas(prioridad);
CREATE INDEX IF NOT EXISTS idx_tareas_columna ON projects.tareas(proyecto_id, columna);
CREATE INDEX IF NOT EXISTS idx_comentarios_tarea ON projects.comentarios(tarea_id);
