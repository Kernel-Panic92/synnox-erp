import express from 'express';
import pool from '../config/db.js';
import wt from '../services/widetech-client.js';

const router = express.Router();

const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

router.get('/travels', soloAdmin, async (req, res) => {
  try {
    await wt.loadConfig();
    const start = req.query.start;
    const end = req.query.end;
    if (!start || !end) return res.status(400).json({ error: 'Parámetros start y end requeridos (YYYY/MM/dd HH:mm:ss)' });
    const travels = await wt.getTravel({ startDate: start, endDate: end, plate: req.query.plate || '' });
    const orphanResult = await wt.syncOrphanVehicles(travels);
    const plates = [...new Set(travels.map(t => t.Plate).filter(Boolean))];
    const vehiculos = await pool.query('SELECT id, placa, alias FROM logistics.vehiculos WHERE placa = ANY($1)', [plates.length ? plates : ['']]);
    const vMap = {};
    for (const v of vehiculos.rows) vMap[v.placa] = v;
    const enriched = travels.map(t => ({
      ...t,
      vehiculo_id: vMap[t.Plate]?.id || null,
      vehiculo_alias: vMap[t.Plate]?.alias || null,
    }));
    res.json({ exitosa: true, travels: enriched, orphan_vehicles: orphanResult });
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

router.post('/import-travel', soloAdmin, async (req, res) => {
  const { placa, conductor, origen, destino, lat_origen, lng_origen, lat_destino, lng_destino, fecha } = req.body;
  if (!placa) return res.status(400).json({ error: 'Placa requerida' });
  try {
    const vResult = await pool.query('SELECT id FROM logistics.vehiculos WHERE placa = $1', [placa]);
    if (!vResult.rows.length) return res.status(400).json({ error: `Vehículo ${placa} no existe en logística. Sincroniza viajes primero para auto-importarlo.` });
    const vehiculoId = vResult.rows[0].id;
    const routeDate = fecha ? fecha.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const r = await pool.query(
      `INSERT INTO logistics.rutas (nombre, fecha, vehiculo_id, conductor_nombre, estado, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'planificada', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [`Widetech ${placa} ${routeDate}`, routeDate, vehiculoId, conductor || '']
    );
    if (origen && destino) {
      await pool.query(
        `INSERT INTO logistics.pedidos_logistica (numero_factura, cliente_nombre, direccion, latitud, longitud, estado, ruta_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pendiente', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [`WT-${r.rows[0].id}`, origen, origen, lat_origen || null, lng_origen || null, r.rows[0].id]
      );
    }
    if (destino && destino !== origen) {
      await pool.query(
        `INSERT INTO logistics.pedidos_logistica (numero_factura, cliente_nombre, direccion, latitud, longitud, estado, ruta_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pendiente', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [`WT-${r.rows[0].id}-D`, destino, destino, lat_destino || null, lng_destino || null, r.rows[0].id]
      );
    }
    const paradas = await pool.query(
      'UPDATE logistics.rutas SET cantidad_paradas = (SELECT COUNT(*) FROM logistics.pedidos_logistica WHERE ruta_id = $1) WHERE id = $1 RETURNING id, nombre, fecha, cantidad_paradas',
      [r.rows[0].id]
    );
    res.json({ exitosa: true, mensaje: 'Ruta importada desde Widetech', ruta: paradas.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
