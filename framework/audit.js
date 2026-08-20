const crypto = require('crypto');

const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'token', 'access_token', 'refresh_token',
  'secret', 'api_key', 'authorization', 'smtp_pass', 'private_key'
]);
const MAX_DEPTH = 8;

let configuredPool = null;
let configuredOptions = {};
let auditFailures = 0;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

function configureAudit(pool, options = {}) {
  configuredPool = pool;
  configuredOptions = { ...options };
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map(item => sanitizeMetadata(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    clean[key] = sanitizeMetadata(child, depth + 1);
  }
  return clean;
}

function maskIp(ip) {
  if (!ip) return ip;
  if (ip.includes(':')) return ip.replace(/:[^:]+$/, ':0');
  return ip.replace(/\.\d+$/, '.0');
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function integrityHash(event, secret) {
  if (!secret) return null;
  const critical = {
    ocurrido_en: event.ocurrido_en || null,
    modulo: event.modulo,
    categoria: event.categoria,
    accion: event.accion,
    resultado: event.resultado,
    actor_id: event.actor_id || null,
    entidad_tipo: event.entidad_tipo || null,
    entidad_id: event.entidad_id || null,
    metadata: event.metadata
  };
  return crypto.createHmac('sha256', secret).update(JSON.stringify(critical)).digest('hex');
}

function normalizeEvent(input, options) {
  const metadata = sanitizeMetadata(input.metadata || {});
  const event = {
    ...input,
    modulo: String(input.modulo || 'unknown').slice(0, 100),
    categoria: String(input.categoria || 'system').slice(0, 50),
    accion: String(input.accion || 'unknown').slice(0, 100),
    resultado: String(input.resultado || 'advertencia').slice(0, 30),
    actor_tipo: String(input.actor_tipo || 'usuario').slice(0, 30),
    actor_email: options.maskEmail === false ? input.actor_email : maskEmail(input.actor_email),
    ip: options.maskIp ? maskIp(input.ip) : input.ip,
    user_agent: input.user_agent ? String(input.user_agent).slice(0, 512) : null,
    resumen: input.resumen ? String(input.resumen).slice(0, 1000) : null,
    metadata
  };
  event.hash_inmutabilidad = input.hash_inmutabilidad || integrityHash(event, options.integritySecret);
  return event;
}

async function auditarEvento(input, pool = configuredPool) {
  if (!pool || !input || typeof input !== 'object') return null;
  const event = normalizeEvent(input, configuredOptions);
  try {
    const result = await pool.query(
      `INSERT INTO public.auditoria_central
       (ocurrido_en, modulo, categoria, accion, resultado, actor_id, actor_tipo,
        actor_email, sesion_id, ip, user_agent, entidad_tipo, entidad_id, resumen,
        metadata, hash_inmutabilidad)
       VALUES (COALESCE($1, NOW()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15::jsonb, $16)
       RETURNING id`,
      [
        input.ocurrido_en || null, event.modulo, event.categoria, event.accion,
        event.resultado, event.actor_id || null, event.actor_tipo, event.actor_email || null,
        input.sesion_id || null, event.ip || null, event.user_agent, input.entidad_tipo || null,
        input.entidad_id || null, event.resumen, JSON.stringify(event.metadata),
        event.hash_inmutabilidad
      ]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    auditFailures += 1;
    console.error('[audit] failed', error.message);
    return null;
  }
}

function getAuditFailureCount() {
  return auditFailures;
}

async function ejecutarRetencion(pool = configuredPool) {
  if (!pool) return 0;
  try {
    const config = await pool.query(
      "SELECT clave, valor FROM public.auditoria_config WHERE clave IN ('retencion_dias', 'retencion_habilitada')"
    );
    const values = Object.fromEntries(config.rows.map(row => [row.clave, row.valor]));
    if (values.retencion_habilitada !== 'true') return 0;
    const result = await pool.query(
      'SELECT public.purgar_auditoria_central($1) AS eliminadas',
      [Math.max(1, parseInt(values.retencion_dias, 10) || 365)]
    );
    const deleted = Number(result.rows[0]?.eliminadas || 0);
    if (deleted) console.log(`[audit] eventos eliminados por retencion: ${deleted}`);
    return deleted;
  } catch (error) {
    console.error('[audit] retention failed', error.message);
    return 0;
  }
}

function startAuditRetentionJob(pool = configuredPool) {
  const check = () => ejecutarRetencion(pool);
  const timer = setInterval(check, RETENTION_INTERVAL_MS);
  timer.unref?.();
  check();
  return timer;
}

function diffSeguro(before = {}, after = {}) {
  const cleanBefore = sanitizeMetadata(before);
  const cleanAfter = sanitizeMetadata(after);
  const keys = new Set([...Object.keys(cleanBefore), ...Object.keys(cleanAfter)]);
  const diff = {};
  for (const key of keys) {
    if (JSON.stringify(cleanBefore[key]) !== JSON.stringify(cleanAfter[key])) {
      diff[key] = { antes: cleanBefore[key], despues: cleanAfter[key] };
    }
  }
  return diff;
}

module.exports = {
  configureAudit,
  auditarEvento,
  sanitizeMetadata,
  diffSeguro,
  getAuditFailureCount,
  ejecutarRetencion,
  startAuditRetentionJob
};
