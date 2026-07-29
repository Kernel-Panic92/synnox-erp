import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

router.get('/:id/comentarios', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.* FROM projects.comentarios c
       WHERE c.tarea_id = $1
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({ exitosa: true, comentarios: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/comentarios', requirePermiso('comentar', 'proyectos'), async (req, res) => {
  try {
    const { contenido } = req.body;
    if (!contenido) return res.status(400).json({ error: 'El contenido es requerido' });
    const usuario_id = req.user.id;
    const tarea = await pool.query('SELECT id FROM projects.tareas WHERE id = $1', [req.params.id]);
    if (tarea.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const result = await pool.query(
      `INSERT INTO projects.comentarios (tarea_id, usuario_id, contenido) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, usuario_id, contenido]
    );
    res.status(201).json({ exitosa: true, comentario: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
