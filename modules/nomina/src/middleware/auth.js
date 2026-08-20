const { db } = require('../db');
const jwt = require('jsonwebtoken');
const { verifySessionValid, parseCookies } = require('../../../../framework/auth');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado en nómina.');
  process.exit(1);
}

function createAuth({ enviarCorreo, getConfig }) {
  function autenticar(rolesPermitidos = []) {
    return async (req, res, next) => {
      const cookies = parseCookies(req);
      const token = cookies.launcher_jwt || req.headers['authorization']?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Token requerido' });
      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch {
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }
      try {
        if (!payload || !payload.email) return res.status(401).json({ error: 'Token inválido' });
        const payloadNombre = payload.nombre || payload.email.split('@')[0];
        const payloadRol = ['admin','rrhh','gerencia','operador','consulta'].includes(payload.rol) ? payload.rol : 'operador';
        let user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(payload.email);
        if (!user) {
          const id = require('crypto').randomUUID();
          db.prepare('INSERT INTO usuarios (id, nombre, email, password, rol, activo, sede, creado) VALUES (?,?,?,?,?,1,?,?)').run(id, payloadNombre, payload.email, '', payloadRol, payload.sede || 'Principal', new Date().toISOString());
          user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
        } else {
          if (!user.activo) db.prepare('UPDATE usuarios SET activo = 1 WHERE id = ?').run(user.id);
          if (user.nombre !== payloadNombre || user.rol !== payloadRol) {
            db.prepare('UPDATE usuarios SET nombre = ?, rol = ? WHERE id = ?').run(payloadNombre, payloadRol, user.id);
            user = { ...user, nombre: payloadNombre, rol: payloadRol };
          }
          user.activo = 1;
        }
        const sesionValida = await verifySessionValid(payload);
        if (!sesionValida) return res.status(401).json({ error: 'Sesión invalidada. Inicia sesión nuevamente.' });
        if (rolesPermitidos.length && !rolesPermitidos.includes(user.rol))
          return res.status(403).json({ error: 'Sin permisos para esta acción' });
        req.usuario = user;
        req.perfil_nombre = payload.perfil_nombre || null;
        const modPermisos = payload.modulos_permisos || {};
        req.usuario.nominaPermisos = modPermisos.nomina || [];
        req.usuario.modulos_permisos = modPermisos;
        next();
      } catch (err) {
        return res.status(500).json({ error: 'Error interno de autenticación' });
      }
    };
  }

  function requierePermiso(permiso) {
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
      if (req.usuario.rol === 'admin') return next();
      const nominaPerms = req.usuario.nominaPermisos || [];
      if (nominaPerms.includes(permiso)) return next();
      return res.status(403).json({ error: 'Permiso denegado: ' + permiso });
    };
  }

  const soloAdmin      = autenticar(['admin']);
  const adminRrhh      = autenticar(['admin', 'rrhh']);
  const adminRrhhOp    = autenticar(['admin', 'rrhh', 'operador', 'gerencia']);
  const podeAprobar    = [autenticar([]), requierePermiso('aprobar')];
  const podeEditar     = [autenticar([]), requierePermiso('editar')];
  const todosRoles     = autenticar([]);

  function requireModule(moduleId) {
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
      if (req.usuario.rol === 'admin') return next();
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

  function requierePermisoJWT(permisoId) {
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
      if (req.usuario.rol === 'admin') return next();
      try {
        const cookies = parseCookies(req);
        const token = cookies.launcher_jwt || req.headers['authorization']?.replace('Bearer ', '');
        if (token) {
          const payload = jwt.verify(token, JWT_SECRET);
          const modPermisos = payload.modulos_permisos || {};
          const nominaPerms = modPermisos.nomina || [];
          if (nominaPerms.includes(permisoId)) return next();
        }
      } catch {}
      return res.status(403).json({ error: `Permiso requerido: ${permisoId}` });
    };
  }

  return { autenticar, requierePermiso, requierePermisoJWT, requireModule, soloAdmin, adminRrhh, adminRrhhOp, podeAprobar, podeEditar, todosRoles };
}

module.exports = { parseCookies, createAuth };
