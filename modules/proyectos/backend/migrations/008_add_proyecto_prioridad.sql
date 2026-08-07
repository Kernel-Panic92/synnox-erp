ALTER TABLE projects.proyectos ADD COLUMN IF NOT EXISTS prioridad TEXT DEFAULT 'media';

-- Migrar prioridad existente basada en tareas
UPDATE projects.proyectos p
SET prioridad = CASE
  WHEN EXISTS (SELECT 1 FROM projects.tareas t WHERE t.proyecto_id = p.id AND t.prioridad = 'critica') THEN 'critica'
  WHEN EXISTS (SELECT 1 FROM projects.tareas t WHERE t.proyecto_id = p.id AND t.prioridad = 'alta') THEN 'alta'
  WHEN EXISTS (SELECT 1 FROM projects.tareas t WHERE t.proyecto_id = p.id AND t.prioridad = 'media') THEN 'media'
  ELSE 'baja'
END
WHERE prioridad = 'media';

CREATE INDEX IF NOT EXISTS idx_proyectos_prioridad ON projects.proyectos(prioridad);
