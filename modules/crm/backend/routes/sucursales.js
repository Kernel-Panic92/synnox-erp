import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

// GET /api/clientes/:clienteId/sucursales — Listar sucursales de un cliente
router.get('/:clienteId/sucursales', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { clienteId } = req.params;
    const result = await pool.query(
      `SELECT * FROM crm.sucursales WHERE cliente_id = $1 AND activa = TRUE ORDER BY es_principal DESC, nombre`,
      [clienteId]
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar sucursales:', err);
    res.status(500).json({ error: 'Error al listar sucursales' });
  }
});

// GET /api/sucursales/:id — Detalle
router.get('/:id', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM crm.sucursales WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Sucursal no encontrada' });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error obtener sucursal:', err);
    res.status(500).json({ error: 'Error al obtener sucursal' });
  }
});

// POST /api/clientes/:clienteId/sucursales — Crear sucursal
router.post('/:clienteId/sucursales', requirePermiso('editar_contacto', 'crm'), async (req, res) => {
  try {
    const { clienteId } = req.params;
    const { codigo, nombre, direccion, ciudad, departamento, telefono, email, contacto_nombre, es_principal, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    // Si es principal, desmarcar las demás
    if (es_principal) {
      await pool.query(`UPDATE crm.sucursales SET es_principal = FALSE WHERE cliente_id = $1`, [clienteId]);
    }

    const result = await pool.query(`
      INSERT INTO crm.sucursales (cliente_id, codigo, nombre, direccion, ciudad, departamento, telefono, email, contacto_nombre, es_principal, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [clienteId, codigo || null, nombre, direccion || null, ciudad || null, departamento || null,
        telefono || null, email || null, contacto_nombre || null, es_principal || false, notas || null]);

    await auditarEvento({ accion: 'crear', entidad: 'sucursal', entidad_id: result.rows[0].id, usuario_id: req.user.id, metadata: { cliente_id: clienteId, nombre } });

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear sucursal:', err);
    res.status(500).json({ error: 'Error al crear sucursal' });
  }
});

// PUT /api/sucursales/:id — Editar sucursal
router.put('/:id', requirePermiso('editar_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['codigo', 'nombre', 'direccion', 'ciudad', 'departamento', 'telefono', 'email', 'contacto_nombre', 'es_principal', 'notas'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx++}`);
        params.push(req.body[field]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });

    // Si se marca como principal, desmarcar las demás
    if (req.body.es_principal) {
      const suc = await pool.query(`SELECT cliente_id FROM crm.sucursales WHERE id = $1`, [id]);
      if (suc.rows.length) {
        await pool.query(`UPDATE crm.sucursales SET es_principal = FALSE WHERE cliente_id = $1 AND id != $2`, [suc.rows[0].cliente_id, id]);
      }
    }

    updates.push(`actualizado_en = NOW()`);
    params.push(id);

    const result = await pool.query(`UPDATE crm.sucursales SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Sucursal no encontrada' });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar sucursal:', err);
    res.status(500).json({ error: 'Error al editar sucursal' });
  }
});

// DELETE /api/sucursales/:id — Eliminar sucursal
router.delete('/:id', requirePermiso('editar_contacto', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`UPDATE crm.sucursales SET activa = FALSE WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Sucursal no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar sucursal:', err);
    res.status(500).json({ error: 'Error al eliminar sucursal' });
  }
});

export default router;
