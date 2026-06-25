import jwt from 'jsonwebtoken';

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

export function verifyToken(req, res, next) {
  const cookies = parseCookies(req);
  let token = cookies.launcher_jwt || null;
  const auth = req.headers.authorization;
  if (!token && auth && auth.startsWith('Bearer ')) token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  console.log(`[framework] token: ${token ? token.slice(0,25)+'... ('+token.length+' chars, '+token.split('.').length+' parts)' : 'null'} secret: ${JWT_SECRET.slice(0,12)}...`);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    console.log(`[framework] JWT error: ${err.message} — token ${token.slice(0,25)}...`);
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
