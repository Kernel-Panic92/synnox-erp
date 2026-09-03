const express = require('express');

module.exports = function createUsuariosRouter({
  db, rolTienePermiso, middlewares
}) {
  const router = express.Router();
  const { soloAdmin, todosRoles } = middlewares;

  router.get('/', todosRoles, (req, res) => {
    const rows = db.prepare('SELECT id, nombre, email, rol, sede, activo, creado FROM usuarios ORDER BY creado DESC').all();
    if (req.usuario.rol === 'admin' || rolTienePermiso(req.usuario.rol, 'usuarios')) return res.json(rows);
    res.json(rows.map(u => ({ id: u.id, nombre: u.nombre, rol: u.rol, sede: u.sede })));
  });

  router.get('/:id/empleados', soloAdmin, (req, res) => {
    const rows = db.prepare('SELECT empleadoId FROM usuario_empleados WHERE usuarioId = ?').all(req.params.id);
    res.json(rows.map(r => r.empleadoId));
  });

  router.put('/:id/empleados', soloAdmin, (req, res) => {
    const { empleados: lista } = req.body;
    db.transaction(() => {
      db.prepare('DELETE FROM usuario_empleados WHERE usuarioId = ?').run(req.params.id);
      if (Array.isArray(lista)) {
        const ins = db.prepare('INSERT OR IGNORE INTO usuario_empleados VALUES (?,?)');
        for (const eid of lista) ins.run(req.params.id, eid);
      }
    })();
    res.json({ ok: true });
  });

  return router;
};
