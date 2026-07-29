import express from 'express';
import pool from '../config/db.js';
import { enviarCorreo, templateAprobacionTarea, templateAprobacionProyecto, templateTareaEnRevision } from '../utils/email.js';

const router = express.Router();

function canApprove(req) {
  return req.user.rol === 'admin' || req.user.rol === 'gerente';
}

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

async function getUserById(id) {
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/admin/usuarios`, {
      headers: { 'Authorization': `Bearer ${req?.headers?.authorization?.split(' ')[1] || ''}` }
    });
    if (!res.ok) return null;
    const users = await res.json();
    return users.find(u => u.id === id) || null;
  } catch { return null; }
}

async function resolveUserEmail(userId) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.nombre FROM launcher.usuarios u WHERE u.id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

router.put('/tareas/:id/aprobar', async (req, res) => {
  if (!canApprove(req)) return res.status(403).json({ error: 'Solo administradores o gerentes pueden aprobar tareas' });
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
    const tarea = result.rows[0];

    // Fetch task with project name and assignee email
    const { rows: full } = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre, u.email AS asignado_email, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       LEFT JOIN launcher.usuarios u ON u.id = t.asignado_a
       WHERE t.id = $1`,
      [req.params.id]
    );
    const tareaFull = full[0] || tarea;

    // Send email notification
    if (tareaFull.asignado_email) {
      try {
        await enviarCorreo(
          tareaFull.asignado_email,
          `✅ Tarea aprobada: ${tareaFull.titulo}`,
          templateAprobacionTarea({ tarea: tareaFull, accion: 'aprobada', aprobador: req.user.nombre })
        );
      } catch (e) { console.warn('[email] Error enviando notificación de aprobación:', e.message); }
    }

    // Notificación in-app
    if (tarea.asignado_a) {
      try {
        await fetch('http://127.0.0.1:3002/api/notificaciones/crear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario_id: tarea.asignado_a, modulo: 'proyectos', tipo: 'proyecto_aprobado', titulo: 'Tarea aprobada', mensaje: 'Tu tarea "' + tarea.titulo + '" fue aprobada por ' + req.user.nombre, url: '/proyectos/#tareas' })
        });
      } catch {}
    }

    res.json({ exitosa: true, tarea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tareas/:id/rechazar', async (req, res) => {
  if (!canApprove(req)) return res.status(403).json({ error: 'Solo administradores o gerentes pueden rechazar tareas' });
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
    const tarea = result.rows[0];

    const { rows: full } = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre, u.email AS asignado_email, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       LEFT JOIN launcher.usuarios u ON u.id = t.asignado_a
       WHERE t.id = $1`,
      [req.params.id]
    );
    const tareaFull = full[0] || tarea;

    if (tareaFull.asignado_email) {
      try {
        await enviarCorreo(
          tareaFull.asignado_email,
          `❌ Tarea rechazada: ${tareaFull.titulo}`,
          templateAprobacionTarea({ tarea: tareaFull, accion: 'rechazada', motivo, aprobador: req.user.nombre })
        );
      } catch (e) { console.warn('[email] Error enviando notificación de rechazo:', e.message); }
    }

    // Notificación in-app
    if (tarea.asignado_a) {
      try {
        await fetch('http://127.0.0.1:3002/api/notificaciones/crear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario_id: tarea.asignado_a, modulo: 'proyectos', tipo: 'proyecto_rechazado', titulo: 'Tarea rechazada', mensaje: 'Tu tarea "' + tarea.titulo + '" fue rechazada: ' + motivo, url: '/proyectos/#tareas' })
        });
      } catch {}
    }

    res.json({ exitosa: true, tarea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proyectos/:id/aprobar', async (req, res) => {
  if (!canApprove(req)) return res.status(403).json({ error: 'Solo administradores o gerentes pueden aprobar proyectos' });
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
  if (!canApprove(req)) return res.status(403).json({ error: 'Solo administradores o gerentes pueden rechazar proyectos' });
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

// ─── Notificación de tarea enviada a revisión ───
router.put('/tareas/:id/solicitar-revision', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE projects.tareas
       SET estado = 'revision', columna = 'revision',
           estado_aprobacion = 'pendiente',
           updated_at = NOW()
       WHERE id = $1 AND estado = 'en_progreso'
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'La tarea debe estar en progreso para solicitar revisión' });
    const tarea = result.rows[0];

    const { rows: full } = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre, u.email AS asignado_email, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       LEFT JOIN launcher.usuarios u ON u.id = t.asignado_a
       WHERE t.id = $1`,
      [req.params.id]
    );
    const tareaFull = full[0] || tarea;

    // Notify gerentes and admins
    try {
      const { rows: admins } = await pool.query(
        `SELECT email FROM launcher.usuarios WHERE rol IN ('admin','gerente') AND activo = 1`
      );
      for (const admin of admins) {
        if (admin.email && admin.email !== tareaFull.asignado_email) {
          await enviarCorreo(
            admin.email,
            `📋 Tarea pendiente de revisión: ${tareaFull.titulo}`,
            templateTareaEnRevision({ tarea: tareaFull })
          );
        }
      }
    } catch (e) { console.warn('[email] Error enviando notificación de revisión:', e.message); }

    res.json({ exitosa: true, tarea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
