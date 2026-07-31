const smtp = require('./smtp.service');
const db   = require('../db');
const { debeEnviarEmail } = require('../../../../framework/email-check');
const { notificarInterna } = require('../../../../framework/notify');

/**
 * Notificaciones in-app + email en cada transición del flujo de facturas.
 * Se llama desde las rutas de facturas.
 */

const tipoEventoMap = {
  recibida:       'factura_recibida',
  asignada:       'factura_asignada',
  revision:       'factura_en_revision',
  aprobada:       'factura_aprobada',
  rechazada:      'factura_rechazada',
  causada:        'factura_causada',
  pagada:         'factura_pagada',
  escalacion_nivel1: 'escalacion',
  escalacion_nivel2: 'escalacion',
};

const tipoLabel = {
  recibida: 'recibida', asignada: 'asignada', revision: 'en revisión',
  aprobada: 'aprobada', rechazada: 'rechazada', causada: 'causada',
  pagada: 'pagada', escalacion_nivel1: 'escalación', escalacion_nivel2: 'escalación',
};

async function notificarTransicion(factura, tipo, usuario, comentario = null) {
  const evento = tipoEventoMap[tipo] || tipo;
  const f = await obtenerDatosFactura(factura.id);
  if (!f) return;

  // 1. In-app notifications
  try {
    const destinatarios = await obtenerDestinatariosInApp(f, tipo);
    const titulo = `Factura ${tipoLabel[tipo] || tipo}`;
    const mensaje = `Factura #${f.numero_factura || f.id} de ${f.proveedor || '—'} — ${tipoLabel[tipo] || tipo}`;
    for (const uid of destinatarios) {
      void notificarInterna({
        usuario_id: uid,
        modulo: 'proveedores',
        tipo: evento,
        titulo,
        mensaje,
        url: '/proveedores/#facturas',
        evento_id: `proveedores-${evento}-${f.id}-${uid}`
      }).then(r => { if (!r.ok) console.warn('[notif] in-app error:', r.error); });
    }
  } catch (e) {
    console.error('[Notif] Error in-app:', e.message);
  }

  // 2. Email notifications
  if (!smtp.isConfigured()) return;
  if (!(await debeEnviarEmail('proveedores', evento))) return;

  const tipoEmail = tipoLabel[tipo] || tipo;
  const emails = await obtenerDestinatariosEmail(f, tipoEmail);
  if (emails.length === 0) return;

  for (const email of emails) {
    try {
      await smtp.enviarNotificacionFactura({
        para:       email,
        tipo:       tipoEmail,
        factura:    f,
        usuario:    usuario?.nombre || null,
        comentario,
      });
    } catch (err) {
      console.error(`[Notif] Error enviando email a ${email}:`, err.message);
    }
  }
}

