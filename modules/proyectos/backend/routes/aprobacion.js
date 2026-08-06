import express from 'express';
import pool from '../config/db.js';
import { notificar, getProyectoCompleto, getEmailBaseUrl } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { templateAprobacion, templateAsignacion } = require('../../../../framework/email-templates');

const router = express.Router();

function canApprove(req) {
  return req.user.rol === 'admin' || req.user.rol === 'gerente';
}

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

let _usersCache = null;
let _usersCacheTs = 0;
const USERS_CACHE_TTL = 60000;

async function getLauncherUsers() {
  const now = Date.now();
  if (_usersCache && (now - _usersCacheTs) < USERS_CACHE_TTL) return _usersCache;
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/usuarios/public`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      _usersCache = Array.isArray(data) ? data : (data.usuarios || []);
      _usersCacheTs = now;
      return _usersCache;
    }
  } catch {}
  return [];
}

async function resolveUserEmail(userId) {
  const users = await getLauncherUsers();
  return users.find(u => u.id === userId) || null;
}

// Obtener tarea con datos de proyecto y asignado (sin cross-DB JOIN)
async function getTareaWithUser(tareaId) {
  const { rows } = await pool.query(
    `SELECT t.*, p.nombre AS proyecto_nombre
     FROM projects.tareas t
     LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
     WHERE t.id = $1`,
    [tareaId]
  );
  const tarea = rows[0] || null;
  if (tarea && tarea.asignado_a) {
    const user = await resolveUserEmail(tarea.asignado_a);
    if (user) {
      tarea.asignado_email = user.email;
      tarea.asignado_nombre = user.nombre;
    }
  }
  return tarea;
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

    const tareaFull = await getTareaWithUser(req.params.id);

    // Notificar al asignado (in-app + email)
    if (tarea.asignado_a) {
      try {
        notificar({
          usuario_id: tarea.asignado_a,
          modulo: 'proyectos',
          tipo: 'tarea_aprobada',
          titulo: 'Tarea aprobada',
          mensaje: `Tu tarea "${tarea.titulo}" fue aprobada por ${req.user.nombre}`,
          url: '/proyectos/#tareas',
          email: tareaFull?.asignado_email,
          emailAsunto: `✅ Tarea aprobada: ${tarea.titulo}`,
          emailHtml: templateAprobacion({ entidad: 'tarea', nombre: tarea.titulo, accion: 'aprobada', aprobador: req.user.nombre, url: `${await getEmailBaseUrl()}/#tareas`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
          enviarCorreo
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

    const tareaFull = await getTareaWithUser(req.params.id);

    // Notificar al asignado (in-app + email)
    if (tarea.asignado_a) {
      try {
        notificar({
          usuario_id: tarea.asignado_a,
          modulo: 'proyectos',
          tipo: 'tarea_rechazada',
          titulo: 'Tarea rechazada',
          mensaje: `Tu tarea "${tarea.titulo}" fue rechazada: ${motivo}`,
          url: '/proyectos/#tareas',
          email: tareaFull?.asignado_email,
          emailAsunto: `❌ Tarea rechazada: ${tarea.titulo}`,
          emailHtml: templateAprobacion({ entidad: 'tarea', nombre: tarea.titulo, accion: 'rechazada', motivo, aprobador: req.user.nombre, url: `${await getEmailBaseUrl()}/#tareas`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
          enviarCorreo
        });
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, tarea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proyectos/:id/aprobar', async (req, res) => {
  try {
    const check = await pool.query('SELECT asignado_a FROM projects.proyectos WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const esAdminGerente = req.user.rol === 'admin' || req.user.rol === 'gerente';
    const esCreador = check.rows[0].asignado_a === req.user.id;
    if (!esAdminGerente && !esCreador) return res.status(403).json({ error: 'Solo administradores, gerentes o el creador del proyecto pueden aprobarlo' });

    // Verificar que todas las tareas estén completadas
    const tareasCheck = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE estado != 'completada') AS pendientes
       FROM projects.tareas WHERE proyecto_id = $1`,
      [req.params.id]
    );
    const total = parseInt(tareasCheck.rows[0].total);
    const pendientes = parseInt(tareasCheck.rows[0].pendientes);
    if (total > 0 && pendientes > 0) {
      return res.status(400).json({ error: `No se puede aprobar: hay ${pendientes} tarea(s) de ${total} sin completar` });
    }

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
            modulo: 'proyectos',
            tipo: 'proyecto_aprobado',
            titulo: 'Proyecto aprobado',
            mensaje: `Tu proyecto "${proyecto.nombre}" fue aprobado por ${req.user.nombre}`,
            url: '/proyectos/#proyectos',
            email: proyectoFull.asignado_email,
            emailAsunto: `✅ Proyecto aprobado: ${proyecto.nombre}`,
            emailHtml: templateAprobacion({ entidad: 'proyecto', nombre: proyecto.nombre, accion: 'aprobada', aprobador: req.user.nombre, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
            enviarCorreo
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
  try {
    const check = await pool.query('SELECT asignado_a FROM projects.proyectos WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const esAdminGerente = req.user.rol === 'admin' || req.user.rol === 'gerente';
    const esCreador = check.rows[0].asignado_a === req.user.id;
    if (!esAdminGerente && !esCreador) return res.status(403).json({ error: 'Solo administradores, gerentes o el creador del proyecto pueden rechazarlo' });
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
            modulo: 'proyectos',
            tipo: 'proyecto_rechazado',
            titulo: 'Proyecto rechazado',
            mensaje: `Tu proyecto "${proyecto.nombre}" fue rechazado por ${req.user.nombre}`,
            url: '/proyectos/#proyectos',
            email: proyectoFull.asignado_email,
            emailAsunto: `❌ Proyecto rechazado: ${proyecto.nombre}`,
            emailHtml: templateAprobacion({ entidad: 'proyecto', nombre: proyecto.nombre, accion: 'rechazada', aprobador: req.user.nombre, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
            enviarCorreo
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

    const tareaFull = await getTareaWithUser(req.params.id);

    // Notify gerentes and admins (email + in-app)
    try {
      const users = await getLauncherUsers();
      const admins = users.filter(u => ['admin', 'gerente'].includes(u.rol));
      for (const admin of admins) {
        if (admin.email && admin.email !== tareaFull?.asignado_email) {
          notificar({
            usuario_id: admin.id,
            modulo: 'proyectos',
            tipo: 'tarea_revision',
            titulo: 'Tarea para revisar',
            mensaje: `"${tarea.titulo}" necesita revisión`,
            url: '/proyectos/#tareas',
            email: admin.email,
            emailAsunto: `📋 Tarea pendiente de revisión: ${tarea.titulo}`,
            emailHtml: templateAsignacion({ entidad: 'tarea', nombre: tarea.titulo, descripcion: tareaFull?.descripcion, prioridad: tarea.prioridad, url: `${await getEmailBaseUrl()}/#tareas`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
            enviarCorreo
          });
        }
      }
      // Notificar al reportero si es diferente al asignado y no es admin/gerente
      if (tareaFull?.reportero && tareaFull.reportero !== tarea.asignado_a && !admins.some(a => a.id === tareaFull.reportero)) {
        notificar({
          usuario_id: tareaFull.reportero,
          modulo: 'proyectos',
          tipo: 'tarea_revision',
          titulo: 'Tarea enviada a revisión',
          mensaje: `"${tarea.titulo}" fue enviada a revisión por ${req.user.nombre}`,
          url: '/proyectos/#tareas',
          email: tareaFull.reportero_email,
          emailAsunto: `📋 Tarea enviada a revisión: ${tarea.titulo}`,
          emailHtml: templateAsignacion({ entidad: 'tarea', nombre: tarea.titulo, descripcion: tareaFull?.descripcion, prioridad: tarea.prioridad, url: `${await getEmailBaseUrl()}/#tareas`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
          enviarCorreo
        });
      }
    } catch (e) { console.warn('[notify] Error enviando notificación de revisión:', e.message); }

    res.json({ exitosa: true, tarea });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
