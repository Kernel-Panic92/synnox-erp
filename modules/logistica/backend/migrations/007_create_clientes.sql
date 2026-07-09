CREATE TABLE IF NOT EXISTS logistics.clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) UNIQUE NOT NULL,
  direccion VARCHAR(500),
  ciudad VARCHAR(100),
  telefono VARCHAR(20),
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  geocodificado BOOLEAN DEFAULT FALSE,
  ultima_importacion TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE logistics.pedidos_logistica ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES logistics.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON logistics.clientes(nombre);
