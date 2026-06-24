const express = require('express');

module.exports = function createAuthRouter({
  db, crypto, middlewares
}) {
  const router = express.Router();
  const { todosRoles } = middlewares;

  router.get('/me', todosRoles, (req, res) => {
    const u = req.usuario;
    res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, sede: u.sede });
  });

  return router;
};
