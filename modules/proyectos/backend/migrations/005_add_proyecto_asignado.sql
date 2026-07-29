ALTER TABLE projects.proyectos ADD COLUMN IF NOT EXISTS asignado_a INTEGER;
CREATE INDEX IF NOT EXISTS idx_proyectos_asignado ON projects.proyectos(asignado_a);
