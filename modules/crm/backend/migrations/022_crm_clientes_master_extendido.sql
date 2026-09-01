-- Master extendido Clientes ERP.csv (39 cols) — 2026-09-01
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS celular VARCHAR(30);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS lista_precio_codigo VARCHAR(20);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS medio_pago VARCHAR(20);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS medio_pago_desc VARCHAR(100);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS iva VARCHAR(30);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS frecuencia_entrega VARCHAR(100);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS fecha_ingreso DATE;
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS sucursal VARCHAR(20);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS vendedor_codigo VARCHAR(20);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS cartera_pendiente VARCHAR(20);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS antiguedad VARCHAR(30);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS punto_envio_desc VARCHAR(255);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS motivo_bloqueo_desc VARCHAR(255);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS c_o_factura_desc VARCHAR(255);
ALTER TABLE crm.clientes ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_clientes_lista_precio_codigo ON crm.clientes(lista_precio_codigo);
CREATE INDEX IF NOT EXISTS idx_clientes_vendedor_codigo ON crm.clientes(vendedor_codigo);
