import pool from '../config/db.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function mapSiesa(tipo, crmCodigo) {
  if (!crmCodigo) return crmCodigo;
  const code = String(crmCodigo).trim();
  if (!code) return code;
  try {
    // exact + case-insensitive + descripcion fallback
    let r = await pool.query(`SELECT siesa_codigo FROM crm.siesa_mapeos WHERE tipo=$1 AND UPPER(TRIM(crm_codigo))=UPPER(TRIM($2)) LIMIT 1`, [tipo, code]);
    if (!r.rows[0]) r = await pool.query(`SELECT siesa_codigo FROM crm.siesa_mapeos WHERE tipo=$1 AND UPPER(TRIM(descripcion))=UPPER(TRIM($2)) LIMIT 1`, [tipo, code]);
    return r.rows[0]?.siesa_codigo || code;
  } catch { return code; }
}

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
    vendedor: vendedorHub ? { codigo: String(vendedorHub.codigo).split(' - ')[0].split(' ')[0].trim(), nombre: vendedorHub.nombre } : null,
    observacion: cotizacion.notas || '',
    items: (items || []).map((it, idx) => {
      const cant = Number(it.cantidad) || 1;
      const pu = Number(it.precio_unitario) || 0;
      const d = Number(it.descuento_pct) || 0;
      const bruto = cant * pu;
      const descVal = bruto * d / 100;
      const neto = bruto - descVal;
      return {
        linea: idx + 1,
        referencia: it.referencia || '',
        descripcion: it.descripcion || '',
        unidad_medida: it.unidad_medida || 'UND',
        cantidad: cant,
        precio_unitario: pu,
        descuento_pct: d,
        porcentaje_iva: Number(it.porcentaje_iva ?? it.tasa_impuesto ?? 19),
        subtotal: Number(it.subtotal) || neto,
        _bruto: bruto,
        _descuento_val: descVal,
      };
    }),
    totales: (() => {
      // SIESA exige coherencia: bruto = sum(cant*precio), descuento = sum linea + global, subtotal = bruto - descuento
      const bruto = (items||[]).reduce((s, it)=> s + (Number(it.cantidad)||1)*(Number(it.precio_unitario)||0), 0);
      const lineDesc = (items||[]).reduce((s, it) => s + (Number(it.cantidad)||1)*(Number(it.precio_unitario)||0)*(Number(it.descuento_pct)||0)/100, 0);
      const globalDesc = Number(cotizacion.valor_descuento)||0;
      const desc = lineDesc + globalDesc;
      const subtotal = bruto - desc;
      // iva por línea (si exento 0, sino 19) — sumado
      const ivaLine = (items||[]).reduce((s, it) => {
        const cant = Number(it.cantidad)||1, pu = Number(it.precio_unitario)||0, d = Number(it.descuento_pct)||0;
        const neto = cant*pu*(1-d/100);
        const ivaPct = Number(it.porcentaje_iva ?? it.tasa_impuesto ?? 0);
        return s + neto * ivaPct / 100;
      }, 0);
      // Si hay items, el iva debe reflejar exactamente la sumatoria por renglón (0 si exento), no el valor cacheado de cotizaciones
      const iva = (items && items.length) ? Math.round(ivaLine) : (Number(cotizacion.valor_iva) || 0);
      const total = subtotal + iva;
      return { bruto, descuento: desc, subtotal, iva, total };
    })(),
    // Metadatos Hub
    origen: 'SynnoxERP-CRM',
    creado_por: cotizacion.creado_por || null,
    creado_en: new Date().toISOString(),
  };
}

function fmtSiesaDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d).replace(/-/g,'').slice(0,8);
    return dt.toISOString().slice(0,10).replace(/-/g,'');
  } catch { return String(d).replace(/-/g,'').slice(0,8); }
}
// Payload estricto SIESA (f350/f431) con códigos mapeados
export async function toSiesaPayload(payloadCrm) {
  const condPago = await mapSiesa('condicion_pago', payloadCrm.condiciones?.condicion_pago || payloadCrm.condiciones?.condicion_pago);
  const undNeg = await mapSiesa('unidad_negocio', payloadCrm.condiciones?.unidad_negocio);
  const centroCosto = await mapSiesa('centro_costo', payloadCrm.condiciones?.centro_costo);
  const tipoDoc = await mapSiesa('tipo_documento', payloadCrm.condiciones?.tipo_documento || 'CPV');
  // Bodega por CO si la cotización no trae bodega (ej. CO 200 → 20002)
  let bodegaSiesa = payloadCrm.condiciones?.bodega || '';
  if (!bodegaSiesa && payloadCrm.condiciones?.centro_operacion) {
    const b = await mapSiesa('bodega_co', payloadCrm.condiciones.centro_operacion);
    if (b !== payloadCrm.condiciones.centro_operacion) bodegaSiesa = b;
  }
  const warnings = [];
  if (payloadCrm.condiciones?.condicion_pago && condPago === payloadCrm.condiciones.condicion_pago && (await pool.query(`SELECT 1 FROM crm.siesa_mapeos WHERE tipo='condicion_pago' AND crm_codigo=$1`, [payloadCrm.condiciones.condicion_pago])).rowCount===0) warnings.push(`condicion_pago ${payloadCrm.condiciones.condicion_pago} sin mapeo siesa_mapeos`);
  return {
    Encabezado: {
      f350_id_co: String(payloadCrm.condiciones?.centro_operacion || '').trim().slice(0,10),
      f350_id_tipo_docto: String(tipoDoc || 'CPV').trim().slice(0,10),
      f350_id_tercero: String(payloadCrm.tercero?.nit || payloadCrm.tercero?.codigo_siesa || '').replace(/\D/g,'').slice(0,20),
      f350_id_sucursal_fact: String(payloadCrm.tercero?.sucursal_facturar?.codigo || '001').padStart(3,'0').slice(0,5),
      f350_id_sucursal_desp: String(payloadCrm.tercero?.sucursal_despachar?.codigo || '001').padStart(3,'0').slice(0,5),
      f430_id_vendedor: String(payloadCrm.vendedor?.codigo || '').split(' - ')[0].trim().slice(0,10),
      f430_id_cond_pago: String(condPago || '').trim().slice(0,10),
      f430_id_lista_precios: String(payloadCrm.condiciones?.lista_precios || '200').trim().slice(0,10),
      f430_id_bodega: String(bodegaSiesa || '').trim().slice(0,10),
      f350_id_unidad_negocio: String(undNeg || '').trim().slice(0,10),
      f350_id_centro_costo: String(centroCosto || '').trim().slice(0,15),
      f350_notas: String(`${payloadCrm.observacion || ''} | Cot: ${payloadCrm.cotizacion_numero}`.slice(0,250)).replace(/[\r\n]+/g,' ').trim(),
      f430_num_orden_compra: String(payloadCrm.condiciones?.orden_compra || payloadCrm.cotizacion_numero || '').trim().slice(0,30),
      f350_consec_docto: '',
      f350_fecha_pedido: fmtSiesaDate(payloadCrm.condiciones?.fecha_pedido || payloadCrm.creado_en),
      f350_fecha_entrega: fmtSiesaDate(payloadCrm.condiciones?.fecha_entrega),
    },
    Movimientos: (payloadCrm.items||[]).map((it, idx) => ({
      f351_consecutivo: idx + 1,
      f351_id_item: it.referencia || it.descripcion,
      f351_id_bodega: payloadCrm.condiciones?.bodega || '',
      f351_cant_pedida: Number(it.cantidad)||0,
      f351_precio_unitario: Number(it.precio_unitario)||0,
      f351_porc_descuento: Number(it.descuento_pct)||0,
      f351_porc_iva: Number(it.porcentaje_iva ?? 19),
      f351_subtotal: Number(it.subtotal) || (Number(it.cantidad)*(Number(it.precio_unitario))*(1-(Number(it.descuento_pct)||0)/100)),
    })),
    _meta: { cotizacion_numero: payloadCrm.cotizacion_numero, warnings },
  };
}

