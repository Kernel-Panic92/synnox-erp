import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

// GET /api/inventario — Listar inventario con filtros
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const { where, params } = buildInventarioWhere(req);
    let paramIdx = params.length + 1;

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM crm.inventario i
      INNER JOIN crm.productos p ON p.id = i.producto_id
      ${where}
    `, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT i.*, p.codigo, p.nombre, p.unidad_medida, p.categoria
      FROM crm.inventario i
      INNER JOIN crm.productos p ON p.id = i.producto_id
      ${where}
      ORDER BY p.codigo, i.bodega
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar inventario:', err);
    res.status(500).json({ error: 'Error al listar inventario' });
  }
});

function buildInventarioWhere(req) {
  const { search, bodega, stock } = req.query;
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(`(p.codigo ILIKE $${paramIdx} OR p.nombre ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (bodega) {
    conditions.push(`i.bodega = $${paramIdx++}`);
    params.push(bodega);
  }
  if (stock === 'con_stock') {
    conditions.push(`i.existencia > 0`);
  } else if (stock === 'sin_stock') {
    conditions.push(`i.existencia = 0`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// GET /api/inventario/stats — Estadisticas (respetan filtros activos)
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { where, params } = buildInventarioWhere(req);
    const stockWhere = where ? `${where} AND i.existencia > 0` : 'WHERE i.existencia > 0';

    const [totalRegistros, bodegas, productosConStock, totalExistencia] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.inventario i INNER JOIN crm.productos p ON p.id = i.producto_id ${where}`, params),
      pool.query(`SELECT COUNT(DISTINCT i.bodega) FROM crm.inventario i INNER JOIN crm.productos p ON p.id = i.producto_id ${where}`, params),
      pool.query(`SELECT COUNT(DISTINCT i.producto_id) FROM crm.inventario i INNER JOIN crm.productos p ON p.id = i.producto_id ${stockWhere}`, params),
      pool.query(`SELECT COALESCE(SUM(i.existencia), 0) AS total FROM crm.inventario i INNER JOIN crm.productos p ON p.id = i.producto_id ${where}`, params)
    ]);

    res.json({
      ok: true,
      total_registros: parseInt(totalRegistros.rows[0].count),
      bodegas: parseInt(bodegas.rows[0].count),
      productos_con_stock: parseInt(productosConStock.rows[0].count),
      total_existencia: parseInt(totalExistencia.rows[0].total)
    });
  } catch (err) {
    console.error('[CRM] Error stats inventario:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/inventario/bodegas — Lista de bodegas con nombre
router.get('/bodegas', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.bodega, b.nombre AS bodega_nombre, COUNT(*) AS productos, SUM(i.existencia) AS total_existencia
      FROM crm.inventario i
      LEFT JOIN crm.bodegas b ON b.codigo = i.bodega
      GROUP BY i.bodega, b.nombre
      ORDER BY i.bodega
    `);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar bodegas:', err);
    res.status(500).json({ error: 'Error al listar bodegas' });
  }
});

// GET /api/inventario/bodegas-all — Lista completa de bodegas (maestro)
router.get('/bodegas-all', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT codigo, nombre, ciudad FROM crm.bodegas ORDER BY codigo`);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar bodegas master:', err);
    res.status(500).json({ error: 'Error al listar bodegas' });
  }
});

// DELETE /api/inventario/limpiar — Eliminar registros huérfanos
router.delete('/limpiar', async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM crm.inventario i
      WHERE NOT EXISTS (SELECT 1 FROM crm.productos p WHERE p.id = i.producto_id)
      RETURNING id
    `);
    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error limpiar inventario:', err);
    res.status(500).json({ error: 'Error al limpiar' });
  }
});

// DELETE /api/inventario/todos — Eliminar TODO el inventario
router.delete('/todos', async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM crm.inventario RETURNING id`);
    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error eliminar todo inventario:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

export default router;
