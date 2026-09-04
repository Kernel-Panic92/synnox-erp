import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { requireVentasPerfil } from './perfilesVenta.js';
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

// GET /api/oportunidades/pipeline — Datos para kanban (agrupados por etapa) con filtros globales
router.get('/pipeline', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const { vendedor, etapa, fuente, prioridad, search, desde, hasta } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (vendedor) { conditions.push(`o.vendedor_id = $${paramIdx++}`); params.push(parseInt(vendedor)); }
    if (etapa) { conditions.push(`o.etapa = $${paramIdx++}`); params.push(etapa); }
    if (fuente) { conditions.push(`o.fuente = $${paramIdx++}`); params.push(fuente); }
    if (prioridad) { conditions.push(`o.prioridad = $${paramIdx++}`); params.push(prioridad); }
    if (search) { conditions.push(`(o.nombre ILIKE $${paramIdx} OR e.nombre ILIKE $${paramIdx} OR l.raison_social ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
    if (desde) { conditions.push(`o.fecha_cierre_estimada >= $${paramIdx++}`); params.push(desde); }
    if (hasta) { conditions.push(`o.fecha_cierre_estimada <= $${paramIdx++}`); params.push(hasta); }

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

// GET /api/oportunidades/stats — Estadisticas (respeta filtros globales)
router.get('/stats', requirePermiso('ver_pipeline', 'crm'), async (req, res) => {
  try {
    const { vendedor, etapa, fuente, prioridad, search, desde, hasta } = req.query;
    // Construir where dinámico para stats (reusa condiciones de pipeline)
    const conds = [];
    const vals = [];
    let pi = 1;
    if (vendedor) { conds.push(`o.vendedor_id = $${pi++}`); vals.push(parseInt(vendedor)); }
    if (etapa) { conds.push(`o.etapa = $${pi++}`); vals.push(etapa); }
    if (fuente) { conds.push(`o.fuente = $${pi++}`); vals.push(fuente); }
    if (prioridad) { conds.push(`o.prioridad = $${pi++}`); vals.push(prioridad); }
    if (search) { conds.push(`(o.nombre ILIKE $${pi} OR e.nombre ILIKE $${pi} OR l.raison_social ILIKE $${pi})`); vals.push(`%${search}%`); pi++; }
    if (desde) { conds.push(`o.fecha_cierre_estimada >= $${pi++}`); vals.push(desde); }
    if (hasta) { conds.push(`o.fecha_cierre_estimada <= $${pi++}`); vals.push(hasta); }
    const whereBase = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    // Para joins con cliente/lead en search
    const joinSearch = search ? ` LEFT JOIN crm.clientes e ON e.id=o.cliente_id LEFT JOIN crm.leads l ON l.id=o.lead_id` : '';
    const cond = whereBase;
    const condWithJoin = whereBase ? whereBase : '';
    const p = vals;
    const condAnd = ''; // no usado pero mantener compat

    const baseFrom = `FROM crm.oportunidades o LEFT JOIN crm.clientes e ON e.id=o.cliente_id LEFT JOIN crm.leads l ON l.id=o.lead_id`;
    // helper para añadir AND etapa NOT IN cuando ya hay WHERE
    const addOpenFilter = (c) => c ? `${c} AND o.etapa NOT IN ('ganada','perdida')` : `WHERE o.etapa NOT IN ('ganada','perdida')`;
    const [total, porEtapa, montoTotal, forecast, porEtapaCounts, vencidas, ticketAvg, ciclo, porFuente, porPrioridad, topVendedor] = await Promise.all([
      pool.query(`SELECT COUNT(*) ${baseFrom} ${cond}`, p),
      pool.query(`SELECT etapa, COUNT(*) AS total, COALESCE(SUM(monto_esperado), 0) AS monto ${baseFrom} ${cond} GROUP BY etapa ORDER BY CASE etapa WHEN 'lead' THEN 1 WHEN 'calificado' THEN 2 WHEN 'propuesta' THEN 3 WHEN 'negociacion' THEN 4 WHEN 'ganada' THEN 5 WHEN 'perdida' THEN 6 END`, p),
      pool.query(`SELECT COALESCE(SUM(monto_esperado), 0) AS total ${baseFrom} ${addOpenFilter(cond)}`, p),
      pool.query(`SELECT COALESCE(SUM(monto_esperado * COALESCE(probabilidad,0) / 100.0),0) AS total ${baseFrom} ${addOpenFilter(cond)}`, p),
      pool.query(`SELECT etapa, COUNT(*) AS total ${baseFrom} ${cond} GROUP BY etapa`, p),
      pool.query(`SELECT COUNT(*) ${baseFrom} ${cond ? cond + ` AND o.fecha_cierre_estimada < CURRENT_DATE AND o.etapa NOT IN ('ganada','perdida')` : `WHERE o.fecha_cierre_estimada < CURRENT_DATE AND o.etapa NOT IN ('ganada','perdida')`}`, p),
      pool.query(`SELECT COALESCE(AVG(monto_esperado),0) AS avg, COUNT(*) as cnt ${baseFrom} ${addOpenFilter(cond)}`, p),
      pool.query(`SELECT COALESCE(AVG(EXTRACT(DAY FROM (CURRENT_DATE - o.creado_en))),0) AS avg ${baseFrom} ${addOpenFilter(cond)}`, p),
      pool.query(`SELECT COALESCE(fuente,'otro') as fuente, COUNT(*) as total ${baseFrom} ${cond} GROUP BY fuente ORDER BY total DESC`, p),
      pool.query(`SELECT COALESCE(prioridad,'media') as prioridad, COUNT(*) as total ${baseFrom} ${cond} GROUP BY prioridad ORDER BY CASE prioridad WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 WHEN 'baja' THEN 4 ELSE 5 END`, p),
      pool.query(`SELECT o.vendedor_id, COUNT(*) as total, COALESCE(SUM(o.monto_esperado),0) as monto ${baseFrom} ${cond ? cond + ` AND o.vendedor_id IS NOT NULL` : `WHERE o.vendedor_id IS NOT NULL`} GROUP BY o.vendedor_id ORDER BY total DESC LIMIT 1`, p)
    ]);

    const ganada = parseInt(porEtapaCounts.rows.find(r=>r.etapa==='ganada')?.total || 0);
    const perdida = parseInt(porEtapaCounts.rows.find(r=>r.etapa==='perdida')?.total || 0);
    const winRate = (ganada + perdida) > 0 ? (ganada / (ganada + perdida) * 100) : 0;

    // nombre top vendedor
    let topVendedorNombre = null;
    if (topVendedor.rows[0]?.vendedor_id) {
      try {
        const Database = (await import('better-sqlite3')).default;
        const path = (await import('path')).default;
        const { fileURLToPath } = await import('url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const ldb = new Database(path.join(__dirname, '..','..','..','launcher','launcher.db'), {readonly:true});
        const row = ldb.prepare('SELECT nombre FROM usuarios WHERE id=?').get(topVendedor.rows[0].vendedor_id);
        if (row) topVendedorNombre = row.nombre;
        ldb.close();
      } catch {}
    }

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      por_etapa: porEtapa.rows,
      monto_pipeline: parseFloat(montoTotal.rows[0].total),
      forecast_ponderado: parseFloat(forecast.rows[0].total),
      win_rate: Math.round(winRate * 10) / 10,
      ganada, perdida,
      vencidas: parseInt(vencidas.rows[0].count),
      ticket_promedio: parseFloat(ticketAvg.rows[0].avg)||0,
      ciclo_promedio: Math.round(parseFloat(ciclo.rows[0].avg)||0),
      por_fuente: porFuente.rows,
      por_prioridad: porPrioridad.rows,
      top_vendedor: topVendedor.rows[0] ? { id: topVendedor.rows[0].vendedor_id, total: parseInt(topVendedor.rows[0].total), monto: parseFloat(topVendedor.rows[0].monto), nombre: topVendedorNombre } : null
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
router.post('/:id/productos', requirePermiso('editar_pipeline', 'crm'), requireVentasPerfil('editar_pipeline'), async (req, res) => {
  try {
    const { id } = req.params;
    const { producto_id, cantidad = 1, precio_unitario } = req.body;
    if (!producto_id) return res.status(400).json({ error: 'producto_id requerido' });
    const prod = await pool.query(`SELECT codigo, precio_unitario FROM crm.productos WHERE id = $1`, [producto_id]);
    if (!prod.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    let precio = precio_unitario;
    if (precio === undefined || precio === null) {
      // usa precio de la lista de la oportunidad (perfil default 200)
      const opp = await pool.query(`SELECT lista_precios FROM crm.oportunidades WHERE id=$1`, [id]);
      const lista = opp.rows[0]?.lista_precios || '200';
      const lr = await pool.query(`SELECT id FROM crm.listas_precio WHERE codigo=$1 LIMIT 1`, [lista]);
      if (lr.rows[0]) {
        const pr = await pool.query(`SELECT precio FROM crm.lista_precio_items WHERE lista_id=$1 AND producto_id=$2 LIMIT 1`, [lr.rows[0].id, producto_id]);
        if (pr.rows[0]) precio = pr.rows[0].precio;
      }
      if (precio === undefined) precio = prod.rows[0].precio_unitario;
    }
    const result = await pool.query(`
      INSERT INTO crm.oportunidad_productos (oportunidad_id, producto_id, cantidad, precio_unitario)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (oportunidad_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad, precio_unitario = EXCLUDED.precio_unitario
      RETURNING *
    `, [id, producto_id, cantidad, precio]);
    // Recalcular monto_esperado solo si hay suma >0 (no pisar monto manual con $0 de producto sin precio)
    const sum = await pool.query(`SELECT COALESCE(SUM(cantidad * precio_unitario),0) AS total FROM crm.oportunidad_productos WHERE oportunidad_id = $1`, [id]);
    const total = parseFloat(sum.rows[0].total)||0;
    if (total > 0) await pool.query(`UPDATE crm.oportunidades SET monto_esperado = $1 WHERE id = $2`, [total, id]);
    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error agregar producto oportunidad:', err);
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

// DELETE /api/oportunidades/:id/productos/:productoId — Quitar producto
router.delete('/:id/productos/:productoId', requirePermiso('editar_pipeline', 'crm'), requireVentasPerfil('editar_pipeline'), async (req, res) => {
  try {
    const { id, productoId } = req.params;
    await pool.query(`DELETE FROM crm.oportunidad_productos WHERE oportunidad_id = $1 AND producto_id = $2`, [id, productoId]);
    const sum = await pool.query(`SELECT COALESCE(SUM(cantidad * precio_unitario),0) AS total FROM crm.oportunidad_productos WHERE oportunidad_id = $1`, [id]);
    const total = parseFloat(sum.rows[0].total)||0;
    if (total > 0 || (await pool.query(`SELECT COUNT(*) FROM crm.oportunidad_productos WHERE oportunidad_id=$1`,[id])).rows[0].count==='0') {
      await pool.query(`UPDATE crm.oportunidades SET monto_esperado = $1 WHERE id = $2`, [total, id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error quitar producto oportunidad:', err);
    res.status(500).json({ error: 'Error al quitar producto' });
  }
});

// POST /api/oportunidades — Crear oportunidad (cliente o lead) — vendedor: solo admin asigna a otro
router.post('/', requirePermiso('crear_oportunidad', 'crm'), requireVentasPerfil('editar_pipeline'), async (req, res) => {
  try {
    const { cliente_id, lead_id, contacto_id, nombre, monto_esperado, probabilidad, etapa, vendedor_id, fecha_cierre_estimada, fuente, prioridad, lista_precios } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!cliente_id && !lead_id) return res.status(400).json({ error: 'Seleccione un cliente o un lead' });
    const esAdmin = ['admin','gerente'].includes(req.user?.rol);
    const vid = vendedor_id ? parseInt(vendedor_id) : null;
    if (!esAdmin && vid && vid !== req.user.id) return res.status(403).json({ error: 'Solo puedes asignarte oportunidades a ti mismo' });

    const finalVendedor = esAdmin ? (vid || req.user.id) : req.user.id;
    const result = await pool.query(`
      INSERT INTO crm.oportunidades (cliente_id, lead_id, contacto_id, nombre, monto_esperado, probabilidad, etapa, vendedor_id, fecha_cierre_estimada, fuente, prioridad, lista_precios)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [cliente_id || null, lead_id || null, contacto_id || null, nombre, monto_esperado || 0, probabilidad || 10, etapa || 'lead', finalVendedor, fecha_cierre_estimada || null, fuente || 'otro', prioridad || 'media', lista_precios || '200']);

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
router.put('/:id', requirePermiso('editar_pipeline', 'crm'), requireVentasPerfil('editar_pipeline'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT * FROM crm.oportunidades WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const fields = ['cliente_id', 'lead_id', 'contacto_id', 'nombre', 'monto_esperado', 'probabilidad', 'motivo_perdida', 'fecha_cierre_estimada', 'fuente', 'prioridad', 'lista_precios'];
    // vendedor_id solo admin puede cambiar a otro
    if (req.body.vendedor_id !== undefined) {
      const esAdmin = ['admin','gerente'].includes(req.user?.rol);
      const vid = parseInt(req.body.vendedor_id);
      if (!esAdmin && vid !== req.user.id) return res.status(403).json({ error: 'Solo puedes asignarte oportunidades a ti mismo' });
      fields.push('vendedor_id');
    }
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
router.put('/:id/mover', requirePermiso('editar_pipeline', 'crm'), requireVentasPerfil('editar_pipeline'), async (req, res) => {
  try {
    const { id } = req.params;
    const { etapa, comentario } = req.body;
    if (!etapa || !ETAPAS.includes(etapa)) return res.status(400).json({ error: 'Etapa invalida' });

    const existing = await pool.query(`SELECT * FROM crm.oportunidades WHERE id = $1::uuid`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Oportunidad no encontrada' });

    const etapaAnterior = existing.rows[0].etapa;
    if (etapaAnterior === etapa) return res.json({ ok: true, data: existing.rows[0] });

    const result = await pool.query(
      `UPDATE crm.oportunidades SET etapa = $1::varchar, actualizado_en = NOW(),
       motivo_perdida = CASE WHEN $1::varchar = 'perdida' THEN COALESCE($2::text, motivo_perdida) ELSE motivo_perdida END
       WHERE id = $3::uuid RETURNING *`,
      [etapa, comentario || null, id]
    );

    // Registrar en historial
    await pool.query(
      `INSERT INTO crm.oportunidad_historial (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, comentario)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
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
router.delete('/:id', requirePermiso('editar_pipeline', 'crm'), requireVentasPerfil('editar_pipeline'), async (req, res) => {
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
