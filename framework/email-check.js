'use strict';

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://127.0.0.1:3002';

const _cache = new Map();
const CACHE_TTL = 60_000;

/**
 * Consulta al launcher si un evento de email está habilitado.
 * Fail-safe: si el launcher no responde, retorna true (envía por defecto).
 *
 * @param {string} modulo - Nombre del módulo ('proyectos', 'nomina', etc.)
 * @param {string} evento - Nombre del evento ('tarea_asignada', etc.)
 * @returns {Promise<boolean>}
 */
async function debeEnviarEmail(modulo, evento) {
  const key = `${modulo}:${evento}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.val;

  try {
    const res = await fetch(`${LAUNCHER_URL}/api/email-notif/check/${modulo}/${evento}`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return true;
    const data = await res.json();
    const val = data.habilitado !== false;
    _cache.set(key, { val, ts: Date.now() });
    return val;
  } catch {
    return true;
  }
}

function invalidateEmailCheckCache() {
  _cache.clear();
}

module.exports = { debeEnviarEmail, invalidateEmailCheckCache };
