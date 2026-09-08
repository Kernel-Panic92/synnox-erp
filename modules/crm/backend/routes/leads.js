import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';
import { crearTerceroHub } from '../utils/hubClient.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDirLeads = path.join(__dirname, '..', 'uploads', 'leads');
fs.mkdirSync(uploadDirLeads, { recursive: true });
const storageLeads = multer.diskStorage({
  destination: (req, file, cb) => {
    const leadId = req.params.id;
    const dir = path.join(uploadDirLeads, String(leadId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`);
  }
});
const ALLOWED_LEAD_MIMES = new Set([
  'application/pdf','image/jpeg','image/png','image/webp','image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','text/csv'
]);
const uploadLeads = multer({
  storage: storageLeads,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_LEAD_MIMES.has(file.mimetype) || file.originalname.match(/\.(pdf|jpe?g|png|webp|gif|xlsx?|docx?|csv)$/i)) cb(null, true);
    else cb(new Error('Tipo no permitido: usa PDF, JPG, PNG, WebP, XLSX, DOCX o CSV'));
  }
});

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

function calcularDV(nit){
  const clean=String(nit||'').replace(/\D/g,'');
  if(!clean) return '';
  let sum=0; const pesos=[3,7,13,17,19,23,29,37,41,43,47,53,59,67,71];
  for(let i=0;i<clean.length;i++){ sum += parseInt(clean[clean.length-1-i],10) * pesos[i%pesos.length]; }
  const mod=sum%11; return String(mod>1?11-mod:mod);
}
function validarLeadDIAN(b, isUpdate=false){
  const errs=[];
  const nit = String(b.numero_identificacion||'').replace(/\D/g,'');
  if(!isUpdate || b.raison_social!==undefined) if(!b.raison_social || !String(b.raison_social).trim()) errs.push('Razón social obligatoria');
  if(!isUpdate || b.numero_identificacion!==undefined){
    if(!nit) errs.push('NIT/Cédula obligatorio (solo dígitos)');
    else if(nit.length<6 || nit.length>11) errs.push('NIT/Cédula debe tener 6-11 dígitos');
  }
  const tipo = String(b.siesa_tipo_identificacion||'31');
  if(!['31','13','22','41','42'].includes(tipo)) errs.push('Tipo identificación SIESA debe ser 31(NIT),13(CC),22(CE),41(Pas)');
  if(tipo==='31'){
    const dv = String(b.siesa_dv||'').replace(/\D/g,'').slice(0,1);
    if(!dv) errs.push('DV obligatorio para NIT (31)');
    else if(nit && dv !== calcularDV(nit)) errs.push(`DV no coincide (calculado ${calcularDV(nit)} para NIT ${nit})`);
  }
  if(!isUpdate || b.siesa_regimen!==undefined) if(!b.siesa_regimen) errs.push('Régimen DIAN obligatorio');
  if(!isUpdate || b.siesa_responsabilidad_fiscal!==undefined) if(!b.siesa_responsabilidad_fiscal) errs.push('Responsabilidad fiscal obligatoria');
  if(!isUpdate || b.siesa_ciiu!==undefined) if(!b.siesa_ciiu || !/^\d{4}$/.test(String(b.siesa_ciiu))) errs.push('CIIU debe ser 4 dígitos');
  if(!isUpdate || b.email!==undefined) if(b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) errs.push('Email inválido');
  if(!isUpdate || b.direccion!==undefined) if(!b.direccion || !String(b.direccion).trim()) errs.push('Dirección obligatoria');
  if(!isUpdate || b.ciudad!==undefined) if(!b.ciudad) errs.push('Ciudad obligatoria');
  if(!isUpdate || b.departamento!==undefined) if(!b.departamento) errs.push('Departamento obligatorio');
  return errs;
}
// POST /api/leads — Crear lead (Hub-ready con siesa_* y validación NIT)
router.post('/', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { raison_social, numero_identificacion, tipo_identificacion, nombre_establecimiento,
      direccion, ciudad, departamento, email, telefono, canal, segmento, tipo_negocio,
      lista_precios, condicion_pago, asesor_comercial, notas,
      siesa_tipo_identificacion, siesa_dv, siesa_tipo_persona, siesa_regimen, siesa_responsabilidad_fiscal, siesa_ciiu } = req.body;
    const dianErrs = validarLeadDIAN(req.body, false);
    if(dianErrs.length) return res.status(400).json({ error: dianErrs[0], detalles: dianErrs });
    if (numero_identificacion) {
      const cleanNit = String(numero_identificacion).replace(/\D/g,'');
      const dup = await pool.query(`SELECT id FROM crm.clientes WHERE nit=$1 AND activo=TRUE LIMIT 1`, [cleanNit]);
      if (dup.rows.length) return res.status(409).json({ error: `NIT ${cleanNit} ya existe como cliente formal` });
      const dupLead = await pool.query(`SELECT id FROM crm.leads WHERE numero_identificacion=$1 LIMIT 1`, [cleanNit]);
      if (dupLead.rows.length) return res.status(409).json({ error: `NIT ${cleanNit} ya existe como lead` });
      req.body.numero_identificacion = cleanNit;
      if(req.body.siesa_dv) req.body.siesa_dv = String(req.body.siesa_dv).replace(/\D/g,'').slice(0,1);
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
      const t = String(req.body.siesa_tipo_identificacion).toUpperCase();
      req.body.tipo_identificacion = t === 'NIT' ? '31' : t;
      req.body.siesa_tipo_identificacion = t === 'NIT' ? '31' : t;
    } else if (req.body.tipo_identificacion !== undefined && req.body.siesa_tipo_identificacion === undefined) {
      const t = String(req.body.tipo_identificacion).toUpperCase();
      req.body.siesa_tipo_identificacion = t === 'NIT' ? '31' : t;
      req.body.tipo_identificacion = t === 'NIT' ? '31' : t;
    }
    if (req.body.siesa_tipo_identificacion) req.body.siesa_tipo_identificacion = String(req.body.siesa_tipo_identificacion).toUpperCase() === 'NIT' ? '31' : String(req.body.siesa_tipo_identificacion);
    if (req.body.numero_identificacion) req.body.numero_identificacion = String(req.body.numero_identificacion).replace(/\D/g, '');
    if (req.body.siesa_dv) req.body.siesa_dv = String(req.body.siesa_dv).replace(/\D/g, '').slice(0, 1);
    // Validar DIAN si se envían campos relevantes
    const { numero_identificacion, siesa_dv, raison_social, siesa_tipo_identificacion, siesa_regimen, siesa_responsabilidad_fiscal, siesa_ciiu, email, direccion, ciudad, departamento } = req.body;
    const hasRelevantFields = numero_identificacion !== undefined || siesa_tipo_identificacion !== undefined || raison_social !== undefined || siesa_dv !== undefined;
    if (hasRelevantFields) {
      const existing = await pool.query(`SELECT * FROM crm.leads WHERE id = $1`, [id]);
      if (!existing.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
      const merged = { ...existing.rows[0], ...req.body };
      const dianErrs = validarLeadDIAN(merged, true);
      if (dianErrs.length) return res.status(400).json({ error: dianErrs[0], detalles: dianErrs });
    }
    const fields = ['raison_social', 'numero_identificacion', 'tipo_identificacion', 'nombre_establecimiento',
      'direccion', 'ciudad', 'departamento', 'email', 'telefono', 'canal', 'segmento', 'tipo_negocio',
      'lista_precios', 'condicion_pago', 'asesor_comercial', 'notas', 'estado',
      'siesa_tipo_identificacion','siesa_dv','siesa_tipo_persona','siesa_regimen','siesa_responsabilidad_fiscal','siesa_ciiu',
      'latitud','longitud','google_place_id','direccion_google'];
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

// POST /api/leads/:id/convertir — Enviar lead a ERP (SIESA Hub) para crear tercero → luego cliente
router.post('/:id/convertir', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await pool.query(`SELECT * FROM crm.leads WHERE id = $1`, [id]);
    if (!lead.rows.length) return res.status(404).json({ error: 'Lead no encontrado' });
    if (lead.rows[0].estado === 'convertido') return res.status(400).json({ error: 'Este lead ya fue convertido' });

    // Hub SIESA: crea tercero (mock si no hay credenciales)
    try {
      const hub = await crearTerceroHub(lead.rows[0]);
      // Marca lead como enviado/convertido y crea cliente formal (misma transacción que confirmar)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const l = lead.rows[0];
        // Cliente creado como prospecto inactivo hasta que contabilidad lo active (flujo lead → prospecto → activo)
      const vendedorCreador = l.asesor_comercial || req.user.nombre || null;
      const cli = await client.query(`
          INSERT INTO crm.clientes (codigo_siesa, nit, nombre, canal, activo, direccion, ciudad, departamento, email, telefono, tipo, tipo_negocio, notas, asesor_comercial,
            siesa_tipo_identificacion, siesa_dv, siesa_tipo_persona, siesa_regimen, siesa_responsabilidad_fiscal, siesa_ciiu, origen)
          VALUES ($1,$2,$3,$4,FALSE,$5,$6,$7,$8,$9,'real',$10,$11,$12,$13,$14,$15,$16,$17,$18,'lead') RETURNING id
        `,[hub.tercero_id||l.numero_identificacion, String(l.numero_identificacion).replace(/\D/g,''), l.raison_social, l.canal||'', l.direccion, l.ciudad, l.departamento, l.email, l.telefono, l.tipo_negocio, `Lead ${l.raison_social} → prospecto. `+(l.notas||''), vendedorCreador,
           l.siesa_tipo_identificacion||'31', l.siesa_dv||calcularDV(String(l.numero_identificacion).replace(/\D/g,'')), l.siesa_tipo_persona||1, l.siesa_regimen||'48', l.siesa_responsabilidad_fiscal||'R-99-PN', l.siesa_ciiu||'4723']);
        await client.query(`UPDATE crm.leads SET estado='enviado_erp', cliente_id=$1, erp_tercero_id=$2, actualizado_en=NOW() WHERE id=$3`,[cli.rows[0].id, hub.tercero_id, id]);
        await client.query('COMMIT');
        await auditarEvento({ accion:'convertir', entidad:'lead', entidad_id:id, usuario_id:req.user.id, metadata:{ cliente_id:cli.rows[0].id, erp_tercero_id:hub.tercero_id, mock:hub.mock } });
        return res.json({ ok:true, cliente_id:cli.rows[0].id, erp_tercero_id:hub.tercero_id, mock:hub.mock, payload:hub.payload });
      } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    } catch(hubErr){
      // Si Hub falla, deja el lead en estado para reintento y devuelve payload para debug
      console.error('[CRM] Hub tercero error', hubErr.message);
      return res.status(502).json({ error: `Hub SIESA: ${hubErr.message}`, lead_id:id, payload: hubErr.payload || null });
    }
  } catch (err) {
    console.error('[CRM] Error convertir lead:', err);
    res.status(500).json({ error: 'Error al procesar' });
  }
});

// PUT /api/leads/:id/activar — Contabilidad activa cliente prospecto (marca activo y convertido)
router.put('/:id/activar', requirePermiso('configurar', 'crm'), async (req, res) => {
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const lead = await client.query(`SELECT * FROM crm.leads WHERE id=$1`,[req.params.id]);
    if(!lead.rows.length) return res.status(404).json({error:'Lead no encontrado'});
    const l = lead.rows[0];
    if(!l.cliente_id) return res.status(400).json({error:'Lead aún no tiene cliente prospecto (primero Enviar al ERP)'});
    await client.query(`UPDATE crm.clientes SET activo=TRUE, actualizado_en=NOW() WHERE id=$1`,[l.cliente_id]);
    await client.query(`UPDATE crm.leads SET estado='convertido', cliente_convertido=TRUE, fecha_conversion=NOW(), actualizado_en=NOW() WHERE id=$1`,[l.id]);
    await client.query('COMMIT');
    await auditarEvento({ accion:'activar', entidad:'lead', entidad_id:l.id, usuario_id:req.user.id, metadata:{ cliente_id:l.cliente_id } });
    res.json({ ok:true, cliente_id:l.cliente_id });
  }catch(err){ await client.query('ROLLBACK'); console.error('[CRM] Error activar lead', err); res.status(500).json({error:'Error al activar'}); } finally{ client.release(); }
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

// ── Adjuntos Lead — RUT, cert bancario, cámara, etc. (20MB, max 10/lead)
router.get('/:id/adjuntos', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, lead_id, nombre_original, ruta, mime, size, tipo, subido_por, creado_en FROM crm.lead_adjuntos WHERE lead_id=$1 ORDER BY creado_en DESC`, [req.params.id]);
    res.json({ ok: true, data: r.rows });
  } catch (e) { console.error('[CRM] list adjuntos', e.message); res.status(500).json({ error: 'Error al listar adjuntos' }); }
});
router.post('/:id/adjuntos', requirePermiso('crear_contacto', 'crm'), uploadLeads.array('archivos', 10), async (req, res) => {
  try {
    const leadId = req.params.id;
    const exists = await pool.query(`SELECT id FROM crm.leads WHERE id=$1`, [leadId]);
    if (!exists.rows.length) {
      for (const f of req.files||[]) try{ fs.unlinkSync(f.path); }catch{}
      return res.status(404).json({ error: 'Lead no encontrado' });
    }
    const count = await pool.query(`SELECT COUNT(*) FROM crm.lead_adjuntos WHERE lead_id=$1`, [leadId]);
    const ya = parseInt(count.rows[0].count);
    if (ya + (req.files?.length||0) > 10) {
      for (const f of req.files||[]) try{ fs.unlinkSync(f.path); }catch{}
      return res.status(400).json({ error: `Máximo 10 archivos por lead (ya tienes ${ya})` });
    }
    const tipo = String(req.body.tipo||'otro');
    const tipoOk = ['rut','cert_bancario','camara_comercio','cedula','otro'].includes(tipo) ? tipo : 'otro';
    const rows = [];
    for (const f of req.files||[]) {
      const rel = `/crm/uploads/leads/${leadId}/${path.basename(f.path)}`;
      // Si se subieron múltiples con tipos distintos, el frontend envía tipo por archivo via tipo[]
      const r = await pool.query(`INSERT INTO crm.lead_adjuntos (lead_id, nombre_original, nombre_guardado, ruta, mime, size, tipo, subido_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [leadId, f.originalname, path.basename(f.path), rel, f.mimetype, f.size, tipoOk, req.user.id]);
      rows.push(r.rows[0]);
    }
    if (rows.length) await auditarEvento({ accion:'adjuntar', entidad:'lead', entidad_id:leadId, usuario_id:req.user.id, metadata:{ archivos: rows.map(x=>x.nombre_original), tipo: tipoOk } });
    res.status(201).json({ ok:true, data: rows });
  } catch (e) {
    console.error('[CRM] upload adjuntos', e.message);
    // multer fileFilter/size errors
    if (e.code==='LIMIT_FILE_SIZE') return res.status(400).json({ error:'Archivo supera 20MB' });
    res.status(500).json({ error: e.message||'Error al subir' });
  }
});
router.get('/:id/adjuntos/:adjId/descargar', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM crm.lead_adjuntos WHERE id=$1 AND lead_id=$2`, [req.params.adjId, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error:'Adjunto no encontrado' });
    const a = r.rows[0];
    const abs = path.join(uploadDirLeads, String(a.lead_id), a.nombre_guardado);
    if (!fs.existsSync(abs)) return res.status(404).json({ error:'Archivo no existe en disco' });
    res.download(abs, a.nombre_original);
  } catch (e) { res.status(500).json({ error:'Error al descargar' }); }
});
router.delete('/:id/adjuntos/:adjId', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM crm.lead_adjuntos WHERE id=$1 AND lead_id=$2 RETURNING *`, [req.params.adjId, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error:'Adjunto no encontrado' });
    const a = r.rows[0];
    const abs = path.join(uploadDirLeads, String(a.lead_id), a.nombre_guardado);
    try{ if(fs.existsSync(abs)) fs.unlinkSync(abs); }catch{}
    await auditarEvento({ accion:'eliminar_adjunto', entidad:'lead', entidad_id:req.params.id, usuario_id:req.user.id, metadata:{ archivo:a.nombre_original } });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error:'Error al eliminar' }); }
});

export default router;
export { uploadDirLeads };
