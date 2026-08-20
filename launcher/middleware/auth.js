const jwt = require('jsonwebtoken');
const { parseCookies, verifySessionValid } = require('../../framework/auth');

const JWT_SECRET = process.env.JWT_SECRET;

function verificarToken(req, res, next) {
  let token = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies.launcher_jwt;
  }
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (!verifySessionValid(req.usuario)) {
      return res.status(401).json({ error: 'Sesión invalidada. Inicia sesión nuevamente.' });
    }
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function soloAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Se requiere rol admin' });
  next();
}

function firmarToken(payload, res, req) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('launcher_jwt', token, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 1000 });
  return token;
}

module.exports = { verificarToken, soloAdmin, parseCookies, firmarToken };
