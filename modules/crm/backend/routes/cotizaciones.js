import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

// Helper: generar numero de cotizacion
async function generarNumero(client) {
  const cfg = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'numero_cotizacion_prefijo'`);
  const con = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'numero_cotizacion_consecutivo'`);
  const prefijo = cfg.rows[0]?.valor || 'COT';
  const num = parseInt(con.rows[0]?.valor || '1');
  const numero = `${prefijo}-${String(num).padStart(5, '0')}`;
  await client.query(`UPDATE crm.configuracion SET valor = $1, actualizado_en = NOW() WHERE clave = 'numero_cotizacion_consecutivo'`, [String(num + 1)]);
  return numero;
}

// Helper: recalcular totales de cotizacion
async function recalcularTotales(client, cotizacionId) {
  const items = await client.query(`SELECT * FROM crm.cotizacion_items WHERE cotizacion_id = $1`, [cotizacionId]);
  let subtotal = 0;
  for (const item of items.rows) {
    const base = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
    const desc = base * (parseFloat(item.descuento_pct || 0) / 100);
    subtotal += base - desc;
    await client.query(`UPDATE crm.cotizacion_items SET subtotal = $1 WHERE id = $2`, [base - desc, item.id]);
  }

  const cfg = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'iva_porcentaje'`);
  const ivaPct = parseFloat(cfg.rows[0]?.valor || '19');
  const cot = await client.query(`SELECT valor_descuento FROM crm.cotizaciones WHERE id = $1`, [cotizacionId]);
  const descuento = parseFloat(cot.rows[0]?.valor_descuento || 0);
  const baseDesc = subtotal - descuento;
  const iva = baseDesc * (ivaPct / 100);
  const total = baseDesc + iva;

  await client.query(`
    UPDATE crm.cotizaciones
    SET valor_subtotal = $1, valor_iva = $2, valor_total = $3, actualizado_en = NOW()
    WHERE id = $4
  `, [subtotal, iva, total, cotizacionId]);

  return { subtotal, descuento, iva, total };
}

// GET /api/cotizaciones — Listar con filtros
router.get('/', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { cliente_id, estado, search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (cliente_id) {
      conditions.push(`c.cliente_id = $${paramIdx++}`);
      params.push(cliente_id);
    }
    if (estado) {
      conditions.push(`c.estado = $${paramIdx++}`);
      params.push(estado);
    }
    if (search) {
      conditions.push(`(c.numero ILIKE $${paramIdx} OR cl.nombre ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM crm.cotizaciones c
      LEFT JOIN crm.clientes cl ON cl.id = c.cliente_id
      ${where}
    `, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT c.*, cl.nombre AS cliente_nombre,
        (SELECT COUNT(*) FROM crm.cotizacion_items ci WHERE ci.cotizacion_id = c.id) AS total_items
      FROM crm.cotizaciones c
      LEFT JOIN crm.clientes cl ON cl.id = c.cliente_id
      ${where}
      ORDER BY c.creado_en DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar cotizaciones:', err);
    res.status(500).json({ error: 'Error al listar cotizaciones' });
  }
});

// GET /api/cotizaciones/stats — Estadisticas
router.get('/stats', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const [total, porEstado, montoTotal, pendientes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.cotizaciones`),
      pool.query(`SELECT estado, COUNT(*) AS total, COALESCE(SUM(valor_total), 0) AS monto FROM crm.cotizaciones GROUP BY estado`),
      pool.query(`SELECT COALESCE(SUM(valor_total), 0) AS total FROM crm.cotizaciones WHERE estado NOT IN ('rechazada','vencida')`),
      pool.query(`SELECT COUNT(*) FROM crm.descuentos_solicitud WHERE estado = 'pendiente'`)
    ]);

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      por_estado: porEstado.rows,
      monto_total: parseFloat(montoTotal.rows[0].total),
      descuentos_pendientes: parseInt(pendientes.rows[0].count)
    });
  } catch (err) {
    console.error('[CRM] Error stats cotizaciones:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/cotizaciones/:id — Detalle con items
router.get('/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT c.*, cl.nombre AS cliente_nombre, cl.nit AS cliente_nit,
        o.nombre AS oportunidad_nombre
      FROM crm.cotizaciones c
      LEFT JOIN crm.clientes cl ON cl.id = c.cliente_id
      LEFT JOIN crm.oportunidades o ON o.id = c.oportunidad_id
      WHERE c.id = $1
    `, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });

    const items = await pool.query(
      `SELECT * FROM crm.cotizacion_items WHERE cotizacion_id = $1 ORDER BY orden, id`,
      [id]
    );

    const descuentos = await pool.query(
      `SELECT * FROM crm.descuentos_solicitud WHERE cotizacion_id = $1 ORDER BY creado_en DESC`,
      [id]
    );

    res.json({ ok: true, data: { ...result.rows[0], items: items.rows, descuentos: descuentos.rows } });
  } catch (err) {
    console.error('[CRM] Error obtener cotizacion:', err);
    res.status(500).json({ error: 'Error al obtener cotizacion' });
  }
});

// POST /api/cotizaciones — Crear cotizacion
router.post('/', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { cliente_id, oportunidad_id, validez_dias, notas, items, descuento_pct,
            orden_compra, centro_operacion, bodega, condicion_pago, fecha_entrega,
            unidad_negocio, punto_envio, motivo, vendedor_nombre } = req.body;
    if (!cliente_id) return res.status(400).json({ error: 'El cliente es obligatorio' });

    const numero = await generarNumero(client);
    const vencimiento = new Date();
    vencimiento.setDate(vencimiento.getDate() + (validez_dias || 30));

    const cot = await client.query(`
      INSERT INTO crm.cotizaciones (numero, cliente_id, oportunidad_id, validez_dias, vencimiento, notas, creado_por,
        orden_compra, centro_operacion, bodega, condicion_pago, fecha_entrega,
        unidad_negocio, punto_envio, motivo, vendedor_nombre, propietario)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [numero, cliente_id, oportunidad_id || null, validez_dias || 30, vencimiento.toISOString().split('T')[0],
        notas || null, req.user.id,
        orden_compra || null, centro_operacion || null, bodega || null, condicion_pago || null,
        fecha_entrega || null, unidad_negocio || null, punto_envio || null, motivo || 'VENTAS',
        vendedor_nombre || null, req.user.nombre || null]);

    const cotizacionId = cot.rows[0].id;

    if (items?.length) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(`
          INSERT INTO crm.cotizacion_items (cotizacion_id, descripcion, referencia, unidad_medida, cantidad, precio_unitario, descuento_pct, orden)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [cotizacionId, it.descripcion, it.referencia || null, it.unidad_medida || 'UND', it.cantidad || 1, it.precio_unitario || 0, it.descuento_pct || 0, i]);
      }
    }

    if (descuento_pct && descuento_pct > 0) {
      const cfg = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'descuento_umbral_aprobacion'`);
      const umbral = parseFloat(cfg.rows[0]?.valor || '10');
      const estadoDesc = descuento_pct <= umbral ? 'auto_aprobado' : 'pendiente';
      await client.query(`
        INSERT INTO crm.descuentos_solicitud (cotizacion_id, cliente_id, solicitado_por, tipo, valor_descuento, monto_original, monto_final, estado, umbral_aplicado)
        VALUES ($1, $2, $3, 'porcentaje', $4, 0, 0, $5, $6)
      `, [cotizacionId, cliente_id, req.user.id, descuento_pct, estadoDesc, umbral]);
    }

    const totales = await recalcularTotales(client, cotizacionId);

    await auditarEvento({ accion: 'crear', entidad: 'cotizacion', entidad_id: cotizacionId, usuario_id: req.user.id, metadata: { numero, cliente_id } });

    await client.query('COMMIT');
    res.status(201).json({ ok: true, data: { ...cot.rows[0], ...totales } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error crear cotizacion:', err);
    res.status(500).json({ error: 'Error al crear cotizacion' });
  } finally {
    client.release();
  }
});

