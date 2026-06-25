const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function parseCookies(req) {
  const raw = req.headers['cookie'] || '';
  const result = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return result;
}

async function authMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  let token = cookies.launcher_jwt || null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token) {
    console.log(`[proveedores] 401 — no token en ${req.method} ${req.path}, cookies: ${req.headers.cookie?.slice(0,80)}`);
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = { ...payload, _token: token };
    next();
  } catch (err) {
    console.log(`[proveedores] JWT error: ${err.message} — path: ${req.path} — token: ${token.slice(0,20)}... — secret: ${JWT_SECRET.slice(0,8)}...`);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: `Acceso denegado. Roles requeridos: ${roles.join(', ')}` });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRol };
