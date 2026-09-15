-- Cotización a cliente potencial (lead) para simulación comercial.
-- El envío al ERP se bloquea (422) hasta convertir el lead en cliente formal.
ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cotizaciones_lead ON crm.cotizaciones(lead_id);
