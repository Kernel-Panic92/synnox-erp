import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function getLauncherDb() {
  return new Database(path.join(__dirname, '..', '..', '..', '..', 'launcher', 'launcher.db'));
}

// Helper: verifica si req.user tiene al menos uno de los perms en crm.perfiles_venta
// Si no tiene perfil_venta asignado => bloquea creación de cotizaciones (lectura sí pasa)
export function requireVentasPerfil(permiso) {
  return (req, res, next) => {
    if (['admin','gerente'].includes(req.user?.rol)) return next();
    pool.query(
      `SELECT 1 FROM crm.usuario_perfil_venta up
       JOIN crm.perfil_venta_permisos pvp ON pvp.perfil_id = up.perfil_venta_id
       WHERE up.usuario_id = $1 AND pvp.permiso = $2 LIMIT 1`,
      [req.user.id, permiso]
    ).then(r => {
      if (r.rows.length) return next();
      return res.status(403).json({ error: `Sin perfil de ventas: requiere ${permiso}` });
    }).catch(() => res.status(500).json({ error: 'Error verificando perfil de ventas' }));
  };
}

// GET /api/perfiles-venta/me/config — config del perfil asignado (lista por defecto, etc.)
router.get('/me/config', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({error:'No autenticado'});
    const r = await pool.query(`
      SELECT pv.config FROM crm.perfiles_venta pv
      JOIN crm.usuario_perfil_venta up ON up.perfil_venta_id = pv.id
      WHERE up.usuario_id = $1
      ORDER BY pv.id LIMIT 1
    `, [req.user.id]);
    // admin sin perfil asignado -> usa primer perfil gerencia como fallback
    let cfg = r.rows[0]?.config || null;
    if (!cfg && req.user?.rol === 'admin') {
      const fb = await pool.query(`SELECT config FROM crm.perfiles_venta WHERE nombre ILIKE '%gerencia%' LIMIT 1`);
      cfg = fb.rows[0]?.config || {};
    }
    res.json({ ok:true, config: cfg || {} });
  } catch (err){ res.status(500).json({error:err.message}); }
});

// GET /api/perfiles-venta/me — mis perfiles y permisos efectivos (para frontend)
router.get('/me/mis-permisos', async (req, res) => {
  try {
    // Este endpoint no requiere configurar, solo auth
    if (!req.user) return res.status(401).json({error:'No autenticado'});
    const r = await pool.query(`
      SELECT DISTINCT pvp.permiso
      FROM crm.usuario_perfil_venta up
      JOIN crm.perfil_venta_permisos pvp ON pvp.perfil_id = up.perfil_venta_id
      WHERE up.usuario_id=$1
    `, [req.user.id]);
    res.json({ ok:true, permisos: r.rows.map(x=>x.permiso) });
  } catch (err){ res.status(500).json({error:err.message}); }
});

// GET /api/perfiles-venta/usuarios-all — todos los usuarios activos (para aprobadores, sin necesidad de perfil)
router.get('/usuarios-all', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const ldb = getLauncherDb();
    const usuarios = ldb.prepare(`SELECT id,nombre,email,rol FROM usuarios WHERE activo=1 ORDER BY nombre`).all();
    ldb.close();
    res.json({ ok: true, data: usuarios });
  } catch (err){ res.status(500).json({error:err.message}); }
});

