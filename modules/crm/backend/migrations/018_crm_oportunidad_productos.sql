-- Productos posibles para una oportunidad (maestro productos)
CREATE TABLE IF NOT EXISTS crm.oportunidad_productos (
  id SERIAL PRIMARY KEY,
  oportunidad_id UUID NOT NULL REFERENCES crm.oportunidades(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES crm.productos(id) ON DELETE CASCADE,
  cantidad DECIMAL(12,2) DEFAULT 1,
  precio_unitario DECIMAL(15,2) DEFAULT 0,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(oportunidad_id, producto_id)
);
CREATE INDEX IF NOT EXISTS idx_oportunidad_productos_oportunidad ON crm.oportunidad_productos(oportunidad_id);
CREATE INDEX IF NOT EXISTS idx_oportunidad_productos_producto ON crm.oportunidad_productos(producto_id);
