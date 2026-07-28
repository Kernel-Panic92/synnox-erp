const { db } = require('../db');

function permisosPorRol(rol) {
  const rows = db.prepare('SELECT permiso FROM permisos_roles WHERE rol = ?').all(rol);
  return rows.map(r => r.permiso);
}

function rolTienePermiso(rol, permiso) {
  return !!db.prepare('SELECT 1 FROM permisos_roles WHERE rol = ? AND permiso = ?').get(rol, permiso);
}

// Check permissions from JWT (launcher granular permissions)
// When JWT provides permissions, they are authoritative (restrictive override)
// Falls back to local permisos_roles only when no JWT permissions present
function tienePermiso(usuario, permiso) {
  if (usuario.rol === 'admin') return true;
  // When JWT provides granular permissions, they are authoritative
  if (usuario.nominaPermisos && usuario.nominaPermisos.length > 0) {
    return usuario.nominaPermisos.includes(perfilPermisoMap[permiso] || permiso);
  }
  // Fallback to local permission system only when no JWT permissions present
  return rolTienePermiso(usuario.rol, permiso);
}

// Map launcher permission IDs to nómina permission IDs
const perfilPermisoMap = {
  'ver': 'ver',
  'crear': 'registros',
  'editar': 'editar',
  'eliminar': 'eliminar_registros',
  'aprobar': 'aprobar',
  'rechazar': 'aprobar',
  'ver_todos': 'ver_todos',
  'ver_sede': 'ver_sede',
  'ver_propios': 'ver_propios',
  'centros': 'centros',
  'usuarios': 'usuarios',
  'empleados': 'empleados',
  'nominas': 'nominas',
  'registros': 'registros',
  'configuracion': 'configuracion',
  'backup': 'backup',
  'reportes': 'reportes',
  'siesa': 'siesa',
  'tipos': 'tipos',
};

module.exports = { permisosPorRol, rolTienePermiso, tienePermiso };
