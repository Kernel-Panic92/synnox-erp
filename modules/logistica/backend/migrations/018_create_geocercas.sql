CREATE TABLE IF NOT EXISTS logistics.geocercas (
  id SERIAL PRIMARY KEY,
  widetech_id VARCHAR(50),
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(20) DEFAULT 'circular',
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  radio DECIMAL(10,2),
  poligono JSONB,
  color VARCHAR(7) DEFAULT '#3388ff',
  activa BOOLEAN DEFAULT true,
  fuente VARCHAR(20) DEFAULT 'widetech',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(widetech_id) WHERE widetech_id IS NOT NULL
);

CREATE TABLE IF NOT EXISTS logistics.alertas_geocerca (
  id SERIAL PRIMARY KEY,
  geocerca_id INT NOT NULL REFERENCES logistics.geocercas(id) ON DELETE CASCADE,
  vehiculo_id INT NOT NULL REFERENCES logistics.vehiculos(id),
  tipo VARCHAR(20) NOT NULL,
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geocercas_activa ON logistics.geocercas(activa);
CREATE INDEX IF NOT EXISTS idx_geocercas_widetech ON logistics.geocercas(widetech_id);
CREATE INDEX IF NOT EXISTS idx_geocercas_nombre ON logistics.geocercas USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_alertas_geocerca ON logistics.alertas_geocerca(geocerca_id);
CREATE INDEX IF NOT EXISTS idx_alertas_vehiculo ON logistics.alertas_geocerca(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_alertas_fecha ON logistics.alertas_geocerca(fecha);
