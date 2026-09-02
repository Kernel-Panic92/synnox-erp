-- Renombrar empresas a clientes (idempotente)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'crm' AND table_name = 'empresas'
  ) THEN
    ALTER TABLE crm.empresas RENAME TO clientes;
  END IF;
END $$;

-- Renombrar secuencia si aplica
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.sequences
    WHERE sequence_schema = 'crm' AND sequence_name = 'empresas_id_seq'
  ) THEN
    ALTER SEQUENCE crm.empresas_id_seq RENAME TO clientes_id_seq;
  END IF;
END $$;

-- Renombrar columnas foreign key en tablas relacionadas (idempotente)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'contactos' AND column_name = 'empresa_id'
  ) THEN
    ALTER TABLE crm.contactos RENAME COLUMN empresa_id TO cliente_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'oportunidades' AND column_name = 'empresa_id'
  ) THEN
    ALTER TABLE crm.oportunidades RENAME COLUMN empresa_id TO cliente_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'visitas' AND column_name = 'empresa_id'
  ) THEN
    ALTER TABLE crm.visitas RENAME COLUMN empresa_id TO cliente_id;
  END IF;
END $$;

-- Actualizar foreign keys (idempotente: borrar ambos nombres)
ALTER TABLE IF EXISTS crm.contactos
  DROP CONSTRAINT IF EXISTS contactos_empresa_id_fkey,
  DROP CONSTRAINT IF EXISTS contactos_cliente_id_fkey;
ALTER TABLE IF EXISTS crm.contactos
  ADD CONSTRAINT contactos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES crm.clientes(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS crm.oportunidades
  DROP CONSTRAINT IF EXISTS oportunidades_empresa_id_fkey,
  DROP CONSTRAINT IF EXISTS oportunidades_cliente_id_fkey;
ALTER TABLE IF EXISTS crm.oportunidades
  ADD CONSTRAINT oportunidades_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES crm.clientes(id);

ALTER TABLE IF EXISTS crm.visitas
  DROP CONSTRAINT IF EXISTS visitas_empresa_id_fkey,
  DROP CONSTRAINT IF EXISTS visitas_cliente_id_fkey;
ALTER TABLE IF EXISTS crm.visitas
  ADD CONSTRAINT visitas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES crm.clientes(id);

-- Actualizar indices si existen
DO $$
BEGIN
  BEGIN
    ALTER INDEX crm.idx_empresas_nombre RENAME TO idx_clientes_nombre;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER INDEX crm.idx_empresas_nit RENAME TO idx_clientes_nit;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER INDEX crm.idx_empresas_tipo RENAME TO idx_clientes_tipo;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER INDEX crm.idx_empresas_vendedor RENAME TO idx_clientes_vendedor;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER INDEX crm.idx_empresas_codigo_siesa RENAME TO idx_clientes_codigo_siesa;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER INDEX crm.idx_empresas_ciudad RENAME TO idx_clientes_ciudad;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER INDEX crm.idx_empresas_activo RENAME TO idx_clientes_activo;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Recrear vista resumen con nueva columna
DROP VIEW IF EXISTS crm.visitas_resumen_diario;
CREATE VIEW crm.visitas_resumen_diario AS
SELECT
  v.vendedor_id,
  DATE(v.fecha) AS fecha,
  COUNT(*) FILTER (WHERE v.tipo = 'checkin') AS total_checkins,
  COUNT(DISTINCT v.cliente_id) AS clientes_visitados,
  MIN(v.fecha) AS primera_visita,
  MAX(v.fecha) AS ultima_visita
FROM crm.visitas v
GROUP BY v.vendedor_id, DATE(v.fecha);
