import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

const ETAPAS = ['lead', 'calificado', 'propuesta', 'negociacion', 'ganada', 'perdida'];

// GET /api/oportunidades — Listar oportunidades con filtros
router.get('/', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const { etapa, vendedor, cliente_id, search, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (etapa) {
      conditions.push(`o.etapa = $${paramIdx++}`);
      params.push(etapa);
    }
    if (vendedor) {
      conditions.push(`o.vendedor_id = $${paramIdx++}`);
      params.push(parseInt(vendedor));
    }
    if (cliente_id) {
      conditions.push(`o.cliente_id = $${paramIdx++}`);
      params.push(cliente_id);
    }
    if (search) {
      conditions.push(`(o.nombre ILIKE $${paramIdx} OR e.nombre ILIKE $${paramIdx} OR l.raison_social ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.oportunidades o LEFT JOIN crm.clientes e ON e.id = o.cliente_id LEFT JOIN crm.leads l ON l.id = o.lead_id ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT o.*, e.nombre AS cliente_nombre, c.nombre AS contacto_nombre, l.raison_social AS lead_nombre
      FROM crm.oportunidades o
      LEFT JOIN crm.clientes e ON e.id = o.cliente_id
      LEFT JOIN crm.leads l ON l.id = o.lead_id
      LEFT JOIN crm.contactos c ON c.id = o.contacto_id
      ${where}
      ORDER BY o.creado_en DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total });
  } catch (err) {
    console.error('[CRM] Error listar oportunidades:', err);
    res.status(500).json({ error: 'Error al listar oportunidades' });
  }
});

// GET /api/oportunidades/pipeline — Datos para kanban (agrupados por etapa)
router.get('/pipeline', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const { vendedor } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (vendedor) {
      conditions.push(`o.vendedor_id = $${paramIdx++}`);
      params.push(parseInt(vendedor));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT o.*, e.nombre AS cliente_nombre, c.nombre AS contacto_nombre, l.raison_social AS lead_nombre
      FROM crm.oportunidades o
      LEFT JOIN crm.clientes e ON e.id = o.cliente_id
      LEFT JOIN crm.leads l ON l.id = o.lead_id
      LEFT JOIN crm.contactos c ON c.id = o.contacto_id
      ${where}
      ORDER BY o.creado_en DESC
    `, params);

    const pipeline = {};
    for (const etapa of ETAPAS) {
      pipeline[etapa] = [];
    }
    for (const row of result.rows) {
      if (pipeline[row.etapa]) {
        pipeline[row.etapa].push(row);
      }
    }

    const stats = {};
    for (const etapa of ETAPAS) {
      const items = pipeline[etapa];
      stats[etapa] = {
        count: items.length,
        total: items.reduce((sum, o) => sum + parseFloat(o.monto_esperado || 0), 0)
      };
    }

    res.json({ ok: true, pipeline, stats });
  } catch (err) {
    console.error('[CRM] Error pipeline:', err);
    res.status(500).json({ error: 'Error al cargar pipeline' });
  }
});

