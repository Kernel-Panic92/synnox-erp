import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

router.get('/', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');

    let result;
    if (soloPropios) {
      result = await pool.query(`
        SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        WHERE EXISTS (SELECT 1 FROM projects.tareas t2 WHERE t2.proyecto_id = p.id AND t2.asignado_a = $1)
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `, [req.user.id]);
    } else {
      result = await pool.query(`
        SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `);
    }
    res.json({ exitosa: true, proyectos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');

    let result;
    if (soloPropios) {
      result = await pool.query(
        `SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        WHERE p.id = $1 AND EXISTS (SELECT 1 FROM projects.tareas t2 WHERE t2.proyecto_id = p.id AND t2.asignado_a = $2)
        GROUP BY p.id`,
        [req.params.id, req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        WHERE p.id = $1
        GROUP BY p.id`,
        [req.params.id]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermiso('crear', 'proyectos'), async (req, res) => {
  try {
    const { nombre, descripcion, fecha_limite, centro_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO projects.proyectos (nombre, descripcion, fecha_limite, centro_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, descripcion || '', fecha_limite || null, centro_id || null]
    );
    res.status(201).json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermiso('editar', 'proyectos'), async (req, res) => {
  try {
    const { nombre, descripcion, estado, fecha_limite, centro_id } = req.body;
    const result = await pool.query(
      `UPDATE projects.proyectos
       SET nombre = COALESCE($1, nombre),
           descripcion = COALESCE($2, descripcion),
           estado = COALESCE($3, estado),
           fecha_limite = COALESCE($4, fecha_limite),
           centro_id = $5,
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [nombre || null, descripcion || null, estado || null, fecha_limite || null, centro_id !== undefined ? centro_id : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermiso('eliminar', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects.proyectos WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, mensaje: 'Proyecto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
