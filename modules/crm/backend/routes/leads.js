import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

function buildLeadsWhere(req) {
  const { estado, asesor, search } = req.query;
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
  return { where, params };
}

// GET /api/leads — Listar leads
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const { where, params } = buildLeadsWhere(req);
    let paramIdx = params.length + 1;

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

// GET /api/leads/stats — Estadisticas (respetan filtros activos)
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { where, params } = buildLeadsWhere(req);
    const convertidosWhere = where ? `${where} AND l.cliente_convertido = TRUE` : 'WHERE l.cliente_convertido = TRUE';

    const [total, porEstado, convertidos] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.leads l ${where}`, params),
      pool.query(`SELECT l.estado, COUNT(*) AS total FROM crm.leads l ${where} GROUP BY l.estado`, params),
      pool.query(`SELECT COUNT(*) FROM crm.leads l ${convertidosWhere}`, params)
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

// POST /api/leads — Crear lead (Hub-ready con siesa_* y validación NIT)
router.post('/', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { raison_social, numero_identificacion, tipo_identificacion, nombre_establecimiento,
      direccion, ciudad, departamento, email, telefono, canal, segmento, tipo_negocio,
      lista_precios, condicion_pago, asesor_comercial, notas,
      siesa_tipo_identificacion, siesa_dv, siesa_tipo_persona, siesa_regimen, siesa_responsabilidad_fiscal, siesa_ciiu } = req.body;
    if (!raison_social) return res.status(400).json({ error: 'La razon social es obligatoria' });
    if (numero_identificacion) {
      const dup = await pool.query(`SELECT id FROM crm.clientes WHERE nit=$1 AND activo=TRUE LIMIT 1`, [String(numero_identificacion).trim()]);
      if (dup.rows.length) return res.status(409).json({ error: `NIT ${numero_identificacion} ya existe como cliente formal` });
      const dupLead = await pool.query(`SELECT id FROM crm.leads WHERE numero_identificacion=$1 LIMIT 1`, [String(numero_identificacion).trim()]);
      if (dupLead.rows.length) return res.status(409).json({ error: `NIT ${numero_identificacion} ya existe como lead` });
    }

    // Normalización: fuente única siesa_* (si viene tipo_identificacion legacy, úsalo como fallback)
    const tipoSiesa = siesa_tipo_identificacion || (tipo_identificacion === 'NIT' ? '31' : tipo_identificacion) || '31';
    const result = await pool.query(`
      INSERT INTO crm.leads (raison_social, numero_identificacion, tipo_identificacion, nombre_establecimiento,
        direccion, ciudad, departamento, email, telefono, canal, segmento, tipo_negocio,
        lista_precios, condicion_pago, asesor_comercial, notas, estado,
        siesa_tipo_identificacion, siesa_dv, siesa_tipo_persona, siesa_regimen, siesa_responsabilidad_fiscal, siesa_ciiu)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'nuevo',$17,$18,$19,$20,$21,$22)
      RETURNING *
    `, [raison_social, numero_identificacion || null, tipoSiesa, nombre_establecimiento || null,
        direccion || null, ciudad || null, departamento || null, email || null, telefono || null,
        canal || null, segmento || null, tipo_negocio || null, lista_precios || null,
        condicion_pago || null, asesor_comercial || null, notas || null,
        tipoSiesa, siesa_dv || null, siesa_tipo_persona || 1, siesa_regimen || '48', siesa_responsabilidad_fiscal || 'R-99-PN', siesa_ciiu || '4723']);

    await auditarEvento({ accion: 'crear', entidad: 'lead', entidad_id: result.rows[0].id, usuario_id: req.user.id, metadata: { raison_social } });
    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear lead:', err);
    res.status(500).json({ error: 'Error al crear lead' });
  }
});

// PUT /api/leads/:id — Hub-ready siesa_*
router.put('/:id', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    // Normalización fuente única siesa_*: si viene siesa, sincroniza legacy y viceversa
    if (req.body.siesa_tipo_identificacion !== undefined && req.body.tipo_identificacion === undefined) {
      req.body.tipo_identificacion = req.body.siesa_tipo_identificacion;
    } else if (req.body.tipo_identificacion !== undefined && req.body.siesa_tipo_identificacion === undefined) {
      const t = String(req.body.tipo_identificacion).toUpperCase();
      req.body.siesa_tipo_identificacion = t === 'NIT' ? '31' : t;
    }
    const fields = ['raison_social', 'numero_identificacion', 'tipo_identificacion', 'nombre_establecimiento',
      'direccion', 'ciudad', 'departamento', 'email', 'telefono', 'canal', 'segmento', 'tipo_negocio',
      'lista_precios', 'condicion_pago', 'asesor_comercial', 'notas', 'estado',
      'siesa_tipo_identificacion','siesa_dv','siesa_tipo_persona','siesa_regimen','siesa_responsabilidad_fiscal','siesa_ciiu'];
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

// POST /api/leads/reconciliar — Comparar leads con clientes existentes
router.post('/reconciliar', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    // Buscar leads no convertidos que tengan NIT coincidente con un cliente
    const result = await pool.query(`
      UPDATE crm.leads l
      SET estado = 'convertido', cliente_convertido = TRUE,
        cliente_id = c.id, fecha_conversion = l.actualizado_en, actualizado_en = NOW()
      FROM crm.clientes c
      WHERE l.numero_identificacion = c.nit
        AND l.estado != 'convertido'
        AND c.activo = TRUE
      RETURNING l.id, l.raison_social, l.numero_identificacion, c.id AS cliente_id
    `);

    res.json({ ok: true, convertidos: result.rowCount, leads: result.rows });
  } catch (err) {
    console.error('[CRM] Error reconciliar leads:', err);
    res.status(500).json({ error: 'Error al reconciliar' });
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

// POST /api/leads/:id/convertir — Enviar lead a ERP para crear tercero
router.post('/:id/convertir', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await pool.query(`SELECT * FROM crm.leads WHERE id = $1`, [id]);
    if (!lead.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
    if (lead.rows[0].estado === 'convertido') return res.status(400).json({ error: 'Este lead ya fue convertido' });

    // TODO: Cuando tengamos la API de SIESA, aqui se crea el tercero
    // const siesaResponse = await crearTerceroERP(lead.rows[0]);
    // if (!siesaResponse.ok) return res.status(502).json({ error: 'Error en API SIESA' });

    // Por ahora, simular que la API no esta disponible
    const apiDisponible = false; // Cambiar a true cuando tengamos la API

    if (!apiDisponible) {
      return res.status(503).json({
        error: 'API de SIESA no disponible. El tercero debe crearse manualmente en el ERP.',
        lead_id: id,
        datos_tercero: {
          codigo: lead.rows[0].numero_identificacion,
          razon_social: lead.rows[0].raison_social,
          nit: lead.rows[0].numero_identificacion,
          direccion: lead.rows[0].direccion,
          ciudad: lead.rows[0].ciudad,
          email: lead.rows[0].email,
          telefono: lead.rows[0].telefono
        }
      });
    }

    // Cuando la API este disponible:
    // await pool.query(`
    //   UPDATE crm.leads SET estado = 'enviado_erp', erp_tercero_id = $1, actualizado_en = NOW() WHERE id = $2
    // `, [siesaResponse.tercero_id, id]);

    res.status(503).json({ error: 'API de SIESA no disponible aun' });
  } catch (err) {
    console.error('[CRM] Error convertir lead:', err);
    res.status(500).json({ error: 'Error al procesar' });
  }
});