let _daneCache=null;
function getDaneCache(){
  if(_daneCache) return _daneCache;
  try{
    const p = path.join(__dirname, '..', '..', 'public', 'data', 'colombia.json');
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const cityByNorm = new Map();
    const deptoByNorm = new Map();
    const cityNames = new Set();
    const deptoNames = new Set();
    for(const dep of j.departamentos){
      const depNorm = dep.nombre.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      deptoByNorm.set(depNorm, dep.codigo_dane);
      deptoNames.add(depNorm);
      for(const m of dep.municipios){
        const cNorm = m.nombre.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
        cityByNorm.set(cNorm, { pais:'170', depto: dep.codigo_dane, ciudad: m.codigo_dane });
        // también clave compuesta "BELLO|05"
        cityByNorm.set(cNorm+'|'+dep.codigo_dane, { pais:'170', depto: dep.codigo_dane, ciudad: m.codigo_dane });
        cityNames.add(cNorm);
      }
    }
    _daneCache={ cityByNorm, deptoByNorm, cityNames, deptoNames };
  }catch(e){ _daneCache={ cityByNorm:new Map(), deptoByNorm:new Map(), cityNames:new Set(), deptoNames:new Set() }; }
  return _daneCache;
}
function daneFromCiudad(ciudad, depto){
  const rawC = String(ciudad||'').trim();
  const rawD = String(depto||'').trim();
  // Si ya vienen códigos DANE (numéricos), úsalos directo
  if(/^\d{5}$/.test(rawC)){
    const depFromCity = rawC.slice(0, rawC.length===5?2:2);
    // si depto también es código, respétalo; si no, deriva del city
    let depCode = /^\d{1,2}$/.test(rawD) ? rawD.padStart(2,'0') : depFromCity;
    if(/^\d{5}$/.test(rawC)) depCode = rawC.slice(0,2);
    return { pais:'170', depto: depCode, ciudad: rawC };
  }
  if(/^\d{2}$/.test(rawD) && /^\d{5}$/.test(rawC)){
    return { pais:'170', depto: rawD.padStart(2,'0'), ciudad: rawC };
  }
  const c = rawC.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const d = rawD.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const cache=getDaneCache();
  // Intento exacto por nombre
  if(cache.cityByNorm.has(c)) {
    // si hay depto, verifica que coincida; si no, retorna el primero encontrado
    const hit = cache.cityByNorm.get(c);
    // si el city existe en varios deptos (p.ej. La Unión), prioriza el depto recibido
    const keyWithDepto = c+'|'+d;
    // d puede ser código o nombre -> normaliza a código
    let depCodeFromName = cache.deptoByNorm.get(d);
    if(!depCodeFromName && /^\d{2}$/.test(d)) depCodeFromName=d;
    if(depCodeFromName && cache.cityByNorm.has(c+'|'+depCodeFromName)) return cache.cityByNorm.get(c+'|'+depCodeFromName);
    return hit;
  }
  if(c.includes('BOGOTA')) {
    const b = cache.cityByNorm.get('BOGOTA');
    if(b) return b;
  }
  // Fallback por depto
  const depCode = cache.deptoByNorm.get(d) || ( /^\d{2}$/.test(d) ? d : null );
  if(depCode){
    // intenta capital del depto
    const cap = [...cache.cityByNorm.values()].find(v=> v.depto===depCode && v.ciudad.endsWith('001'));
    if(cap) return cap;
    return { pais:'170', depto:depCode, ciudad: depCode+'001' };
  }
  // último fallback: intenta por substring
  for(const [k,v] of cache.cityByNorm.entries()){
    if(k.includes(c) || c.includes(k)) return v;
  }
  return { pais:'170', depto:'11', ciudad:'11001' };
}
function cleanDir(dir){
  let s=String(dir||'').trim().replace(/,+$/,'').replace(/\s+,/g,',');
  if(!s) return '';
  // Quita redundancia de ciudad/depto/país: conserva solo vía + barrio
  // Ej: "Cra. 62b #72a-25, Villa del Sol, Bello, Antioquia, Colombia" → "Cra. 62b #72a-25, Villa del Sol"
  const parts=s.split(',').map(p=>p.trim()).filter(Boolean);
  if(parts.length>2){
    try{
      const cache=getDaneCache();
      // detecta qué partes son ciudad/depto/país
      const isGeo = (p)=>{
        const n=p.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
        return n==='COLOMBIA' || n==='CO' || cache.deptoNames.has(n) || cache.cityNames.has(n);
      };
      // Mantén solo partes no geo al inicio; si las 2 primeras ya son geo, conserva al menos la primera (vía)
      let keep=[];
      for(let i=0;i<parts.length;i++){
        if(keep.length<2 && !isGeo(parts[i])) keep.push(parts[i]);
        else if(keep.length>=2) break;
        else if(keep.length===1 && !isGeo(parts[i])) keep.push(parts[i]);
      }
      // Si no se pudo filtrar, fallback a primeras 2 partes no vacías que no sean solo país/depto
      if(keep.length) s=keep.join(', ');
      else s=parts.slice(0,2).join(', ');
    }catch{ s=parts.slice(0,2).join(', '); }
  }
  // Límite SIESA: 80 caracteres (algunas versiones 40) — usamos 80 para no truncar vía+barrio
  s=s.replace(/\s+/g,' ').trim();
  if(s.length>80) s=s.slice(0,80).trim().replace(/,+$/,'');
  return s;
}
export function buildTerceroPayload(lead){
  const dane = daneFromCiudad(lead.ciudad, lead.departamento);
  const dirClean = cleanDir(lead.direccion);
  const esNit = String(lead.siesa_tipo_identificacion||'31') === '31';
  const dvClean = esNit ? String(lead.siesa_dv||'').replace(/\D/g,'').slice(0,1) : '';
  const tipoPersona = String(lead.siesa_tipo_persona|| (esNit ? '1' : '2'));
  // Para persona natural (2) SIESA exige descomponer razon_social en nombres/apellidos; para jurídica (1) basta razon_social
  let ap1='', ap2='', n1='', n2='';
  if(tipoPersona==='2'){
    const partes = String(lead.raison_social||'').trim().split(/\s+/).filter(Boolean);
    if(partes.length>=2){ ap1=partes[0].slice(0,100); ap2=(partes[1]||'').slice(0,100); n1=partes.slice(2,3).join(' ').slice(0,100); n2=partes.slice(3).join(' ').slice(0,100); }
    else { n1=String(lead.raison_social||'').slice(0,100); }
  }
  return {
    Tercero: {
      f200_id_tipo_ident: String(lead.siesa_tipo_identificacion||'31').slice(0,5),
      f200_nit: String(lead.numero_identificacion||'').replace(/\D/g,'').slice(0,20),
      f200_dv: esNit ? (dvClean || null) : '',
      f200_tipo_persona: tipoPersona,
      ...(tipoPersona==='2' ? {
        f200_primer_apellido: ap1,
        f200_segundo_apellido: ap2,
        f200_primer_nombre: n1,
        f200_segundo_nombre: n2,
      } : {
        f200_razon_social: String(lead.raison_social||'').slice(0,200),
      }),
      f200_nombre_comercial: String(lead.raison_social||'').slice(0,200),
      f200_f201_id_regimen: String(lead.siesa_regimen||'48').slice(0,10),
      f200_id_responsabilidad_fiscal: String(lead.siesa_responsabilidad_fiscal||'R-99-PN').slice(0,20),
      f200_id_ciiu: String(lead.siesa_ciiu||'4723').slice(0,10),
      f200_email: String(lead.email||'').slice(0,200),
      f200_telefono: String(lead.telefono||'').replace(/\D/g,'').slice(0,30),
      f200_direccion: dirClean,
      f200_id_pais: dane.pais,
      f200_id_depto: dane.depto,
      f200_id_ciudad: dane.ciudad,
      f200_ind_estado: '0',
      _lead_id: lead.id,
      _origen: 'SynnoxCRM-Lead'
    },
    SucursalPrincipal: {
      f201_id_sucursal: '001',
      f201_descripcion: 'PRINCIPAL',
      f201_direccion: dirClean,
      f201_telefono: String(lead.telefono||'').replace(/\D/g,'').slice(0,30),
      f201_id_pais: dane.pais,
      f201_id_depto: dane.depto,
      f201_id_ciudad: dane.ciudad
    }
  };
}

