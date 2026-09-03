-- Hub SIESA: configuración y cola (mock-ready)
CREATE TABLE IF NOT EXISTS crm.hub_config (
  id SERIAL PRIMARY KEY,
  base_url TEXT DEFAULT '',
  client_id TEXT DEFAULT '',
  client_secret TEXT DEFAULT '',
  mock_enabled BOOLEAN DEFAULT TRUE,
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT NOW(),
  actualizado_en TIMESTAMP DEFAULT NOW()
);
INSERT INTO crm.hub_config (base_url, mock_enabled, activo)
SELECT '', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM crm.hub_config);

-- Cola / log de envíos al Hub (para retry y auditoría)
CREATE TABLE IF NOT EXISTS crm.hub_envios (
  id SERIAL PRIMARY KEY,
  cotizacion_id INTEGER REFERENCES crm.cotizaciones(id) ON DELETE SET NULL,
  numero VARCHAR(50) NOT NULL,
  payload JSONB,
  respuesta JSONB,
  estado VARCHAR(30) DEFAULT 'pendiente', -- pendiente | enviado | confirmado | error | mock
  documento_erp VARCHAR(100),
  intentos INTEGER DEFAULT 0,
  ultimo_error TEXT,
  creado_en TIMESTAMP DEFAULT NOW(),
  actualizado_en TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_hub_envios_cot ON crm.hub_envios(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_crm_hub_envios_estado ON crm.hub_envios(estado);
