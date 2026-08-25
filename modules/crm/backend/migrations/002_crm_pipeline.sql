-- Pipeline de oportunidades
CREATE TABLE IF NOT EXISTS crm.oportunidades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID REFERENCES crm.empresas(id),
  contacto_id UUID REFERENCES crm.contactos(id),
  nombre VARCHAR(255) NOT NULL,
  monto_esperado DECIMAL(15,2),
  probabilidad SMALLINT DEFAULT 10,
  etapa VARCHAR(30) CHECK (etapa IN (
    'lead','calificado','propuesta','negociacion','ganada','perdida'
  )) DEFAULT 'lead',
  motivo_perdida TEXT,
  vendedor_id INTEGER,
  fecha_cierre_estimada DATE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oportunidades_empresa ON crm.oportunidades(empresa_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_contacto ON crm.oportunidades(contacto_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_vendedor ON crm.oportunidades(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_etapa ON crm.oportunidades(etapa);
CREATE INDEX IF NOT EXISTS idx_oportunidades_fecha ON crm.oportunidades(fecha_cierre_estimada);

-- Historial de cambios de etapa
CREATE TABLE IF NOT EXISTS crm.oportunidad_historial (
  id SERIAL PRIMARY KEY,
  oportunidad_id UUID REFERENCES crm.oportunidades(id) ON DELETE CASCADE,
  etapa_anterior VARCHAR(30),
  etapa_nueva VARCHAR(30),
  cambiado_por INTEGER,
  comentario TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_oportunidad ON crm.oportunidad_historial(oportunidad_id);
