'use strict';
const crypto = require('crypto');

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://127.0.0.1:3002';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';

/**
 * Envía una notificación in-app al launcher.
 * Siempre retorna { ok, id?, error? } — nunca lanza excepciones.
 *
 * @param {Object} opts
 * @param {number}  opts.usuario_id  — ID del usuario destino
 * @param {string}  opts.modulo      — Nombre del módulo (max 30)
 * @param {string}  opts.tipo        — Tipo de notificación (max 50)
 * @param {string}  opts.titulo      — Título (max 200)
 * @param {string}  opts.mensaje     — Mensaje (max 500)
 * @param {string}  [opts.url]       — URL de destino (max 300)
 * @param {string}  [opts.evento_id] — Idempotency key (si no se provee, genera UUID)
 * @returns {Promise<{ok: boolean, id?: number, error?: string}>}
 */
async function notificarInterna({ usuario_id, modulo, tipo, titulo, mensaje, url, evento_id }) {
  if (!usuario_id || !modulo || !tipo || !titulo || !mensaje) {
    return { ok: false, error: 'Faltan campos requeridos' };
  }
  if (!INTERNAL_API_TOKEN) {
    return { ok: false, error: 'INTERNAL_API_TOKEN no configurado' };
  }

  const idempotency_key = evento_id || crypto.randomUUID();
  const body = {
    usuario_id,
    modulo: String(modulo).slice(0, 30),
    tipo: String(tipo).slice(0, 50),
    titulo: String(titulo).slice(0, 200),
    mensaje: String(mensaje).slice(0, 500),
    url: url ? String(url).slice(0, 300) : null,
    idempotency_key
  };

  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(`${LAUNCHER_URL}/api/notificaciones/crear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': INTERNAL_API_TOKEN
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json();
      if (res.ok) return { ok: true, id: data.id };
      // No reintentar en 4xx (cliente)
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
    } catch (e) {
      // Reintentar en timeout/network solo en primer intento
      if (intento === 0) continue;
    }
  }
  return { ok: false, error: 'Fallo tras 2 intentos' };
}

module.exports = { notificarInterna };
