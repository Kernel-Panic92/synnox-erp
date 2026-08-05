CREATE TABLE IF NOT EXISTS logistics.devoluciones (
  id SERIAL PRIMARY KEY,
  fuente VARCHAR(20) NOT NULL DEFAULT 'smart2go',
  fuente_id VARCHAR(100),
  fecha_reporte DATE NOT NULL,
  hora_reporte TIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  centro_operaciones VARCHAR(50),
  cliente_nombre VARCHAR(200) NOT NULL,
  sucursal VARCHAR(200),
  latitud DECIMAL(10,8),
  longitud DECIMAL(11,8),
  direccion TEXT,
  documento_devolucion VARCHAR(100),
  quien_recibe VARCHAR(200),
  mercaderista VARCHAR(200),
  productos JSONB DEFAULT '[]',
  productos_texto TEXT,
  valor_total DECIMAL(12,2),
  causa VARCHAR(100) NOT NULL,
  causa_detalle TEXT,
  entregado_conductor BOOLEAN DEFAULT FALSE,
  conductor_nombre VARCHAR(200),
  conductor_placa VARCHAR(20),
  foto_url TEXT,
  pedido_id INTEGER,
  numero_factura VARCHAR(100),
  estado VARCHAR(20) DEFAULT 'registrada',
  creado_por INTEGER,
  CONSTRAINT fk_devoluciones_pedido FOREIGN KEY (pedido_id)
    REFERENCES logistics.pedidos_logistica(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_devoluciones_fecha ON logistics.devoluciones(fecha_reporte);
CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente ON logistics.devoluciones(cliente_nombre);
CREATE INDEX IF NOT EXISTS idx_devoluciones_causa ON logistics.devoluciones(causa);
CREATE INDEX IF NOT EXISTS idx_devoluciones_centro ON logistics.devoluciones(centro_operaciones);
CREATE INDEX IF NOT EXISTS idx_devoluciones_estado ON logistics.devoluciones(estado);
CREATE INDEX IF NOT EXISTS idx_devoluciones_fuente ON logistics.devoluciones(fuente);
CREATE INDEX IF NOT EXISTS idx_devoluciones_pedido ON logistics.devoluciones(pedido_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_factura ON logistics.devoluciones(numero_factura);
