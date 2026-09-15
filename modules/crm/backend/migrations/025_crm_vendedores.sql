-- Vendedores SIESA y mapping usuario -> codigo_vendedor (preparación SIESA Hub)
CREATE TABLE IF NOT EXISTS crm.vendedores (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  cobrador BOOLEAN DEFAULT FALSE,
  es_vendedor BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_vendedores_nombre ON crm.vendedores(nombre);

-- Mapping por asignación de perfil de ventas: un usuario puede tener un vendedor SIESA por cada perfil asignado
ALTER TABLE crm.usuario_perfil_venta ADD COLUMN IF NOT EXISTS codigo_vendedor VARCHAR(50) REFERENCES crm.vendedores(codigo);
CREATE INDEX IF NOT EXISTS idx_crm_upv_codigo_vendedor ON crm.usuario_perfil_venta(codigo_vendedor);

-- Migrar vendedores existentes guardados en crm.configuracion (clave vendedor_XXX) -> crm.vendedores
DO $$
DECLARE r RECORD;
DECLARE j JSONB;
BEGIN
  FOR r IN SELECT clave, valor FROM crm.configuracion WHERE clave LIKE 'vendedor_%' LOOP
    BEGIN
      j := r.valor::jsonb;
      INSERT INTO crm.vendedores (codigo, nombre, cobrador, es_vendedor, activo)
      VALUES (
        COALESCE(j->>'codigo', replace(r.clave, 'vendedor_', '')),
        COALESCE(j->>'nombre', j->>'codigo', replace(r.clave, 'vendedor_', '')),
        COALESCE((j->>'cobrador')::boolean, false),
        COALESCE((j->>'vendedor')::boolean, true),
        true
      ) ON CONFLICT (codigo) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        cobrador = EXCLUDED.cobrador,
        es_vendedor = EXCLUDED.es_vendedor;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
  END LOOP;
END $$;
