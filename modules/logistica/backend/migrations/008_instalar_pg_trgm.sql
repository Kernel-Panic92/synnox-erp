CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_clientes_nombre_trgm ON logistics.clientes USING GIN (nombre gin_trgm_ops);
