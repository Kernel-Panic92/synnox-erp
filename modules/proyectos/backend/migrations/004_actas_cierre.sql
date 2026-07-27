CREATE TABLE IF NOT EXISTS projects.actas_cierre (
    id SERIAL PRIMARY KEY,
    proyecto_id INTEGER NOT NULL REFERENCES projects.proyectos(id) ON DELETE CASCADE,
    cerrado_por INTEGER,
    observaciones TEXT DEFAULT '',
    resumen_ejecutivo TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actas_proyecto ON projects.actas_cierre(proyecto_id);
