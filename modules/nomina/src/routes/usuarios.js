const express = require('express');
const bcrypt = require('bcryptjs');

module.exports = function({ db, uid, middlewares: { todosRoles, soloAdmin }, enviarCorreo, BASE_URL, APP_NAME }) {
  const router = express.Router();

  router.get('/', todosRoles, (req, res) => {
    const usuarios = db.prepare('SELECT id, nombre, email, rol, sede, activo, creado FROM usuarios ORDER BY nombre').all();
    res.json(usuarios);
  });

  router.post('/', soloAdmin, (req, res) => {
    const { nombre, email, rol, sede } = req.body;
    if (!nombre || !email || !rol || !sede) return res.status(400).json({ error: 'Todos los campos son requeridos' });
    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
    if (existe) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    const password = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase();
    const hash = bcrypt.hashSync(password, 10);
    const id = uid();
    db.prepare('INSERT INTO usuarios (id, nombre, email, password, rol, sede, activo, creado) VALUES (?,?,?,?,?,?,1,?)').run(id, nombre, email.toLowerCase().trim(), hash, rol, sede, new Date().toISOString());
    if (enviarCorreo) {
      enviarCorreo({ to: email, subject: `Bienvenido a ${APP_NAME}`, html: `<p>Hola ${nombre},</p><p>Tu cuenta ha sido creada en ${APP_NAME}.</p><p>Email: ${email}<br>Contraseña temporal: <strong>${password}</strong></p><p>Ingresa en: <a href="${BASE_URL}">${BASE_URL}</a></p>` }).catch(e => console.error('[Usuarios] Error email:', e.message));
    }
    res.json({ ok: true, id });
  });

  router.put('/:id', soloAdmin, (req, res) => {
    const { nombre, email, rol, sede, activo } = req.body;
    const user = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const sets = []; const params = [];
    if (nombre !== undefined) { sets.push('nombre = ?'); params.push(nombre); }
    if (email !== undefined) { sets.push('email = ?'); params.push(email.toLowerCase().trim()); }
    if (rol !== undefined) { sets.push('rol = ?'); params.push(rol); }
    if (sede !== undefined) { sets.push('sede = ?'); params.push(sede); }
    if (activo !== undefined) { sets.push('activo = ?'); params.push(activo ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Sin cambios' });
    params.push(req.params.id);
    db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  });

  router.delete('/:id', soloAdmin, (req, res) => {
    const user = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM usuario_empleados WHERE usuarioId = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.get('/:id/empleados', soloAdmin, (req, res) => {
    const rows = db.prepare('SELECT empleadoId FROM usuario_empleados WHERE usuarioId = ?').all(req.params.id);
    res.json(rows.map(r => r.empleadoId));
  });

  router.put('/:id/empleados', soloAdmin, (req, res) => {
    const { empleados } = req.body;
    if (!Array.isArray(empleados)) return res.status(400).json({ error: 'empleados debe ser un array' });
    db.prepare('DELETE FROM usuario_empleados WHERE usuarioId = ?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO usuario_empleados (usuarioId, empleadoId) VALUES (?, ?)');
    for (const empId of empleados) ins.run(req.params.id, empId);
    res.json({ ok: true });
  });

  router.post('/:id/reset-password', soloAdmin, async (req, res) => {
    const user = db.prepare('SELECT id, nombre, email FROM usuarios WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const password = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hash, user.id);
    if (enviarCorreo) {
      enviarCorreo({ to: user.email, subject: `Contraseña restablecida - ${APP_NAME}`, html: `<p>Hola ${user.nombre},</p><p>Tu contraseña ha sido restablecida.</p><p>Nueva contraseña temporal: <strong>${password}</strong></p><p>Ingresa en: <a href="${BASE_URL}">${BASE_URL}</a></p><p>Recomendamos cambiar la contraseña después de iniciar sesión.</p>` }).catch(e => console.error('[Usuarios] Error email:', e.message));
    }
    res.json({ ok: true, message: 'Contraseña restablecida. Se envió correo con la nueva contraseña.' });
  });

  return router;
};
