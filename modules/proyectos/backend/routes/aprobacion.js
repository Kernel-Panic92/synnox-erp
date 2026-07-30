import express from 'express';
import pool from '../config/db.js';
import { notificar, getProyectoCompleto } from '../utils/notify.js';
import { enviarCorreo, templateAprobacionTarea, templateAprobacionProyecto, templateTareaEnRevision } from '../utils/email.js';

const router = express.Router();

function canApprove(req) {
  return req.user.rol === 'admin' || req.user.rol === 'gerente';
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

    const { rows: full } = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre, u.email AS asignado_email, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       LEFT JOIN launcher.usuarios u ON u.id = t.asignado_a
       WHERE t.id = $1`,
      [req.params.id]
    );
    const tareaFull = full[0] || tarea;

    // Notificar al asignado (in-app + email)
    if (tarea.asignado_a) {
      try {
        notificar({
          usuario_id: tarea.asignado_a,
          tipo: 'proyecto_aprobado',
          titulo: 'Tarea aprobada',
          mensaje: `Tu tarea "${tarea.titulo}" fue aprobada por ${req.user.nombre}`,
          url: '/proyectos/#tareas',
          email: tareaFull.asignado_email,
          emailAsunto: `✅ Tarea aprobada: ${tareaFull.titulo}`,
          emailHtml: templateAprobacionTarea({ tarea: tareaFull, accion: 'aprobada', aprobador: req.user.nombre })
        });
      } catch (e) { console.warn('[notify] Error:', e.message); }
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

    // Notificar al asignado (in-app + email)
    if (tarea.asignado_a) {
      try {
        notificar({
          usuario_id: tarea.asignado_a,
          tipo: 'proyecto_rechazado',
          titulo: 'Tarea rechazada',
          mensaje: `Tu tarea "${tarea.titulo}" fue rechazada: ${motivo}`,
          url: '/proyectos/#tareas',
          email: tareaFull.asignado_email,
          emailAsunto: `❌ Tarea rechazada: ${tareaFull.titulo}`,
          emailHtml: templateAprobacionTarea({ tarea: tareaFull, accion: 'rechazada', motivo, aprobador: req.user.nombre })
        });
      } catch (e) { console.warn('[notify] Error:', e.message); }
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
    const proyecto = result.rows[0];

    // Notificar al asignado del proyecto (in-app + email)
    if (proyecto.asignado_a) {
      try {
        const proyectoFull = await getProyectoCompleto(pool, req.params.id);
        if (proyectoFull) {
          notificar({
            usuario_id: proyecto.asignado_a,
            tipo: 'proyecto_aprobado',
            titulo: 'Proyecto aprobado',
            mensaje: `Tu proyecto "${proyecto.nombre}" fue aprobado por ${req.user.nombre}`,
            url: '/proyectos/#proyectos',
            email: proyectoFull.asignado_email,
            emailAsunto: `✅ Proyecto aprobado: ${proyecto.nombre}`,
            emailHtml: templateAprobacionProyecto({ proyecto, accion: 'aprobada', aprobador: req.user.nombre })
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, proyecto });
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
    const proyecto = result.rows[0];

    // Notificar al asignado del proyecto (in-app + email)
    if (proyecto.asignado_a) {
      try {
        const proyectoFull = await getProyectoCompleto(pool, req.params.id);
        if (proyectoFull) {
          notificar({
            usuario_id: proyecto.asignado_a,
            tipo: 'proyecto_rechazado',
            titulo: 'Proyecto rechazado',
            mensaje: `Tu proyecto "${proyecto.nombre}" fue rechazado por ${req.user.nombre}`,
            url: '/proyectos/#proyectos',
            email: proyectoFull.asignado_email,
            emailAsunto: `❌ Proyecto rechazado: ${proyecto.nombre}`,
            emailHtml: templateAprobacionProyecto({ proyecto, accion: 'rechazada', aprobador: req.user.nombre })
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, proyecto });
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

    // Notify gerentes and admins (email + in-app)
    try {
      const { rows: admins } = await pool.query(
        `SELECT id, email FROM launcher.usuarios WHERE rol IN ('admin','gerente') AND activo = 1`
      );
      for (const admin of admins) {
        if (admin.email && admin.email !== tareaFull.asignado_email) {
          // Email
          enviarCorreo(
            admin.email,
            `📋 Tarea pendiente de revisión: ${tareaFull.titulo}`,
            templateTareaEnRevision({ tarea: tareaFull })
          );
          // In-app
          notificar({
            usuario_id: admin.id,
            tipo: 'tarea_revision',
            titulo: 'Tarea para revisar',
            mensaje: `"${tareaFull.titulo}" necesita revisión`,
            url: '/proyectos/#tareas'
          });
        }
      }
    } catch (e) { console.warn('[email] Error enviando notificación de revisión:', e.message); }

    res.json({ exitosa: true, tarea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
