import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

function isAdmin(req) {
  return req.user.rol === 'admin';
}

router.put('/tareas/:id/aprobar', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores pueden aprobar tareas' });
  try {
    const result = await pool.query(
      `UPDATE projects.tareas
       SET estado_aprobacion = 'aprobada',
           aprobado_por = $1,
           aprobado_en = NOW(),
           estado = 'completada',
           columna = 'completada',
           updated_at = NOW()
       WHERE id = $2 AND estado = 'revision'
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'La tarea debe estar en revisión para ser aprobada' });
    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tareas/:id/rechazar', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores pueden rechazar tareas' });
  const { motivo } = req.body;
  if (!motivo) return res.status(400).json({ error: 'Debes indicar un motivo de rechazo' });
  try {
    const result = await pool.query(
      `UPDATE projects.tareas
       SET estado_aprobacion = 'rechazada',
           aprobado_por = $1,
           aprobado_en = NOW(),
           motivo_rechazo = $2,
           estado = 'en_progreso',
           columna = 'en_progreso',
           updated_at = NOW()
       WHERE id = $3 AND estado = 'revision'
       RETURNING *`,
      [req.user.id, motivo, req.params.id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'La tarea debe estar en revisión para ser rechazada' });
    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proyectos/:id/aprobar', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores pueden aprobar proyectos' });
  try {
    const result = await pool.query(
      `UPDATE projects.proyectos
       SET estado_aprobacion = 'aprobada',
           aprobado_por = $1,
           aprobado_en = NOW(),
           estado = 'completado',
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proyectos/:id/rechazar', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores pueden rechazar proyectos' });
  try {
    const result = await pool.query(
      `UPDATE projects.proyectos
       SET estado_aprobacion = 'rechazada',
           aprobado_por = $1,
           aprobado_en = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
