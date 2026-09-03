-- Catálogo GS1 de la compañía (EANGS1.xlsx) — fuente oficial de códigos de barras
CREATE TABLE IF NOT EXISTS crm.gs1_catalogo (
  id SERIAL PRIMARY KEY,
  gtin VARCHAR(50) NOT NULL UNIQUE,
  tipo_producto VARCHAR(50),
  estado VARCHAR(50),
  fecha_creacion DATE,
  url_imagen TEXT,
  descripcion TEXT,
  marca VARCHAR(255),
  cantidad VARCHAR(50),
  categoria_gpc VARCHAR(255),
  mercado VARCHAR(100),
  estado_producto VARCHAR(100),
  unidad_cantidad VARCHAR(50),
  producto_id UUID REFERENCES crm.productos(id) ON DELETE SET NULL,
  vinculado BOOLEAN DEFAULT FALSE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs1_catalogo_gtin ON crm.gs1_catalogo(gtin);
CREATE INDEX IF NOT EXISTS idx_gs1_catalogo_producto ON crm.gs1_catalogo(producto_id);
CREATE INDEX IF NOT EXISTS idx_gs1_catalogo_marca ON crm.gs1_catalogo(marca);