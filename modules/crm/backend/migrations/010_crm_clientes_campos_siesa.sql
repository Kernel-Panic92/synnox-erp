-- Campos faltantes del tercero SIESA
DO $$ BEGIN
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS departamento VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS cobrador VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS correo_fe VARCHAR(200);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS asesor_comercial VARCHAR(255);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS lista_precios VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS codigo_ean VARCHAR(50);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS sucursal_corporativa VARCHAR(50);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS razon_social VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
