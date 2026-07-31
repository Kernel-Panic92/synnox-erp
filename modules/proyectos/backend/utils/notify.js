import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { notificar } = require('../../../../framework/notify');

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

let _baseUrl = null;

async function getBaseUrl() {
  if (_baseUrl) return _baseUrl;
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/smtp/internal`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data.baseUrl) {
        _baseUrl = `${data.baseUrl}/proyectos`;
        return _baseUrl;
      }
    }
  } catch {}
  const domain = process.env.COMPANY_DOMAIN || 'localhost';
  _baseUrl = domain !== 'localhost' ? `https://${domain}/proyectos` : `http://localhost:3101`;
  return _baseUrl;
}

// Pre-fetch on module load
getBaseUrl().catch(() => {});

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

export async function getTareaCompleta(pool, tareaId) {
  const result = await pool.query(`
    SELECT t.*, p.nombre AS proyecto_nombre, p.asignado_a AS proyecto_asignado_a
    FROM projects.tareas t
    LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
    WHERE t.id = $1
  `, [tareaId]);
  const tarea = result.rows[0] || null;
  if (tarea) {
    if (tarea.asignado_a) {
      const user = await getUserEmail(tarea.asignado_a);
      if (user) {
        tarea.asignado_email = user.email;
        tarea.asignado_nombre = user.nombre;
      }
    }
    if (tarea.reportero) {
      const reporter = await getUserEmail(tarea.reportero);
      if (reporter) {
        tarea.reportero_email = reporter.email;
        tarea.reportero_nombre = reporter.nombre;
      }
    }
    if (tarea.proyecto_asignado_a && tarea.proyecto_asignado_a !== tarea.asignado_a) {
      const owner = await getUserEmail(tarea.proyecto_asignado_a);
      if (owner) {
        tarea.proyecto_owner_email = owner.email;
        tarea.proyecto_owner_nombre = owner.nombre;
        tarea.proyecto_owner_id = tarea.proyecto_asignado_a;
      }
    }
  }
  return tarea;
}

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

export { notificar, esc };

// Re-export email helpers
export { getEmailBaseUrl, getEmailModuleOpts } from './email.js';
