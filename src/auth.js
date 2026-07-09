const jwt = require('jsonwebtoken');
const { db: pgPool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Sesión expirada' : 'Token inválido';
    return res.status(401).json({ error: msg });
  }
}

function requireModule(moduleId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const modulos = req.user.modulos || [];
    if (req.user.rol === 'admin' || modulos.includes(moduleId)) return next();
    res.status(403).json({ error: `No tienes acceso al módulo ${moduleId}` });
  };
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (roles.includes(req.user.rol)) return next();
    res.status(403).json({ error: `Acceso denegado. Roles: ${roles.join(', ')}` });
  };
}

module.exports = { verifyToken, requireModule, requireRol };
