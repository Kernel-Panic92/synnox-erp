import { enviarCorreo } from './email.js';

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';
const BASE_URL = (() => {
  const domain = process.env.COMPANY_DOMAIN || 'localhost';
  return domain !== 'localhost' ? `https://${domain}/proyectos` : 'http://localhost:3101';
})();

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// Helper para obtener datos completos de tarea (asignado, proyecto, etc.)
export async function getTareaCompleta(pool, tareaId) {
  const result = await pool.query(`
    SELECT t.*, p.nombre AS proyecto_nombre, p.asignado_a AS proyecto_asignado_a,
           u1.email AS asignado_email, u1.nombre AS asignado_nombre,
           u2.email AS reportero_email, u2.nombre AS reportero_nombre
    FROM projects.tareas t
    LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
    LEFT JOIN launcher.usuarios u1 ON u1.id = t.asignado_a
    LEFT JOIN launcher.usuarios u2 ON u2.id = t.reportero
    WHERE t.id = $1
  `, [tareaId]);
  return result.rows[0] || null;
}

// Helper para obtener datos completos de proyecto
export async function getProyectoCompleto(pool, proyectoId) {
  const result = await pool.query(`
    SELECT p.*,
           u1.email AS asignado_email, u1.nombre AS asignado_nombre
    FROM projects.proyectos p
    LEFT JOIN launcher.usuarios u1 ON u1.id = p.asignado_a
    WHERE p.id = $1
  `, [proyectoId]);
  return result.rows[0] || null;
}

// URL base para links en emails
export { BASE_URL, esc };