// PUT /api/cotizaciones/:id — Editar cabecera
router.put('/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT id, estado FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    if (['aprobada', 'convertida'].includes(existing.rows[0].estado)) {
      return res.status(400).json({ error: 'No se puede editar una cotizacion aprobada o convertida' });
    }

    const fields = ['cliente_id', 'oportunidad_id', 'validez_dias', 'notas', 'moneda',
                    'orden_compra', 'centro_operacion', 'bodega', 'condicion_pago', 'fecha_entrega',
                    'unidad_negocio', 'punto_envio', 'motivo', 'vendedor_nombre'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx++}`);
        params.push(req.body[field]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });

    updates.push(`actualizado_en = NOW()`);
    params.push(id);

    const result = await pool.query(`UPDATE crm.cotizaciones SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    await auditarEvento({ accion: 'editar', entidad: 'cotizacion', entidad_id: id, usuario_id: req.user.id, metadata: { campos: Object.keys(req.body) } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar cotizacion:', err);
    res.status(500).json({ error: 'Error al editar cotizacion' });
  }
});

// DELETE /api/cotizaciones/seleccionados — Bulk delete (solo borradores)
router.delete('/seleccionados', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'Sin IDs' });

    const result = await pool.query(`DELETE FROM crm.cotizaciones WHERE id = ANY($1) RETURNING id`, [ids]);

    await auditarEvento({ accion: 'eliminar', entidad: 'cotizacion', usuario_id: req.user.id, metadata: { count: result.rowCount } });

    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error bulk eliminar cotizaciones:', err);
    res.status(500).json({ error: 'Error al eliminar cotizaciones' });
  }
});

