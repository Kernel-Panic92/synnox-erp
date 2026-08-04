const express = require('express');

module.exports = function createAuthRouter({
  db, crypto, middlewares
}) {
  const router = express.Router();
  const { todosRoles } = middlewares;

  router.get('/me', todosRoles, (req, res) => {
    const u = req.usuario;
    const permisos = db.prepare('SELECT permiso FROM permisos_roles WHERE rol = ?').all(u.rol).map(p => p.permiso);
    res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, sede: u.sede, permisos, modulos_permisos: u.modulos_permisos || {}, perfil_nombre: req.perfil_nombre || null });
  });

  return router;
};
