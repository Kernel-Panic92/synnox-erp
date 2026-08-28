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
export async function requireVentasPerfil(permiso) {
  return async (req, res, next) => {
    try {
      // Admin/gerente del launcher (rol) pasa directo si es admin
      if (req.user?.rol === 'admin') return next();
      const r = await pool.query(
        `SELECT 1 FROM crm.usuario_perfil_venta up
         JOIN crm.perfil_venta_permisos pvp ON pvp.perfil_id = up.perfil_venta_id
         WHERE up.usuario_id = $1 AND pvp.permiso = $2 LIMIT 1`,
        [req.user.id, permiso]
      );
      if (r.rows.length) return next();
      return res.status(403).json({ error: `Sin perfil de ventas: requiere ${permiso}` });
    } catch (e) {
      return res.status(500).json({ error: 'Error verificando perfil de ventas' });
    }
  };
}

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
    const { nombre, descripcion, permisos } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await pool.query(`INSERT INTO crm.perfiles_venta (nombre, descripcion) VALUES ($1,$2) RETURNING *`, [nombre, descripcion||'']);
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
    const { nombre, descripcion, permisos } = req.body;
    if (nombre) await pool.query(`UPDATE crm.perfiles_venta SET nombre=$1, descripcion=$2 WHERE id=$3`, [nombre, descripcion||'', req.params.id]);
    else if (descripcion!==undefined) await pool.query(`UPDATE crm.perfiles_venta SET descripcion=$1 WHERE id=$2`, [descripcion, req.params.id]);
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

// GET /api/perfiles-venta/:id/usuarios — listar usuarios asignados + disponibles
router.get('/:id/usuarios', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const asignados = await pool.query(`SELECT usuario_id FROM crm.usuario_perfil_venta WHERE perfil_venta_id=$1`, [req.params.id]);
    const ids = asignados.rows.map(r=>r.usuario_id);
    const ldb = getLauncherDb();
    const todos = ldb.prepare(`SELECT id,nombre,email,rol,perfil_id FROM usuarios WHERE activo=1 ORDER BY nombre`).all();
    ldb.close();
    res.json({ ok: true, asignados: ids, usuarios: todos });
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
  } catch (err){ await pool.query('ROLLBACK').catch(()=>{}); res.status(500).json({error:err.message}); }
  finally { client.release(); }
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

export default router;