// DELETE /api/cotizaciones/:id — Eliminar (solo borradores, AFTER /seleccionados)
router.delete('/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT id, estado, numero FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    if (existing.rows[0].estado !== 'borrador') {
      return res.status(400).json({ error: 'Solo se pueden eliminar cotizaciones en borrador' });
    }

    await pool.query(`DELETE FROM crm.cotizaciones WHERE id = $1`, [id]);

    await auditarEvento({ accion: 'eliminar', entidad: 'cotizacion', entidad_id: id, usuario_id: req.user.id, metadata: { numero: existing.rows[0].numero } });

    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar cotizacion:', err);
    res.status(500).json({ error: 'Error al eliminar cotizacion' });
  }
});

// ── Items ──

// POST /api/cotizaciones/:id/items — Agregar item
router.post('/:id/items', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { descripcion, referencia, unidad_medida, cantidad, precio_unitario, descuento_pct } = req.body;
    if (!descripcion) return res.status(400).json({ error: 'La descripcion es obligatoria' });

    const estado = await client.query(`SELECT estado FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!estado.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    if (['aprobada', 'convertida'].includes(estado.rows[0].estado)) {
      return res.status(400).json({ error: 'No se pueden editar items de una cotizacion aprobada' });
    }

    const maxOrden = await client.query(`SELECT COALESCE(MAX(orden), 0) + 1 AS next FROM crm.cotizacion_items WHERE cotizacion_id = $1`, [id]);

    const result = await client.query(`
      INSERT INTO crm.cotizacion_items (cotizacion_id, descripcion, referencia, unidad_medida, cantidad, precio_unitario, descuento_pct, orden)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [id, descripcion, referencia || null, unidad_medida || 'UND', cantidad || 1, precio_unitario || 0, descuento_pct || 0, maxOrden.rows[0].next]);

    const totales = await recalcularTotales(client, id);

    await client.query('COMMIT');
    res.status(201).json({ ok: true, data: result.rows[0], totales });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error agregar item:', err);
    res.status(500).json({ error: 'Error al agregar item' });
  } finally {
    client.release();
  }
});

// PUT /api/cotizaciones/:id/items/:itemId — Editar item
router.put('/:id/items/:itemId', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id, itemId } = req.params;

    const estado = await client.query(`SELECT estado FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!estado.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    if (['aprobada', 'convertida'].includes(estado.rows[0].estado)) {
      return res.status(400).json({ error: 'No se pueden editar items de una cotizacion aprobada' });
    }

    const fields = ['descripcion', 'referencia', 'unidad_medida', 'cantidad', 'precio_unitario', 'descuento_pct', 'orden'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx++}`);
        params.push(req.body[field]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });

    params.push(itemId);
    const result = await pool.query(`UPDATE crm.cotizacion_items SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    const totales = await recalcularTotales(client, id);

    await client.query('COMMIT');
    res.json({ ok: true, data: result.rows[0], totales });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error editar item:', err);
    res.status(500).json({ error: 'Error al editar item' });
  } finally {
    client.release();
  }
});

// DELETE /api/cotizaciones/:id/items/:itemId — Eliminar item
router.delete('/:id/items/:itemId', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id, itemId } = req.params;

    const estado = await client.query(`SELECT estado FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!estado.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    if (['aprobada', 'convertida'].includes(estado.rows[0].estado)) {
      return res.status(400).json({ error: 'No se pueden eliminar items de una cotizacion aprobada' });
    }

    await client.query(`DELETE FROM crm.cotizacion_items WHERE id = $1 AND cotizacion_id = $2`, [itemId, id]);

    const totales = await recalcularTotales(client, id);

    await client.query('COMMIT');
    res.json({ ok: true, totales });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error eliminar item:', err);
    res.status(500).json({ error: 'Error al eliminar item' });
  } finally {
    client.release();
  }
});

