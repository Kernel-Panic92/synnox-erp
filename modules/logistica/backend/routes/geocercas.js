import express from 'express';
import pool from '../config/db.js';
import wt from '../services/widetech-client.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { activa, fuente, q } = req.query;
    const conditions = [];
    const params = [];
    if (activa !== undefined) { params.push(activa === 'true'); conditions.push(`g.activa = $${params.length}`); }
    if (fuente) { params.push(fuente); conditions.push(`g.fuente = $${params.length}`); }
    if (q) { params.push(`%${q}%`); conditions.push(`g.nombre ILIKE $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(
      `SELECT g.*,
        (SELECT COUNT(*) FROM logistics.alertas_geocerca a WHERE a.geocerca_id = g.id) AS alertas_count
       FROM logistics.geocercas g ${where} ORDER BY g.nombre`, params
    );
    res.json({ ok: true, geocercas: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logistics.geocercas WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Geocerca no encontrada' });
    res.json({ ok: true, geocerca: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, tipo, latitud, longitud, radio, poligono, color, activa, fuente } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    if (tipo === 'circular' && (!latitud || !longitud || !radio)) return res.status(400).json({ error: 'Circular requiere latitud, longitud y radio' });
    if (tipo === 'poligono' && (!poligono || !Array.isArray(poligono) || poligono.length < 3)) return res.status(400).json({ error: 'Poligono requiere al menos 3 puntos' });
    const result = await pool.query(
      `INSERT INTO logistics.geocercas (nombre, tipo, latitud, longitud, radio, poligono, color, activa, fuente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [nombre, tipo || 'circular', latitud, longitud, radio, poligono ? JSON.stringify(poligono) : null, color || '#3388ff', activa !== false, fuente || 'manual']
    );
    res.json({ ok: true, geocerca: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, tipo, latitud, longitud, radio, poligono, color, activa } = req.body;
    const existing = await pool.query('SELECT * FROM logistics.geocercas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Geocerca no encontrada' });
    const cur = existing.rows[0];
    const result = await pool.query(
      `UPDATE logistics.geocercas SET nombre=$1, tipo=$2, latitud=$3, longitud=$4, radio=$5, poligono=$6, color=$7, activa=$8, updated_at=CURRENT_TIMESTAMP
       WHERE id=$9 RETURNING *`,
      [nombre || cur.nombre, tipo || cur.tipo, latitud ?? cur.latitud, longitud ?? cur.longitud, radio ?? cur.radio, poligono ? JSON.stringify(poligono) : cur.poligono, color || cur.color, activa ?? cur.activa, req.params.id]
    );
    res.json({ ok: true, geocerca: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logistics.geocercas WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Geocerca no encontrada' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/import-widetech', async (req, res) => {
  try {
    await wt.loadConfig();
    const zones = await wt.getZones('');
    if (!zones.length) return res.json({ ok: true, importadas: 0, actualizadas: 0, total: 0 });
    let importadas = 0;
    let actualizadas = 0;
    for (const z of zones) {
      const widetechId = String(z.cpID || z.Id || '');
      const nombre = z.cpName || z.Name || 'Sin nombre';
      const lat = parseFloat(z.cpLat || z.Lat) || null;
      const lng = parseFloat(z.cpLng || z.Lng) || null;
      const tipoRaw = (z.cpType || z.Type || '').toString().toLowerCase();
      const tipo = tipoRaw.includes('poly') || tipoRaw.includes('poligono') ? 'poligono' : 'circular';
      const radio = parseFloat(z.cpRadius || z.Radius) || null;
      const metadata = {};
      for (const [k, v] of Object.entries(z)) {
        if (!['cpID', 'Id', 'cpName', 'Name', 'cpLat', 'Lat', 'cpLng', 'Lng', 'cpType', 'Type', 'cpRadius', 'Radius'].includes(k)) {
          metadata[k] = v;
        }
      }
      const randomColor = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      try {
        const r = await pool.query(
          `INSERT INTO logistics.geocercas (widetech_id, nombre, tipo, latitud, longitud, radio, color, activa, fuente, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'widetech', $8)
           ON CONFLICT (widetech_id) DO UPDATE SET nombre=$2, tipo=$3, latitud=$4, longitud=$5, radio=$6, metadata=$8, updated_at=CURRENT_TIMESTAMP
           RETURNING (xmax = 0) AS is_insert`,
          [widetechId, nombre, tipo, lat, lng, radio, randomColor, Object.keys(metadata).length ? JSON.stringify(metadata) : null]
        );
        if (r.rows[0]?.is_insert) importadas++; else actualizadas++;
      } catch (e) {
        console.error(`[geocercas] Error importando zona ${widetechId}: ${e.message}`);
      }
    }
    res.json({ ok: true, importadas, actualizadas, total: zones.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/alertas', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const result = await pool.query(
      `SELECT a.*, v.placa, v.alias
       FROM logistics.alertas_geocerca a
       JOIN logistics.vehiculos v ON v.id = a.vehiculo_id
       WHERE a.geocerca_id = $1 ORDER BY a.fecha DESC LIMIT $2 OFFSET $3`,
      [req.params.id, parseInt(limit), offset]
    );
    const count = await pool.query('SELECT COUNT(*) FROM logistics.alertas_geocerca WHERE geocerca_id = $1', [req.params.id]);
    res.json({ ok: true, alertas: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/check-alert', async (req, res) => {
  try {
    const { vehiculo_id, latitud, longitud } = req.body;
    if (!vehiculo_id || !latitud || !longitud) return res.status(400).json({ error: 'vehiculo_id, latitud, longitud requeridos' });
    const geocercas = await pool.query(
      `SELECT id, nombre, tipo, latitud, longitud, radio, poligono FROM logistics.geocercas WHERE activa = true`
    );
    const alertas = [];
    for (const g of geocercas.rows) {
      let dentro = false;
      if (g.tipo === 'circular' && g.latitud && g.longitud && g.radio) {
        const dist = haversine(latitud, longitud, parseFloat(g.latitud), parseFloat(g.longitud));
        dentro = dist <= parseFloat(g.radio);
      } else if (g.tipo === 'poligono' && g.poligono) {
        const puntos = typeof g.poligono === 'string' ? JSON.parse(g.poligono) : g.poligono;
        dentro = pointInPolygon(latitud, longitud, puntos);
      }
      if (dentro) {
        const last = await pool.query(
          `SELECT tipo FROM logistics.alertas_geocerca WHERE geocerca_id=$1 AND vehiculo_id=$2 ORDER BY fecha DESC LIMIT 1`,
          [g.id, vehiculo_id]
        );
        if (!last.rows.length || last.rows[0].tipo === 'salida') {
          await pool.query(
            `INSERT INTO logistics.alertas_geocerca (geocerca_id, vehiculo_id, tipo, latitud, longitud) VALUES ($1, $2, 'entrada', $3, $4)`,
            [g.id, vehiculo_id, latitud, longitud]
          );
          alertas.push({ geocerca_id: g.id, nombre: g.nombre, tipo: 'entrada' });
        }
      } else {
        const last = await pool.query(
          `SELECT tipo FROM logistics.alertas_geocerca WHERE geocerca_id=$1 AND vehiculo_id=$2 ORDER BY fecha DESC LIMIT 1`,
          [g.id, vehiculo_id]
        );
        if (last.rows.length && last.rows[0].tipo === 'entrada') {
          await pool.query(
            `INSERT INTO logistics.alertas_geocerca (geocerca_id, vehiculo_id, tipo, latitud, longitud) VALUES ($1, $2, 'salida', $3, $4)`,
            [g.id, vehiculo_id, latitud, longitud]
          );
          alertas.push({ geocerca_id: g.id, nombre: g.nombre, tipo: 'salida' });
        }
      }
    }
    res.json({ ok: true, alertas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = parseFloat(polygon[i].lat || polygon[i].latitud || polygon[i][0]);
    const yi = parseFloat(polygon[i].lng || polygon[i].longitud || polygon[i][1]);
    const xj = parseFloat(polygon[j].lat || polygon[j].latitud || polygon[j][0]);
    const yj = parseFloat(polygon[j].lng || polygon[j].longitud || polygon[j][1]);
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export default router;
