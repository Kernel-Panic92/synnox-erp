const { db } = require('../db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error('WARN: JWT_SECRET no configurado en nómina');

function parseCookies(req) {
  const raw = req.headers['cookie'] || '';
  const result = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  });
  return result;
}

function createAuth({ BACKUP_TOKEN, enviarCorreo, getConfig }) {
  function autenticar(rolesPermitidos = []) {
    return (req, res, next) => {
      const cookies = parseCookies(req);
      const token = cookies.launcher_jwt || req.headers['authorization']?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Token requerido' });
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload || !payload.email) return res.status(401).json({ error: 'Token inválido' });
        const payloadNombre = payload.nombre || payload.email.split('@')[0];
        const payloadRol = ['admin','rrhh','gerencia','operador','consulta'].includes(payload.rol) ? payload.rol : 'operador';
        let user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(payload.email);
        if (!user) {
          const id = require('crypto').randomUUID();
          db.prepare('INSERT INTO usuarios (id, nombre, email, password, rol, activo, sede, creado) VALUES (?,?,?,?,?,1,?,?)').run(id, payloadNombre, payload.email, '', payloadRol, payload.sede || 'Principal', new Date().toISOString());
          user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
        } else if (user.nombre !== payloadNombre || user.rol !== payloadRol) {
          db.prepare('UPDATE usuarios SET nombre = ?, rol = ? WHERE id = ?').run(payloadNombre, payloadRol, user.id);
          user = { ...user, nombre: payloadNombre, rol: payloadRol };
        }
        if (rolesPermitidos.length && !rolesPermitidos.includes(user.rol))
          return res.status(403).json({ error: 'Sin permisos para esta acción' });
        req.usuario = user;
        req.perfil_nombre = payload.perfil_nombre || null;
        next();
      } catch (err) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }
    };
  }

  function requierePermiso(permiso) {
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
      const tiene = db.prepare('SELECT 1 FROM permisos_roles WHERE rol = ? AND permiso = ?').get(req.usuario.rol, permiso);
      if (!tiene) return res.status(403).json({ error: 'Permiso denegado: ' + permiso });
      next();
    };
  }

  const soloAdmin      = autenticar(['admin']);
  const adminRrhh      = autenticar(['admin', 'rrhh']);
  const adminRrhhOp    = autenticar(['admin', 'rrhh', 'operador', 'gerencia']);
  const podeAprobar    = [autenticar([]), requierePermiso('aprobar')];
  const podeEditar     = [autenticar([]), requierePermiso('editar')];
  const todosRoles     = autenticar([]);

  function requiereBackupToken(req, res, next) {
    if (!BACKUP_TOKEN) return res.status(500).json({ error: 'BACKUP_TOKEN no configurado en .env' });
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || token !== BACKUP_TOKEN) return res.status(401).json({ error: 'Token de backup inválido' });
    req.usuario = { rol: 'admin', id: null, nombre: 'Backup Automático' };
    next();
  }

  const soloAdminOBkp = (req, res, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (token) return requiereBackupToken(req, res, next);
    soloAdmin(req, res, next);
  };

  function requireModule(moduleId) {
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
      if (req.usuario.rol === 'admin') return next();
      // Read modulos from JWT (local user record doesn't have it)
      try {
        const cookies = parseCookies(req);
        const token = cookies.launcher_jwt || req.headers['authorization']?.replace('Bearer ', '');
        if (token) {
          const payload = jwt.verify(token, JWT_SECRET);
          const modulos = payload.modulos || [];
          if (modulos.includes(moduleId)) return next();
        }
      } catch {}
      res.status(403).json({ error: `No tienes acceso al módulo ${moduleId}` });
    };
  }

  return { autenticar, requierePermiso, requireModule, soloAdmin, adminRrhh, adminRrhhOp, podeAprobar, podeEditar, todosRoles, requiereBackupToken, soloAdminOBkp };
}

module.exports = { parseCookies, createAuth };
