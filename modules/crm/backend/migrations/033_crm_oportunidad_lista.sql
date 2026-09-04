ALTER TABLE crm.oportunidades ADD COLUMN IF NOT EXISTS lista_precios VARCHAR(20) DEFAULT '200';
CREATE INDEX IF NOT EXISTS idx_crm_oportunidades_lista ON crm.oportunidades(lista_precios);
