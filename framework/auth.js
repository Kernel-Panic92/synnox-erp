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
    sede: user.sede || 'Principal',
    modulos: user.modulos || [],
    perfil_id: user.perfil_id || null,
    perfil_nombre: user.perfil_nombre || null,
    permisos: user.permisos || [],
    modulos_permisos: user.modulos_permisos || {},
    seq: user.seq || 1,
    jti
  };
}

function getUserWithPermissions(db, userId) {
  const user = db.prepare('SELECT id, nombre, email, rol, perfil_id, seq, sede FROM usuarios WHERE id = ? AND activo = 1').get(userId);
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

// Session version cache (5 second TTL)
const _seqCache = new Map();
function getCachedSeq(userId) {
  const cached = _seqCache.get(userId);
  if (cached && Date.now() - cached.ts < 5000) return cached.seq;
  return null;
}
function setCachedSeq(userId, seq) {
  _seqCache.set(userId, { seq, ts: Date.now() });
}

// Verify user session directly via SQLite (no HTTP call needed in monorepo)
function verifySessionValid(payload) {
  try {
    const cachedSeq = getCachedSeq(payload.id);
    if (cachedSeq !== null) return cachedSeq === payload.seq;
    const Database = require('better-sqlite3');
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'launcher', 'launcher.db');
    const ldb = new Database(dbPath, { readonly: true });
    const row = ldb.prepare('SELECT seq FROM usuarios WHERE id = ?').get(payload.id);
    ldb.close();
    const seq = row ? row.seq : payload.seq;
    setCachedSeq(payload.id, seq);
    return seq === payload.seq;
  } catch {
    return true;
  }
}

function parseCookies(req) {
  const raw = req.headers['cookie'] || '';
  const result = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return result;
}

module.exports = { buildPayload, getUserWithPermissions, verifySessionValid, parseCookies };
