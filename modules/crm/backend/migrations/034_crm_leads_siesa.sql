ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_tipo_identificacion VARCHAR(5) DEFAULT '31';
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_dv VARCHAR(1);
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_tipo_persona INT DEFAULT 1;
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_regimen VARCHAR(10) DEFAULT '48';
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_responsabilidad_fiscal VARCHAR(20) DEFAULT 'R-99-PN';
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_ciiu VARCHAR(10) DEFAULT '4723';
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS siesa_sincronizado BOOLEAN DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_nit_unique ON crm.leads(numero_identificacion) WHERE numero_identificacion IS NOT NULL AND numero_identificacion <> '';
