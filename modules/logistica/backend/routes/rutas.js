import express from 'express';
import pool from '../config/db.js';
import { generarRutasOptimizadas } from '../utils/vrp.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { fecha, sede } = req.query;
    let sql = `SELECT r.*, v.placa FROM logistics.rutas r JOIN logistics.vehiculos v ON r.vehiculo_id=v.id WHERE 1=1`;
    const params = [];
    if (fecha) { params.push(fecha); sql += ` AND r.fecha=$${params.length}`; }
    if (sede) { params.push(sede); sql += ` AND r.sede=$${params.length}`; }
    sql += ' ORDER BY r.id';
    const result = await pool.query(sql, params);
    res.json({ exitosa: true, total: result.rows.length, rutas: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/diagnostico', async (req, res) => {
  try {
    const pedidosTodos = await pool.query(`SELECT id, numero_factura, estado, ruta_id, latitud, longitud FROM logistics.pedidos_logistica ORDER BY id`);
    const pedidosPendientesSinRuta = await pool.query(`SELECT id, numero_factura, latitud, longitud FROM logistics.pedidos_logistica WHERE estado='pendiente' AND ruta_id IS NULL`);
    const pedidosConCoords = await pool.query(`SELECT id, numero_factura FROM logistics.pedidos_logistica WHERE estado='pendiente' AND ruta_id IS NULL AND latitud IS NOT NULL AND longitud IS NOT NULL`);
    const vehiculosDisponibles = await pool.query(`SELECT id, placa, estado, ultima_posicion_lat, ultima_posicion_lng FROM logistics.vehiculos WHERE estado='disponible'`);
    res.json({
      pedidos_total: pedidosTodos.rows.length,
      pedidos_pendientes_sin_ruta: pedidosPendientesSinRuta.rows,
      pedidos_pendientes_con_coords: pedidosConCoords.rows,
      vehiculos_disponibles: vehiculosDisponibles.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const ruta = await pool.query(
      `SELECT r.*, v.placa, v.alias as vehiculo_alias, v.color as color_vehiculo
       FROM logistics.rutas r
       JOIN logistics.vehiculos v ON r.vehiculo_id=v.id
       WHERE r.id=$1`, [req.params.id]);
    if (ruta.rows.length === 0) return res.status(404).json({ error: 'Ruta no encontrada' });
    const paradas = await pool.query(
      'SELECT * FROM logistics.paradas_ruta WHERE ruta_id=$1 ORDER BY secuencia', [req.params.id]
    );
    res.json({ exitosa: true, ruta: ruta.rows[0], paradas: paradas.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generar', async (req, res) => {
  try {
    const { fecha, sede, sede_id, ruta, tipo } = req.body;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    let depot = null;
    let sedeNombre = sede || null;

    const rutaCol = tipo === 'moto' ? 'c.ruta_moto' : 'c.ruta';

    // Auto-detectar sede desde la zona si no se especificó sede_id
    if (ruta && !sede_id) {
      const ciudadRow = await pool.query(
        `SELECT c.ciudad, COUNT(*) AS cnt
         FROM logistics.clientes c
         WHERE ${rutaCol.replace('c.', 'c.')}=$1 AND c.ciudad IS NOT NULL AND c.ciudad!=''
         GROUP BY c.ciudad ORDER BY cnt DESC LIMIT 1`,
        [ruta]
      );
      if (ciudadRow.rows.length > 0) {
        const ciudad = ciudadRow.rows[0].ciudad;
        const sedeRow = await pool.query(
          `SELECT id, nombre, latitud, longitud FROM logistics.sedes
           WHERE (ciudad ILIKE $1 OR nombre ILIKE $1) AND activo=true LIMIT 1`,
          [`%${ciudad}%`]
        );
        if (sedeRow.rows.length > 0) {
          sedeNombre = sedeRow.rows[0].nombre;
          if (sedeRow.rows[0].latitud && sedeRow.rows[0].longitud) {
            depot = { lat: Number(sedeRow.rows[0].latitud), lng: Number(sedeRow.rows[0].longitud) };
          }
          console.log(`[rutas/generar] sede auto-detectada para zona "${ruta}": "${sedeNombre}" (${ciudad})`);
        }
      }
    }

    if (sede_id) {
      const sedeRow = await pool.query('SELECT nombre, latitud, longitud FROM logistics.sedes WHERE id=$1 AND activo=true', [sede_id]);
      if (sedeRow.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada o inactiva' });
      sedeNombre = sedeRow.rows[0].nombre;
      if (sedeRow.rows[0].latitud && sedeRow.rows[0].longitud) {
        depot = { lat: Number(sedeRow.rows[0].latitud), lng: Number(sedeRow.rows[0].longitud) };
      }
    }

    const pedidos = await pool.query(
      `SELECT p.id, p.latitud AS lat, p.longitud AS lng, p.peso_estimado, p.volumen_estimado,
              p.vehiculo_id, p.cliente_nombre, p.direccion, ${rutaCol} AS cliente_ruta
       FROM logistics.pedidos_logistica p
       LEFT JOIN logistics.clientes c ON c.id = p.cliente_id
       WHERE p.estado='pendiente' AND p.ruta_id IS NULL
         AND p.latitud IS NOT NULL AND p.longitud IS NOT NULL`
    );
    if (pedidos.rows.length === 0) return res.status(400).json({ error: 'No hay pedidos pendientes con coordenadas. Asegúrate de que los pedidos tengan latitud y longitud.' });

    const vehiculos = await pool.query(
      `SELECT id, placa, sede, ultima_posicion_lat AS lat, ultima_posicion_lng AS lng
       FROM logistics.vehiculos WHERE estado='disponible'`
    );
    if (vehiculos.rows.length === 0) return res.status(400).json({ error: 'No hay vehículos disponibles' });

    // Filtrar pedidos por zona si se especificó
    let pedidosFiltrados = pedidos.rows;
    if (ruta) {
      pedidosFiltrados = pedidosFiltrados.filter(p => p.cliente_ruta === ruta);
    }

    // Separar pedidos con vehiculo_id asignado
    const pedidosConVehiculo = pedidosFiltrados.filter(p => p.vehiculo_id);
    const pedidosSinVehiculo = pedidosFiltrados.filter(p => !p.vehiculo_id);
    if (pedidosConVehiculo.length === 0) return res.status(400).json({
      error: 'Ningún pedido pendiente tiene vehículo asignado. Asigne un vehículo a los pedidos primero.'
    });

    // Agrupar pedidos por vehiculo_id (el vehículo que ya tiene asignado cada pedido)
    const gruposPorVehiculo = {};
    for (const p of pedidosConVehiculo) {
      if (!gruposPorVehiculo[p.vehiculo_id]) gruposPorVehiculo[p.vehiculo_id] = [];
      gruposPorVehiculo[p.vehiculo_id].push(p);
    }

    // Obtener datos de los vehículos asignados a los pedidos
    const vehiculoIds = Object.keys(gruposPorVehiculo).map(Number);
    const vehiculosAsignados = vehiculos.rows.filter(v => vehiculoIds.includes(v.id));
    if (vehiculosAsignados.length === 0) return res.status(400).json({
      error: 'No se encontraron los vehículos asignados a los pedidos.'
    });

    console.log(`[rutas/generar] ${pedidosConVehiculo.length} pedidos agrupados en ${vehiculosAsignados.length} vehículo(s)`);
    if (pedidosSinVehiculo.length > 0) {
      console.log(`[rutas/generar] ${pedidosSinVehiculo.length} pedido(s) ignorados por no tener vehículo asignado`);
    }

    const osrmUrl = process.env.OSRM_URL || 'https://router.project-osrm.org';
    const rutasCreadas = [];

    for (const vehiculo of vehiculosAsignados) {
      const grupo = gruposPorVehiculo[vehiculo.id];
      const nombreRuta = grupo[0].cliente_ruta || `Vehículo ${vehiculo.placa}`;

      console.log(`[rutas/generar] vehículo #${vehiculo.id} (${vehiculo.placa}): ${grupo.length} pedidos`);

      const resultado = await generarRutasOptimizadas(grupo, [vehiculo], osrmUrl, depot);
      console.log(`[rutas/generar] resultado vehículo #${vehiculo.id}:`, resultado);

      if (!resultado.exitosa || resultado.rutas.length === 0) {
        console.log(`[rutas/generar] vehículo #${vehiculo.id} no generó ruta:`, resultado.error || 'sin rutas');
        continue;
      }

      const rOpt = resultado.rutas[0];
      const nombre = `${nombreRuta} - ${vehiculo.placa} - ${fecha}`;
      const nuevaRuta = await pool.query(
        `INSERT INTO logistics.rutas (nombre, fecha, vehiculo_id, sede, distancia_total_estimada,
         tiempo_estimado, estado, cantidad_paradas, geometria)
         VALUES ($1,$2,$3,$4,$5,$6,'planificada',$7,$8::jsonb) RETURNING *`,
        [nombre, fecha, rOpt.vehiculoId, sedeNombre, rOpt.distancia, rOpt.duracion, rOpt.paradas.length,
         rOpt.geometria ? JSON.stringify(rOpt.geometria) : null]
      );
      const rutaId = nuevaRuta.rows[0].id;

      for (let i = 0; i < rOpt.paradas.length; i++) {
        const p = rOpt.paradas[i];
        await pool.query(
          `INSERT INTO logistics.paradas_ruta (ruta_id, pedido_id, secuencia, latitud, longitud,
           cliente_nombre, estado)
           VALUES ($1,$2,$3,$4,$5,$6,'pendiente')`,
          [rutaId, p.id, i + 1, p.lat, p.lng, p.cliente_nombre || '']
        );
        await pool.query(
          `UPDATE logistics.pedidos_logistica SET ruta_id=$1, secuencia_en_ruta=$2, estado='asignado'
           WHERE id=$3`, [rutaId, i + 1, p.id]
        );
      }
      rutasCreadas.push(nuevaRuta.rows[0]);
    }

    res.status(201).json({
      exitosa: true,
      mensaje: `${rutasCreadas.length} ruta(s) creada(s) de ${vehiculosAsignados.length} vehículo(s)`,
      rutas: rutasCreadas
    });
  } catch (err) {
    console.error('Error generando rutas:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { estado, distancia_total_real, tiempo_real, paradas_completadas, paradas_fallidas } = req.body;
    const result = await pool.query(
      `UPDATE logistics.rutas SET estado=COALESCE($1,estado), distancia_total_real=COALESCE($2,distancia_total_real),
       tiempo_real=COALESCE($3,tiempo_real), paradas_completadas=COALESCE($4,paradas_completadas),
       paradas_fallidas=COALESCE($5,paradas_fallidas), updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *`,
      [estado, distancia_total_real, tiempo_real, paradas_completadas, paradas_fallidas, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.json({ exitosa: true, ruta: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ruta = await pool.query('SELECT id FROM logistics.rutas WHERE id=$1', [req.params.id]);
    if (ruta.rows.length === 0) return res.status(404).json({ error: 'Ruta no encontrada' });
    await pool.query('UPDATE logistics.pedidos_logistica SET ruta_id=NULL, estado=\'pendiente\', secuencia_en_ruta=NULL WHERE ruta_id=$1', [req.params.id]);
    await pool.query('DELETE FROM logistics.paradas_ruta WHERE ruta_id=$1', [req.params.id]);
    await pool.query('DELETE FROM logistics.rutas WHERE id=$1', [req.params.id]);
    res.json({ exitosa: true, mensaje: 'Ruta eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids requerido' });
    await pool.query('UPDATE logistics.pedidos_logistica SET ruta_id=NULL, estado=\'pendiente\', secuencia_en_ruta=NULL WHERE ruta_id=ANY($1)', [ids]);
    await pool.query('DELETE FROM logistics.paradas_ruta WHERE ruta_id=ANY($1)', [ids]);
    const result = await pool.query('DELETE FROM logistics.rutas WHERE id=ANY($1) RETURNING id', [ids]);
    res.json({ exitosa: true, eliminados: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mapa/datos', async (req, res) => {
  try {
    const { fecha } = req.query;
    const fechaHoy = fecha || new Date().toISOString().split('T')[0];

    const rutas = await pool.query(`
      SELECT r.id, r.nombre, r.fecha, r.vehiculo_id, r.estado,
             r.distancia_total_estimada, r.tiempo_estimado, r.cantidad_paradas,
             r.geometria,
             v.placa, v.alias as vehiculo_alias, v.color as color_vehiculo,
             v.ultima_posicion_lat, v.ultima_posicion_lng
      FROM logistics.rutas r
      JOIN logistics.vehiculos v ON r.vehiculo_id=v.id
      WHERE r.fecha=$1 ORDER BY r.id`, [fechaHoy]);

    let paradas = [];
    if (rutas.rows.length > 0) {
      const r = await pool.query(`
        SELECT pr.ruta_id, pr.secuencia, pr.estado as parada_estado,
               p.id as pedido_id, p.latitud, p.longitud, p.cliente_nombre,
               p.numero_factura, p.direccion
        FROM logistics.paradas_ruta pr
        JOIN logistics.pedidos_logistica p ON pr.pedido_id=p.id
        WHERE pr.ruta_id = ANY($1) ORDER BY pr.ruta_id, pr.secuencia`,
        [rutas.rows.map(r => r.id)]);
      paradas = r.rows;
    }

    const vehiculos = await pool.query(`
      SELECT id, placa, alias, ultima_posicion_lat, ultima_posicion_lng, estado
      FROM logistics.vehiculos WHERE ultima_posicion_lat IS NOT NULL AND ultima_posicion_lng IS NOT NULL`);

    const sedes = await pool.query(`
      SELECT id, nombre, centro_operacion, ciudad, direccion, latitud, longitud
      FROM logistics.sedes WHERE activo=true AND latitud IS NOT NULL AND longitud IS NOT NULL`);

    res.json({
      exitosa: true,
      rutas: rutas.rows,
      paradas,
      vehiculos: vehiculos.rows,
      sedes: sedes.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
