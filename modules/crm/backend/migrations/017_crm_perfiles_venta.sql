-- Perfiles de venta internos CRM (híbrido: launcher sigue para auth, CRM para comercial)
CREATE TABLE IF NOT EXISTS crm.perfiles_venta (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm.perfil_venta_permisos (
  id SERIAL PRIMARY KEY,
  perfil_id INTEGER NOT NULL REFERENCES crm.perfiles_venta(id) ON DELETE CASCADE,
  permiso VARCHAR(100) NOT NULL,
  UNIQUE(perfil_id, permiso)
);

CREATE TABLE IF NOT EXISTS crm.usuario_perfil_venta (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  perfil_venta_id INTEGER NOT NULL REFERENCES crm.perfiles_venta(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, perfil_venta_id)
);

-- Seed 3 perfiles clonando launcher.perfiles 2882-2884 si existen (plantillas sin asignar)
-- Nota: se ejecuta en cada arranque vía run.js (IDEMPOTENTE por nombre UNIQUE)
INSERT INTO crm.perfiles_venta (nombre, descripcion) VALUES
  ('CRM - Gerencia', 'Perfil gerencial que ve todo (mapeo SIESA Gerencia) - gestionado en CRM Admin'),
  ('CRM - Comercial', 'Rol para los comerciales (SIESA Comercial): sin borrado ni aprobación descuentos'),
  ('CRM - Aprobador Descuentos', 'Solo aprueba cotizaciones que superen rango (Flujo Notificación Jacques)')
ON CONFLICT (nombre) DO NOTHING;
