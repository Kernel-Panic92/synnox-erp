import pool from '../modules/crm/backend/config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHubPayload, toSiesaPayload } from '../modules/crm/backend/utils/hubClient.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Uso: node scripts/genera_cotizaciones.js [n]
// Flujo fiel al POST /cotizaciones + validaciones de perfil de ventas:
//  - creado_por con permiso crear_cotizacion (si no, se omite la oportunidad)
//  - centro/bodega/lista/motivo validados contra config del perfil
//    (isMaestroPermitido: vacío = sin restricción, si no debe estar en lista)
//  - precio desde lista_precios (fallback base, como GET /productos/buscar)
//  - bodega con stock del item cuando existe (el POST no bloquea sin stock)
//  - totales como recalcularTotales (IVA 19 por defecto)
// Exporta payload dual + pre-check de enviar-erp (422) a scripts/payloads/.
function permitido(config, key, valor) {
  if (!config || valor == null || valor === '') return true;
  const lista = config[key];
  if (!Array.isArray(lista) || !lista.length) return true;
  return lista.map(String).includes(String(valor));
}

async function generarNumero(client) {
  const cfg = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'numero_cotizacion_prefijo'`);
  const con = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'numero_cotizacion_consecutivo'`);
  const prefijo = cfg.rows[0]?.valor || 'COT';
  let num = parseInt(con.rows[0]?.valor || '1');
  const maxConsec = await client.query(`SELECT MAX(consecutive_siesa::int) AS m FROM crm.cotizaciones WHERE consecutive_siesa ~ '^[0-9]+$'`);
  const maxNum = await client.query(`SELECT MAX((regexp_match(numero, '-(\\d+)$'))[1]::int) AS m FROM crm.cotizaciones WHERE numero ~ '^${prefijo}-\\d+$'`);
  const maxExist = Math.max(parseInt(maxConsec.rows[0]?.m || '0'), parseInt(maxNum.rows[0]?.m || '0'), 0);
  if (maxExist >= num) num = maxExist + 1;
  const numero = `${prefijo}-${String(num).padStart(5, '0')}`;
  await client.query(`UPDATE crm.configuracion SET valor = $1, actualizado_en = NOW() WHERE clave = 'numero_cotizacion_consecutivo'`, [String(num + 1)]);
  return numero;
}

async function recalcularTotales(client, cotizacionId) {
  const items = await client.query(`SELECT * FROM crm.cotizacion_items WHERE cotizacion_id = $1`, [cotizacionId]);
  let subtotal = 0;
  for (const item of items.rows) {
    const base = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
    const desc = base * (parseFloat(item.descuento_pct || 0) / 100);
    subtotal += base - desc;
    await client.query(`UPDATE crm.cotizacion_items SET subtotal = $1 WHERE id = $2`, [base - desc, item.id]);
  }
  const cfg = await client.query(`SELECT valor FROM crm.configuracion WHERE clave = 'iva_porcentaje'`);
  const ivaPct = parseFloat(cfg.rows[0]?.valor || '19');
  const iva = subtotal * (ivaPct / 100);
  const total = subtotal + iva;
  await client.query(`UPDATE crm.cotizaciones SET valor_subtotal=$1, valor_iva=$2, valor_total=$3, actualizado_en=NOW() WHERE id=$4`, [subtotal, iva, total, cotizacionId]);
  return { subtotal, iva, total };
}

