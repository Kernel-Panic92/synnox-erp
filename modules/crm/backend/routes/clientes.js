import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';
import { requireClienteEditable } from '../utils/siesaReadOnly.js';

const router = express.Router();

function buildClientesWhere(req) {
  const { tipo, vendedor, ciudad, canal, search, col_nombre, col_nit, col_ciudad } = req.query;
  const conditions = ['e.activo = TRUE'];
  const params = [];
  let paramIdx = 1;

  if (tipo) {
    conditions.push(`e.tipo = $${paramIdx++}`);
    params.push(tipo);
  }
  if (canal) {
    conditions.push(`e.canal ILIKE $${paramIdx++}`);
    params.push(`%${canal}%`);
  }
  if (vendedor) {
    conditions.push(`e.vendedor_asignado = $${paramIdx++}`);
    params.push(parseInt(vendedor));
  }
  if (ciudad) {
    conditions.push(`e.ciudad ILIKE $${paramIdx++}`);
    params.push(`%${ciudad}%`);
  }
  if (col_nombre) {
    conditions.push(`e.nombre ILIKE $${paramIdx++}`);
    params.push(`%${col_nombre}%`);
  }
  if (col_nit) {
    conditions.push(`e.nit ILIKE $${paramIdx++}`);
    params.push(`%${col_nit}%`);
  }
  if (col_ciudad) {
    conditions.push(`e.ciudad ILIKE $${paramIdx++}`);
    params.push(`%${col_ciudad}%`);
  }
    if (search) {
      conditions.push(`(e.nombre ILIKE $${paramIdx} OR e.nit ILIKE $${paramIdx} OR e.sector ILIKE $${paramIdx} OR e.razon_social ILIKE $${paramIdx} OR e.codigo_siesa ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// GET /api/clientes — Listar clientes con filtros, busqueda y paginacion
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = 'creado_en', order = 'desc' } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const { where, params } = buildClientesWhere(req);
    const allowedSort = ['nombre', 'ciudad', 'tipo', 'creado_en', 'actualizado_en'];
    const sortCol = allowedSort.includes(sort) ? sort : 'creado_en';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let paramIdx = params.length + 1;

    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.clientes e ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT e.*,
        (SELECT COUNT(*) FROM crm.contactos c WHERE c.cliente_id = e.id AND c.activo = TRUE) AS total_contactos
      FROM crm.clientes e
      ${where}
      ORDER BY e.${sortCol} ${sortOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar clientes:', err);
    res.status(500).json({ error: 'Error al listar clientes' });
  }
});

// GET /api/clientes/stats — Estadisticas (respetan filtros activos)
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { where, params } = buildClientesWhere(req);

    const [total, porTipo, porCiudad, recientes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.clientes e ${where}`, params),
      pool.query(`SELECT e.tipo, COUNT(*) AS total FROM crm.clientes e ${where} GROUP BY e.tipo ORDER BY total DESC`, params),
      pool.query(`SELECT e.ciudad, COUNT(*) AS total FROM crm.clientes e ${where} AND e.ciudad IS NOT NULL GROUP BY e.ciudad ORDER BY total DESC LIMIT 10`, params),
      pool.query(`SELECT e.id, e.nombre, e.tipo, e.ciudad, e.creado_en FROM crm.clientes e ${where} ORDER BY e.creado_en DESC LIMIT 5`, params)
    ]);

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      por_tipo: porTipo.rows,
      por_ciudad: porCiudad.rows,
      recientes: recientes.rows
    });
  } catch (err) {
    console.error('[CRM] Error stats clientes:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/clientes/:id — Detalle de cliente con contactos
router.get('/:id', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await pool.query(`SELECT * FROM crm.clientes WHERE id = $1`, [id]);
    if (!cliente.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const contactos = await pool.query(
      `SELECT * FROM crm.contactos WHERE cliente_id = $1 AND activo = TRUE ORDER BY nombre`,
      [id]
    );

    res.json({ ok: true, data: { ...cliente.rows[0], contactos: contactos.rows } });
  } catch (err) {
    console.error('[CRM] Error obtener cliente:', err);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

// GET /api/clientes/:id/facturas — Facturas del cliente
router.get('/:id/facturas', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM crm.facturas WHERE cliente_id = $1 ORDER BY fecha DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar facturas:', err);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

// POST /api/clientes — Crear cliente (BLOQUEADO: terceros se gestionan en el ERP SIESA y se sincronizan)
router.post('/', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  // Flujo oficial: Vendedor crea LEAD -> envia al ERP -> contabilidad crea el tercero -> se sincroniza.
  // El CRM nunca crea terceros/clientes directamente (ni admin). Solo import/sync (rutas internas).
  return res.status(403).json({ error: 'Los clientes/terceros se gestionan en el ERP SIESA y se sincronizan. Crea un Lead (prospecto) y envíalo al ERP; contabilidad crea el tercero.' });
});

// PUT /api/clientes/:id — Editar cliente
router.put('/:id', requirePermiso('editar_contacto', 'crm'), requireClienteEditable, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT id FROM crm.clientes WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const fields = ['nombre', 'nit', 'tipo', 'sector', 'direccion', 'ciudad', 'latitud', 'longitud', 'telefono', 'email', 'website', 'codigo_siesa', 'vendedor_asignado', 'notas', 'activo'];
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

    const result = await pool.query(`UPDATE crm.clientes SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    await auditarEvento({ accion: 'editar', entidad: 'cliente', entidad_id: id, usuario_id: req.user.id, metadata: { campos: Object.keys(req.body) } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar cliente:', err);
    res.status(500).json({ error: 'Error al editar cliente' });
  }
});

// DELETE /api/clientes/seleccionados — Bulk delete (BEFORE /:id)
router.delete('/seleccionados', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'Sin IDs' });
    if (req.user?.rol !== 'admin' && req.user?.rol !== 'gerente') {
      const siesa = await pool.query(`SELECT COUNT(*) AS c FROM crm.clientes WHERE id = ANY($1) AND origen = 'siesa'`, [ids]);
      if (parseInt(siesa.rows[0].c) > 0) return res.status(403).json({ error: 'No se pueden eliminar clientes del ERP SIESA (solo lectura). Gestiona los terceros en el ERP.' });
    }
    const result = await pool.query(`UPDATE crm.clientes SET activo = FALSE WHERE id = ANY($1) RETURNING id`, [ids]);

    await auditarEvento({ accion: 'eliminar', entidad: 'cliente', usuario_id: req.user.id, metadata: { count: result.rowCount } });

    res.json({ ok: true, eliminadas: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error bulk eliminar clientes:', err);
    res.status(500).json({ error: 'Error al eliminar clientes' });
  }
});

// DELETE /api/clientes/todos — Delete ALL clients (testing only, BEFORE /:id)
router.delete('/todos', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    if (req.user?.rol !== 'admin' && req.user?.rol !== 'gerente') {
      return res.status(403).json({ error: 'Solo admin/gerente pueden eliminar todos los clientes' });
    }
    const result = await pool.query(`UPDATE crm.clientes SET activo = FALSE WHERE activo = TRUE RETURNING id`);
    await auditarEvento({ accion: 'eliminar', entidad: 'cliente', usuario_id: req.user.id, metadata: { count: result.rowCount, tipo: 'todos' } });
    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error eliminar todos:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// DELETE /api/clientes/:id — Soft delete (AFTER /seleccionados and /todos)
router.delete('/:id', requirePermiso('eliminar_contacto', 'crm'), requireClienteEditable, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`UPDATE crm.clientes SET activo = FALSE WHERE id = $1 RETURNING id, nombre`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    await auditarEvento({ accion: 'eliminar', entidad: 'cliente', entidad_id: id, usuario_id: req.user.id, metadata: { nombre: result.rows[0].nombre } });

    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar cliente:', err);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

export default router;
