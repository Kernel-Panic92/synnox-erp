import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { q, estado } = req.query;
    let sql = 'SELECT * FROM logistics.vehiculos WHERE 1=1';
    const params = [];
    let idx = 1;
    if (estado) { params.push(estado); sql += ` AND estado=$${idx++}`; }
    if (q) {
      params.push('%' + q + '%');
      sql += ` AND (placa ILIKE $${idx} OR alias ILIKE $${idx} OR sede ILIKE $${idx})`;
      idx++;
    }
    sql += ' ORDER BY id';
    const result = await pool.query(sql, params);
    res.json({ exitosa: true, total: result.rows.length, vehiculos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logistics.vehiculos WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json({ exitosa: true, vehiculo: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { placa, alias, capacidad_peso, capacidad_volumen, sede, color } = req.body;
    const result = await pool.query(
      `INSERT INTO logistics.vehiculos (placa, alias, capacidad_peso, capacidad_volumen, sede, color)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [placa, alias, capacidad_peso || 5000, capacidad_volumen || 20, sede, color || null]
    );
    res.status(201).json({ exitosa: true, vehiculo: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { placa, alias, capacidad_peso, capacidad_volumen, sede, estado, color } = req.body;
    const result = await pool.query(
      `UPDATE logistics.vehiculos SET placa=COALESCE($1,placa), alias=COALESCE($2,alias),
       capacidad_peso=COALESCE($3,capacidad_peso), capacidad_volumen=COALESCE($4,capacidad_volumen),
       sede=COALESCE($5,sede), estado=COALESCE($6,estado), color=COALESCE($7,color), updated_at=CURRENT_TIMESTAMP
       WHERE id=$8 RETURNING *`,
      [placa, alias, capacidad_peso, capacidad_volumen, sede, estado, color, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json({ exitosa: true, vehiculo: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/seleccionados', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids requerido' });
    const result = await pool.query('DELETE FROM logistics.vehiculos WHERE id = ANY($1::int[]) RETURNING id', [ids]);
    res.json({ eliminados: result.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logistics.vehiculos WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json({ exitosa: true, mensaje: 'Vehículo eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