async function main() {
  const n = parseInt(process.argv[2] || '4');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const opps = (await client.query(`
      SELECT o.*, c.nombre AS cliente_nombre, c.medio_pago_desc,
             c.lista_precio_codigo, c.lista_precios
      FROM crm.oportunidades o JOIN crm.clientes c ON c.id = o.cliente_id
      WHERE o.nombre LIKE 'OPORT-%' AND o.etapa IN ('propuesta','negociacion') AND c.activo = TRUE
      ORDER BY random() LIMIT $1`, [n * 3])).rows;
    const outDir = path.join(__dirname, 'payloads');
    fs.mkdirSync(outDir, { recursive: true });
    let creadas = 0;
    for (const o of opps) {
      if (creadas >= n) break;
      // 1. Permiso crear_cotizacion (requireVentasPerfil)
      const perm = await client.query(
        `SELECT 1 FROM crm.usuario_perfil_venta up JOIN crm.perfil_venta_permisos pvp ON pvp.perfil_id = up.perfil_venta_id
         WHERE up.usuario_id = $1 AND pvp.permiso = 'crear_cotizacion' LIMIT 1`, [o.vendedor_id]);
      if (!perm.rowCount) { console.log(`× ${o.nombre}: vendedor ${o.vendedor_id} sin permiso crear_cotizacion (403 real)`); continue; }
      // 2. Config del perfil
      const cfgR = await client.query(
        `SELECT pv.config FROM crm.perfiles_venta pv JOIN crm.usuario_perfil_venta up ON up.perfil_venta_id = pv.id
         WHERE up.usuario_id = $1 ORDER BY pv.id LIMIT 1`, [o.vendedor_id]);
      const cfg = cfgR.rows[0]?.config || null;
      // 3. Sucursal principal del cliente
      const suc = (await client.query(
        `SELECT codigo,nombre FROM crm.sucursales WHERE cliente_id=$1 ORDER BY es_principal DESC NULLS LAST, codigo LIMIT 1`, [o.cliente_id])).rows[0];
      if (!suc) { console.log(`× ${o.nombre}: cliente sin sucursales`); continue; }
      // 4. Centro: primero permitido con mapeo (100/200/300)
      const centros = ['100', '200', '300'].filter(c => permitido(cfg, 'centro_operacion', c));
      if (!centros.length) { console.log(`× ${o.nombre}: perfil sin centros permitidos`); continue; }
      const centro = centros[0];
      // 5. Items de la oportunidad + precio de lista
      const oppItems = (await client.query(`
        SELECT op.cantidad, p.codigo, p.nombre, p.unidad_medida, p.precio_unitario AS base
        FROM crm.oportunidad_productos op JOIN crm.productos p ON p.id = op.producto_id
        WHERE op.oportunidad_id = $1`, [o.id])).rows;
      if (!oppItems.length) { console.log(`× ${o.nombre}: sin productos`); continue; }
      const listaCli = o.lista_precio_codigo || o.lista_precios || '200';
      const lista = permitido(cfg, 'listas_precio', listaCli) ? listaCli : '200';
      if (!permitido(cfg, 'listas_precio', lista)) { console.log(`× ${o.nombre}: lista ${lista} no permitida`); continue; }
      const items = [];
      for (const it of oppItems) {
        const lp = (await client.query(
          `SELECT lpi.precio FROM crm.lista_precio_items lpi JOIN crm.listas_precio lp ON lp.id=lpi.lista_id
           JOIN crm.productos p ON p.id=lpi.producto_id WHERE (lp.codigo=$1 OR lp.nombre=$1) AND p.codigo=$2 LIMIT 1`,
          [lista, it.codigo])).rows[0];
        // Parámetro acordado: solo precio de lista real (sin fallback a base/0)
        if (!lp) continue;
        items.push({ ...it, precio: parseFloat(lp.precio), precio_lista: true });
      }
      if (!items.length) { console.log(`× ${o.nombre}: ningún item con precio en lista ${lista}`); continue; }
      // Parámetro acordado: bodega vacía + fallback por CO (única ruta enviable
      // hoy: las bodegas de 5 dígitos no tienen mapeo bodega_co → 422).
      // El POST y el perfil permiten bodega vacía; enviar-erp usa el CO.
      const bodega = '';
      // 7. Condición de pago mapeada + motivo permitido
      let condPago = (o.medio_pago_desc || '').trim();
      if (condPago) {
        const m = await client.query(`SELECT 1 FROM crm.siesa_mapeos WHERE tipo='condicion_pago' AND (crm_codigo=$1 OR descripcion=$1)`, [condPago]);
        if (!m.rowCount) condPago = '';
      }
      if (!condPago) condPago = 'EFECTIVO';
      const motivo = permitido(cfg, 'motivo_venta', 'VENTAS') ? 'VENTAS' : null;
      if (!motivo) { console.log(`× ${o.nombre}: motivo VENTAS no permitido`); continue; }
      // 8. Vendedor Hub (mapa usuario, fallback cliente)
      const cliFull = (await client.query(`SELECT * FROM crm.clientes WHERE id=$1`, [o.cliente_id])).rows[0];
      let vendedorHub = null;
      const vm = (await client.query(`SELECT codigo_vendedor FROM crm.usuario_perfil_venta WHERE usuario_id=$1 AND codigo_vendedor IS NOT NULL LIMIT 1`, [o.vendedor_id])).rows[0];
      if (vm?.codigo_vendedor) {
        const v = (await client.query(`SELECT codigo,nombre FROM crm.vendedores WHERE codigo=$1`, [vm.codigo_vendedor])).rows[0];
        vendedorHub = v || { codigo: vm.codigo_vendedor, nombre: vm.codigo_vendedor };
      }
      if (!vendedorHub && cliFull.vendedor_codigo) {
        const v = (await client.query(`SELECT codigo,nombre FROM crm.vendedores WHERE codigo=$1`, [cliFull.vendedor_codigo])).rows[0];
        vendedorHub = v || { codigo: cliFull.vendedor_codigo, nombre: cliFull.asesor_comercial || cliFull.vendedor_codigo };
      }
      // 9. Insert (réplica POST /)
      const numero = await generarNumero(client);
      const venc = new Date(); venc.setDate(venc.getDate() + 30);
      const entrega = new Date(); entrega.setDate(entrega.getDate() + 15);
      const vendedorNombre = (cliFull.asesor_comercial || '').trim() || (cliFull.vendedor_codigo ? `Vendedor ${cliFull.vendedor_codigo}` : 'Sintética');
      const cot = (await client.query(`
        INSERT INTO crm.cotizaciones (numero, cliente_id, oportunidad_id, validez_dias, vencimiento, notas, creado_por,
          centro_operacion, bodega, condicion_pago, fecha_entrega, motivo, vendedor_nombre,
          facturar_a, despachar_a, lista_precios, estado)
        VALUES ($1,$2,$3,30,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,'borrador')
        RETURNING *`,
        [numero, o.cliente_id, o.id, venc.toISOString().slice(0, 10), `Sintética de ${o.nombre}`,
         o.vendedor_id, centro, bodega, condPago, entrega.toISOString().slice(0, 10), motivo, vendedorNombre,
         suc.codigo, lista])).rows[0];
      let k = 0;
      for (const it of items) {
        await client.query(`
          INSERT INTO crm.cotizacion_items (cotizacion_id, descripcion, referencia, unidad_medida, cantidad, precio_unitario, descuento_pct, orden)
          VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
          [cot.id, it.nombre, it.codigo, it.unidad_medida || 'UND', it.cantidad, it.precio, k++]);
      }
      const totales = await recalcularTotales(client, cot.id);
      // 10. Preview dual + pre-check enviar-erp (422)
      const itemsR = (await client.query(`SELECT * FROM crm.cotizacion_items WHERE cotizacion_id=$1 ORDER BY orden`, [cot.id])).rows;
      const payload_crm = buildHubPayload({ cotizacion: cot, items: itemsR, cliente: cliFull, sucursalFacturar: suc, sucursalDespachar: suc, vendedorHub });
      const payload_siesa = await toSiesaPayload(payload_crm);
      const missing = [];
      if (!payload_siesa.Encabezado.f430_id_vendedor) missing.push('f430_id_vendedor');
      if (!payload_siesa.Encabezado.f430_id_cond_pago) missing.push('f430_id_cond_pago');
      if (!payload_siesa.Encabezado.f350_id_co) missing.push('f350_id_co');
      const envio422 = [];
      if (bodega) {
        const mb = await client.query(`SELECT 1 FROM crm.siesa_mapeos WHERE tipo='bodega_co' AND crm_codigo=$1`, [bodega]);
        if (!mb.rowCount) envio422.push(`bodega '${bodega}' sin mapeo (enviar-erp daría 422)`);
      }
      // (bodega vacía → fallback por CO, solo warning, no bloquea — igual que la ruta real)
      const file = path.join(outDir, `${numero}.payload.json`);
      fs.writeFileSync(file, JSON.stringify({
        numero, cotizacion_id: cot.id, oportunidad: o.nombre, perfil_ok: true,
        precio_lista: true, bodega_co_fallback: true,
        payload_crm, payload_siesa, warnings: payload_siesa._meta?.warnings || [], missing, envio422,
      }, null, 2));
      creadas++;
      console.log(`+ ${numero} (de ${o.nombre}) CO:${centro} BOD:(vacía→CO) CP:${condPago} lista:${lista} items:${itemsR.length} total:${Math.round(totales.total)} missing:[${missing.join(',') || 'ninguno'}] envio422:[${envio422.join(';') || 'ok'}]`);
    }
    await client.query('COMMIT');
    console.log(`Creadas ${creadas} cotizaciones sintéticas fieles + payloads en scripts/payloads/`);
    process.exit(0);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); process.exit(1); }
}
main();
