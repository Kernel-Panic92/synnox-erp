const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const MODULE_ID = process.env.MODULE_ID || 'docflow';

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = { ...payload, _token: token };
    next();
  } catch (err) {
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
