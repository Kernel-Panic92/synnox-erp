import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { notificar, getTareaCompleta, getEmailBaseUrl } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { templateNuevoComentario } = require('../../../../framework/email-templates');

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

    // Obtener tarea con datos completos
    const tarea = await getTareaCompleta(pool, req.params.id);
    if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

    const result = await pool.query(
      `INSERT INTO projects.comentarios (tarea_id, usuario_id, contenido) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, usuario_id, contenido]
    );

    // Auto-cambiar estado de pendiente a en_progreso
    if (tarea.estado === 'pendiente') {
      await pool.query(
        `UPDATE projects.tareas SET estado = 'en_progreso', columna = 'en_progreso', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
    }

    // Notificar al asignado de la tarea (siempre)
    const emailBase = await getEmailBaseUrl();
    if (tarea.asignado_a) {
      try {
        notificar({
          usuario_id: tarea.asignado_a,
          modulo: 'proyectos',
          tipo: 'nuevo_comentario',
          titulo: 'Nuevo comentario',
          mensaje: `${req.user.nombre} comentó en "${tarea.titulo}"`,
          url: '/proyectos/#tareas',
          email: tarea.asignado_email,
          emailAsunto: `[Proyectos] Nuevo comentario en: ${tarea.titulo}`,
          emailHtml: templateNuevoComentario({ entidad: 'tarea', nombre: tarea.titulo, autor: req.user.nombre, comentario: result.rows[0].contenido, url: `${emailBase}/#tareas`, module: 'proyectos', baseUrl: emailBase }),
          enviarCorreo
        });
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    // Notificar al reportero/creador si es diferente al asignado y al que comenta
    if (tarea.reportero && tarea.reportero !== usuario_id && tarea.reportero !== tarea.asignado_a) {
      try {
        notificar({
          usuario_id: tarea.reportero,
          modulo: 'proyectos',
          tipo: 'nuevo_comentario',
          titulo: 'Nuevo comentario',
          mensaje: `${req.user.nombre} comentó en "${tarea.titulo}"`,
          url: '/proyectos/#tareas',
          email: tarea.reportero_email,
          emailAsunto: `[Proyectos] Nuevo comentario en: ${tarea.titulo}`,
          emailHtml: templateNuevoComentario({ entidad: 'tarea', nombre: tarea.titulo, autor: req.user.nombre, comentario: result.rows[0].contenido, url: `${emailBase}/#tareas`, module: 'proyectos', baseUrl: emailBase }),
          enviarCorreo
        });
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.status(201).json({ exitosa: true, comentario: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
