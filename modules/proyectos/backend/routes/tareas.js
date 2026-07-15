import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

const COLUMNA_A_ESTADO = {
  pendiente: 'pendiente',
  en_progreso: 'en_progreso',
  revision: 'revision',
  completada: 'completada'
};

router.get('/', async (req, res) => {
  try {
    const { proyecto_id, estado, asignado_a, prioridad, columna, q, page, limit } = req.query;
    const params = [];
    const conditions = [];
    let idx = 1;

    if (proyecto_id) { params.push(proyecto_id); conditions.push(`t.proyecto_id = $${idx++}`); }
    if (estado) { params.push(estado); conditions.push(`t.estado = $${idx++}`); }
    if (asignado_a) { params.push(asignado_a); conditions.push(`t.asignado_a = $${idx++}`); }
    if (prioridad) { params.push(prioridad); conditions.push(`t.prioridad = $${idx++}`); }
    if (columna) { params.push(columna); conditions.push(`t.columna = $${idx++}`); }
    if (q) { params.push('%' + q + '%'); conditions.push(`(t.titulo ILIKE $${idx} OR t.descripcion ILIKE $${idx})`); idx++; }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM projects.tareas t ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const pg = parseInt(page) || 1;
    const lim = parseInt(limit) || 50;
    const offset = (pg - 1) * lim;

    const result = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       ${where}
       ORDER BY t.orden ASC, t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, lim, offset]
    );

    res.json({ exitosa: true, total, page: pg, limit: lim, tareas: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { proyecto_id, titulo, descripcion, tipo, prioridad, asignado_a, reportero, fecha_limite, estimacion_horas, columna } = req.body;
    if (!titulo) return res.status(400).json({ error: 'El título es requerido' });
    const col = columna || 'pendiente';
    const est = COLUMNA_A_ESTADO[col] || 'pendiente';
    const result = await pool.query(
      `INSERT INTO projects.tareas (proyecto_id, titulo, descripcion, tipo, prioridad, estado, columna, asignado_a, reportero, fecha_limite, estimacion_horas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [proyecto_id || null, titulo, descripcion || '', tipo || 'tarea', prioridad || 'media', est, col, asignado_a || null, reportero || null, fecha_limite || null, estimacion_horas || null]
    );
    res.status(201).json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { titulo, descripcion, tipo, prioridad, estado, columna, asignado_a, fecha_limite, estimacion_horas, horas_invertidas } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (titulo !== undefined) { updates.push(`titulo = $${idx++}`); params.push(titulo); }
    if (descripcion !== undefined) { updates.push(`descripcion = $${idx++}`); params.push(descripcion); }
    if (tipo !== undefined) { updates.push(`tipo = $${idx++}`); params.push(tipo); }
    if (prioridad !== undefined) { updates.push(`prioridad = $${idx++}`); params.push(prioridad); }
    if (estado !== undefined) { updates.push(`estado = $${idx++}`); params.push(estado); }
    if (columna !== undefined) {
      updates.push(`columna = $${idx++}`); params.push(columna);
      const est = COLUMNA_A_ESTADO[columna];
      if (est) { updates.push(`estado = $${idx++}`); params.push(est); }
    }
    if (asignado_a !== undefined) { updates.push(`asignado_a = $${idx++}`); params.push(asignado_a); }
    if (fecha_limite !== undefined) { updates.push(`fecha_limite = $${idx++}`); params.push(fecha_limite); }
    if (estimacion_horas !== undefined) { updates.push(`estimacion_horas = $${idx++}`); params.push(estimacion_horas); }
    if (horas_invertidas !== undefined) { updates.push(`horas_invertidas = $${idx++}`); params.push(horas_invertidas); }

    if (updates.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE projects.tareas SET ${updates.join(', ')} WHERE id = $${idx++} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/reordenar', async (req, res) => {
  try {
    const { tarea_id, columna, orden } = req.body;
    if (!tarea_id || !columna) return res.status(400).json({ error: 'tarea_id y columna requeridos' });
    const est = COLUMNA_A_ESTADO[columna] || 'pendiente';
    const result = await pool.query(
      `UPDATE projects.tareas SET columna = $1, estado = $2, orden = COALESCE($3, orden), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [columna, est, orden || 0, tarea_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects.tareas WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ exitosa: true, mensaje: 'Tarea eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
