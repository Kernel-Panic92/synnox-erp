import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { requireVentasPerfil } from './perfilesVenta.js';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

// GET /api/presupuestos?periodo=YYYY-MM — listar (asesor ve solo lo suyo salvo gerencia)
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { periodo, usuario_id } = req.query;
    const conds = [];
    const params = [];
    let pi = 1;
    if (periodo) { conds.push(`p.periodo = $${pi++}`); params.push(periodo); }
    if (req.user?.rol === 'admin' || req.user?.rol === 'gerente') {
      if (usuario_id) { conds.push(`p.usuario_id = $${pi++}`); params.push(parseInt(usuario_id)); }
    } else {
      conds.push(`p.usuario_id = $${pi++}`); params.push(req.user.id);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(`SELECT p.* FROM crm.presupuestos p ${where} ORDER BY p.periodo DESC, p.usuario_id`, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) {
    console.error('[CRM] Error listar presupuestos:', err);
    res.status(500).json({ error: 'Error al listar presupuestos' });
  }
});

// POST /api/presupuestos — asignar presupuesto (dirección comercial)
router.post('/', requirePermiso('configurar', 'crm'), requireVentasPerfil('configurar'), async (req, res) => {
  try {
    const { usuario_id, periodo, presupuesto, centro } = req.body;
    if (!usuario_id || !periodo || presupuesto == null) return res.status(400).json({ error: 'usuario_id, periodo (YYYY-MM) y presupuesto son obligatorios' });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return res.status(400).json({ error: 'periodo debe ser YYYY-MM' });
    if (parseFloat(presupuesto) < 0) return res.status(400).json({ error: 'presupuesto no puede ser negativo' });
    const r = await pool.query(`
      INSERT INTO crm.presupuestos (usuario_id, periodo, presupuesto, centro, creado_por)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (usuario_id, periodo) DO UPDATE SET presupuesto = EXCLUDED.presupuesto, centro = EXCLUDED.centro, actualizado_en = NOW()
      RETURNING *`,
      [parseInt(usuario_id), periodo, presupuesto, centro || null, req.user.id]);
    await auditarEvento({ accion: 'asignar', entidad: 'presupuesto', entidad_id: r.rows[0].id, usuario_id: req.user.id, metadata: { usuario_id, periodo, presupuesto } });
    res.status(201).json({ ok: true, data: r.rows[0] });
  } catch (err) {
    console.error('[CRM] Error asignar presupuesto:', err);
    res.status(500).json({ error: 'Error al asignar presupuesto' });
  }
});

// PUT /api/presupuestos/:id — editar (dirección comercial)
router.put('/:id', requirePermiso('configurar', 'crm'), requireVentasPerfil('configurar'), async (req, res) => {
  try {
    const { presupuesto, centro } = req.body;
    if (presupuesto != null && parseFloat(presupuesto) < 0) return res.status(400).json({ error: 'presupuesto no puede ser negativo' });
    const sets = [];
    const params = [];
    let pi = 1;
    if (presupuesto !== undefined) { sets.push(`presupuesto = $${pi++}`); params.push(presupuesto); }
    if (centro !== undefined) { sets.push(`centro = $${pi++}`); params.push(centro || null); }
    if (!sets.length) return res.status(400).json({ error: 'Sin cambios' });
    sets.push(`actualizado_en = NOW()`);
    params.push(req.params.id);
    const r = await pool.query(`UPDATE crm.presupuestos SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    await auditarEvento({ accion: 'editar', entidad: 'presupuesto', entidad_id: req.params.id, usuario_id: req.user.id, metadata: { presupuesto, centro } });
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar presupuesto:', err);
    res.status(500).json({ error: 'Error al editar presupuesto' });
  }
});

// DELETE /api/presupuestos/:id — eliminar (dirección comercial)
router.delete('/:id', requirePermiso('configurar', 'crm'), requireVentasPerfil('configurar'), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM crm.presupuestos WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    await auditarEvento({ accion: 'eliminar', entidad: 'presupuesto', entidad_id: req.params.id, usuario_id: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar presupuesto:', err);
    res.status(500).json({ error: 'Error al eliminar presupuesto' });
  }
});

export default router;
