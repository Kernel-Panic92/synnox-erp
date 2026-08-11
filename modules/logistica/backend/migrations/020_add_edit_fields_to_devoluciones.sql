ALTER TABLE logistics.devoluciones ADD COLUMN IF NOT EXISTS editado_por INTEGER;
ALTER TABLE logistics.devoluciones ADD COLUMN IF NOT EXISTS edit_comentario TEXT;
ALTER TABLE logistics.devoluciones ADD COLUMN IF NOT EXISTS editado_en TIMESTAMP;
