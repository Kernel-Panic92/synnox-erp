-- creado_por debe ser INTEGER (launcher usuarios.id es integer), no UUID.
-- Idempotente y seguro en cualquier estado:
--   * instalación limpia → tablas vacías, el ALTER aplica directo;
--   * dev ya migrado → columna ya INTEGER, se omite;
--   * estados intermedios con UUIDs legacy → esos valores nunca fueron ids
--     de launcher válidos, se llevan a NULL en vez de romper la migración.
-- Nota: uuid no tiene cast directo a integer (error 42846), por eso se pasa
-- por ::text y se filtran los no numéricos antes del ALTER. El 030 original
-- usaba USING NULL y borraba datos sin discriminar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'cotizaciones'
      AND column_name = 'creado_por' AND udt_name = 'uuid'
  ) THEN
    UPDATE crm.cotizaciones SET creado_por = NULL
      WHERE creado_por IS NOT NULL AND creado_por::text !~ '^[0-9]+$';
    ALTER TABLE crm.cotizaciones
      ALTER COLUMN creado_por TYPE INTEGER USING (creado_por::text)::integer;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'oportunidades'
      AND column_name = 'vendedor_id' AND udt_name = 'uuid'
  ) THEN
    UPDATE crm.oportunidades SET vendedor_id = NULL
      WHERE vendedor_id IS NOT NULL AND vendedor_id::text !~ '^[0-9]+$';
    ALTER TABLE crm.oportunidades
      ALTER COLUMN vendedor_id TYPE INTEGER USING (vendedor_id::text)::integer;
  END IF;
END $$;
