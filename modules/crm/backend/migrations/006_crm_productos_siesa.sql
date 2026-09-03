-- Productos + Bodegas + Campos SIESA en cotizaciones

-- Productos del catalogo
CREATE TABLE IF NOT EXISTS crm.productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  unidad_medida VARCHAR(20) DEFAULT 'UND',
  precio_unitario DECIMAL(15,2) DEFAULT 0,
  tasa_impuesto DECIMAL(5,2) DEFAULT 0,
  categoria VARCHAR(100),
  bodega VARCHAR(100),
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productos_codigo ON crm.productos(codigo);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON crm.productos USING gin(nombre gin_trgm_ops);

-- Bodegas
CREATE TABLE IF NOT EXISTS crm.bodegas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  ciudad VARCHAR(100),
  activa BOOLEAN DEFAULT TRUE
);

-- Campos SIESA en cotizaciones
DO $$ BEGIN
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS orden_compra VARCHAR(50);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS fecha_entrega DATE;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS centro_operacion VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS bodega VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS centro_costo VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS condicion_pago VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS motivo VARCHAR(100) DEFAULT 'VENTAS';
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS unidad_negocio VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS vendedor_nombre VARCHAR(255);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS punto_envio VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(100) DEFAULT 'PEDIDO DE VENTA CRM';
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS documento_erp VARCHAR(50);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS estado_erp VARCHAR(50);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS aprobado BOOLEAN DEFAULT FALSE;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS propietario VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Referencia SIESA en items de cotizacion
DO $$ BEGIN
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS referencia VARCHAR(50);
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(20) DEFAULT 'UND';
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS id_ext1 VARCHAR(50);
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS id_ext2 VARCHAR(50);
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS estado_item VARCHAR(50);
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS cantidad_remisionada DECIMAL(10,2) DEFAULT 0;
  ALTER TABLE crm.cotizacion_items ADD COLUMN IF NOT EXISTS cantidad_pendiente DECIMAL(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
