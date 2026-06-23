CREATE SCHEMA IF NOT EXISTS logistics;

CREATE TABLE IF NOT EXISTS logistics.vehiculos (
  id SERIAL PRIMARY KEY,
  placa VARCHAR(10) UNIQUE NOT NULL,
  alias VARCHAR(50),
  capacidad_peso DECIMAL(10,2) DEFAULT 5000.00,
  capacidad_volumen DECIMAL(10,2) DEFAULT 20.00,
  sede VARCHAR(50),
  estado VARCHAR(20) DEFAULT 'disponible',
  ultima_posicion_lat DECIMAL(10,8),
  ultima_posicion_lng DECIMAL(10,8),
  ultima_actualizacion TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logistics.rutas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100),
  fecha DATE NOT NULL,
  vehiculo_id INT NOT NULL,
  conductor_id INT,
  conductor_nombre VARCHAR(255),
  sede VARCHAR(50),
  distancia_total_estimada DECIMAL(10,2),
  distancia_total_real DECIMAL(10,2),
  tiempo_estimado INT,
  tiempo_real INT,
  estado VARCHAR(20) DEFAULT 'planificada',
  cantidad_paradas INT,
  paradas_completadas INT DEFAULT 0,
  paradas_fallidas INT DEFAULT 0,
  hora_inicio_estimada TIME,
  hora_inicio_real TIMESTAMP,
  hora_fin_estimada TIME,
  hora_fin_real TIMESTAMP,
  eficiencia DECIMAL(5,2),
  nota TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehiculo_id) REFERENCES logistics.vehiculos(id)
);

CREATE TABLE IF NOT EXISTS logistics.pedidos_logistica (
  id SERIAL PRIMARY KEY,
  numero_factura VARCHAR(20) UNIQUE NOT NULL,
  cliente_nombre VARCHAR(255),
  direccion VARCHAR(500),
  ciudad VARCHAR(100),
  barrio VARCHAR(100),
  telefono VARCHAR(20),
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  valor_credito DECIMAL(15,2),
  tipo_cliente VARCHAR(20) DEFAULT 'REGULAR',
  cita_entrega TIMESTAMP NULL,
  ventana_horaria_inicio TIME DEFAULT '09:00:00',
  ventana_horaria_fin TIME DEFAULT '18:00:00',
  estado VARCHAR(20) DEFAULT 'pendiente',
  ruta_id INT,
  secuencia_en_ruta INT,
  peso_estimado DECIMAL(10,2) DEFAULT 0,
  volumen_estimado DECIMAL(10,2) DEFAULT 0,
  nota_entrega TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ruta_id) REFERENCES logistics.rutas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS logistics.paradas_ruta (
  id SERIAL PRIMARY KEY,
  ruta_id INT NOT NULL,
  pedido_id INT NOT NULL,
  secuencia INT NOT NULL,
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  direccion VARCHAR(500),
  cliente_nombre VARCHAR(255),
  hora_estimada TIMESTAMP,
  hora_llegada TIMESTAMP,
  hora_salida TIMESTAMP,
  tiempo_en_parada INT,
  estado VARCHAR(20) DEFAULT 'pendiente',
  razon_fallo VARCHAR(255),
  firma_cliente TEXT,
  nota TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ruta_id) REFERENCES logistics.rutas(id) ON DELETE CASCADE,
  FOREIGN KEY (pedido_id) REFERENCES logistics.pedidos_logistica(id)
);

CREATE TABLE IF NOT EXISTS logistics.posiciones_gps (
  id SERIAL PRIMARY KEY,
  vehiculo_id INT NOT NULL,
  fecha_gps TIMESTAMP NOT NULL,
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  localizacion VARCHAR(500),
  velocidad DECIMAL(5,2),
  rumbo VARCHAR(50),
  temp_sensor1 DECIMAL(5,2),
  temp_sensor2 DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehiculo_id) REFERENCES logistics.vehiculos(id)
);

CREATE TABLE IF NOT EXISTS logistics.historico_eficiencia (
  id SERIAL PRIMARY KEY,
  ruta_id INT,
  vehiculo_id INT,
  conductor_id INT,
  fecha DATE,
  paradas_planificadas INT,
  paradas_completadas INT,
  paradas_fallidas INT,
  distancia_planificada DECIMAL(10,2),
  distancia_real DECIMAL(10,2),
  tiempo_planificado INT,
  tiempo_real INT,
  tasa_exito DECIMAL(5,2),
  eficiencia_distancia DECIMAL(5,2),
  eficiencia_tiempo DECIMAL(5,2),
  nota TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ruta_id) REFERENCES logistics.rutas(id),
  FOREIGN KEY (vehiculo_id) REFERENCES logistics.vehiculos(id)
);

CREATE TABLE IF NOT EXISTS logistics.importaciones (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50),
  nombre_archivo VARCHAR(255),
  fecha_importacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  registros_importados INT,
  registros_fallidos INT,
  estado VARCHAR(20),
  detalles JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON logistics.pedidos_logistica(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_ruta ON logistics.pedidos_logistica(ruta_id);
CREATE INDEX IF NOT EXISTS idx_rutas_fecha ON logistics.rutas(fecha);
CREATE INDEX IF NOT EXISTS idx_rutas_vehiculo ON logistics.rutas(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_rutas_estado ON logistics.rutas(estado);
CREATE INDEX IF NOT EXISTS idx_paradas_ruta ON logistics.paradas_ruta(ruta_id);
CREATE INDEX IF NOT EXISTS idx_paradas_estado ON logistics.paradas_ruta(estado);
CREATE INDEX IF NOT EXISTS idx_posiciones_vehiculo_fecha ON logistics.posiciones_gps(vehiculo_id, fecha_gps);
