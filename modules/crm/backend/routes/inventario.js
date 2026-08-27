import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

// GET /api/inventario — Listar inventario con filtros
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { search, bodega, stock, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
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

// GET /api/inventario/stats — Estadisticas
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const [totalRegistros, bodegas, productosConStock, totalExistencia] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.inventario`),
      pool.query(`SELECT COUNT(DISTINCT bodega) FROM crm.inventario`),
      pool.query(`SELECT COUNT(DISTINCT producto_id) FROM crm.inventario WHERE existencia > 0`),
      pool.query(`SELECT COALESCE(SUM(existencia), 0) AS total FROM crm.inventario`)
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

// GET /api/inventario/bodegas — Lista de bodegas
router.get('/bodegas', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bodega, COUNT(*) AS productos, SUM(existencia) AS total_existencia
      FROM crm.inventario
      GROUP BY bodega
      ORDER BY bodega
    `);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar bodegas:', err);
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
