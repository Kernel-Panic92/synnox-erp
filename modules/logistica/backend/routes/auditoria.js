import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

router.get('/', soloAdmin, async (req, res) => {
  try {
    const { tipo, desde, hasta, buscar } = req.query;
    let sql = 'SELECT a.*, u.nombre FROM logistics.auditoria_accesos a LEFT JOIN logistics.usuarios u ON a.usuario_id = u.id WHERE 1=1';
    const params = [];
    if (tipo) { params.push(tipo); sql += ` AND a.tipo=$${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND a.timestamp>=$${params.length}`; }
    if (hasta) { params.push(hasta + 'T23:59:59'); sql += ` AND a.timestamp<=$${params.length}`; }
    if (buscar) { params.push(`%${buscar}%`); sql += ` AND (a.email ILIKE $${params.length} OR u.nombre ILIKE $${params.length})`; }
    sql += ' ORDER BY a.timestamp DESC LIMIT 200';
    const historial = await pool.query(sql, params);

    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM logistics.auditoria_accesos WHERE tipo='exito' AND timestamp >= CURRENT_DATE) AS exitos_hoy,
        (SELECT COUNT(*) FROM logistics.auditoria_accesos WHERE tipo='fallido' AND timestamp >= CURRENT_DATE) AS fallidos_hoy,
        (SELECT COUNT(*) FROM logistics.auditoria_accesos WHERE tipo='exito' AND timestamp >= CURRENT_DATE - INTERVAL '7 days') AS exitos_7d
    `);

    res.json({ exitosa: true, historial: historial.rows, stats: stats.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
