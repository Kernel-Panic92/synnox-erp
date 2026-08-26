-- Fix: ON DELETE SET NULL en FKs a oportunidades
ALTER TABLE crm.visitas DROP CONSTRAINT IF EXISTS visitas_oportunidad_id_fkey;
ALTER TABLE crm.visitas ADD CONSTRAINT visitas_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES crm.oportunidades(id) ON DELETE SET NULL;

ALTER TABLE crm.cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_oportunidad_id_fkey;
ALTER TABLE crm.cotizaciones ADD CONSTRAINT cotizaciones_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES crm.oportunidades(id) ON DELETE SET NULL;
