CREATE SCHEMA IF NOT EXISTS crm;

-- Extension para busqueda fuzzy
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Empresas / Clientes potenciales y reales
CREATE TABLE IF NOT EXISTS crm.empresas (
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

CREATE INDEX IF NOT EXISTS idx_empresas_nombre ON crm.empresas USING gin(nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_empresas_nit ON crm.empresas(nit);
CREATE INDEX IF NOT EXISTS idx_empresas_tipo ON crm.empresas(tipo);
CREATE INDEX IF NOT EXISTS idx_empresas_vendedor ON crm.empresas(vendedor_asignado);
CREATE INDEX IF NOT EXISTS idx_empresas_codigo_siesa ON crm.empresas(codigo_siesa);
CREATE INDEX IF NOT EXISTS idx_empresas_ciudad ON crm.empresas(ciudad);
CREATE INDEX IF NOT EXISTS idx_empresas_activo ON crm.empresas(activo);

-- Contactos (personas dentro de la empresa)
CREATE TABLE IF NOT EXISTS crm.contactos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID REFERENCES crm.empresas(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_contactos_empresa ON crm.contactos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contactos_nombre ON crm.contactos USING gin(nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contactos_email ON crm.contactos(email);
CREATE INDEX IF NOT EXISTS idx_contactos_activo ON crm.contactos(activo);
