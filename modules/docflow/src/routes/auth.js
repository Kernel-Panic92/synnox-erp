const router  = require('express').Router();
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.area_id, u.activo,
              u.creado, u.actualizado, a.nombre AS area_nombre
       FROM usuarios u LEFT JOIN areas a ON a.id = u.area_id
       WHERE u.email = $1`,
      [req.usuario.email]
    );
    if (rows.length === 0) {
      const rolesValidos = ['admin','contador','tesorero','comprador','auditor'];
      const rol = rolesValidos.includes(req.usuario.rol) ? req.usuario.rol : 'comprador';
      const hash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
      const { rows: newUser } = await db.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (email) DO UPDATE SET nombre = $1, rol = $4
         RETURNING id, nombre, email, rol, activo, creado, actualizado`,
        [req.usuario.nombre, req.usuario.email, hash, rol]
      );
      return res.json(newUser[0]);
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
