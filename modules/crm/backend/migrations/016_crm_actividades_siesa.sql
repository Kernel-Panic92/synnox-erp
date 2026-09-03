-- Campos para actividades estilo SIESA
DO $$ BEGIN
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMPTZ;
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS recordatorio VARCHAR(30) DEFAULT 'nunca';
  ALTER TABLE crm.visitas ADD COLUMN IF NOT EXISTS propietario_nombre VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Actualizar tipos de estado (agregar nuevos estados)
ALTER TABLE crm.visitas DROP CONSTRAINT IF EXISTS visitas_estado_check;
ALTER TABLE crm.visitas ADD CONSTRAINT visitas_estado_check CHECK (estado IN (
  'no_iniciada','en_proceso','realizada','no_realizada','asignada','pendiente'
));

-- Actualizar tipos de actividad
ALTER TABLE crm.visitas DROP CONSTRAINT IF EXISTS visitas_tipo_actividad_check;
ALTER TABLE crm.visitas ADD CONSTRAINT visitas_tipo_actividad_check CHECK (tipo_actividad IN (
  'visita','reunion','llamada','nota'
));
