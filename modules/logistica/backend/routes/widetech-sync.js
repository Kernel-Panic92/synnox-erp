import express from 'express';
import pool from '../config/db.js';
import wt from '../services/widetech-client.js';

const router = express.Router();

const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

router.post('/check-plate', soloAdmin, async (req, res) => {
  try {
    await wt.loadConfig();
    const { plate } = req.body;
    if (!plate) return res.status(400).json({ error: 'Placa requerida' });
    const result = await wt.checkPlate(plate.toUpperCase());
    res.json({ exitosa: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/check-vehicles', soloAdmin, async (req, res) => {
  try {
    await wt.loadConfig();
    const result = await pool.query('SELECT id, placa FROM logistics.vehiculos WHERE placa IS NOT NULL AND placa != \'\'');
    const results = [];
    for (const v of result.rows) {
      try {
        const boot = await wt.checkBoot(v.placa);
        results.push({ vehiculo_id: v.id, placa: v.placa, online: boot.exists, ultimo_gps: boot.dateGps });
      } catch (e) {
        results.push({ vehiculo_id: v.id, placa: v.placa, online: false, ultimo_gps: null, error: e.message });
      }
    }
    res.json({ exitosa: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/zones', soloAdmin, async (req, res) => {
  try {
    await wt.loadConfig();
    const zones = await wt.getZones(req.query.name || '');
    res.json({ exitosa: true, zones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/push-route', soloAdmin, async (req, res) => {
  try {
    await wt.loadConfig();
    const { rutaId } = req.body;
    if (!rutaId) return res.status(400).json({ error: 'rutaId requerido' });
    const ruta = await pool.query(
      `SELECT r.*, v.placa FROM logistics.rutas r
       JOIN logistics.vehiculos v ON v.id = r.vehiculo_id
       WHERE r.id = $1`, [rutaId]
    );
    if (!ruta.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });
    const r = ruta.rows[0];
    const paradas = await pool.query(
      `SELECT p.direccion, p.latitud, p.longitud, p.cliente_nombre
       FROM logistics.pedidos_logistica p
       WHERE p.ruta_id = $1 ORDER BY p.id`, [rutaId]
    );
    const checkpoints = paradas.rows.map((p, i) => ({
      name: p.cliente_nombre || p.direccion || `Parada ${i + 1}`,
      lat: p.latitud,
      lng: p.longitud,
      order: i + 1
    }));
    const first = paradas.rows[0] || {};
    const last = paradas.rows[paradas.rows.length - 1] || {};
    const result = await wt.pushRoute({
      manifest: `LOG-${rutaId}-${r.fecha ? r.fecha.slice(0, 10).replace(/-/g, '') : ''}`,
      plate: r.placa,
      date: r.fecha || '',
      driver: r.conductor_nombre || '',
      origin: first.direccion || first.cliente_nombre || '',
      destination: last.direccion || last.cliente_nombre || '',
      latOrigin: first.latitud,
      lngOrigin: first.longitud,
      checkpoints
    });
    await pool.query(
      `INSERT INTO logistics.configuracion (clave, valor, updated_at)
       VALUES ('widtech_sync_log', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (clave) DO UPDATE SET valor = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify({ ruta_id: rutaId, fecha: new Date().toISOString(), manifiesto: `LOG-${rutaId}`, ok: true })]
    );
    res.json({ exitosa: true, mensaje: `Ruta ${rutaId} enviada a Widetech`, resultado: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-check-plates', soloAdmin, async (req, res) => {
  try {
    await wt.loadConfig();
    const { plates } = req.body;
    if (!Array.isArray(plates) || !plates.length) return res.status(400).json({ error: 'Array de placas requerido' });
    const unique = [...new Set(plates.map(p => p.toUpperCase().trim()).filter(Boolean))];
    const results = [];
    for (const plate of unique) {
      try {
        const boot = await wt.checkBoot(plate);
        let created = false;
        if (boot.exists) {
          const existing = await pool.query('SELECT id FROM logistics.vehiculos WHERE placa = $1', [plate]);
          if (!existing.rows.length) {
            await pool.query(
              `INSERT INTO logistics.vehiculos (placa, alias, estado, created_at, updated_at)
               VALUES ($1, $2, 'desconocido', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [plate, '🛰️ Widetech']
            );
            created = true;
          }
        }
        results.push({ plate, exists: boot.exists, dateGps: boot.dateGps, created });
      } catch (e) {
        results.push({ plate, exists: false, dateGps: null, created: false, error: e.message });
      }
    }
    const imported = results.filter(r => r.created).length;
    const found = results.filter(r => r.exists).length;
    res.json({ exitosa: true, results, summary: { total: unique.length, found, imported, notFound: unique.length - found } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