// GET /api/oportunidades/stats — Estadisticas (respeta filtro vendedor)
router.get('/stats', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const { vendedor } = req.query;
    const cond = vendedor ? 'WHERE o.vendedor_id = $1' : '';
    const condAnd = vendedor ? 'AND o.vendedor_id = $1' : '';
    const p = vendedor ? [parseInt(vendedor)] : [];
    const pPipeline = vendedor ? [parseInt(vendedor)] : [];

    const [total, porEtapa, montoTotal, forecast, porEtapaCounts] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.oportunidades o ${cond}`, p),
      pool.query(`SELECT etapa, COUNT(*) AS total, COALESCE(SUM(monto_esperado), 0) AS monto FROM crm.oportunidades o ${cond} GROUP BY etapa ORDER BY CASE etapa WHEN 'lead' THEN 1 WHEN 'calificado' THEN 2 WHEN 'propuesta' THEN 3 WHEN 'negociacion' THEN 4 WHEN 'ganada' THEN 5 WHEN 'perdida' THEN 6 END`, p),
      pool.query(`SELECT COALESCE(SUM(monto_esperado), 0) AS total FROM crm.oportunidades o ${cond ? cond + ` AND o.etapa NOT IN ('ganada','perdida')` : `WHERE o.etapa NOT IN ('ganada','perdida')`}`, p),
      pool.query(`SELECT COALESCE(SUM(monto_esperado * COALESCE(probabilidad,0) / 100.0),0) AS total FROM crm.oportunidades o ${cond ? cond + ` AND o.etapa NOT IN ('ganada','perdida')` : `WHERE o.etapa NOT IN ('ganada','perdida')`}`, p),
      pool.query(`SELECT etapa, COUNT(*) AS total FROM crm.oportunidades o ${cond} GROUP BY etapa`, p)
    ]);

    const ganada = parseInt(porEtapaCounts.rows.find(r=>r.etapa==='ganada')?.total || 0);
    const perdida = parseInt(porEtapaCounts.rows.find(r=>r.etapa==='perdida')?.total || 0);
    const winRate = (ganada + perdida) > 0 ? (ganada / (ganada + perdida) * 100) : 0;

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      por_etapa: porEtapa.rows,
      monto_pipeline: parseFloat(montoTotal.rows[0].total),
      forecast_ponderado: parseFloat(forecast.rows[0].total),
      win_rate: Math.round(winRate * 10) / 10,
      ganada, perdida
    });
  } catch (err) {
    console.error('[CRM] Error stats oportunidades:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/oportunidades/:id — Detalle con historial y productos
router.get('/:id', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT o.*, e.nombre AS cliente_nombre, c.nombre AS contacto_nombre, c.email AS contacto_email, l.raison_social AS lead_nombre
      FROM crm.oportunidades o
      LEFT JOIN crm.clientes e ON e.id = o.cliente_id
      LEFT JOIN crm.leads l ON l.id = o.lead_id
      LEFT JOIN crm.contactos c ON c.id = o.contacto_id
      WHERE o.id = $1
    `, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const historial = await pool.query(
      `SELECT * FROM crm.oportunidad_historial WHERE oportunidad_id = $1 ORDER BY fecha DESC`,
      [id]
    );
    const productos = await pool.query(`
      SELECT op.*, p.codigo, p.nombre AS producto_nombre, p.unidad_medida, p.categoria
      FROM crm.oportunidad_productos op
      JOIN crm.productos p ON p.id = op.producto_id
      WHERE op.oportunidad_id = $1
      ORDER BY p.codigo
    `, [id]);

    res.json({ ok: true, data: { ...result.rows[0], historial: historial.rows, productos: productos.rows } });
  } catch (err) {
    console.error('[CRM] Error obtener oportunidad:', err);
    res.status(500).json({ error: 'Error al obtener oportunidad' });
  }
});

// GET /api/oportunidades/:id/productos — Listar productos de la oportunidad
router.get('/:id/productos', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT op.*, p.codigo, p.nombre AS producto_nombre, p.unidad_medida, p.categoria, p.precio_unitario AS precio_maestro
      FROM crm.oportunidad_productos op
      JOIN crm.productos p ON p.id = op.producto_id
      WHERE op.oportunidad_id = $1
      ORDER BY p.codigo
    `, [req.params.id]);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar productos oportunidad:', err);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// POST /api/oportunidades/:id/productos — Agregar producto
router.post('/:id/productos', requirePermiso('editar_pipeline', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const { producto_id, cantidad = 1, precio_unitario } = req.body;
    if (!producto_id) return res.status(400).json({ error: 'producto_id requerido' });
    const prod = await pool.query(`SELECT precio_unitario FROM crm.productos WHERE id = $1`, [producto_id]);
    if (!prod.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const precio = precio_unitario !== undefined ? precio_unitario : prod.rows[0].precio_unitario;
    const result = await pool.query(`
      INSERT INTO crm.oportunidad_productos (oportunidad_id, producto_id, cantidad, precio_unitario)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (oportunidad_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad, precio_unitario = EXCLUDED.precio_unitario
      RETURNING *
    `, [id, producto_id, cantidad, precio]);
    // Opcional: recalcular monto_esperado como suma
    const sum = await pool.query(`SELECT COALESCE(SUM(cantidad * precio_unitario),0) AS total FROM crm.oportunidad_productos WHERE oportunidad_id = $1`, [id]);
    await pool.query(`UPDATE crm.oportunidades SET monto_esperado = $1 WHERE id = $2`, [sum.rows[0].total, id]);
    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error agregar producto oportunidad:', err);
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

// DELETE /api/oportunidades/:id/productos/:productoId — Quitar producto
router.delete('/:id/productos/:productoId', requirePermiso('editar_pipeline', 'crm'), async (req, res) => {
  try {
    const { id, productoId } = req.params;
    await pool.query(`DELETE FROM crm.oportunidad_productos WHERE oportunidad_id = $1 AND producto_id = $2`, [id, productoId]);
    const sum = await pool.query(`SELECT COALESCE(SUM(cantidad * precio_unitario),0) AS total FROM crm.oportunidad_productos WHERE oportunidad_id = $1`, [id]);
    await pool.query(`UPDATE crm.oportunidades SET monto_esperado = $1 WHERE id = $2`, [sum.rows[0].total, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error quitar producto oportunidad:', err);
    res.status(500).json({ error: 'Error al quitar producto' });
  }
});

// POST /api/oportunidades — Crear oportunidad (cliente o lead)
router.post('/', requirePermiso('crear_oportunidad', 'crm'), async (req, res) => {
  try {
    const { cliente_id, lead_id, contacto_id, nombre, monto_esperado, probabilidad, etapa, vendedor_id, fecha_cierre_estimada } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!cliente_id && !lead_id) return res.status(400).json({ error: 'Seleccione un cliente o un lead' });

    const result = await pool.query(`
      INSERT INTO crm.oportunidades (cliente_id, lead_id, contacto_id, nombre, monto_esperado, probabilidad, etapa, vendedor_id, fecha_cierre_estimada)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [cliente_id || null, lead_id || null, contacto_id || null, nombre, monto_esperado || 0, probabilidad || 10, etapa || 'lead', vendedor_id || req.user.id, fecha_cierre_estimada || null]);

    // Registrar en historial
    await pool.query(
      `INSERT INTO crm.oportunidad_historial (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, comentario)
       VALUES ($1, NULL, $2, $3, 'Oportunidad creada')`,
      [result.rows[0].id, result.rows[0].etapa, req.user.id]
    );

    await auditarEvento({ accion: 'crear', entidad: 'oportunidad', entidad_id: result.rows[0].id, usuario_id: req.user.id, metadata: { nombre, etapa: result.rows[0].etapa } });

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear oportunidad:', err);
    res.status(500).json({ error: 'Error al crear oportunidad' });
  }
});

