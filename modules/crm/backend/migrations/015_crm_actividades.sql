-- Transformar Visitas en Actividades
DO $$ BEGIN
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS asunto VARCHAR(255);
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS lugar VARCHAR(255);
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS tipo_actividad VARCHAR(30) DEFAULT 'visita';
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'en_proceso';
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS descripcion TEXT;
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Migrar datos existentes: check-in/checkout a tipo_actividad = 'visita'
UPDATE crm.visitas SET tipo_actividad = 'visita' WHERE tipo_actividad IS NULL;
