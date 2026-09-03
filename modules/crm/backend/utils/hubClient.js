import pool from '../config/db.js';

// Construye payload genérico SIESA Hub a partir del modelo CRM
// Basado en CSVs: Pedidos por item, Centros, Vendedores, Clientes
export function buildHubPayload({ cotizacion, items, cliente, sucursalFacturar, sucursalDespachar, vendedorHub }) {
  return {
    // Identificación Vitamar
    cotizacion_numero: cotizacion.numero,
    cotizacion_id: cotizacion.id,
    // Cliente SIESA
    tercero: {
      nit: cliente?.nit || '',
      codigo_siesa: cliente?.codigo_siesa || '',
      nombre: cliente?.nombre || '',
      sucursal_facturar: sucursalFacturar ? { codigo: sucursalFacturar.codigo, nombre: sucursalFacturar.nombre } : null,
      sucursal_despachar: sucursalDespachar ? { codigo: sucursalDespachar.codigo, nombre: sucursalDespachar.nombre } : null,
    },
    // Comercial
    condiciones: {
      centro_operacion: cotizacion.centro_operacion || null,      // 100 ITAGUI etc.
      bodega: cotizacion.bodega || null,
      lista_precios: cotizacion.lista_precios || '200',
      tipo_documento: 'CPV',
      motivo_venta: cotizacion.motivo || 'VENTAS',
      unidad_negocio: cotizacion.unidad_negocio || null,
      centro_costo: null, // se puede extender desde perfil
      condicion_pago: cotizacion.condicion_pago || null,
      fecha_entrega: cotizacion.fecha_entrega || null,
      orden_compra: cotizacion.orden_compra || null,
    },
    vendedor: vendedorHub ? { codigo: vendedorHub.codigo, nombre: vendedorHub.nombre } : null,
    observacion: cotizacion.notas || '',
    items: (items || []).map((it, idx) => ({
      linea: idx + 1,
      referencia: it.referencia || '',
      descripcion: it.descripcion || '',
      unidad_medida: it.unidad_medida || 'UND',
      cantidad: Number(it.cantidad) || 1,
      precio_unitario: Number(it.precio_unitario) || 0,
      descuento_pct: Number(it.descuento_pct) || 0,
      subtotal: Number(it.subtotal) || (Number(it.cantidad) * Number(it.precio_unitario)),
    })),
    totales: {
      subtotal: Number(cotizacion.valor_subtotal) || 0,
      descuento: Number(cotizacion.valor_descuento) || 0,
      iva: Number(cotizacion.valor_iva) || 0,
      total: Number(cotizacion.valor_total) || 0,
    },
    // Metadatos Hub
    origen: 'SynnoxERP-CRM',
    creado_por: cotizacion.creado_por || null,
    creado_en: new Date().toISOString(),
  };
}

async function getHubConfig(client = pool) {
  const r = await client.query(`SELECT * FROM crm.hub_config ORDER BY id LIMIT 1`);
  return r.rows[0] || { mock_enabled: true, base_url: '', client_id: '', client_secret: '' };
}

async function obtenerTokenHub(cfg) {
  // Cuando haya credenciales reales: POST {base_url}/oauth/token con client_credentials
  if (!cfg.base_url || !cfg.client_id) throw new Error('Hub no configurado');
  // Stub: retornar token mock
  return 'mock-token';
}

