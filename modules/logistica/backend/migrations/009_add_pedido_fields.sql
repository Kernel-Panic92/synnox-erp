ALTER TABLE logistics.pedidos_logistica ADD COLUMN IF NOT EXISTS valor_contado DECIMAL(15,2) DEFAULT 0;
ALTER TABLE logistics.pedidos_logistica ADD COLUMN IF NOT EXISTS conductor VARCHAR(100);
ALTER TABLE logistics.pedidos_logistica ADD COLUMN IF NOT EXISTS placa VARCHAR(10);
ALTER TABLE logistics.pedidos_logistica ADD COLUMN IF NOT EXISTS nro_guia VARCHAR(50);
