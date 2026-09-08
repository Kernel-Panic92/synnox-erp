-- Adjuntos por lead (RUT, certificados, etc.) — 20MB/archivo, max 10/lead
CREATE TABLE IF NOT EXISTS crm.lead_adjuntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  nombre_original TEXT NOT NULL,
  nombre_guardado TEXT NOT NULL,
  ruta TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL CHECK (size > 0 AND size <= 20971520),
  tipo TEXT NOT NULL DEFAULT 'otro' CHECK (tipo IN ('rut','cert_bancario','camara_comercio','cedula','otro')),
  subido_por INTEGER,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_adjuntos_lead ON crm.lead_adjuntos(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_adjuntos_creado ON crm.lead_adjuntos(creado_en);
