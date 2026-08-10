import pool from '../config/db.js';
import { notificar, esc } from './notify.js';
import { enviarCorreo, templateAlertaVencimiento } from './email.js';

const THRESHOLDS = [7, 3, 1];

function getDiasRestantes(fechaLimite) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const limite = new Date(fechaLimite);
  limite.setHours(0, 0, 0, 0);
  return Math.ceil((limite - hoy) / (1000 * 60 * 60 * 24));
}

function getUmbralEmoji(dias) {
  if (dias <= 1) return '🚨';
  if (dias <= 3) return '⏰';
  return '📅';
}

function getUmbralMensaje(dias) {
  if (dias <= 0) return 'Venció hoy — acción urgente requerida';
  if (dias === 1) return 'Vence mañana — acción urgente requerida';
  if (dias <= 3) return `Quedan ${dias} días — completa esta tarea pronto`;
  return `Tienes ${dias} días para completar esta tarea`;
}

let _usersCache = null;
let _usersCacheTs = 0;
const USERS_CACHE_TTL = 60000;
const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

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

export async function checkDueDateNotifications() {
  console.log('[scheduler] Checking due date notifications...');
  try {
    const result = await pool.query(`
      SELECT t.id, t.titulo, t.fecha_limite, t.prioridad, t.estado,
             t.asignado_a, t.last_notified_at,
             p.nombre AS proyecto_nombre
      FROM projects.tareas t
      LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
      WHERE t.estado NOT IN ('completada')
        AND t.fecha_limite IS NOT NULL
      ORDER BY t.fecha_limite ASC
    `);

    const users = await getLauncherUsers();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let notificacionesEnviadas = 0;

    for (const tarea of result.rows) {
      const diasRestantes = getDiasRestantes(tarea.fecha_limite);
      const umbral = THRESHOLDS.find(t => diasRestantes <= t && diasRestantes >= 0);
      if (!umbral) continue;

      const yaNotificadoHoy = tarea.last_notified_at && new Date(tarea.last_notified_at) >= today;
      if (yaNotificadoHoy) continue;

      const user = tarea.asignado_a ? users.find(u => u.id === tarea.asignado_a) : null;
      if (!user) continue;

      const emoji = getUmbralEmoji(diasRestantes);
      const titulo = `${emoji} ${tarea.titulo}`;
      const mensaje = `${getUmbralMensaje(diasRestantes)} — ${tarea.proyecto_nombre || 'Sin proyecto'}`;
      const url = `/proyectos/#tareas?proyecto=${tarea.proyecto_id || ''}`;

      const idempotency_key = `recordatorio_vencimiento_${tarea.id}_${umbral}d_${today.toISOString().split('T')[0]}`;

      await notificar({
        usuario_id: user.id,
        modulo: 'proyectos',
        tipo: 'recordatorio_vencimiento',
        titulo,
        mensaje,
        url,
        evento_id: idempotency_key,
        email: user.email,
        emailAsunto: `${emoji} ${diasRestantes <= 0 ? 'Vencida' : `${diasRestantes} día(s) para vencer`}: ${tarea.titulo}`,
        emailHtml: templateAlertaVencimiento({
          tareas: [{ ...tarea, proyecto_nombre: tarea.proyecto_nombre }],
          tipo: diasRestantes <= 0 ? 'vencidas' : 'proximas'
        }),
        enviarCorreo
      });

      notificacionesEnviadas++;
    }

    if (notificacionesEnviadas > 0) {
      await pool.query(`
        UPDATE projects.tareas
        SET last_notified_at = NOW()
        WHERE id IN (
          SELECT t.id FROM projects.tareas t
          WHERE t.estado NOT IN ('completada')
            AND t.fecha_limite IS NOT NULL
            AND t.fecha_limite <= CURRENT_DATE + INTERVAL '7 days'
            AND (t.last_notified_at IS NULL OR t.last_notified_at < CURRENT_DATE)
        )
      `);
    }

    console.log(`[scheduler] Due date notifications sent: ${notificacionesEnviadas}`);
  } catch (err) {
    console.error('[scheduler] Error checking due dates:', err.message);
  }
}
