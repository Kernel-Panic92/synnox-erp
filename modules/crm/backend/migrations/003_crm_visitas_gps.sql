-- Visitas GPS con check-in/check-out
CREATE TABLE IF NOT EXISTS crm.visitas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID REFERENCES crm.empresas(id),
  contacto_id UUID REFERENCES crm.contactos(id),
  oportunidad_id UUID REFERENCES crm.oportunidades(id),
  vendedor_id INTEGER NOT NULL,
  tipo VARCHAR(20) CHECK (tipo IN ('checkin','checkout')),
  latitud DECIMAL(10,8) NOT NULL,
  longitud DECIMAL(10,8) NOT NULL,
  precision_gps DECIMAL(10,2),
  notas TEXT,
  evidencia_foto VARCHAR(500),
  fecha TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitas_vendedor ON crm.visitas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_visitas_empresa ON crm.visitas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON crm.visitas(fecha);
CREATE INDEX IF NOT EXISTS idx_visitas_tipo ON crm.visitas(tipo);

-- Vista resumen diaria por vendedor
CREATE OR REPLACE VIEW crm.visitas_resumen_diario AS
SELECT
  v.vendedor_id,
  DATE(v.fecha) AS fecha,
  COUNT(*) FILTER (WHERE v.tipo = 'checkin') AS total_checkins,
  COUNT(DISTINCT v.empresa_id) AS empresas_visitadas,
  MIN(v.fecha) AS primera_visita,
  MAX(v.fecha) AS ultima_visita
FROM crm.visitas v
GROUP BY v.vendedor_id, DATE(v.fecha);
