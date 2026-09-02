-- Leads + Inventario + Campos SIESA en clientes

-- Leads (clientes potenciales)
CREATE TABLE IF NOT EXISTS crm.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raison_social VARCHAR(255),
  numero_identificacion VARCHAR(30),
  tipo_identificacion VARCHAR(20),
  asesor_comercial VARCHAR(255),
  nombre_establecimiento VARCHAR(255),
  direccion TEXT,
  ciudad VARCHAR(100),
  departamento VARCHAR(100),
  pais VARCHAR(100),
  email VARCHAR(200),
  telefono VARCHAR(30),
  telefono_alternativo VARCHAR(30),
  canal VARCHAR(100),
  segmento VARCHAR(100),
  tipo_negocio VARCHAR(100),
  tipo_cliente VARCHAR(50),
  tamano VARCHAR(50),
  lista_precios VARCHAR(100),
  condicion_pago VARCHAR(100),
  productos_interes TEXT,
  medio_captacion VARCHAR(100),
  fuente_registro VARCHAR(100),
  estado VARCHAR(50) DEFAULT 'activo',
  scoring INTEGER,
  notas TEXT,
  cliente_convertido BOOLEAN DEFAULT FALSE,
  fecha_conversion DATE,
  fecha_creacion_siesa DATE,
  siesa_id VARCHAR(100),
  cliente_id UUID REFERENCES crm.clientes(id),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_identificacion ON crm.leads(numero_identificacion);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON crm.leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_asesor ON crm.leads(asesor_comercial);

-- Inventario por bodega
CREATE TABLE IF NOT EXISTS crm.inventario (
  id SERIAL PRIMARY KEY,
  producto_id UUID REFERENCES crm.productos(id),
  bodega VARCHAR(100) NOT NULL,
  precio DECIMAL(15,2) DEFAULT 0,
  disponibilidad DECIMAL(10,2) DEFAULT 0,
  existencia DECIMAL(10,2) DEFAULT 0,
  comprometida DECIMAL(10,2) DEFAULT 0,
  unidad_medida VARCHAR(20),
  extension_1 VARCHAR(100),
  extension_1_desc VARCHAR(255),
  extension_2 VARCHAR(100),
  extension_2_desc VARCHAR(255),
  sincronizado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, bodega)
);

CREATE INDEX IF NOT EXISTS idx_inventario_producto ON crm.inventario(producto_id);
CREATE INDEX IF NOT EXISTS idx_inventario_bodega ON crm.inventario(bodega);

-- Listas de precio
CREATE TABLE IF NOT EXISTS crm.listas_precio (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  moneda VARCHAR(3) DEFAULT 'COP',
  activa BOOLEAN DEFAULT TRUE,
  sincronizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm.lista_precio_items (
  id SERIAL PRIMARY KEY,
  lista_id INTEGER REFERENCES crm.listas_precio(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES crm.productos(id),
  precio DECIMAL(15,2) NOT NULL,
  moneda VARCHAR(3) DEFAULT 'COP',
  vigente_desde DATE,
  vigente_hasta DATE,
  UNIQUE(lista_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_lpi_lista ON crm.lista_precio_items(lista_id);
CREATE INDEX IF NOT EXISTS idx_lpi_producto ON crm.lista_precio_items(producto_id);

-- Campos SIESA en clientes
DO $$ BEGIN
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS codigo_siesa VARCHAR(30);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS canal VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS ruta_vehiculos VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS ruta_motos VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS tipo_negocio VARCHAR(100);
  ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS identificacion VARCHAR(30);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Campos SIESA en cotizaciones (algunos ya existen de migration 006)
DO $$ BEGIN
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS lista_precios VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS center_costo VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS punto_envio_nombre VARCHAR(255);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS descuento_global_pct DECIMAL(5,2) DEFAULT 0;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS valor_bruto DECIMAL(15,2) DEFAULT 0;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS tasa_conversion DECIMAL(10,4) DEFAULT 1;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS consecutive_siesa VARCHAR(50);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS enviado_erp BOOLEAN DEFAULT FALSE;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS fecha_envio_erp TIMESTAMPTZ;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS estado_siesa VARCHAR(50);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS aprobado BOOLEAN DEFAULT FALSE;
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS motivo VARCHAR(100);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS unidad_negocio VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
