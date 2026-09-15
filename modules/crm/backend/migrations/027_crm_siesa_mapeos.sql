-- Mapeos CRM -> SIESA (códigos maestros)
CREATE TABLE IF NOT EXISTS crm.siesa_mapeos (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL,         -- condicion_pago, unidad_negocio, centro_costo, tipo_identificacion
  crm_codigo VARCHAR(100) NOT NULL,
  siesa_codigo VARCHAR(100) NOT NULL,
  descripcion TEXT,
  UNIQUE(tipo, crm_codigo)
);
CREATE INDEX IF NOT EXISTS idx_siesa_mapeos_tipo ON crm.siesa_mapeos(tipo);

-- Seed condición pago desde clientes (medio_pago_desc)
INSERT INTO crm.siesa_mapeos (tipo, crm_codigo, siesa_codigo, descripcion)
SELECT DISTINCT 'condicion_pago', COALESCE(medio_pago_desc, medio_pago), 
  CASE 
    WHEN UPPER(COALESCE(medio_pago_desc,'')) LIKE '%CONTADO%' OR UPPER(medio_pago)='CON' THEN '001'
    WHEN UPPER(medio_pago_desc) LIKE '%30%' THEN '030'
    WHEN UPPER(medio_pago_desc) LIKE '%15%' THEN '015'
    WHEN UPPER(medio_pago)='EFE' OR UPPER(medio_pago_desc)='EFECTIVO' THEN '001'
    ELSE COALESCE(medio_pago, '001')
  END,
  'Cond pago ' || COALESCE(medio_pago_desc, medio_pago)
FROM crm.clientes WHERE COALESCE(medio_pago_desc, medio_pago) IS NOT NULL
ON CONFLICT (tipo, crm_codigo) DO NOTHING;

-- Seed unidad_negocio desde tabla
INSERT INTO crm.siesa_mapeos (tipo, crm_codigo, siesa_codigo, descripcion)
SELECT 'unidad_negocio', codigo, 
  CASE codigo 
    WHEN 'PROD_CRUDOS' THEN '01'
    WHEN 'PROD_PROCESADOS' THEN '02'
    WHEN 'PROD_CARNICOS' THEN '03'
    ELSE SUBSTRING(codigo,1,5)
  END,
  nombre
FROM crm.unidades_negocio
ON CONFLICT (tipo, crm_codigo) DO NOTHING;

-- Seed centro_costo
INSERT INTO crm.siesa_mapeos (tipo, crm_codigo, siesa_codigo, descripcion)
SELECT 'centro_costo', codigo, SUBSTRING(codigo,1,8), nombre FROM crm.centros_costo
ON CONFLICT (tipo, crm_codigo) DO NOTHING;

-- Seed centros costo comunes si no existen
INSERT INTO crm.siesa_mapeos (tipo, crm_codigo, siesa_codigo) VALUES
  ('condicion_pago','EFECTIVO','001'),
  ('condicion_pago','CREDITO 30 DIAS','030'),
  ('unidad_negocio','PROD_CRUDOS','01')
ON CONFLICT DO NOTHING;
