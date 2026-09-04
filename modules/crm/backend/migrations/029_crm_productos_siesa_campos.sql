ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS siesa_id_item VARCHAR(50);
ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS siesa_id_impuesto VARCHAR(10) DEFAULT '19';
ALTER TABLE crm.productos ADD COLUMN IF NOT EXISTS siesa_es_inventariable BOOLEAN DEFAULT TRUE;
UPDATE crm.productos SET siesa_id_item = codigo WHERE siesa_id_item IS NULL;
