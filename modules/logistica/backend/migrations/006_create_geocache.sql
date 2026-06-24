CREATE TABLE IF NOT EXISTS logistics.cache_geocoding (
  id SERIAL PRIMARY KEY,
  direccion_hash VARCHAR(64) UNIQUE NOT NULL,
  direccion_original TEXT NOT NULL,
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  display_name TEXT,
  es_exacto BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geocache_hash ON logistics.cache_geocoding(direccion_hash);
