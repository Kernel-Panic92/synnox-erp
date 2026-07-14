import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado en framework/auth.mjs');
  process.exit(1);
}

export function parseCookies(req) {
  const raw = req.headers['cookie'] || '';
  const result = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return result;
}

export function verifyToken(req, res, next) {
  const cookies = parseCookies(req);
  let token = cookies.launcher_jwt || null;
  const auth = req.headers.authorization;
  if (!token && auth && auth.startsWith('Bearer ')) token = auth.split(' ')[1];
  if (!token) {
    console.log(`[auth] No token — path: ${req.path}, cookie: ${!!cookies.launcher_jwt}, auth: ${!!auth}`);
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    console.log(`[auth] JWT error: ${err.message} — path: ${req.path}`);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export async function verifySession(req, res, next) {
  if (!req.user) return next();
  const valida = await verifySessionValid(req.user);
  if (!valida) return res.status(401).json({ error: 'Sesión invalidada. Inicia sesión nuevamente.' });
  next();
}

export function requireModule(moduleId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const modulos = req.user.modulos || [];
    if (req.user.rol === 'admin') return next();
    if (modulos.includes(moduleId)) return next();
    res.status(403).json({ error: `No tienes acceso al módulo ${moduleId}` });
  };
}

export function requirePermiso(permisoId, moduloId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.rol === 'admin') return next();
    const modPermisos = req.user.modulos_permisos || {};
    const perms = modPermisos[moduloId] || [];
    if (perms.includes(permisoId)) return next();
    return res.status(403).json({ error: `Permiso requerido: ${permisoId}` });
  };
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

export async function verifySessionValid(payload) {
  try {
    const launcherUrl = process.env.LAUNCHER_URL || 'http://localhost:3002';
    const cachedSeq = getCachedSeq(payload.id);
    if (cachedSeq !== null) return cachedSeq === payload.seq;
    const res = await fetch(launcherUrl + '/api/internal/usuario-seq/' + payload.id, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return true;
    const data = await res.json();
    setCachedSeq(payload.id, data.seq);
    return data.seq === payload.seq;
  } catch {
    return true;
  }
}
