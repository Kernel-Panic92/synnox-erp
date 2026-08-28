-- Campo para ID del tercero en ERP
DO $$ BEGIN
  ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS erp_tercero_id VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
