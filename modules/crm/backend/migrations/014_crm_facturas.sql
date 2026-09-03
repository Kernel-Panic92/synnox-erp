-- Facturas del ERP (solo lectura, sincronizado via API)
CREATE TABLE IF NOT EXISTS crm.facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES crm.clientes(id),
  numero VARCHAR(50) UNIQUE,
  estado VARCHAR(50),
  fecha DATE,
  fecha_vencimiento DATE,
  moneda VARCHAR(3) DEFAULT 'COP',
  valor_bruto DECIMAL(15,2) DEFAULT 0,
  valor_descuentos DECIMAL(15,2) DEFAULT 0,
  valor_subtotal DECIMAL(15,2) DEFAULT 0,
  valor_impuestos DECIMAL(15,2) DEFAULT 0,
  valor_total DECIMAL(15,2) DEFAULT 0,
  condicion_pago VARCHAR(100),
  centro_operacion VARCHAR(100),
  notas TEXT,
  erp_sync_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON crm.facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_numero ON crm.facturas(numero);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON crm.facturas(estado);
