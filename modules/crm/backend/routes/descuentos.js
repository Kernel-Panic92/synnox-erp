import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

// GET /api/descuentos — Listar solicitudes
router.get('/', requirePermiso('aprobar_descuento', 'crm'), async (req, res) => {
  try {
    const { estado, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (estado) {
      conditions.push(`d.estado = $${paramIdx++}`);
      params.push(estado);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.descuentos_solicitud d ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT d.*,
        cl.nombre AS cliente_nombre,
        c.numero AS cotizacion_numero,
        u1.nombre AS solicitado_por_nombre,
        u2.nombre AS aprobado_por_nombre
      FROM crm.descuentos_solicitud d
      LEFT JOIN crm.clientes cl ON cl.id = d.cliente_id
      LEFT JOIN crm.cotizaciones c ON c.id = d.cotizacion_id
      LEFT JOIN launcher.usuarios u1 ON u1.id = d.solicitado_por
      LEFT JOIN launcher.usuarios u2 ON u2.id = d.aprobado_por
      ${where}
      ORDER BY d.creado_en DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar descuentos:', err);
    res.status(500).json({ error: 'Error al listar solicitudes de descuento' });
  }
});

// GET /api/descuentos/pendientes — Solo pendientes
router.get('/pendientes', requirePermiso('aprobar_descuento', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*,
        cl.nombre AS cliente_nombre,
        c.numero AS cotizacion_numero,
        u1.nombre AS solicitado_por_nombre
      FROM crm.descuentos_solicitud d
      LEFT JOIN crm.clientes cl ON cl.id = d.cliente_id
      LEFT JOIN crm.cotizaciones c ON c.id = d.cotizacion_id
      LEFT JOIN launcher.usuarios u1 ON u1.id = d.solicitado_por
      WHERE d.estado = 'pendiente'
      ORDER BY d.creado_en ASC
    `);

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar pendientes:', err);
    res.status(500).json({ error: 'Error al listar pendientes' });
  }
});

// PUT /api/descuentos/:id/aprobar — Aprobar descuento
router.put('/:id/aprobar', requirePermiso('aprobar_descuento', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const solicitud = await client.query(`SELECT * FROM crm.descuentos_solicitud WHERE id = $1`, [id]);
    if (!solicitud.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (solicitud.rows[0].estado !== 'pendiente') {
      return res.status(400).json({ error: 'La solicitud ya fue resuelta' });
    }

    const result = await client.query(`
      UPDATE crm.descuentos_solicitud
      SET estado = 'aprobado', aprobado_por = $1, resuelto_en = NOW()
      WHERE id = $2
      RETURNING *
    `, [req.user.id, id]);

    // Aplicar descuento a la cotizacion
    const sol = solicitud.rows[0];
    await client.query(`
      UPDATE crm.cotizaciones SET valor_descuento = $1, actualizado_en = NOW() WHERE id = $2
    `, [sol.monto_original - sol.monto_final, sol.cotizacion_id]);

    // Recalcular totales
    const items = await client.query(`SELECT * FROM crm.cotizacion_items WHERE cotizacion_id = $1`, [sol.cotizacion_id]);
    let subtotal = 0;
    for (const item of items.rows) {
      const base = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
      const desc = base * (parseFloat(item.descuento_pct || 0) / 100);
      subtotal += base - desc;
    }
    const cfg = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'iva_porcentaje'`);
    const ivaPct = parseFloat(cfg.rows[0]?.valor || '19');
    const descuento = parseFloat(sol.monto_original - sol.monto_final);
    const baseDesc = subtotal - descuento;
    const iva = baseDesc * (ivaPct / 100);
    const total = baseDesc + iva;
    await client.query(`
      UPDATE crm.cotizaciones SET valor_subtotal = $1, valor_iva = $2, valor_total = $3 WHERE id = $4
    `, [subtotal, iva, total, sol.cotizacion_id]);

    await auditarEvento({ accion: 'aprobar_descuento', entidad: 'cotizacion', entidad_id: sol.cotizacion_id, usuario_id: req.user.id, metadata: { solicitud_id: id, valor: descuento } });

    await client.query('COMMIT');
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error aprobar descuento:', err);
    res.status(500).json({ error: 'Error al aprobar descuento' });
  } finally {
    client.release();
  }
});

// PUT /api/descuentos/:id/rechazar — Rechazar descuento
router.put('/:id/rechazar', requirePermiso('aprobar_descuento', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;

    const solicitud = await pool.query(`SELECT * FROM crm.descuentos_solicitud WHERE id = $1`, [id]);
    if (!solicitud.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (solicitud.rows[0].estado !== 'pendiente') {
      return res.status(400).json({ error: 'La solicitud ya fue resuelta' });
    }

    const result = await pool.query(`
      UPDATE crm.descuentos_solicitud
      SET estado = 'rechazado', aprobado_por = $1, motivo_rechazo = $2, resuelto_en = NOW()
      WHERE id = $3
      RETURNING *
    `, [req.user.id, motivo || null, id]);

    await auditarEvento({ accion: 'rechazar_descuento', entidad: 'cotizacion', entidad_id: solicitud.rows[0].cotizacion_id, usuario_id: req.user.id, metadata: { solicitud_id: id, motivo } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error rechazar descuento:', err);
    res.status(500).json({ error: 'Error al rechazar descuento' });
  }
});

export default router;