async function obtenerDatosFactura(facturaId) {
  try {
    const { rows } = await db.query(
      `SELECT f.*,
              p.nombre  AS proveedor,
              c.nombre  AS categoria,
              a.nombre  AS area,
              u.nombre  AS asignado_nombre,
              u.email   AS asignado_email
       FROM facturas f
       LEFT JOIN proveedores p ON p.id = f.proveedor_id
       LEFT JOIN categorias_compra c ON c.id = f.categoria_id
       LEFT JOIN areas a ON a.id = f.area_responsable_id
       LEFT JOIN usuarios u ON u.id = f.asignado_a_id
       WHERE f.id = $1`,
      [facturaId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[Notif] Error obteniendo datos factura:', err.message);
    return null;
  }
}

async function obtenerLauncherUserIdByEmail(email) {
  if (!email) return null;
  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const res = await client.query('SELECT id FROM launcher.usuarios WHERE email = $1 AND activo = 1', [email]);
    await client.end();
    return res.rows[0]?.id || null;
  } catch { return null; }
}

async function obtenerDestinatariosInApp(factura, tipo) {
  const ids = new Set();

  switch (tipo) {
    case 'recibida':
    case 'asignada':
    case 'revision':
    case 'escalacion_nivel1':
    case 'escalacion_nivel2': {
      // Notificar al asignado
      if (factura.asignado_a_id) ids.add(factura.asignado_a_id);
      // Notificar a admins/contadores del launcher
      try {
        const { rows } = await db.query("SELECT id FROM launcher.usuarios WHERE rol IN ('admin','contador') AND activo = 1");
        rows.forEach(r => ids.add(r.id));
      } catch {}
      break;
    }
    case 'aprobada':
    case 'causada': {
      // Notificar a tesoreros/contadores
      try {
        const { rows } = await db.query("SELECT id FROM launcher.usuarios WHERE rol IN ('admin','tesorero','contador') AND activo = 1");
        rows.forEach(r => ids.add(r.id));
      } catch {}
      break;
    }
    case 'rechazada':
    case 'pagada': {
      if (factura.asignado_a_id) ids.add(factura.asignado_a_id);
      try {
        const { rows } = await db.query("SELECT id FROM launcher.usuarios WHERE rol = 'admin' AND activo = 1");
        rows.forEach(r => ids.add(r.id));
      } catch {}
      break;
    }
    default:
      break;
  }

  return Array.from(ids);
}

async function obtenerDestinatariosEmail(factura, tipo) {
  const emails = new Set();

  const cfgEmail = await db.query(
    "SELECT valor FROM configuracion WHERE clave = 'email_notificaciones'"
  );
  if (cfgEmail.rows[0]?.valor) {
    emails.add(cfgEmail.rows[0].valor);
  }

  switch (tipo) {
    case 'recibida':
    case 'revision':
    case 'escalacion':
      if (factura.asignado_email) emails.add(factura.asignado_email);
      const areaUsers = await db.query(
        `SELECT email FROM usuarios u WHERE u.area_id = $1 AND u.activo = TRUE`,
        [factura.area_responsable_id]
      );
      areaUsers.rows.forEach(r => emails.add(r.email));
      break;

    case 'aprobada':
    case 'causada':
      const financieros = await db.query(
        `SELECT email FROM usuarios
         WHERE rol IN ('tesorero', 'contador', 'admin') AND activo = TRUE`
      );
      financieros.rows.forEach(r => emails.add(r.email));
      break;

    case 'rechazada':
      if (factura.asignado_email) emails.add(factura.asignado_email);
      const areaEmails = await db.query(
        `SELECT email FROM usuarios u WHERE u.area_id = $1 AND u.activo = TRUE LIMIT 5`,
        [factura.area_responsable_id]
      );
      areaEmails.rows.forEach(r => emails.add(r.email));
      break;

    case 'pagada':
      if (factura.asignado_email) emails.add(factura.asignado_email);
      const areaFinal = await db.query(
        `SELECT email FROM usuarios u WHERE u.area_id = $1 AND u.activo = TRUE LIMIT 3`,
        [factura.area_responsable_id]
      );
      areaFinal.rows.forEach(r => emails.add(r.email));
      break;

    default:
      break;
  }

  return Array.from(emails).filter(e => e && e.includes('@'));
}

// ─── Helpers para integrar con rutas de facturas ─────────────────────────────

async function onFacturaRecibida(facturaId, usuario, metadata = null) {
  await registrarYNotificar(facturaId, usuario, 'recibida', metadata);
}

async function onFacturaAsignada(facturaId, usuario, metadata = null) {
  await registrarYNotificar(facturaId, usuario, 'asignada', metadata);
}

async function onFacturaRevision(facturaId, usuario) {
  await registrarYNotificar(facturaId, usuario, 'revision');
}

async function onFacturaAprobada(facturaId, usuario, comentario = null) {
  await registrarYNotificar(facturaId, usuario, 'aprobada', null, comentario);
}

async function onFacturaRechazada(facturaId, usuario, motivo) {
  await registrarYNotificar(facturaId, usuario, 'rechazada', null, motivo);
}

async function onFacturaCausada(facturaId, usuario, comentario = null) {
  await registrarYNotificar(facturaId, usuario, 'causada', null, comentario);
}

async function onFacturaPagada(facturaId, usuario) {
  await registrarYNotificar(facturaId, usuario, 'pagada');
}

async function onEscalacion(facturaId, nivel, usuario = null) {
  const tipo = nivel === 2 ? 'escalacion_nivel2' : 'escalacion_nivel1';
  await registrarYNotificar(facturaId, usuario, tipo);
}

async function registrarYNotificar(facturaId, usuario, tipo, metadata = null, comentario = null) {
  // El evento ya se registra en la ruta, solo notificamos aquí
  const factura = { id: facturaId };
  try {
    await notificarTransicion(factura, tipo, usuario, comentario);
  } catch (err) {
    console.error(`[Notif] Error en notificarTransicion (${tipo}):`, err.message);
  }
}

module.exports = {
  notificarTransicion,
  onFacturaRecibida,
  onFacturaAsignada,
  onFacturaRevision,
  onFacturaAprobada,
  onFacturaRechazada,
  onFacturaCausada,
  onFacturaPagada,
  onEscalacion,
};
