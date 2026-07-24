import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
const MODULE = 'logistica';
const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

const router = express.Router();

// Cache de centros del launcher (30s TTL)
let _centrosCache = null;
let _centrosCacheTs = 0;
async function getCentrosLauncher() {
  const now = Date.now();
  if (_centrosCache && (now - _centrosCacheTs) < 30000) return _centrosCache;
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/centros`);
    if (!res.ok) return _centrosCache || [];
    _centrosCache = await res.json();
    _centrosCacheTs = now;
    return _centrosCache;
  } catch { return _centrosCache || []; }
}

async function validarCentroOperacion(nombre) {
  if (!nombre || !nombre.trim()) return true;
  const centros = await getCentrosLauncher();
  return centros.some(c => c.nombre === nombre.trim());
}

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = 'SELECT * FROM logistics.sedes WHERE 1=1';
    const params = [];
    let idx = 1;
    if (q) {
      params.push('%' + q + '%');
      sql += ` AND (nombre ILIKE $${idx} OR ciudad ILIKE $${idx} OR direccion ILIKE $${idx})`;
      idx++;
    }
    sql += ' ORDER BY nombre';
    const result = await pool.query(sql, params);
    res.json({ exitosa: true, total: result.rows.length, sedes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/centros', async (req, res) => {
  try {
    const centros = await getCentrosLauncher();
    res.json(Array.isArray(centros) ? centros : []);
  } catch (err) {
    res.json([]);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logistics.sedes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ exitosa: true, sede: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermiso('crear', MODULE), async (req, res) => {
  try {
    const { nombre, direccion, ciudad, latitud, longitud, telefono, centro_operacion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    if (centro_operacion && !await validarCentroOperacion(centro_operacion)) {
      return res.status(400).json({ error: `El centro de operación "${centro_operacion}" no existe en el Launcher` });
    }
    const result = await pool.query(
      `INSERT INTO logistics.sedes (nombre, direccion, ciudad, latitud, longitud, telefono, centro_operacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nombre, direccion || null, ciudad || null, latitud || null, longitud || null, telefono || null, centro_operacion || null]
    );
    res.status(201).json({ exitosa: true, sede: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermiso('editar', MODULE), async (req, res) => {
  try {
    const { nombre, direccion, ciudad, latitud, longitud, telefono, activo, centro_operacion } = req.body;
    if (centro_operacion && !await validarCentroOperacion(centro_operacion)) {
      return res.status(400).json({ error: `El centro de operación "${centro_operacion}" no existe en el Launcher` });
    }
    const result = await pool.query(
      `UPDATE logistics.sedes SET nombre=COALESCE($1,nombre), direccion=$2, ciudad=$3,
       latitud=$4, longitud=$5, telefono=$6, activo=COALESCE($7,activo),
       centro_operacion=$8, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *`,
      [nombre || null, direccion !== undefined ? direccion : undefined,
       ciudad !== undefined ? ciudad : undefined,
       latitud !== undefined ? latitud : undefined,
       longitud !== undefined ? longitud : undefined,
       telefono !== undefined ? telefono : undefined,
       activo !== undefined ? activo : undefined,
       centro_operacion !== undefined ? centro_operacion : undefined,
       req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ exitosa: true, sede: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermiso('eliminar', MODULE), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logistics.sedes WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    res.json({ exitosa: true, mensaje: 'Sede eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
