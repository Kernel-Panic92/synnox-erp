// framework/auth.js — Shared auth utilities for all modules
// buildPayload: constructs JWT payload with modulos_permisos
// getUserWithPermissions: fetches user + permissions from SQLite/DB

function buildPayload(user) {
  const jti = require('crypto').randomUUID();
  return {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    modulos: user.modulos || [],
    perfil_id: user.perfil_id || null,
    perfil_nombre: user.perfil_nombre || null,
    permisos: user.permisos || [],
    modulos_permisos: user.modulos_permisos || {},
    jti
  };
}

function getUserWithPermissions(db, userId) {
  const user = db.prepare('SELECT id, nombre, email, rol, perfil_id FROM usuarios WHERE id = ? AND activo = 1').get(userId);
  if (!user) return null;

  // Modules
  if (user.rol === 'admin') {
    const allModulos = db.prepare("SELECT id FROM modulos_plataforma WHERE activo = 1").all();
    user.modulos = allModulos.map(m => m.id);
  } else {
    const modRows = db.prepare("SELECT modulo_id FROM user_modulos WHERE user_id = ?").all(userId);
    user.modulos = modRows.map(m => m.modulo_id);
  }

  // Profile name + launcher permissions
  if (user.perfil_id) {
    const perfil = db.prepare('SELECT nombre FROM perfiles WHERE id = ?').get(user.perfil_id);
    user.perfil_nombre = perfil?.nombre || null;
    user.permisos = db.prepare('SELECT modulo_id, permiso FROM perfil_permisos WHERE perfil_id = ?').all(user.perfil_id);
  } else {
    user.perfil_nombre = null;
    user.permisos = [];
  }

  // modulos_permisos — functional permissions per module
  user.modulos_permisos = {};

  if (user.perfil_id) {
    const perfilPerms = db.prepare(
      'SELECT modulo_id, permiso_id FROM modulos_permisos_perfil WHERE perfil_id = ? AND activo = 1'
    ).all(user.perfil_id);
    for (const row of perfilPerms) {
      if (!user.modulos.includes(row.modulo_id)) continue;
      if (!user.modulos_permisos[row.modulo_id]) user.modulos_permisos[row.modulo_id] = [];
      user.modulos_permisos[row.modulo_id].push(row.permiso_id);
    }
  }

  const userPerms = db.prepare(
    'SELECT modulo_id, permiso_id FROM modulos_permisos_usuario WHERE usuario_id = ? AND activo = 1'
  ).all(userId);
  for (const row of userPerms) {
    if (!user.modulos.includes(row.modulo_id)) continue;
    if (!user.modulos_permisos[row.modulo_id]) user.modulos_permisos[row.modulo_id] = [];
    if (!user.modulos_permisos[row.modulo_id].includes(row.permiso_id)) {
      user.modulos_permisos[row.modulo_id].push(row.permiso_id);
    }
  }

  return user;
}

module.exports = { buildPayload, getUserWithPermissions };
