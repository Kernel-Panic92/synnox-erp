-- FASE 1 permisos: crear perfiles Gerencia/Comercial que 017 nunca sembró
-- (su guard WHERE NOT EXISTS falló porque Vendedor Generico ya existía).
-- Idempotente: corre en cada arranque vía run.js sin tocar asignaciones manuales.
INSERT INTO crm.perfiles_venta (nombre, descripcion)
SELECT v.nombre, v.descripcion FROM (VALUES
  ('CRM - Gerencia', 'Gerencia comercial: acceso total + configurar (gestionado en CRM Admin)'),
  ('CRM - Comercial', 'Comercial: cotizar y pipeline, sin aprobar ni configurar')
) AS v(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM crm.perfiles_venta pv WHERE pv.nombre = v.nombre)
ON CONFLICT (nombre) DO NOTHING;

-- Permisos Gerencia 5/6 (sin siesa_sync, eliminado FASE 1)
INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso)
SELECT pv.id, perm FROM crm.perfiles_venta pv
CROSS JOIN (VALUES ('crear_cotizacion'),('aprobar_descuento'),('configurar'),('ver_pipeline'),('editar_pipeline')) AS p(perm)
WHERE pv.nombre = 'CRM - Gerencia'
ON CONFLICT DO NOTHING;

-- Permisos Comercial 3/6
INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso)
SELECT pv.id, perm FROM crm.perfiles_venta pv
CROSS JOIN (VALUES ('crear_cotizacion'),('ver_pipeline'),('editar_pipeline')) AS p(perm)
WHERE pv.nombre = 'CRM - Comercial'
ON CONFLICT DO NOTHING;
