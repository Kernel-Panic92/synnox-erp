-- creado_por debe ser INTEGER (launcher usuarios.id es integer), no UUID
ALTER TABLE crm.cotizaciones ALTER COLUMN creado_por TYPE INTEGER USING NULL;
ALTER TABLE crm.oportunidades ALTER COLUMN vendedor_id TYPE INTEGER USING NULL;
