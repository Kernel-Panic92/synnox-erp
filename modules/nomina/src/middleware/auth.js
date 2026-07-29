const { db } = require('../db');
const jwt = require('jsonwebtoken');
const { verifySessionValid, parseCookies } = require('../../../../framework/auth');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado en nómina.');
  process.exit(1);
}

function createAuth({ BACKUP_TOKEN, enviarCorreo, getConfig }) {
  function autenticar(rolesPermitidos = []) {
    return async (req, res, next) => {
      const cookies = parseCookies(req);
      const token = cookies.launcher_jwt || req.headers['authorization']?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Token requerido' });
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload || !payload.email) return res.status(401).json({ error: 'Token inválido' });
        console.log(`[nomina:auth] OK — email: ${payload.email}, rol: ${payload.rol}, modulos: ${JSON.stringify(payload.modulos)}, seq: ${payload.seq}`);
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
        const sesionValida = await verifySessionValid(payload);
        console.log(`[nomina:auth] sesionValida: ${sesionValida}, payload.seq: ${payload.seq}`);
        if (!sesionValida) return res.status(401).json({ error: 'Sesión invalidada. Inicia sesión nuevamente.' });
        if (rolesPermitidos.length && !rolesPermitidos.includes(user.rol))
          return res.status(403).json({ error: 'Sin permisos para esta acción' });
        req.usuario = user;
        req.perfil_nombre = payload.perfil_nombre || null;
        // Attach granular permissions from launcher JWT
        const modPermisos = payload.modulos_permisos || {};
        req.usuario.nominaPermisos = modPermisos.nomina || [];
        next();
      } catch (err) {
        const tokenPreview = token ? token.substring(0, 20) + '...' : 'null';
        const secretPreview = JWT_SECRET ? JWT_SECRET.substring(0, 8) + '...' : 'UNDEFINED';
        console.error(`[nomina:auth] FALLÓ — ${err.message} | token: ${tokenPreview} | secret: ${secretPreview} | name: ${err.name}`);
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
          console.log(`[nomina:requireModule] modulos: ${JSON.stringify(modulos)}, buscando: ${moduleId}, includes: ${modulos.includes(moduleId)}`);
          if (modulos.includes(moduleId)) return next();
        }
      } catch (err) {
        console.error(`[nomina:requireModule] Error: ${err.message}`);
      }
      res.status(403).json({ error: `No tienes acceso al módulo ${moduleId}` });
    };
  }

  // JWT-based permission check (reads modulos_permisos from launcher-issued JWT)
  // Migración gradual: coexiste con requierePermiso local
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

  return { autenticar, requierePermiso, requierePermisoJWT, requireModule, soloAdmin, adminRrhh, adminRrhhOp, podeAprobar, podeEditar, todosRoles, requiereBackupToken, soloAdminOBkp };
}

module.exports = { parseCookies, createAuth };

// Re-export parseCookies for nomina/server.js → telemetry.js
// (kept for backward compat, now sourced from framework/auth)
