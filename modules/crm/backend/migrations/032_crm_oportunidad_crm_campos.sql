ALTER TABLE crm.oportunidades ADD COLUMN IF NOT EXISTS fuente VARCHAR(50) DEFAULT 'otro';
ALTER TABLE crm.oportunidades ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'media';
-- motivo_perdida ya existe desde antes
CREATE INDEX IF NOT EXISTS idx_crm_oportunidades_fuente ON crm.oportunidades(fuente);
CREATE INDEX IF NOT EXISTS idx_crm_oportunidades_prioridad ON crm.oportunidades(prioridad);
