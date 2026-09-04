-- creado_por debe ser INTEGER (launcher usuarios.id es integer), no UUID
-- Nota: 030 original usó USING NULL y borró datos; ya reasignados. Para futuros entornos usar cast correcto.
ALTER TABLE crm.cotizaciones ALTER COLUMN creado_por TYPE INTEGER USING creado_por::integer;
ALTER TABLE crm.oportunidades ALTER COLUMN vendedor_id TYPE INTEGER USING vendedor_id::integer;
