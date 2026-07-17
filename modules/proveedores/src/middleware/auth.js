const jwt = require('jsonwebtoken');
const { verifySessionValid, parseCookies } = require('../../../../framework/auth');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado en proveedores.');
  process.exit(1);
}

async function authMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  let token = cookies.launcher_jwt || null;
  const header = req.headers.authorization;
  if (!token && header && header.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }
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

function requirePermiso(permisoId) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (req.usuario.rol === 'admin') return next();
    const modPermisos = req.usuario.modulos_permisos || {};
    const proveedoresPerms = modPermisos.proveedores || [];
    if (proveedoresPerms.includes(permisoId)) return next();
    return res.status(403).json({ error: `Permiso requerido: ${permisoId}` });
  };
}

function requireModule(moduleId) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (req.usuario.rol === 'admin') return next();
    const modulos = req.usuario.modulos || [];
    if (modulos.includes(moduleId)) return next();
    res.status(403).json({ error: `No tienes acceso al módulo ${moduleId}` });
  };
}

// Session invalidation check — run after authMiddleware
async function verificarSesionValida(req, res, next) {
  if (!req.usuario) return next();
  const valida = await verifySessionValid(req.usuario);
  if (!valida) return res.status(401).json({ error: 'Sesión invalidada. Inicia sesión nuevamente.' });
  next();
}

module.exports = { authMiddleware, verificarSesionValida, requireRol, requireModule, requirePermiso };
