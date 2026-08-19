-- ============================================================
-- Fase 2: Archivo de proyectos completados
-- Migración idempotente — safe para ejecutar múltiples veces
-- ============================================================

-- 1. Tabla de proyectos archivados
CREATE TABLE IF NOT EXISTS projects.proyectos_archivadas (
  id                      SERIAL PRIMARY KEY,
  proyecto_id_original    INTEGER NOT NULL UNIQUE,
  -- Snapshots
  proyecto_snapshot       JSONB NOT NULL,
  tareas_activas_snapshot JSONB DEFAULT '[]'::jsonb,
  tareas_archivadas_refs  JSONB DEFAULT '[]'::jsonb,
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

CREATE INDEX IF NOT EXISTS idx_proy_archivadas_original
  ON projects.proyectos_archivadas(proyecto_id_original);
CREATE INDEX IF NOT EXISTS idx_proy_archivadas_fecha
  ON projects.proyectos_archivadas(archivada_en);
CREATE INDEX IF NOT EXISTS idx_proy_archivadas_nombre
  ON projects.proyectos_archivadas
  USING gin ((proyecto_snapshot->>'nombre') gin_trgm_ops);

-- 2. Config de archivado de proyectos
INSERT INTO projects.archivo_config (clave, valor, descripcion) VALUES
  ('meses_para_archivar_proyectos', '3',
   'Meses desde aprobación para archivar un proyecto'),
  ('habilitado_proyectos', 'true',
   'Si el archivado automático de proyectos está activo')
ON CONFLICT (clave) DO NOTHING;
