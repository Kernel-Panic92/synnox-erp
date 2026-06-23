ALTER TABLE logistics.pedidos_logistica ADD COLUMN IF NOT EXISTS vehiculo_id INT REFERENCES logistics.vehiculos(id);
