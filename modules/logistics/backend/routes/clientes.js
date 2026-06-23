import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `
      SELECT c.*, (SELECT COUNT(*) FROM logistics.pedidos_logistica p WHERE p.cliente_id=c.id) as cantidad_pedidos
      FROM logistics.clientes c`;
    const params = [];
    if (q) {
      sql += ` WHERE LOWER(c.nombre) LIKE $1 OR LOWER(c.direccion) LIKE $1 OR LOWER(c.ciudad) LIKE $1`;
      params.push('%' + q.toLowerCase() + '%');
    }
    sql += ' ORDER BY c.ultima_importacion DESC NULLS LAST, c.nombre LIMIT 100';
    const result = await pool.query(sql, params);
    res.json({ clientes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM logistics.pedidos_logistica p WHERE p.cliente_id=c.id) as cantidad_pedidos
       FROM logistics.clientes c WHERE c.id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ cliente: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, direccion, ciudad, telefono, latitud, longitud, ruta, ruta_moto, codigo_siesa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const result = await pool.query(
      `INSERT INTO logistics.clientes (nombre, direccion, ciudad, telefono, latitud, longitud, ruta, ruta_moto, codigo_siesa, geocodificado, ultima_importacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
       ON CONFLICT (nombre) DO UPDATE SET direccion=EXCLUDED.direccion, ciudad=EXCLUDED.ciudad,
        telefono=EXCLUDED.telefono, latitud=EXCLUDED.latitud, longitud=EXCLUDED.longitud,
        ruta=EXCLUDED.ruta, ruta_moto=EXCLUDED.ruta_moto, codigo_siesa=EXCLUDED.codigo_siesa,
        geocodificado=EXCLUDED.geocodificado, ultima_importacion=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [nombre, direccion || '', ciudad || '', telefono || '', latitud, longitud, ruta || null, ruta_moto || null, codigo_siesa || null, latitud !== null && latitud !== undefined]
    );
    res.status(201).json({ cliente: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/asignar-ruta-masivo', async (req, res) => {
  try {
    const { ids, ruta, ruta_moto } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids requerido' });
    if (!ruta && !ruta_moto) return res.status(400).json({ error: 'Debe proporcionar ruta o ruta_moto' });

    const sets = [];
    const params = [];
    let idx = 1;
    params.push(ids);
    idx++;
    if (ruta !== undefined && ruta !== null) { sets.push(`ruta=$${idx++}`); params.push(ruta || null); }
    if (ruta_moto !== undefined && ruta_moto !== null) { sets.push(`ruta_moto=$${idx++}`); params.push(ruta_moto || null); }
    sets.push('updated_at=CURRENT_TIMESTAMP');

    const result = await pool.query(
      `UPDATE logistics.clientes SET ${sets.join(', ')} WHERE id = ANY($1::int[]) RETURNING id`,
      params
    );

    res.json({
      exitosa: true,
      actualizados: result.rows.length,
      total: ids.length,
      mensaje: `${result.rows.length} cliente(s) actualizado(s)`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nombre, direccion, ciudad, telefono, latitud, longitud, ruta, ruta_moto, codigo_siesa } = req.body;
    const result = await pool.query(
      `UPDATE logistics.clientes SET
        nombre=COALESCE($1,nombre), direccion=COALESCE($2,direccion),
        ciudad=COALESCE($3,ciudad), telefono=COALESCE($4,telefono),
        latitud=COALESCE($5,latitud), longitud=COALESCE($6,longitud),
        ruta=COALESCE($7,ruta), ruta_moto=COALESCE($8,ruta_moto),
        codigo_siesa=COALESCE($9,codigo_siesa),
        geocodificado=CASE WHEN $5 IS NOT NULL AND $6 IS NOT NULL THEN TRUE ELSE geocodificado END,
        updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 RETURNING *`,
      [nombre, direccion, ciudad, telefono, latitud, longitud, ruta, ruta_moto, codigo_siesa, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ cliente: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/seleccionados', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids requerido' });
    const result = await pool.query('DELETE FROM logistics.clientes WHERE id = ANY($1::int[]) RETURNING id', [ids]);
    res.json({ eliminados: result.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logistics.clientes WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ mensaje: 'Cliente eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
