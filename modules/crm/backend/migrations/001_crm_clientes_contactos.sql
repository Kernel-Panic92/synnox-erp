CREATE SCHEMA IF NOT EXISTS crm;

-- Extension para busqueda fuzzy
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Clientes / Clientes potenciales y reales
CREATE TABLE IF NOT EXISTS crm.clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(255) NOT NULL,
  nit VARCHAR(30),
  tipo VARCHAR(20) CHECK (tipo IN ('potencial','real','siesa')),
  sector VARCHAR(100),
  direccion TEXT,
  ciudad VARCHAR(100),
  latitud DECIMAL(10,8),
  longitud DECIMAL(10,8),
  telefono VARCHAR(30),
  email VARCHAR(200),
  website VARCHAR(300),
  codigo_siesa VARCHAR(30),
  vendedor_asignado INTEGER,
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  origen VARCHAR(50) DEFAULT 'manual',
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON crm.clientes USING gin(nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_nit ON crm.clientes(nit);
CREATE INDEX IF NOT EXISTS idx_clientes_tipo ON crm.clientes(tipo);
CREATE INDEX IF NOT EXISTS idx_clientes_vendedor ON crm.clientes(vendedor_asignado);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo_siesa ON crm.clientes(codigo_siesa);
CREATE INDEX IF NOT EXISTS idx_clientes_ciudad ON crm.clientes(ciudad);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON crm.clientes(activo);

-- Contactos (personas dentro de la cliente)
CREATE TABLE IF NOT EXISTS crm.contactos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  cargo VARCHAR(100),
  email VARCHAR(200),
  telefono VARCHAR(30),
  whatsapp VARCHAR(30),
  es_decision_maker BOOLEAN DEFAULT FALSE,
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contactos_cliente ON crm.contactos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_contactos_nombre ON crm.contactos USING gin(nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contactos_email ON crm.contactos(email);
CREATE INDEX IF NOT EXISTS idx_contactos_activo ON crm.contactos(activo);
