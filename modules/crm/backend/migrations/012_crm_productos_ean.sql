-- Codigos de barras (EAN/GTIN) por producto
CREATE TABLE IF NOT EXISTS crm.productos_ean (
  id SERIAL PRIMARY KEY,
  producto_id UUID NOT NULL REFERENCES crm.productos(id) ON DELETE CASCADE,
  gtin VARCHAR(50) NOT NULL,
  descripcion TEXT,
  unidad_medida VARCHAR(20),
  es_principal BOOLEAN DEFAULT FALSE,
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, gtin)
);

CREATE INDEX IF NOT EXISTS idx_ean_producto ON crm.productos_ean(producto_id);
CREATE INDEX IF NOT EXISTS idx_ean_gtin ON crm.productos_ean(gtin);