// ── Estado ──

// PUT /api/cotizaciones/:id/estado — Cambiar estado
router.put('/:id/estado', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const validStates = ['borrador', 'enviada', 'aprobada', 'rechazada', 'vencida', 'convertida'];
    if (!validStates.includes(estado)) return res.status(400).json({ error: 'Estado invalido' });

    const existing = await pool.query(`SELECT id, estado AS estado_actual FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });

    const updates = ['estado = $1', 'actualizado_en = NOW()'];
    const params = [estado];

    if (estado === 'enviada') updates.push('enviado_en = NOW()');
    if (estado === 'aprobada') updates.push('aprobada_en = NOW()');

    params.push(id);
    const result = await pool.query(`UPDATE crm.cotizaciones SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);

    await auditarEvento({ accion: 'cambio_estado', entidad: 'cotizacion', entidad_id: id, usuario_id: req.user.id, metadata: { anterior: existing.rows[0].estado_actual, nuevo: estado } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error cambiar estado:', err);
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// POST /api/cotizaciones/:id/descuento — Solicitar descuento
router.post('/:id/descuento', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo, valor_descuento, justificacion } = req.body;

    const cot = await pool.query(`SELECT id, cliente_id, valor_subtotal, estado FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!cot.rows.length) return res.status(404).json({ error: 'Cotizacion no encontrada' });
    if (['aprobada', 'convertida'].includes(cot.rows[0].estado)) {
      return res.status(400).json({ error: 'No se puede solicitar descuento en cotizacion aprobada' });
    }

    const cfg = await pool.query(`SELECT valor FROM crm.configuracion WHERE clave = 'descuento_umbral_aprobacion'`);
    const umbral = parseFloat(cfg.rows[0]?.valor || '10');

    let montoDescuento = 0;
    if (tipo === 'porcentaje') {
      montoDescuento = parseFloat(cot.rows[0].valor_subtotal) * (parseFloat(valor_descuento) / 100);
    } else {
      montoDescuento = parseFloat(valor_descuento);
    }

    const pctDescuento = tipo === 'porcentaje' ? parseFloat(valor_descuento) : (montoDescuento / parseFloat(cot.rows[0].valor_subtotal)) * 100;
    const estado = pctDescuento <= umbral ? 'auto_aprobado' : 'pendiente';

    const result = await pool.query(`
      INSERT INTO crm.descuentos_solicitud (cotizacion_id, cliente_id, solicitado_por, tipo, valor_descuento, monto_original, monto_final, justificacion, estado, umbral_aplicado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [id, cot.rows[0].cliente_id, req.user.id, tipo || 'porcentaje', valor_descuento, cot.rows[0].valor_subtotal, parseFloat(cot.rows[0].valor_subtotal) - montoDescuento, justificacion || null, estado, umbral]);

    if (estado === 'auto_aprobado') {
      await pool.query(`UPDATE crm.cotizaciones SET valor_descuento = $1, actualizado_en = NOW() WHERE id = $2`, [montoDescuento, id]);
      const client = await pool.connect();
      try {
        await recalcularTotales(client, id);
      } finally {
        client.release();
      }
    }

    await auditarEvento({ accion: 'solicitar_descuento', entidad: 'cotizacion', entidad_id: id, usuario_id: req.user.id, metadata: { tipo, valor: valor_descuento, estado } });

    res.status(201).json({ ok: true, data: result.rows[0], auto_aprobado: estado === 'auto_aprobado' });
  } catch (err) {
    console.error('[CRM] Error solicitar descuento:', err);
    res.status(500).json({ error: 'Error al solicitar descuento' });
  }
});

export default router;