// PUT /api/leads/:id/confirmar — Contabilidad confirma que tercero fue creado en ERP
router.put('/:id/confirmar', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { erp_tercero_id } = req.body;

    const lead = await client.query(`SELECT * FROM crm.leads WHERE id = $1`, [id]);
    if (!lead.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
    if (lead.rows[0].estado === 'convertido') return res.status(400).json({ error: 'Ya convertido' });

    const l = lead.rows[0];

    // Crear cliente en CRM con siesa_* (Hub-ready)
    const cliente = await client.query(`
      INSERT INTO crm.clientes (codigo_siesa, nit, nombre, canal, activo, direccion, ciudad, departamento,
        email, telefono, tipo, tipo_negocio, notas, asesor_comercial,
        siesa_tipo_identificacion, siesa_dv, siesa_tipo_persona, siesa_regimen, siesa_responsabilidad_fiscal, siesa_ciiu)
      VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,'real',$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id
    `, [erp_tercero_id || l.numero_identificacion, l.numero_identificacion, l.raison_social, l.canal || '',
        l.direccion, l.ciudad, l.departamento, l.email, l.telefono, l.tipo_negocio, l.notas, l.asesor_comercial,
        l.siesa_tipo_identificacion||'31', l.siesa_dv||null, l.siesa_tipo_persona||1, l.siesa_regimen||'48', l.siesa_responsabilidad_fiscal||'R-99-PN', l.siesa_ciiu||'4723']);

    // Marcar lead como convertido
    await client.query(`
      UPDATE crm.leads SET estado = 'convertido', cliente_convertido = TRUE,
        cliente_id = $1, fecha_conversion = NOW(), erp_tercero_id = $2, actualizado_en = NOW()
      WHERE id = $3
    `, [cliente.rows[0].id, erp_tercero_id || null, id]);

    await auditarEvento({ accion: 'convertir', entidad: 'lead', entidad_id: id, usuario_id: req.user.id,
      metadata: { cliente_id: cliente.rows[0].id, erp_tercero_id } });

    await client.query('COMMIT');
    res.json({ ok: true, cliente_id: cliente.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error confirmar conversion:', err);
    res.status(500).json({ error: 'Error al confirmar' });
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
