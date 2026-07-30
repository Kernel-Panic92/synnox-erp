import { enviarCorreo } from './email.js';

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';
const BASE_URL = (() => {
  const domain = process.env.COMPANY_DOMAIN || 'localhost';
  return domain !== 'localhost' ? `https://${domain}/proyectos` : 'http://localhost:3101';
})();

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Cache simple de usuarios del launcher
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

async function getUserEmail(userId) {
  const users = await getLauncherUsers();
  const user = users.find(u => u.id === userId);
  return user ? { email: user.email, nombre: user.nombre } : null;
}

export async function notificar({ usuario_id, tipo, titulo, mensaje, url, email, emailAsunto, emailHtml }) {
  if (!usuario_id) return;

  // 1. In-app notification
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/notificaciones/crear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id, modulo: 'proyectos', tipo, titulo, mensaje, url })
    });
    if (!res.ok) console.warn('[notify] In-app response:', res.status);
  } catch (e) {
    console.warn('[notify] Error in-app:', e.message);
  }

  // 2. Email notification
  if (email && emailHtml) {
    try {
      await enviarCorreo(email, emailAsunto || titulo, emailHtml);
    } catch (e) {
      console.warn('[notify] Error email:', e.message);
    }
  }
}

// Helper para obtener datos de tarea (sin JOIN cross-DB)
export async function getTareaCompleta(pool, tareaId) {
  const result = await pool.query(`
    SELECT t.*, p.nombre AS proyecto_nombre, p.asignado_a AS proyecto_asignado_a
    FROM projects.tareas t
    LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
    WHERE t.id = $1
  `, [tareaId]);
  const tarea = result.rows[0] || null;
  if (tarea && tarea.asignado_a) {
    const user = await getUserEmail(tarea.asignado_a);
    if (user) {
      tarea.asignado_email = user.email;
      tarea.asignado_nombre = user.nombre;
    }
  }
  return tarea;
}

// Helper para obtener datos de proyecto (sin JOIN cross-DB)
export async function getProyectoCompleto(pool, proyectoId) {
  const result = await pool.query(`
    SELECT p.*
    FROM projects.proyectos p
    WHERE p.id = $1
  `, [proyectoId]);
  const proyecto = result.rows[0] || null;
  if (proyecto && proyecto.asignado_a) {
    const user = await getUserEmail(proyecto.asignado_a);
    if (user) {
      proyecto.asignado_email = user.email;
      proyecto.asignado_nombre = user.nombre;
    }
  }
  return proyecto;
}

export { BASE_URL, esc };