// Enviar pedido al Hub (mock o real)
export async function enviarPedidoAlHub({ cotizacionId }, client = pool) {
  const cfg = await getHubConfig(client);
  // Cargar cotizacion completa
  const cotR = await client.query(`SELECT * FROM crm.cotizaciones WHERE id = $1`, [cotizacionId]);
  if (!cotR.rows.length) throw new Error('Cotización no encontrada');
  const cot = cotR.rows[0];
  if (cot.documento_erp) throw new Error('Ya tiene CPV');

  const itemsR = await client.query(`SELECT * FROM crm.cotizacion_items WHERE cotizacion_id = $1 ORDER BY orden`, [cotizacionId]);
  const cliR = cot.cliente_id ? await client.query(`SELECT * FROM crm.clientes WHERE id = $1`, [cot.cliente_id]) : { rows: [] };
  const cliente = cliR.rows[0] || {};

  let sucFact = null, sucDesp = null;
  if (cot.facturar_a) {
    const s = await client.query(`SELECT * FROM crm.cliente_sucursales WHERE cliente_id = $1 AND codigo = $2 LIMIT 1`, [cot.cliente_id, cot.facturar_a]);
    sucFact = s.rows[0] || { codigo: cot.facturar_a, nombre: cot.facturar_a };
  }
  if (cot.despachar_a) {
    const s = await client.query(`SELECT * FROM crm.cliente_sucursales WHERE cliente_id = $1 AND codigo = $2 LIMIT 1`, [cot.cliente_id, cot.despachar_a]);
    sucDesp = s.rows[0] || { codigo: cot.despachar_a, nombre: cot.despachar_a };
  }
  // Vendedor Hub (mapping del usuario creador)
  let vendedorHub = null;
  try {
    const vm = await client.query(`SELECT codigo_vendedor FROM crm.usuario_perfil_venta WHERE usuario_id = $1 AND codigo_vendedor IS NOT NULL LIMIT 1`, [cot.creado_por]);
    if (vm.rows[0]?.codigo_vendedor) {
      const v = await client.query(`SELECT codigo,nombre FROM crm.vendedores WHERE codigo = $1`, [vm.rows[0].codigo_vendedor]);
      vendedorHub = v.rows[0] || { codigo: vm.rows[0].codigo_vendedor, nombre: vm.rows[0].codigo_vendedor };
    }
  } catch {}

  const payload = buildHubPayload({ cotizacion: cot, items: itemsR.rows, cliente, sucursalFacturar: sucFact, sucursalDespachar: sucDesp, vendedorHub });

  if (cfg.mock_enabled || !cfg.base_url) {
    // Mock: genera CPV-MOCK y guarda envío
    const mockCpv = `CPV-MOCK-${String(cotIdPadded(cot.numero)).padStart(6,'0')}-${Date.now().toString().slice(-4)}`;
    const respuesta = { ok: true, documento_erp: mockCpv, estado_erp: 'confirmado', mock: true, payload_preview: payload };
    await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, documento_erp, intentos) VALUES ($1,$2,$3,$4,'mock',$5,1)`, [cotizacionId, cot.numero, JSON.stringify(payload), JSON.stringify(respuesta), mockCpv]);
    await client.query(`UPDATE crm.cotizaciones SET documento_erp = $1, estado_erp = 'confirmado', estado = CASE WHEN estado='borrador' THEN 'enviada' ELSE estado END, actualizado_en = NOW() WHERE id = $2`, [mockCpv, cotizacionId]);
    return { documento_erp: mockCpv, estado_erp: 'confirmado', mock: true, payload, respuesta };
  }

  // Real (cuando haya credenciales): POST al Hub
  const token = await obtenerTokenHub(cfg);
  const resp = await fetch(`${cfg.base_url.replace(/\/$/,'')}/api/pedidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await resp.json().catch(()=> ({}));
  if (!resp.ok) {
    const err = body.error || body.message || `Hub error ${resp.status}`;
    await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, ultimo_error, intentos) VALUES ($1,$2,$3,$4,'error',$5,1)`, [cotizacionId, cot.numero, JSON.stringify(payload), JSON.stringify(body), String(err).slice(0,1000)]);
    throw new Error(err);
  }
  const documento_erp = body.documento_erp || body.cpv || body.numero || null;
  await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, documento_erp, intentos) VALUES ($1,$2,$3,$4,'enviado',$5,1)`, [cotizacionId, cot.numero, JSON.stringify(payload), JSON.stringify(body), documento_erp]);
  if (documento_erp) await client.query(`UPDATE crm.cotizaciones SET documento_erp = $1, estado_erp = 'enviado', actualizado_en = NOW() WHERE id = $2`, [documento_erp, cotizacionId]);
  return { documento_erp, estado_erp: 'enviado', mock: false, payload, respuesta: body };
}

function cotIdPadded(numero) {
  const m = String(numero).match(/(\d+)/);
  return m ? m[1] : String(Date.now()).slice(-6);
}

export async function getHubEnvios(cotizacionId) {
  const r = await pool.query(`SELECT * FROM crm.hub_envios WHERE cotizacion_id = $1 ORDER BY creado_en DESC`, [cotizacionId]);
  return r.rows;
}
