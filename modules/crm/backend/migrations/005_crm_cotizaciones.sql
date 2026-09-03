-- Cotizaciones + Items + Descuentos + Config
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Cotizaciones
CREATE TABLE IF NOT EXISTS crm.cotizaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oportunidad_id UUID REFERENCES crm.oportunidades(id),
  cliente_id UUID REFERENCES crm.clientes(id),
  numero VARCHAR(50) UNIQUE,
  estado VARCHAR(20) CHECK (estado IN (
    'borrador','enviada','aprobada','rechazada',
    'vencida','convertida'
  )) DEFAULT 'borrador',
  valor_subtotal DECIMAL(15,2) DEFAULT 0,
  valor_descuento DECIMAL(15,2) DEFAULT 0,
  valor_iva DECIMAL(15,2) DEFAULT 0,
  valor_total DECIMAL(15,2) DEFAULT 0,
  moneda VARCHAR(3) DEFAULT 'COP',
  validez_dias SMALLINT DEFAULT 30,
  notas TEXT,
  archivo_pdf VARCHAR(500),
  enviado_en TIMESTAMPTZ,
  aprobada_en TIMESTAMPTZ,
  vencimiento DATE,
  creado_por UUID,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente ON crm.cotizaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_oportunidad ON crm.cotizaciones(oportunidad_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON crm.cotizaciones(estado);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_numero ON crm.cotizaciones(numero);

-- Items de cotizacion
CREATE TABLE IF NOT EXISTS crm.cotizacion_items (
  id SERIAL PRIMARY KEY,
  cotizacion_id UUID REFERENCES crm.cotizaciones(id) ON DELETE CASCADE,
  descripcion VARCHAR(500) NOT NULL,
  cantidad DECIMAL(10,2) DEFAULT 1,
  precio_unitario DECIMAL(15,2) DEFAULT 0,
  descuento_pct DECIMAL(5,2) DEFAULT 0,
  subtotal DECIMAL(15,2) DEFAULT 0,
  orden SMALLINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cotizacion_items_cotizacion ON crm.cotizacion_items(cotizacion_id);

-- Solicitudes de descuento
CREATE TABLE IF NOT EXISTS crm.descuentos_solicitud (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cotizacion_id UUID REFERENCES crm.cotizaciones(id),
  cliente_id UUID REFERENCES crm.clientes(id),
  solicitado_por UUID NOT NULL,
  tipo VARCHAR(20) CHECK (tipo IN ('porcentaje','monto_fijo')),
  valor_descuento DECIMAL(15,2) NOT NULL,
  monto_original DECIMAL(15,2) NOT NULL,
  monto_final DECIMAL(15,2) NOT NULL,
  justificacion TEXT,
  estado VARCHAR(20) CHECK (estado IN (
    'pendiente','aprobado','rechazado','auto_aprobado'
  )) DEFAULT 'pendiente',
  aprobado_por UUID,
  motivo_rechazo TEXT,
  umbral_aplicado DECIMAL(5,2),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  resuelto_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_descuentos_estado ON crm.descuentos_solicitud(estado);
CREATE INDEX IF NOT EXISTS idx_descuentos_cotizacion ON crm.descuentos_solicitud(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_descuentos_cliente ON crm.descuentos_solicitud(cliente_id);

-- Configuracion del modulo
CREATE TABLE IF NOT EXISTS crm.configuracion (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT,
  descripcion TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO crm.configuracion (clave, valor, descripcion) VALUES
  ('descuento_umbral_aprobacion', '10', 'Porcentaje maximo para aprobacion automatica'),
  ('numero_cotizacion_prefijo', 'COT', 'Prefijo para numeracion de cotizaciones'),
  ('numero_cotizacion_consecutivo', '1', 'Consecutivo actual de cotizaciones'),
  ('iva_porcentaje', '19', 'Porcentaje de IVA por defecto')
ON CONFLICT (clave) DO NOTHING;
