const express = require('express');
const { getSedesActivas } = require('../utils/launcherDb');

module.exports = function({ db, fs, path, __dirname, permisosPorRol, middlewares: { todosRoles } }) {
  const router = express.Router();

  router.get('/me', todosRoles, (req, res) => {
    const u = req.usuario;
    res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, perfil_nombre: req.perfil_nombre || null, sede: u.sede, cambio_password: u.cambio_password||0, permisos: permisosPorRol(u.rol) });
  });

  router.get('/sedes', todosRoles, (req, res) => {
    res.json(getSedesActivas());
  });

  router.get('/version', todosRoles, (req, res) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      const rama = (() => { try { return require('child_process').execFileSync('git', ['branch', '--show-current']).toString().trim(); } catch { return ''; } })();
      res.json({ version: pkg.version, rama: rama || 'main' });
    } catch { res.json({ version: '—', rama: '' }); }
  });

  router.get('/manual/:rol', todosRoles, (req, res) => {
    const mapa = { admin: 'MANUAL_ADMIN', rrhh: 'MANUAL_RRHH', gerencia: 'MANUAL_GERENCIA', operador: 'MANUAL_OPERADOR', consulta: 'MANUAL_CONSULTA' };
    const nombre = mapa[req.params.rol] || 'MANUAL_OPERADOR';
    const ruta = path.join(__dirname, nombre + '.md');
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Manual no disponible para este rol' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(ruta);
  });

  return router;
};
