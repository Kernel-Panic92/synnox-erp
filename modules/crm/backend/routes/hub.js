import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { enviarPedidoAlHub, getHubEnvios, buildHubPayload } from '../utils/hubClient.js';

const router = express.Router();

// GET /api/hub/config — ver config Hub
router.get('/config', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, base_url, client_id, mock_enabled, activo, actualizado_en FROM crm.hub_config LIMIT 1`);
    res.json({ ok: true, data: r.rows[0] || { mock_enabled: true, base_url: '' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/hub/config — guardar config Hub
router.put('/config', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const { base_url, client_id, client_secret, mock_enabled } = req.body;
    await pool.query(`UPDATE crm.hub_config SET base_url = $1, client_id = $2, client_secret = $3, mock_enabled = $4, actualizado_en = NOW() WHERE id = (SELECT id FROM crm.hub_config LIMIT 1)`, [base_url || '', client_id || '', client_secret || '', mock_enabled !== false]);
    const r = await pool.query(`SELECT * FROM crm.hub_config LIMIT 1`);
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/hub/envios?cotizacion_id= — historial envíos
router.get('/envios', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { cotizacion_id } = req.query;
    let q = `SELECT * FROM crm.hub_envios ORDER BY creado_en DESC LIMIT 50`;
    let params = [];
    if (cotizacion_id) { q = `SELECT * FROM crm.hub_envios WHERE cotizacion_id = $1 ORDER BY creado_en DESC`; params = [cotizacion_id]; }
    const r = await pool.query(q, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/hub/sync — stub mock sync maestras (cuando Hub real esté, llamará al Hub)
router.post('/sync', requirePermiso('configurar', 'crm'), async (req, res) => {
  try {
    const cfg = (await pool.query(`SELECT mock_enabled, base_url FROM crm.hub_config LIMIT 1`)).rows[0];
    if (!cfg?.mock_enabled || !cfg.base_url) {
      return res.json({ ok: true, mock: true, message: 'Mock activo: maestras ya están sincronizadas vía CSV. Cuando Hub real esté configurado aquí se hará fetch.' });
    }
    res.json({ ok: true, message: 'Sync real no implementado (falta spec Hub)' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/hub/enviar/:cotizacionId — disparar envío vía Hub (mock o real)
router.post('/enviar/:cotizacionId', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const id = parseInt(req.params.cotizacionId);
    const result = await enviarPedidoAlHub({ cotizacionId: id });
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/hub/payload/:cotizacionId — preview payload que se enviaría al Hub (sin enviar)
router.get('/payload/:cotizacionId', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const id = parseInt(req.params.cotizacionId);
    const cotR = await pool.query(`SELECT * FROM crm.cotizaciones WHERE id = $1`, [id]);
    if (!cotR.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const cot = cotR.rows[0];
    const itemsR = await pool.query(`SELECT * FROM crm.cotizacion_items WHERE cotizacion_id = $1 ORDER BY orden`, [id]);
    const cliR = cot.cliente_id ? await pool.query(`SELECT * FROM crm.clientes WHERE id = $1`, [cot.cliente_id]) : { rows: [] };
    const cliente = cliR.rows[0] || {};
    let vendedorHub = null;
    try {
      const vm = await pool.query(`SELECT codigo_vendedor FROM crm.usuario_perfil_venta WHERE usuario_id = $1 LIMIT 1`, [cot.creado_por]);
      if (vm.rows[0]?.codigo_vendedor) {
        const v = await pool.query(`SELECT codigo,nombre FROM crm.vendedores WHERE codigo = $1`, [vm.rows[0].codigo_vendedor]);
        vendedorHub = v.rows[0] || { codigo: vm.rows[0].codigo_vendedor, nombre: vm.rows[0].codigo_vendedor };
      }
    } catch {}
    const payload = buildHubPayload({ cotizacion: cot, items: itemsR.rows, cliente, sucursalFacturar: null, sucursalDespachar: null, vendedorHub });
    const envios = await getHubEnvios(id);
    res.json({ ok: true, payload, envios });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
