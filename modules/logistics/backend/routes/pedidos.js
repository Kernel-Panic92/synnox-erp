import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { fecha, estado, q } = req.query;
    let sql = 'SELECT p.*, c.nombre AS cliente_nombre_real, c.ruta AS cliente_ruta, c.ruta_moto AS cliente_ruta_moto FROM logistics.pedidos_logistica p LEFT JOIN logistics.clientes c ON c.id = p.cliente_id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (fecha) { params.push(fecha); sql += ` AND DATE(p.created_at)=$${idx++}`; }
    if (estado) { params.push(estado); sql += ` AND p.estado=$${idx++}`; }
    if (q) {
      params.push('%' + q + '%');
      sql += ` AND (p.numero_factura ILIKE $${idx}
               OR p.cliente_nombre ILIKE $${idx}
               OR c.nombre ILIKE $${idx}
               OR p.direccion ILIKE $${idx}
               OR p.ciudad ILIKE $${idx}
               OR p.placa ILIKE $${idx}
               OR p.conductor ILIKE $${idx})`;
      idx++;
    }
    sql += ' ORDER BY p.id';
    const result = await pool.query(sql, params);
    res.json({ exitosa: true, total: result.rows.length, pedidos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pendientes/lista', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.nombre AS cliente_nombre_real, c.ruta AS cliente_ruta, c.ruta_moto AS cliente_ruta_moto FROM logistics.pedidos_logistica p LEFT JOIN logistics.clientes c ON c.id = p.cliente_id WHERE p.estado='pendiente' AND p.ruta_id IS NULL ORDER BY p.id`
    );
    res.json({ exitosa: true, total: result.rows.length, pedidos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.nombre as cliente_nombre_tabla, c.direccion as cliente_direccion, c.ciudad as cliente_ciudad, c.telefono as cliente_telefono
       FROM logistics.pedidos_logistica p
       LEFT JOIN logistics.clientes c ON c.id = p.cliente_id
       WHERE p.id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ exitosa: true, pedido: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, valor_credito, estado, sede, latitud, longitud, vehiculo_id } = req.body;
    if (!numero_factura) return res.status(400).json({ error: 'numero_factura requerido' });
    if (!vehiculo_id) return res.status(400).json({ error: 'vehiculo_id requerido' });
    const result = await pool.query(
      `INSERT INTO logistics.pedidos_logistica (numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, valor_credito, estado, sede, latitud, longitud, vehiculo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, valor_credito, estado || 'pendiente', sede || null, latitud || null, longitud || null, vehiculo_id || null]
    );
    res.status(201).json({ exitosa: true, pedido: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/asignar-masivo', async (req, res) => {
  try {
    const { ids, vehiculo_id, sede } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids requerido' });
    if (!vehiculo_id && !sede) return res.status(400).json({ error: 'Debe proporcionar vehiculo_id o sede' });

    const sets = [];
    const params = [];
    let idx = 1;
    params.push(ids);
    idx++;
    if (vehiculo_id) { sets.push(`vehiculo_id=$${idx++}`); params.push(vehiculo_id); }
    if (sede) { sets.push(`sede=$${idx++}`); params.push(sede); }
    sets.push('updated_at=CURRENT_TIMESTAMP');

    const result = await pool.query(
      `UPDATE logistics.pedidos_logistica SET ${sets.join(', ')} WHERE id = ANY($1::int[]) AND ruta_id IS NULL RETURNING id`,
      params
    );

    const ignorados = ids.length - result.rows.length;
    res.json({
      exitosa: true,
      actualizados: result.rows.length,
      ignorados,
      mensaje: `${result.rows.length} pedido(s) actualizado(s)${ignorados ? `, ${ignorados} ignorado(s) por estar en una ruta` : ''}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, valor_credito, estado, ruta_id, secuencia_en_ruta, sede, latitud, longitud, vehiculo_id } = req.body;
    const result = await pool.query(
      `UPDATE logistics.pedidos_logistica SET
        numero_factura=COALESCE($1,numero_factura),
        cliente_id=COALESCE($2,cliente_id),
        cliente_nombre=COALESCE($3,cliente_nombre),
        direccion=COALESCE($4,direccion),
        ciudad=COALESCE($5,ciudad),
        telefono=COALESCE($6,telefono),
        valor_credito=COALESCE($7,valor_credito),
        estado=COALESCE($8,estado),
        ruta_id=COALESCE($9,ruta_id),
        secuencia_en_ruta=COALESCE($10,secuencia_en_ruta),
        sede=COALESCE($11,sede),
        latitud=COALESCE($12,latitud),
        longitud=COALESCE($13,longitud),
        vehiculo_id=COALESCE($14,vehiculo_id),
        updated_at=CURRENT_TIMESTAMP
       WHERE id=$15 RETURNING *`,
      [numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, valor_credito, estado, ruta_id, secuencia_en_ruta, sede, latitud, longitud, vehiculo_id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ exitosa: true, pedido: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/seleccionados', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids requerido' });
    const blocking = await pool.query(`
      SELECT DISTINCT r.id, r.fecha
      FROM logistics.pedidos_logistica p
      JOIN logistics.rutas r ON r.id = p.ruta_id
      WHERE p.id = ANY($1::int[]) AND p.ruta_id IS NOT NULL
    `, [ids]);
    if (blocking.rows.length > 0) {
      const rutas = blocking.rows.map(r => `Ruta #${r.id} (${r.fecha})`).join(', ');
      return res.status(409).json({ error: `Pedidos asignados a: ${rutas}. Elimine la(s) ruta(s) primero.` });
    }
    const result = await pool.query('DELETE FROM logistics.pedidos_logistica WHERE id = ANY($1::int[]) RETURNING id', [ids]);
    res.json({ eliminados: result.rows.length });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Uno o más pedidos están asignados a una ruta. Elimine la(s) ruta(s) primero.' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const blocking = await pool.query(`
      SELECT r.id, r.fecha
      FROM logistics.pedidos_logistica p
      JOIN logistics.rutas r ON r.id = p.ruta_id
      WHERE p.id = $1 AND p.ruta_id IS NOT NULL
    `, [req.params.id]);
    if (blocking.rows.length > 0) {
      const r = blocking.rows[0];
      return res.status(409).json({ error: `Pedido asignado a Ruta #${r.id} (${r.fecha}). Elimine la ruta primero.` });
    }
    const result = await pool.query('DELETE FROM logistics.pedidos_logistica WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ exitosa: true, mensaje: 'Pedido eliminado' });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Este pedido está asignado a una ruta. Elimine la ruta primero.' });
    res.status(500).json({ error: err.message });
  }
});

export default router;
