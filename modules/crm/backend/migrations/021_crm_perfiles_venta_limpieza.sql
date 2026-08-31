-- Limpieza: perfil de ventas solo con permisos comerciales (sin duplicar launcher)
-- Launcher ya gestiona ver, crear_contacto, etc. CRM solo necesita 6 comerciales
DELETE FROM crm.perfil_venta_permisos WHERE permiso NOT IN ('crear_cotizacion','aprobar_descuento','configurar','siesa_sync','ver_pipeline','editar_pipeline');

-- Re-asignar 3 perfiles base al nuevo modelo (idempotente)
-- CRM - Gerencia: 6/6
INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso)
SELECT pv.id, perm FROM crm.perfiles_venta pv CROSS JOIN (VALUES ('crear_cotizacion'),('aprobar_descuento'),('configurar'),('siesa_sync'),('ver_pipeline'),('editar_pipeline')) AS p(perm)
WHERE pv.nombre = 'CRM - Gerencia'
ON CONFLICT DO NOTHING;

-- CRM - Comercial: 3/6 (sin aprobar ni configurar/sync)
DELETE FROM crm.perfil_venta_permisos WHERE perfil_id = (SELECT id FROM crm.perfiles_venta WHERE nombre='CRM - Comercial');
INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso)
SELECT pv.id, perm FROM crm.perfiles_venta pv CROSS JOIN (VALUES ('crear_cotizacion'),('ver_pipeline'),('editar_pipeline')) AS p(perm)
WHERE pv.nombre = 'CRM - Comercial'
ON CONFLICT DO NOTHING;

-- CRM - Aprobador Descuentos: 2/6 (aprobar + ver)
DELETE FROM crm.perfil_venta_permisos WHERE perfil_id = (SELECT id FROM crm.perfiles_venta WHERE nombre='CRM - Aprobador Descuentos');
INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso)
SELECT pv.id, perm FROM crm.perfiles_venta pv CROSS JOIN (VALUES ('aprobar_descuento'),('ver_pipeline')) AS p(perm)
WHERE pv.nombre = 'CRM - Aprobador Descuentos'
ON CONFLICT DO NOTHING;

-- Vendedor Generico (si existe) lo alineamos a Comercial 3/6 si tenia 9 del modelo viejo
UPDATE crm.perfiles_venta SET descripcion = 'Rol comercial (SIESA Comercial) — puede cotizar y trabajar pipeline, sin aprobar' WHERE nombre = 'Vendedor Generico';
DELETE FROM crm.perfil_venta_permisos WHERE perfil_id = (SELECT id FROM crm.perfiles_venta WHERE nombre='Vendedor Generico') AND permiso NOT IN ('crear_cotizacion','ver_pipeline','editar_pipeline');
INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso)
SELECT pv.id, perm FROM crm.perfiles_venta pv CROSS JOIN (VALUES ('crear_cotizacion'),('ver_pipeline'),('editar_pipeline')) AS p(perm)
WHERE pv.nombre = 'Vendedor Generico' AND NOT EXISTS (SELECT 1 FROM crm.perfil_venta_permisos WHERE perfil_id = pv.id AND permiso = perm)
ON CONFLICT DO NOTHING;
