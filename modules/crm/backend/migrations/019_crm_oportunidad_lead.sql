-- Permitir que una oportunidad esté vinculada a un lead (cliente potencial) además de a un cliente real
ALTER TABLE crm.oportunidades ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_oportunidades_lead ON crm.oportunidades(lead_id);
