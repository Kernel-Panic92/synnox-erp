import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

// GET /api/leads — Listar leads
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { estado, asesor, search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (estado) { conditions.push(`l.estado = $${paramIdx++}`); params.push(estado); }
    if (asesor) { conditions.push(`l.asesor_comercial ILIKE $${paramIdx++}`); params.push(`%${asesor}%`); }
    if (search) {
      conditions.push(`(l.raison_social ILIKE $${paramIdx} OR l.numero_identificacion ILIKE $${paramIdx} OR l.email ILIKE $${paramIdx})`);
      params.push(`%${search}%`); paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.leads l ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT l.*, cl.nombre AS cliente_nombre
      FROM crm.leads l
      LEFT JOIN crm.clientes cl ON cl.id = l.cliente_id
      ${where}
      ORDER BY l.creado_en DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar leads:', err);
    res.status(500).json({ error: 'Error al listar leads' });
  }
});

// GET /api/leads/stats
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const [total, porEstado, convertidos] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.leads`),
      pool.query(`SELECT estado, COUNT(*) AS total FROM crm.leads GROUP BY estado`),
      pool.query(`SELECT COUNT(*) FROM crm.leads WHERE cliente_convertido = TRUE`)
    ]);
    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      por_estado: porEstado.rows,
      convertidos: parseInt(convertidos.rows[0].count)
    });
  } catch (err) {
    console.error('[CRM] Error stats leads:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/leads/:id
router.get('/:id', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM crm.leads WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error obtener lead:', err);
    res.status(500).json({ error: 'Error al obtener lead' });
  }
});

// POST /api/leads — Crear lead
router.post('/', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { raison_social, numero_identificacion, tipo_identificacion, nombre_establecimiento,
      direccion, ciudad, departamento, email, telefono, canal, segmento, tipo_negocio,
      lista_precios, condicion_pago, asesor_comercial, notas } = req.body;
    if (!raison_social) return res.status(400).json({ error: 'La razon social es obligatoria' });

    const result = await pool.query(`
      INSERT INTO crm.leads (raison_social, numero_identificacion, tipo_identificacion, nombre_establecimiento,
        direccion, ciudad, departamento, email, telefono, canal, segmento, tipo_negocio,
        lista_precios, condicion_pago, asesor_comercial, notas, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'nuevo')
      RETURNING *
    `, [raison_social, numero_identificacion || null, tipo_identificacion || 'NIT', nombre_establecimiento || null,
        direccion || null, ciudad || null, departamento || null, email || null, telefono || null,
        canal || null, segmento || null, tipo_negocio || null, lista_precios || null,
        condicion_pago || null, asesor_comercial || null, notas || null]);

    await auditarEvento({ accion: 'crear', entidad: 'lead', entidad_id: result.rows[0].id, usuario_id: req.user.id, metadata: { raison_social } });
    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear lead:', err);
    res.status(500).json({ error: 'Error al crear lead' });
  }
});

// PUT /api/leads/:id
router.put('/:id', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['raison_social', 'numero_identificacion', 'tipo_identificacion', 'nombre_establecimiento',
      'direccion', 'ciudad', 'departamento', 'email', 'telefono', 'canal', 'segmento', 'tipo_negocio',
      'lista_precios', 'condicion_pago', 'asesor_comercial', 'notas', 'estado'];
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

    updates.push(`actualizado_en = NOW()`);
    params.push(id);
    const result = await pool.query(`UPDATE crm.leads SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });

    await auditarEvento({ accion: 'editar', entidad: 'lead', entidad_id: id, usuario_id: req.user.id, metadata: { campos: Object.keys(req.body) } });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar lead:', err);
    res.status(500).json({ error: 'Error al editar lead' });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM crm.leads WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
    await auditarEvento({ accion: 'eliminar', entidad: 'lead', entidad_id: req.params.id, usuario_id: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar lead:', err);
    res.status(500).json({ error: 'Error al eliminar lead' });
  }
});

// POST /api/leads/:id/convertir — Convertir lead a cliente
router.post('/:id/convertir', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const lead = await client.query(`SELECT * FROM crm.leads WHERE id = $1`, [id]);
    if (!lead.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
    if (lead.rows[0].cliente_convertido) return res.status(400).json({ error: 'Este lead ya fue convertido' });

    const l = lead.rows[0];

    // Crear cliente
    const cliente = await client.query(`
      INSERT INTO crm.clientes (codigo_siesa, nit, nombre, canal, activo, direccion, ciudad, departamento,
        email, telefono, tipo, tipo_negocio, notas, asesor_comercial)
      VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,'real',$10,$11,$12) RETURNING id
    `, [l.numero_identificacion, l.numero_identificacion, l.raison_social, l.canal || '',
        l.direccion, l.ciudad, l.departamento, l.email, l.telefono, l.tipo_negocio, l.notas, l.asesor_comercial]);

    // Actualizar lead
    await client.query(`
      UPDATE crm.leads SET estado = 'convertido', cliente_convertido = TRUE,
        cliente_id = $1, fecha_conversion = NOW(), actualizado_en = NOW()
      WHERE id = $2
    `, [cliente.rows[0].id, id]);

    await auditarEvento({ accion: 'convertir', entidad: 'lead', entidad_id: id, usuario_id: req.user.id,
      metadata: { cliente_id: cliente.rows[0].id, raison_social: l.raison_social } });

    await client.query('COMMIT');
    res.json({ ok: true, cliente_id: cliente.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error convertir lead:', err);
    res.status(500).json({ error: 'Error al convertir lead' });
  } finally {
    client.release();
  }
});

// PUT /api/leads/:id/enviar — Marcar como enviado a ERP
router.put('/:id/enviar', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE crm.leads SET estado = 'enviado_erp', actualizado_en = NOW() WHERE id = $1 RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });

    await auditarEvento({ accion: 'enviar_erp', entidad: 'lead', entidad_id: req.params.id, usuario_id: req.user.id });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error enviar lead:', err);
    res.status(500).json({ error: 'Error al enviar lead' });
  }
});

export default router;
