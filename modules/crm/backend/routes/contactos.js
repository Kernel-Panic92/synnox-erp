import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

function buildContactosWhere(req) {
  const { cliente_id, search } = req.query;
  const conditions = ['c.activo = TRUE'];
  const params = [];
  let paramIdx = 1;

  if (cliente_id) {
    conditions.push(`c.cliente_id = $${paramIdx++}`);
    params.push(cliente_id);
  }
  if (search) {
    conditions.push(`(c.nombre ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR c.cargo ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// GET /api/contactos — Listar contactos con filtros y paginacion
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = 'creado_en', order = 'desc' } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const { where, params } = buildContactosWhere(req);
    const allowedSort = ['nombre', 'email', 'cargo', 'creado_en'];
    const sortCol = allowedSort.includes(sort) ? sort : 'creado_en';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let paramIdx = params.length + 1;

    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.contactos c ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT c.*, e.nombre AS cliente_nombre
      FROM crm.contactos c
      LEFT JOIN crm.clientes e ON e.id = c.cliente_id
      ${where}
      ORDER BY c.${sortCol} ${sortOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar contactos:', err);
    res.status(500).json({ error: 'Error al listar contactos' });
  }
});

// GET /api/contactos/stats — Estadisticas (respetan filtros activos)
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { where, params } = buildContactosWhere(req);

    const [total, conEmail, conTelefono, decisionMakers] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.contactos c ${where}`, params),
      pool.query(`SELECT COUNT(*) FROM crm.contactos c ${where} AND c.email IS NOT NULL AND c.email <> ''`, params),
      pool.query(`SELECT COUNT(*) FROM crm.contactos c ${where} AND c.telefono IS NOT NULL AND c.telefono <> ''`, params),
      pool.query(`SELECT COUNT(*) FROM crm.contactos c ${where} AND c.es_decision_maker = TRUE`, params)
    ]);

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      con_email: parseInt(conEmail.rows[0].count),
      con_telefono: parseInt(conTelefono.rows[0].count),
      decision_makers: parseInt(decisionMakers.rows[0].count)
    });
  } catch (err) {
    console.error('[CRM] Error stats contactos:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/contactos/:id — Detalle de contacto
router.get('/:id', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT c.*, e.nombre AS cliente_nombre, e.nit AS cliente_nit, e.ciudad AS cliente_ciudad
      FROM crm.contactos c
      LEFT JOIN crm.clientes e ON e.id = c.cliente_id
      WHERE c.id = $1
    `, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Contacto no encontrado' });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error obtener contacto:', err);
    res.status(500).json({ error: 'Error al obtener contacto' });
  }
});

// POST /api/contactos — Crear contacto
router.post('/', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { cliente_id, nombre, cargo, email, telefono, whatsapp, es_decision_maker, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!cliente_id) return res.status(400).json({ error: 'El cliente es obligatorio' });

    // Verificar que el cliente existe
    const cliente = await pool.query(`SELECT id FROM crm.clientes WHERE id = $1 AND activo = TRUE`, [cliente_id]);
    if (!cliente.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const result = await pool.query(`
      INSERT INTO crm.contactos (cliente_id, nombre, cargo, email, telefono, whatsapp, es_decision_maker, notas)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [cliente_id, nombre, cargo || null, email || null, telefono || null, whatsapp || null, es_decision_maker || false, notas || null]);

    await auditarEvento({ accion: 'crear', entidad: 'contacto', entidad_id: result.rows[0].id, usuario_id: req.user.id, metadata: { nombre, cliente_id } });

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear contacto:', err);
    res.status(500).json({ error: 'Error al crear contacto' });
  }
});

// PUT /api/contactos/:id — Editar contacto
router.put('/:id', requirePermiso('editar_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT id FROM crm.contactos WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Contacto no encontrado' });

    const fields = ['cliente_id', 'nombre', 'cargo', 'email', 'telefono', 'whatsapp', 'es_decision_maker', 'notas', 'activo'];
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

    params.push(id);

    const result = await pool.query(`UPDATE crm.contactos SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    await auditarEvento({ accion: 'editar', entidad: 'contacto', entidad_id: id, usuario_id: req.user.id, metadata: { campos: Object.keys(req.body) } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar contacto:', err);
    res.status(500).json({ error: 'Error al editar contacto' });
  }
});

// DELETE /api/contactos/seleccionados — Bulk delete (BEFORE /:id)
router.delete('/seleccionados', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'Sin IDs' });

    const result = await pool.query(`UPDATE crm.contactos SET activo = FALSE WHERE id = ANY($1) RETURNING id`, [ids]);

    await auditarEvento({ accion: 'eliminar', entidad: 'contacto', usuario_id: req.user.id, metadata: { count: result.rowCount } });

    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error bulk eliminar contactos:', err);
    res.status(500).json({ error: 'Error al eliminar contactos' });
  }
});

// DELETE /api/contactos/:id — Soft delete (AFTER /seleccionados)
router.delete('/:id', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`UPDATE crm.contactos SET activo = FALSE WHERE id = $1 RETURNING id, nombre`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Contacto no encontrado' });

    await auditarEvento({ accion: 'eliminar', entidad: 'contacto', entidad_id: id, usuario_id: req.user.id, metadata: { nombre: result.rows[0].nombre } });

    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar contacto:', err);
    res.status(500).json({ error: 'Error al eliminar contacto' });
  }
});

export default router;