// GET /api/perfiles-venta — listar perfiles con conteo usuarios
router.get('/', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const perfiles = await pool.query(`
      SELECT pv.*, COALESCE(u.cnt,0)::int as usuarios_count
      FROM crm.perfiles_venta pv
      LEFT JOIN (SELECT perfil_venta_id, COUNT(*) as cnt FROM crm.usuario_perfil_venta GROUP BY perfil_venta_id) u ON u.perfil_venta_id = pv.id
      ORDER BY pv.nombre
    `);
    // Adjuntar perms
    for (const p of perfiles.rows) {
      const perms = await pool.query(`SELECT permiso FROM crm.perfil_venta_permisos WHERE perfil_id = $1 ORDER BY permiso`, [p.id]);
      p.permisos = perms.rows.map(r => r.permiso);
    }
    res.json({ ok: true, data: perfiles.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/perfiles-venta — crear
router.post('/', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const { nombre, descripcion, permisos, config } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const cfg = config && typeof config === 'object' ? config : {};
    const r = await pool.query(`INSERT INTO crm.perfiles_venta (nombre, descripcion, config) VALUES ($1,$2,$3) RETURNING *`, [nombre, descripcion||'', JSON.stringify(cfg)]);
    if (Array.isArray(permisos)) {
      const ins = `INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso) VALUES ($1,$2) ON CONFLICT DO NOTHING`;
      for (const perm of permisos) await pool.query(ins, [r.rows[0].id, perm]);
    }
    res.status(201).json({ ok: true, data: r.rows[0] });
  } catch (err) { if (err.code==='23505') return res.status(409).json({error:'Nombre ya existe'}); res.status(500).json({error:err.message}); }
});

// PUT /api/perfiles-venta/:id — editar
router.put('/:id', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const { nombre, descripcion, permisos, config } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;
    if (nombre !== undefined) { updates.push(`nombre=$${idx++}`); params.push(nombre); }
    if (descripcion !== undefined) { updates.push(`descripcion=$${idx++}`); params.push(descripcion); }
    if (config !== undefined) { updates.push(`config=$${idx++}`); params.push(JSON.stringify(config)); }
    if (updates.length) {
      params.push(req.params.id);
      await pool.query(`UPDATE crm.perfiles_venta SET ${updates.join(', ')} WHERE id=$${idx}`, params);
    }
    if (Array.isArray(permisos)) {
      await pool.query(`DELETE FROM crm.perfil_venta_permisos WHERE perfil_id=$1`, [req.params.id]);
      for (const perm of permisos) await pool.query(`INSERT INTO crm.perfil_venta_permisos (perfil_id, permiso) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, perm]);
    }
    const r = await pool.query(`SELECT * FROM crm.perfiles_venta WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/perfiles-venta/:id
router.delete('/:id', requirePermiso('configurar', 'crm'), async (req, res) => {
  try { await pool.query(`DELETE FROM crm.perfiles_venta WHERE id=$1`, [req.params.id]); res.json({ok:true}); }
  catch (err){ res.status(500).json({error:err.message}); }
});

// GET /api/perfiles-venta/:id/usuarios — listar usuarios asignados + disponibles (+ perfiles launcher para filtro)
router.get('/:id/usuarios', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const asignados = await pool.query(`SELECT usuario_id FROM crm.usuario_perfil_venta WHERE perfil_venta_id=$1`, [req.params.id]);
    const ids = asignados.rows.map(r=>r.usuario_id);
    const ldb = getLauncherDb();
    const todos = ldb.prepare(`SELECT u.id,u.nombre,u.email,u.rol,u.perfil_id,p.nombre as perfil_nombre FROM usuarios u LEFT JOIN perfiles p ON p.id=u.perfil_id WHERE u.activo=1 ORDER BY u.nombre`).all();
    const perfiles = ldb.prepare(`SELECT id,nombre FROM perfiles ORDER BY id`).all();
    ldb.close();
    res.json({ ok: true, asignados: ids, usuarios: todos, perfiles });
  } catch (err){ res.status(500).json({error:err.message}); }
});

// PUT /api/perfiles-venta/:id/usuarios — reemplazar asignaciones (transacción)
router.put('/:id/usuarios', requirePermiso('configurar', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    const perfilId = parseInt(req.params.id);
    const { usuario_ids } = req.body;
    if (!Array.isArray(usuario_ids)) return res.status(400).json({error:'usuario_ids debe ser array'});
    await client.query('BEGIN');
    await client.query(`DELETE FROM crm.usuario_perfil_venta WHERE perfil_venta_id=$1`, [perfilId]);
    const ins = `INSERT INTO crm.usuario_perfil_venta (usuario_id, perfil_venta_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`;
    for (const uid of usuario_ids) await client.query(ins, [parseInt(uid), perfilId]);
    await client.query('COMMIT');
    res.json({ ok:true, count: usuario_ids.length });
  } catch (err){ await client.query('ROLLBACK').catch(()=>{}); res.status(500).json({error:err.message}); }
  finally { client.release(); }
});

export default router;
