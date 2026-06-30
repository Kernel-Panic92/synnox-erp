import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado en framework/auth.mjs');
  process.exit(1);
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

export function requireModule(moduleId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const modulos = req.user.modulos || [];
    if (req.user.rol === 'admin') return next();
    if (modulos.includes(moduleId)) return next();
    res.status(403).json({ error: `No tienes acceso al módulo ${moduleId}` });
  };
}
