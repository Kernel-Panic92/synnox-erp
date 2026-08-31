-- Maestros SIESA para perfil de ventas y cotizaciones
-- Lista de Precios ya existe (crm.listas_precio), Bodegas ya existe (crm.bodegas), Centros en Launcher

CREATE TABLE IF NOT EXISTS crm.motivos_venta (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS crm.tipos_documento (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS crm.centros_costo (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS crm.unidades_negocio (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  activo BOOLEAN DEFAULT TRUE
);

-- Config JSON para perfil de ventas: listas de precio permitidas, bodegas, etc.
ALTER TABLE crm.perfiles_venta ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Seed desde captura SIESA Vendedor generico
INSERT INTO crm.motivos_venta (codigo, nombre) VALUES ('VENTAS', 'VENTAS') ON CONFLICT DO NOTHING;
INSERT INTO crm.tipos_documento (codigo, nombre) VALUES ('PEDIDO_VENTA_CRM', 'PEDIDO DE VENTA CRM') ON CONFLICT DO NOTHING;

INSERT INTO crm.centros_costo (codigo, nombre) VALUES
  ('GENERICO','Generico'),
  ('GASTOS_GRALES_ADM','GASTOS GRALES ADM. FINANC - OFICINA CENTR'),
  ('CELULA_GERENCIAL','CELULA GERENCIAL'),
  ('CELULA_CONTABLE','CELULA CONTABLE'),
  ('CELULA_RRHH','CELULA RRHH'),
  ('CELULA_ERP','CELULA ERP SISTEMAS'),
  ('SERV_COMERCIALES_NA','SERVICIOS COMERCIALES N/A')
ON CONFLICT DO NOTHING;

INSERT INTO crm.unidades_negocio (codigo, nombre) VALUES
  ('PROD_CRUDOS','PRODUCCION CRUDOS (PESCADOS Y MARISCOS)'),
  ('PROD_PROCESADOS','PRODUCCION PROCESADOS(PESCADOS-MARISCOS)'),
  ('PROD_CARNICOS','PRODUCCION PRODUCTOS CARNICOS')
ON CONFLICT DO NOTHING;
