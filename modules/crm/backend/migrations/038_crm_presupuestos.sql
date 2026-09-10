-- Presupuesto mensual por asesor (dirección comercial asigna, asesor ve cumplimiento).
-- Lo real se calcula vivo desde oportunidades ganadas; aquí solo vive la meta.
CREATE TABLE IF NOT EXISTS crm.presupuestos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id INTEGER NOT NULL,
  periodo VARCHAR(7) NOT NULL,
  presupuesto NUMERIC(15,2) NOT NULL DEFAULT 0,
  centro VARCHAR(10),
  creado_por INTEGER,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT presupuestos_periodo_fmt CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT presupuestos_monto_check CHECK (presupuesto >= 0),
  CONSTRAINT presupuestos_usuario_periodo_uniq UNIQUE (usuario_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_presupuestos_periodo ON crm.presupuestos(periodo);
CREATE INDEX IF NOT EXISTS idx_presupuestos_usuario ON crm.presupuestos(usuario_id);
