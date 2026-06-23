import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = 'SELECT * FROM logistics.sedes WHERE 1=1';
    const params = [];
    let idx = 1;
    if (q) {
      params.push('%' + q + '%');
      sql += ` AND (nombre ILIKE $${idx} OR ciudad ILIKE $${idx} OR direccion ILIKE $${idx})`;
      idx++;
    }
    sql += ' ORDER BY nombre';
    const result = await pool.query(sql, params);
    res.json({ exitosa: true, total: result.rows.length, sedes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logistics.sedes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ exitosa: true, sede: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, direccion, ciudad, latitud, longitud, telefono, centro_operacion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = await pool.query(
      `INSERT INTO logistics.sedes (nombre, direccion, ciudad, latitud, longitud, telefono, centro_operacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nombre, direccion || null, ciudad || null, latitud || null, longitud || null, telefono || null, centro_operacion || null]
    );
    res.status(201).json({ exitosa: true, sede: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, direccion, ciudad, latitud, longitud, telefono, activo, centro_operacion } = req.body;
    const result = await pool.query(
      `UPDATE logistics.sedes SET nombre=COALESCE($1,nombre), direccion=$2, ciudad=$3,
       latitud=$4, longitud=$5, telefono=$6, activo=COALESCE($7,activo),
       centro_operacion=$8, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *`,
      [nombre || null, direccion !== undefined ? direccion : undefined,
       ciudad !== undefined ? ciudad : undefined,
       latitud !== undefined ? latitud : undefined,
       longitud !== undefined ? longitud : undefined,
       telefono !== undefined ? telefono : undefined,
       activo !== undefined ? activo : undefined,
       centro_operacion !== undefined ? centro_operacion : undefined,
       req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ exitosa: true, sede: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logistics.sedes WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ exitosa: true, mensaje: 'Sede eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
