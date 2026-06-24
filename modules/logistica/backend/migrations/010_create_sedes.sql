CREATE TABLE IF NOT EXISTS logistics.sedes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) UNIQUE NOT NULL,
  direccion VARCHAR(500),
  ciudad VARCHAR(100),
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  telefono VARCHAR(50),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sedes_nombre ON logistics.sedes(nombre);
CREATE INDEX IF NOT EXISTS idx_sedes_ciudad ON logistics.sedes(ciudad);
