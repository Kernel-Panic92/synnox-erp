import express from 'express';
import pool from '../config/db.js';
import { enviarCorreo, templateAlertaVencimiento, templateResumenSemanal } from '../utils/email.js';

const router = express.Router();

// ─── Alertas de vencimiento (tareas sin avance próximas a vencer) ───
router.get('/alertas/vencimiento', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre, u.email AS asignado_email, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       LEFT JOIN launcher.usuarios u ON u.id = t.asignado_a
       WHERE t.estado NOT IN ('completada')
         AND t.fecha_limite IS NOT NULL
         AND t.fecha_limite <= CURRENT_DATE + INTERVAL '3 days'
         AND (t.horas_invertidas = 0 OR t.horas_invertidas IS NULL)
       ORDER BY t.fecha_limite ASC`
    );
    res.json({ exitosa: true, tareas: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Enviar alertas de vencimiento por email ───
router.post('/alertas/vencimiento/enviar', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre, u.email AS asignado_email, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       LEFT JOIN launcher.usuarios u ON u.id = t.asignado_a
       WHERE t.estado NOT IN ('completada')
         AND t.fecha_limite IS NOT NULL
         AND t.fecha_limite <= CURRENT_DATE + INTERVAL '3 days'
         AND (t.horas_invertidas = 0 OR t.horas_invertidas IS NULL)
       ORDER BY t.fecha_limite ASC`
    );

    const tareas = result.rows;
    if (tareas.length === 0) {
      return res.json({ exitosa: true, enviados: 0, mensaje: 'No hay tareas pendientes de vencimiento' });
    }

    // Group by assignee
    const porUsuario = {};
    for (const t of tareas) {
      const key = t.asignado_email || 'sin_asignar';
      if (!porUsuario[key]) porUsuario[key] = { email: t.asignado_email, nombre: t.asignado_nombre, tareas: [] };
      porUsuario[key].tareas.push(t);
    }

    let enviados = 0;
    for (const [key, grupo] of Object.entries(porUsuario)) {
      if (!grupo.email) continue;
      const vencidas = grupo.tareas.filter(t => new Date(t.fecha_limite) < new Date());
      const proximas = grupo.tareas.filter(t => new Date(t.fecha_limite) >= new Date());

      if (vencidas.length > 0) {
        try {
          await enviarCorreo(
            grupo.email,
            `⚠️ ${vencidas.length} tarea(s) vencida(s) — Acción requerida`,
            templateAlertaVencimiento({ tareas: vencidas, tipo: 'vencidas' })
          );
          enviados++;
        } catch (e) { console.warn('[email] Error enviando alerta vencidas:', e.message); }
      }
      if (proximas.length > 0) {
        try {
          await enviarCorreo(
            grupo.email,
            `⏰ ${proximas.length} tarea(s) próximas a vencer`,
            templateAlertaVencimiento({ tareas: proximas, tipo: 'proximas' })
          );
          enviados++;
        } catch (e) { console.warn('[email] Error enviando alertas próximas:', e.message); }
      }
    }

    // Also notify gerentes/admins
    try {
      const { rows: admins } = await pool.query(
        `SELECT email FROM launcher.usuarios WHERE rol IN ('admin','gerente') AND activo = 1`
      );
      for (const admin of admins) {
        if (admin.email) {
          await enviarCorreo(
            admin.email,
            `📊 Resumen de tareas con riesgo de vencimiento (${tareas.length} tareas)`,
            templateAlertaVencimiento({ tareas, tipo: 'proximas' })
          );
          enviados++;
        }
      }
    } catch (e) { console.warn('[email] Error notificando admins:', e.message); }

    res.json({ exitosa: true, enviados, totalTareas: tareas.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Resumen semanal ───
router.get('/alertas/resumen', async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT estado, COUNT(*) FROM projects.tareas GROUP BY estado`
    );
    const proyectos = await pool.query(
      `SELECT p.nombre, COUNT(t.id) AS total
       FROM projects.proyectos p
       LEFT JOIN projects.tareas t ON t.proyecto_id = p.id AND t.estado != 'completada'
       WHERE p.estado = 'activo'
       GROUP BY p.id, p.nombre
       ORDER BY total DESC
       LIMIT 10`
    );
    res.json({
      exitosa: true,
      stats: Object.fromEntries(stats.rows.map(r => [r.estado, r.count])),
      proyectos: proyectos.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Enviar resumen semanal por email ───
router.post('/alertas/resumen/enviar', async (req, res) => {
  try {
    const statsResult = await pool.query(
      `SELECT estado, COUNT(*) FROM projects.tareas GROUP BY estado`
    );
    const stats = Object.fromEntries(statsResult.rows.map(r => [r.estado, r.count]));

    const proyectosResult = await pool.query(
      `SELECT p.nombre, COUNT(t.id) AS total
       FROM projects.proyectos p
       LEFT JOIN projects.tareas t ON t.proyecto_id = p.id AND t.estado != 'completada'
       WHERE p.estado = 'activo'
       GROUP BY p.id, p.nombre
       ORDER BY total DESC
       LIMIT 10`
    );

    const html = templateResumenSemanal({ proyectos: proyectosResult.rows, stats });

    const { rows: admins } = await pool.query(
      `SELECT email FROM launcher.usuarios WHERE rol IN ('admin','gerente') AND activo = 1`
    );

    let enviados = 0;
    for (const admin of admins) {
      if (admin.email) {
        try {
          await enviarCorreo(admin.email, '📊 Resumen semanal de proyectos', html);
          enviados++;
        } catch (e) { console.warn('[email] Error enviando resumen:', e.message); }
      }
    }

    res.json({ exitosa: true, enviados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
