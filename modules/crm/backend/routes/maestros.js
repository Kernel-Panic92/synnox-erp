import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';

const router = express.Router();

const MAP = {
  motivo_venta: { table: 'crm.motivos_venta', cols: ['codigo','nombre'] },
  tipo_documento: { table: 'crm.tipos_documento', cols: ['codigo','nombre'] },
  centro_costo: { table: 'crm.centros_costo', cols: ['codigo','nombre'] },
  unidad_negocio: { table: 'crm.unidades_negocio', cols: ['codigo','nombre'] },
  lista_precio: { table: 'crm.listas_precio', cols: ['codigo','nombre'] },
  bodega: { table: 'crm.bodegas', cols: ['codigo','nombre'] },
};

// GET /api/maestros?tipo=motivo_venta|...
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { tipo, q, limit = 100 } = req.query;
    if (tipo && MAP[tipo]) {
      const cfg = MAP[tipo];
      let sql = `SELECT * FROM ${cfg.table} WHERE activo = TRUE`;
      const params = [];
      if (q) { sql += ` AND (codigo ILIKE $1 OR nombre ILIKE $1)`; params.push(`%${q}%`); }
      sql += ` ORDER BY nombre LIMIT ${parseInt(limit)}`;
      const r = await pool.query(sql, params);
      return res.json({ ok: true, data: r.rows, tipo });
    }
    // Sin tipo: devuelve conteos de todos
    const counts = {};
    for (const [k, cfg] of Object.entries(MAP)) {
      const r = await pool.query(`SELECT COUNT(*) FROM ${cfg.table} WHERE activo = TRUE`);
      counts[k] = parseInt(r.rows[0].count);
    }
    // Centros vienen del Launcher via proxy (si está disponible)
    let centros = 0;
    try { centros = globalThis.__centrosCache ? globalThis.__centrosCache.length : 0; } catch {}
    counts.centro_operacion = centros;
    res.json({ ok: true, counts });
  } catch (err) {
    console.error('[CRM] Error maestros:', err);
    res.status(500).json({ error: 'Error al cargar maestros' });
  }
});

// POST /api/maestros/sync — stub para SIESA Hub (hoy sincroniza desde CSV ya importado)
router.post('/sync', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    // Futuro: llamar a SIESA Hub y upsert. Hoy solo retorna conteos actuales.
    const r = await pool.query(`SELECT COUNT(*) FROM crm.listas_precio WHERE activa = TRUE`);
    res.json({ ok: true, message: 'Sincronización con SIESA Hub pendiente de credenciales. Datos actuales desde CSV.', listas_precio: parseInt(r.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Error en sync' });
  }
});

export default router;
