-- Campos GS1 en productos
DO $$ BEGIN
  ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS gtin VARCHAR(50);
  ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS foto_url VARCHAR(500);
  ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS marca VARCHAR(100);
  ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS descripcion_gs1 TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_productos_gtin ON crm.productos(gtin);
