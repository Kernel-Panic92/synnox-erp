-- ============================================================
-- Fase 1: Archivo de tareas completadas
-- Migración idempotente — safe para ejecutar múltiples veces
-- ============================================================

-- 1. Extensión para búsqueda por título (pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Campo en tareas activas para saber cuándo se completó
ALTER TABLE projects.tareas
  ADD COLUMN IF NOT EXISTS completada_en TIMESTAMPTZ;

-- 3. Backfill: tareas ya completadas sin fecha documentada usan updated_at
--    como aproximación. Se documenta en código y en archivo_config.
UPDATE projects.tareas
SET completada_en = updated_at
WHERE estado = 'completada'
  AND completada_en IS NULL;

-- 4. Trigger: setear completada_en al marcar estado = 'completada'
CREATE OR REPLACE FUNCTION projects.set_completada_en()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'completada' AND (OLD.estado IS DISTINCT FROM 'completada') THEN
    NEW.completada_en = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_completada_en ON projects.tareas;
CREATE TRIGGER trg_set_completada_en
  BEFORE INSERT OR UPDATE ON projects.tareas
  FOR EACH ROW
  EXECUTE FUNCTION projects.set_completada_en();

-- 5. Tabla principal de archivo (JSONB consultable, sin gzip)
CREATE TABLE IF NOT EXISTS projects.tareas_archivadas (
  id                    SERIAL PRIMARY KEY,
  tarea_id_original     INTEGER NOT NULL UNIQUE,
  proyecto_id_original  INTEGER,
  proyecto_nombre       TEXT,
  -- Snapshots completos (PostgreSQL comprime internamente valores grandes)
  tarea_snapshot        JSONB NOT NULL,
  comentarios_snapshot  JSONB DEFAULT '[]'::jsonb,
  evidencias_snapshot   JSONB DEFAULT '[]'::jsonb,
  -- Metadatos de archivo
  archivada_en          TIMESTAMPTZ DEFAULT NOW(),
  archivada_por         INTEGER,  -- usuario_id; NULL = job automático
  completada_en         TIMESTAMPTZ,
  -- Política de retención (informativa en Fase 1; sin borrado automático)
  meses_retencion       INTEGER DEFAULT 24,
  -- Restauración: nunca reutiliza IDs
  restaurada_como_id    INTEGER,
  restaurada_en         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_archivadas_proyecto
  ON projects.tareas_archivadas(proyecto_id_original);
CREATE INDEX IF NOT EXISTS idx_archivadas_fecha
  ON projects.tareas_archivadas(archivada_en);
CREATE INDEX IF NOT EXISTS idx_archivadas_tarea_original
  ON projects.tareas_archivadas(tarea_id_original);
-- Índice para búsqueda por título usando pg_trgm
CREATE INDEX IF NOT EXISTS idx_archivadas_titulo
  ON projects.tareas_archivadas
  USING gin ((tarea_snapshot->>'titulo') gin_trgm_ops);

-- 6. Log de ejecuciones del job de archivado
CREATE TABLE IF NOT EXISTS projects.archivo_log (
  id                  SERIAL PRIMARY KEY,
  ejecutado_en        TIMESTAMPTZ DEFAULT NOW(),
  ejecutado_por       INTEGER,  -- NULL = job automático
  tipo                TEXT DEFAULT 'automatico',  -- 'automatico' | 'manual'
  tareas_archivadas   INTEGER DEFAULT 0,
  tareas_fallidas     INTEGER DEFAULT 0,
  bytes_antes         BIGINT DEFAULT 0,
  bytes_despues       BIGINT DEFAULT 0,
  duracion_ms         INTEGER,
  detalles            TEXT  -- JSON con IDs procesados/errores
);

CREATE INDEX IF NOT EXISTS idx_archivo_log_tipo_fecha
  ON projects.archivo_log(tipo, ejecutado_en DESC);

-- 7. Configuración de retención
CREATE TABLE IF NOT EXISTS projects.archivo_config (
  clave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  descripcion   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO projects.archivo_config (clave, valor, descripcion) VALUES
  ('meses_para_archivar', '3',
   'Meses transcurridos desde completada_en para considerar una tarea archivable'),
  ('meses_retencion', '24',
   'Meses que se conserva una tarea en archivo antes de evaluar eliminación (política informativa en Fase 1)'),
  ('habilitado', 'true',
   'Si el archivado automático está activo')
ON CONFLICT (clave) DO NOTHING;
