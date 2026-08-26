-- Sucursales de clientes
CREATE TABLE IF NOT EXISTS crm.sucursales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL REFERENCES crm.clientes(id) ON DELETE CASCADE,
  codigo VARCHAR(30),
  nombre VARCHAR(255) NOT NULL,
  direccion TEXT,
  ciudad VARCHAR(100),
  departamento VARCHAR(100),
  telefono VARCHAR(30),
  email VARCHAR(200),
  contacto_nombre VARCHAR(255),
  es_principal BOOLEAN DEFAULT FALSE,
  notas TEXT,
  activa BOOLEAN DEFAULT TRUE,
  siesa_id VARCHAR(100),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sucursales_cliente ON crm.sucursales(cliente_id);
CREATE INDEX IF NOT EXISTS idx_sucursales_codigo ON crm.sucursales(codigo);

-- Campo sucursal en cotizaciones
DO $$ BEGIN
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES crm.sucursales(id);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS facturar_a VARCHAR(255);
  ALTER TABLE crm.cotizaciones ADD COLUMN IF NOT EXISTS despachar_a VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Campo sucursal en contactos
DO $$ BEGIN
  ALTER TABLE crm.contactos ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES crm.sucursales(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
