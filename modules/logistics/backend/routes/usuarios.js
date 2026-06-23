import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db.js';

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

router.get('/', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, email, rol, activo, created_at FROM logistics.usuarios ORDER BY id'
    );
    res.json({ exitosa: true, total: result.rows.length, usuarios: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Nombre, email y password requeridos' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO logistics.usuarios (nombre, email, password_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, rol, activo, created_at`,
      [nombre, email, hash, rol || 'admin']
    );
    res.status(201).json({ exitosa: true, usuario: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'El email ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol, activo } = req.body;
    let sql = 'UPDATE logistics.usuarios SET nombre=COALESCE($1,nombre), email=COALESCE($2,email), rol=COALESCE($3,rol), activo=COALESCE($4,activo), updated_at=CURRENT_TIMESTAMP';
    const params = [nombre, email, rol, activo !== undefined ? activo : null];
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sql += `, password_hash=$${params.length + 1}`;
      params.push(hash);
    }
    sql += ` WHERE id=$${params.length + 1} RETURNING id, nombre, email, rol, activo, created_at`;
    params.push(req.params.id);
    const result = await pool.query(sql, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ exitosa: true, usuario: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', soloAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.usuario.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    const result = await pool.query('DELETE FROM logistics.usuarios WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ exitosa: true, mensaje: 'Usuario eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