export async function crearTerceroHub(lead, client = pool){
  const cfg = await getHubConfig(client);
  const payload = buildTerceroPayload(lead);
  if(cfg.mock_enabled || !cfg.base_url){
    const mockId = `TERCERO-MOCK-${String(payload.f200_nit||Date.now()).slice(-8)}-${Date.now().toString().slice(-4)}`;
    // guarda en hub_envios para que Admin lo vea (cotizacion_id null)
    try { await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, documento_erp, intentos) VALUES (NULL, $1, $2, $3, 'mock', $4, 1)`, [String(lead.raison_social||lead.numero_identificacion||'LEAD').slice(0,50), JSON.stringify({ payload_tercero: payload }), JSON.stringify({ ok:true, tercero_id: mockId, mock:true }), mockId]); } catch {}
    return { tercero_id: mockId, mock: true, payload, respuesta: { ok:true, tercero_id: mockId } };
  }
  const token = await obtenerTokenHub(cfg);
  const resp = await fetch(`${cfg.base_url.replace(/\/$/,'')}/api/terceros`, {
    method: 'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body: JSON.stringify(payload)
  });
  const body = await resp.json().catch(()=>({}));
  if(!resp.ok){
    try { await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, ultimo_error, intentos) VALUES (NULL, $1, $2, $3, 'error', $4, 1)`, [String(lead.raison_social||lead.numero_identificacion||'LEAD').slice(0,50), JSON.stringify({ payload_tercero: payload }), JSON.stringify(body), String(body.error||body.message||`Hub tercero error ${resp.status}`).slice(0,1000)]); } catch {}
    throw new Error(body.error || body.message || `Hub tercero error ${resp.status}`);
  }
  const tid = body.tercero_id || body.id || body.codigo || payload.f200_nit;
  try { await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, documento_erp, intentos) VALUES (NULL, $1, $2, $3, 'enviado', $4, 1)`, [String(lead.raison_social||lead.numero_identificacion||'LEAD').slice(0,50), JSON.stringify({ payload_tercero: payload }), JSON.stringify(body), tid]); } catch {}
  return { tercero_id: tid, mock:false, payload, respuesta: body };
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

  const itemsR = await client.query(`
    SELECT ci.*, p.tasa_impuesto, p.precio_unitario as precio_lista
    FROM crm.cotizacion_items ci
    LEFT JOIN crm.productos p ON p.codigo = ci.referencia
    WHERE ci.cotizacion_id = $1 ORDER BY ci.orden`, [cotizacionId]);
  const cliR = cot.cliente_id ? await client.query(`SELECT * FROM crm.clientes WHERE id = $1`, [cot.cliente_id]) : { rows: [] };
  const cliente = cliR.rows[0] || {};

  let sucFact = null, sucDesp = null;
  try {
    if (cot.facturar_a) {
      const s = await client.query(`SELECT codigo,nombre,direccion,ciudad FROM crm.sucursales WHERE cliente_id = $1 AND codigo = $2 LIMIT 1`, [cot.cliente_id, cot.facturar_a]);
      sucFact = s.rows[0] || { codigo: cot.facturar_a, nombre: cot.facturar_a };
    } else if (cot.cliente_id) {
      const s = await client.query(`SELECT codigo,nombre,direccion,ciudad FROM crm.sucursales WHERE cliente_id = $1 AND es_principal = TRUE LIMIT 1`, [cot.cliente_id]);
      if (s.rows[0]) sucFact = s.rows[0];
    }
    if (cot.despachar_a) {
      const s = await client.query(`SELECT codigo,nombre,direccion,ciudad FROM crm.sucursales WHERE cliente_id = $1 AND codigo = $2 LIMIT 1`, [cot.cliente_id, cot.despachar_a]);
      sucDesp = s.rows[0] || { codigo: cot.despachar_a, nombre: cot.despachar_a };
    } else if (cot.cliente_id && sucFact) {
      sucDesp = sucFact;
    }
  } catch {}
  // Vendedor Hub (mapping del usuario creador) → fallback a cliente.vendedor_codigo
  let vendedorHub = null;
  try {
    if (cot.creado_por) {
      const vm = await client.query(`SELECT codigo_vendedor FROM crm.usuario_perfil_venta WHERE usuario_id = $1 AND codigo_vendedor IS NOT NULL LIMIT 1`, [cot.creado_por]);
      if (vm.rows[0]?.codigo_vendedor) {
        const v = await client.query(`SELECT codigo,nombre FROM crm.vendedores WHERE codigo = $1`, [vm.rows[0].codigo_vendedor]);
        vendedorHub = v.rows[0] || { codigo: vm.rows[0].codigo_vendedor, nombre: vm.rows[0].codigo_vendedor };
      }
    }
    if (!vendedorHub && cliente?.vendedor_codigo) {
      const v = await client.query(`SELECT codigo,nombre FROM crm.vendedores WHERE codigo = $1`, [cliente.vendedor_codigo]);
      vendedorHub = v.rows[0] || { codigo: cliente.vendedor_codigo, nombre: cliente.asesor_comercial || cliente.vendedor_codigo };
    }
  } catch {}

  const payload = buildHubPayload({ cotizacion: cot, items: itemsR.rows, cliente, sucursalFacturar: sucFact, sucursalDespachar: sucDesp, vendedorHub });
  const payload_siesa = await toSiesaPayload(payload);

  if (cfg.mock_enabled || !cfg.base_url) {
    // Mock: genera CPV-MOCK y guarda envío (guarda ambos payloads para debug dual)
    const mockCpv = `CPV-MOCK-${String(cotIdPadded(cot.numero)).padStart(6,'0')}-${Date.now().toString().slice(-4)}`;
    const respuesta = { ok: true, documento_erp: mockCpv, estado_erp: 'confirmado', mock: true, payload_preview: payload, payload_siesa };
    await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, documento_erp, intentos) VALUES ($1,$2,$3,$4,'mock',$5,1)`, [cotizacionId, cot.numero, JSON.stringify({ payload_crm: payload, payload_siesa }), JSON.stringify(respuesta), mockCpv]);
    await client.query(`UPDATE crm.cotizaciones SET documento_erp = $1, estado_erp = 'confirmado', estado = CASE WHEN estado='borrador' THEN 'enviada' ELSE estado END, actualizado_en = NOW() WHERE id = $2`, [mockCpv, cotizacionId]);
    return { documento_erp: mockCpv, estado_erp: 'confirmado', mock: true, payload, payload_siesa, respuesta };
  }

  // Real (cuando haya credenciales): POST al Hub en formato SIESA f350/f351
  const token = await obtenerTokenHub(cfg);
  const resp = await fetch(`${cfg.base_url.replace(/\/$/,'')}/api/pedidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload_siesa),
  });
  const body = await resp.json().catch(()=> ({}));
  if (!resp.ok) {
    const err = body.error || body.message || `Hub error ${resp.status}`;
    await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, ultimo_error, intentos) VALUES ($1,$2,$3,$4,'error',$5,1)`, [cotizacionId, cot.numero, JSON.stringify({ payload_crm: payload, payload_siesa }), JSON.stringify(body), String(err).slice(0,1000)]);
    throw new Error(err);
  }
  const documento_erp = body.documento_erp || body.cpv || body.numero || null;
  await client.query(`INSERT INTO crm.hub_envios (cotizacion_id, numero, payload, respuesta, estado, documento_erp, intentos) VALUES ($1,$2,$3,$4,'enviado',$5,1)`, [cotizacionId, cot.numero, JSON.stringify({ payload_crm: payload, payload_siesa }), JSON.stringify(body), documento_erp]);
  if (documento_erp) await client.query(`UPDATE crm.cotizaciones SET documento_erp = $1, estado_erp = 'enviado', actualizado_en = NOW() WHERE id = $2`, [documento_erp, cotizacionId]);
  return { documento_erp, estado_erp: 'enviado', mock: false, payload, payload_siesa, respuesta: body };
}

function cotIdPadded(numero) {
  const m = String(numero).match(/(\d+)/);
  return m ? m[1] : String(Date.now()).slice(-6);
}

export async function getHubEnvios(cotizacionId) {
  const r = await pool.query(`SELECT * FROM crm.hub_envios WHERE cotizacion_id = $1 ORDER BY creado_en DESC`, [cotizacionId]);
  return r.rows;
}
