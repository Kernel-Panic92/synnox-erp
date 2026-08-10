CREATE TABLE IF NOT EXISTS projects.proyecto_miembros (
    id            SERIAL PRIMARY KEY,
    proyecto_id   INTEGER NOT NULL REFERENCES projects.proyectos(id) ON DELETE CASCADE,
    usuario_id    INTEGER NOT NULL,
    rol           TEXT NOT NULL DEFAULT 'miembro',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proyecto_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_proyecto_miembros_usuario ON projects.proyecto_miembros(usuario_id);
CREATE INDEX IF NOT EXISTS idx_proyecto_miembros_proyecto ON projects.proyecto_miembros(proyecto_id);
