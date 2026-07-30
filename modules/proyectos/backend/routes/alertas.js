import express from 'express';
import pool from '../config/db.js';
import { enviarCorreo, templateAlertaVencimiento, templateResumenSemanal } from '../utils/email.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

function soloAdminGerente(req, res, next) {
  if (req.user?.rol !== 'admin' && req.user?.rol !== 'gerente') {
    return res.status(403).json({ error: 'Solo administradores y gerentes pueden realizar esta acción' });
  }
  next();
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

async function getTareasConUsuarios(query, params) {
  const result = await pool.query(query, params);
  const users = await getLauncherUsers();
  return result.rows.map(t => {
    if (t.asignado_a) {
      const user = users.find(u => u.id === t.asignado_a);
      if (user) {
        t.asignado_email = user.email;
        t.asignado_nombre = user.nombre;
      }
    }
    return t;
  });
}

// ─── Alertas de vencimiento (tareas sin avance próximas a vencer) ───
router.get('/alertas/vencimiento', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const tareas = await getTareasConUsuarios(
      `SELECT t.*, p.nombre AS proyecto_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       WHERE t.estado NOT IN ('completada')
         AND t.fecha_limite IS NOT NULL
         AND t.fecha_limite <= CURRENT_DATE + INTERVAL '3 days'
         AND (t.horas_invertidas = 0 OR t.horas_invertidas IS NULL)
       ORDER BY t.fecha_limite ASC`
    );
    res.json({ exitosa: true, tareas, total: tareas.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Enviar alertas de vencimiento por email ───
router.post('/alertas/vencimiento/enviar', requirePermiso('configurar', 'proyectos'), soloAdminGerente, async (req, res) => {
  try {
    const tareas = await getTareasConUsuarios(
      `SELECT t.*, p.nombre AS proyecto_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       WHERE t.estado NOT IN ('completada')
         AND t.fecha_limite IS NOT NULL
         AND t.fecha_limite <= CURRENT_DATE + INTERVAL '3 days'
         AND (t.horas_invertidas = 0 OR t.horas_invertidas IS NULL)
       ORDER BY t.fecha_limite ASC`
    );

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
      const users = await getLauncherUsers();
      const admins = users.filter(u => ['admin', 'gerente'].includes(u.rol));
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
router.get('/alertas/resumen', requirePermiso('ver', 'proyectos'), async (req, res) => {
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
router.post('/alertas/resumen/enviar', requirePermiso('configurar', 'proyectos'), soloAdminGerente, async (req, res) => {
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

    const users = await getLauncherUsers();
    const admins = users.filter(u => ['admin', 'gerente'].includes(u.rol));

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
