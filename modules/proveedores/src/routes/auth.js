const router  = require('express').Router();
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, async (req, res) => {
  try {
    // Read fresh user data from launcher.db
    let freshUser = null;
    try {
      const path = require('path');
      const dbPath = path.join(__dirname, '..', '..', '..', 'launcher', 'launcher.db');
      const ldb = require('better-sqlite3')(dbPath, { readonly: true });
      freshUser = ldb.prepare(`
        SELECT u.id, u.nombre, u.email, u.rol, u.perfil_id,
               p.nombre as perfil_nombre
        FROM usuarios u LEFT JOIN perfiles p ON u.perfil_id = p.id
        WHERE u.id = ?
      `).get(req.usuario.id);
      ldb.close();
    } catch {}

    const nombre = freshUser?.nombre || req.usuario.nombre;
    const rol = freshUser?.rol || req.usuario.rol;
    const perfil_nombre = freshUser?.perfil_nombre || req.usuario.perfil_nombre || null;

    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.area_id, u.activo,
              u.creado_en, u.actualizado_en, a.nombre AS area_nombre
       FROM usuarios u LEFT JOIN areas a ON a.id = u.area_id
       WHERE u.email = $1`,
      [req.usuario.email]
    );
    const user = rows[0];
    if (!user) {
      const rolesValidos = ['admin','contador','tesorero','comprador','auditor'];
      const rolInsert = rolesValidos.includes(rol) ? rol : 'comprador';
      const hash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
      const { rows: newUser } = await db.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (email) DO UPDATE SET nombre = $1, rol = $4
         RETURNING id, nombre, email, rol, activo, creado_en, actualizado_en`,
        [nombre, req.usuario.email, hash, rolInsert]
      );
      return res.json({ ...newUser[0], perfil_nombre, modulos_permisos: req.usuario.modulos_permisos || {} });
    }
    const rolesValidos = ['admin','contador','tesorero','comprador','auditor'];
    const updateRol = rolesValidos.includes(rol) ? rol : 'comprador';
    if (user.nombre !== nombre || user.rol !== updateRol) {
      await db.query('UPDATE usuarios SET nombre = $1, rol = $2 WHERE id = $3', [nombre, updateRol, user.id]);
      user.nombre = nombre;
      user.rol = updateRol;
    }
    res.json({ ...user, perfil_nombre, modulos_permisos: req.usuario.modulos_permisos || {} });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
