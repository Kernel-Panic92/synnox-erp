import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

// GET /api/reportes/productos-rendimiento?desde=&hasta= — veces cotizado y dinero por producto
router.get('/productos-rendimiento', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const conds = [];
    const params = [];
    let pi = 1;
    if (desde) { conds.push(`c.creado_en >= $${pi}::date`); params.push(desde); pi++; }
    if (hasta) { conds.push(`c.creado_en < $${pi}::date + INTERVAL '1 day'`); params.push(hasta); pi++; }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT COALESCE(p.codigo, ci.referencia, 'SIN-REF') AS codigo,
        COALESCE(p.nombre, ci.descripcion, '—') AS nombre,
        COALESCE(p.categoria, '—') AS categoria,
        COUNT(*) AS veces,
        ROUND(SUM(ci.cantidad * ci.precio_unitario * (1 - COALESCE(ci.descuento_pct,0)/100)), 0) AS total_dinero
      FROM crm.cotizacion_items ci
      JOIN crm.cotizaciones c ON c.id = ci.cotizacion_id
      LEFT JOIN crm.productos p ON p.codigo = ci.referencia
      ${where}
      GROUP BY COALESCE(p.codigo, ci.referencia, 'SIN-REF'), COALESCE(p.nombre, ci.descripcion, '—'), COALESCE(p.categoria, '—')
      ORDER BY total_dinero DESC`, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) {
    console.error('[CRM] Error reporte productos:', err);
    res.status(500).json({ error: 'Error al generar reporte de productos' });
  }
});

export default router;