// PUT /api/oportunidades/:id — Editar oportunidad
router.put('/:id', requirePermiso('editar_pipeline', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT * FROM crm.oportunidades WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const fields = ['cliente_id', 'lead_id', 'contacto_id', 'nombre', 'monto_esperado', 'probabilidad', 'motivo_perdida', 'vendedor_id', 'fecha_cierre_estimada'];
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

    const result = await pool.query(`UPDATE crm.oportunidades SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    await auditarEvento({ accion: 'editar', entidad: 'oportunidad', entidad_id: id, usuario_id: req.user.id, metadata: { campos: Object.keys(req.body) } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar oportunidad:', err);
    res.status(500).json({ error: 'Error al editar oportunidad' });
  }
});

// PUT /api/oportunidades/:id/mover — Cambiar etapa (para kanban drag & drop)
router.put('/:id/mover', requirePermiso('editar_pipeline', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const { etapa, comentario } = req.body;
    if (!etapa || !ETAPAS.includes(etapa)) return res.status(400).json({ error: 'Etapa invalida' });

    const existing = await pool.query(`SELECT * FROM crm.oportunidades WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const etapaAnterior = existing.rows[0].etapa;
    if (etapaAnterior === etapa) return res.json({ ok: true, data: existing.rows[0] });

    const result = await pool.query(
      `UPDATE crm.oportunidades SET etapa = $1, actualizado_en = NOW(),
       motivo_perdida = CASE WHEN $1 = 'perdida' THEN COALESCE($2, motivo_perdida) ELSE motivo_perdida END
       WHERE id = $3 RETURNING *`,
      [etapa, comentario || null, id]
    );

    // Registrar en historial
    await pool.query(
      `INSERT INTO crm.oportunidad_historial (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, comentario)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, etapaAnterior, etapa, req.user.id, comentario || `Movido de ${etapaAnterior} a ${etapa}`]
    );

    await auditarEvento({ accion: 'mover_oportunidad', entidad: 'oportunidad', entidad_id: id, usuario_id: req.user.id, metadata: { etapa_anterior: etapaAnterior, etapa_nueva: etapa } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error mover oportunidad:', err);
    res.status(500).json({ error: 'Error al mover oportunidad' });
  }
});

// DELETE /api/oportunidades/:id — Eliminar
router.delete('/:id', requirePermiso('editar_pipeline', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM crm.oportunidades WHERE id = $1 RETURNING id, nombre`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    await auditarEvento({ accion: 'eliminar', entidad: 'oportunidad', entidad_id: id, usuario_id: req.user.id, metadata: { nombre: result.rows[0].nombre } });

    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar oportunidad:', err);
    res.status(500).json({ error: 'Error al eliminar oportunidad' });
  }
});

export default router;
