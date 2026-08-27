import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Normalizar headers ──
function normalizeHeader(h) {
  return h.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ── Mapeo flexible de columnas ──
function findCol(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
    // Buscar por inclusión (para columnas que pueden tener prefijos)
    for (const key of Object.keys(row)) {
      if (key.includes(c) && row[key] !== '') return row[key];
    }
  }
  return '';
}

// ── Parsear archivo (CSV o XLSX) ──
function parseFile(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'csv' || ext === 'txt') {
    // Detectar encoding: intentar latin-1 que es el estándar de Siesa
    let text;
    try {
      text = buffer.toString('utf-8');
      // Si hay caracteres de reemplazo o bytes inválidos, usar latin-1
      if (text.includes('\ufffd') || /[\x80-\x9f]/.test(buffer.toString('latin1'))) {
        text = buffer.toString('latin1');
      }
    } catch { text = buffer.toString('latin1'); }
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    return records.map(r => {
      const norm = {};
      for (const [k, v] of Object.entries(r)) norm[normalizeHeader(k)] = v;
      return norm;
    });
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return data.map(r => {
      const norm = {};
      for (const [k, v] of Object.entries(r)) norm[normalizeHeader(k)] = v;
      return norm;
    });
  }
  throw new Error('Formato no soportado. Use CSV o XLSX.');
}

// ── Parsers por tipo ──

const REQUIRED_COLUMNS = {
  clientes: [['codigo', 'c_digo', 'rut'], ['razon_social', 'raz_n_social']],
  contactos: [['nombre_completo', 'nombre'], ['correo_electronico', 'email']],
  leads: [['razon_social', 'raz_n_social'], ['numero_de_identificacion', 'numero_de_identificaci_n']],
  cotizaciones: [['nombre'], ['consecutivo_interno']],
  items: [['referencia'], ['item'], ['descripcion', 'desc_item', 'desc__item']],
  inventario: [['codigo', 'c_digo'], ['referencia'], ['bodega']],
  codigos_barra: [['codigo', 'c_digo'], ['referencia']]
};

function validateColumns(rows, tipo) {
  const requiredGroups = REQUIRED_COLUMNS[tipo];
  if (!requiredGroups || !rows.length) return null;
  const fileCols = Object.keys(rows[0]);
  // For each group of alternatives, at least one must match
  for (const group of requiredGroups) {
    const hasMatch = group.some(r => fileCols.some(c => c.includes(r) || r.includes(c)));
    if (!hasMatch) {
      return `El archivo no parece ser del tipo "${tipo}". Columnas: ${fileCols.slice(0, 6).join(', ')}... Se esperaba: ${requiredGroups.map(g => g.join('/')).join(', ')}`;
    }
  }
  return null;
}

async function importarClientes(rows, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0, sucursalesCreadas = 0, contactosCreados = 0, listasCreadas = 0;
  const errores = [];
  const listasPrecios = new Map(); // nombre -> Set de clientes

  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const codigo = (r.codigo || r.rut || '').trim();
      const nombre = (r.razon_social_sucursal || r.razon_social || r.nombre || '').trim();
      if (!codigo && !nombre) { fallidos++; errores.push(`Fila ${i+1}: sin código ni nombre`); continue; }

      let clienteId;
      const existing = await pool.query(`SELECT id FROM crm.clientes WHERE codigo_siesa = $1`, [codigo]);
      if (existing.rows.length) {
        clienteId = existing.rows[0].id;
        await pool.query(`UPDATE crm.clientes SET
          nombre = COALESCE(NULLIF($1,''), nombre),
          nit = COALESCE(NULLIF($2,''), nit),
          canal = COALESCE(NULLIF($3,''), canal),
          direccion = COALESCE(NULLIF($4,''), direccion),
          ciudad = COALESCE(NULLIF($5,''), ciudad),
          tipo_negocio = COALESCE(NULLIF($6,''), tipo_negocio),
          email = COALESCE(NULLIF($7,''), email),
          activo = TRUE,
          actualizado_en = NOW()
          WHERE codigo_siesa = $8`,
          [nombre, codigo, r.canal || '', r.direccion_1 || r.direccion || '', r.ciudad || '', r.tipo_negocio || '', r.email || '', codigo]);
        actualizados++;
      } else {
        const tipoTercero = (r.tipo_tercero || '').toLowerCase().includes('natural') ? 'potencial' : 'real';
        const ins = await pool.query(`INSERT INTO crm.clientes (codigo_siesa, nit, nombre, canal, activo, direccion, ciudad, tipo_negocio, email, tipo, ruta_vehiculos, ruta_motos, sector, departamento, cobrador, correo_fe, asesor_comercial, lista_precios, codigo_ean, sucursal_corporativa, razon_social)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [codigo, codigo, nombre, r.canal || '', r.estado === 'Activo', r.direccion_1 || r.direccion || '', r.ciudad || '',
           r.tipo_negocio || '', r.email || '', tipoTercero, r.rutas_vehiculos || '', r.rutas_motos || '', r.region || '',
           r.depto_estado || r.deptoestado || '', r.cobrador || '', r.correo_f_e || r.correo_fe || '', r.asesor_comercial || '',
           r.desc__lista_de_precio || r.desc_lista_de_precio || '', r.codigo_ean || '', r.sucursal_corporativa || '', r.razon_social || '']);
        clienteId = ins.rows[0].id;
        insertados++;
      }

      // Crear contacto con celular
      const email = (r.email || '').trim();
      const celular = (r.celular || '').trim();
      const nombreContacto = (r.nombre_establecimiento || nombre).split('/')[0].trim();
      if ((email || celular) && clienteId) {
        const contactExist = await pool.query(`SELECT id FROM crm.contactos WHERE cliente_id = $1 AND (email = $2 OR whatsapp = $3)`, [clienteId, email, celular]);
        if (!contactExist.rows.length) {
          await pool.query(`INSERT INTO crm.contactos (cliente_id, nombre, email, telefono, whatsapp, es_decision_maker)
            VALUES ($1,$2,$3,$4,$5,TRUE)`, [clienteId, nombreContacto, email || null, celular || null, celular || null]);
          contactosCreados++;
        }
      }

      // Crear sucursal
      const sucursalCodigo = (r.sucursal || '').trim();
      if (sucursalCodigo && clienteId) {
        const sucExist = await pool.query(`SELECT id FROM crm.sucursales WHERE cliente_id = $1 AND codigo = $2 AND activa = TRUE`, [clienteId, sucursalCodigo]);
        if (!sucExist.rows.length) {
          const esPrincipal = sucursalCodigo === '001';
          if (esPrincipal) {
            await pool.query(`UPDATE crm.sucursales SET es_principal = FALSE WHERE cliente_id = $1`, [clienteId]);
          }
          await pool.query(`INSERT INTO crm.sucursales (cliente_id, codigo, nombre, direccion, ciudad, departamento, es_principal)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [clienteId, sucursalCodigo, `${nombre}/${sucursalCodigo}`, r.direccion_1 || r.direccion || '', r.ciudad || '', r.depto_estado || r.deptoestado || '', esPrincipal]);
          sucursalesCreadas++;
        } else if (sucursalCodigo === '001') {
          await pool.query(`UPDATE crm.sucursales SET es_principal = TRUE WHERE id = $1`, [sucExist.rows[0].id]);
          await pool.query(`UPDATE crm.sucursales SET es_principal = FALSE WHERE cliente_id = $1 AND id != $2`, [clienteId, sucExist.rows[0].id]);
        }
      }

      // Recopilar listas de precio
      const listaPrecio = (r.desc__lista_de_precio || r.desc_lista_de_precio || '').trim();
      if (listaPrecio && clienteId) {
        if (!listasPrecios.has(listaPrecio)) listasPrecios.set(listaPrecio, new Set());
        listasPrecios.get(listaPrecio).add(clienteId);
      }

      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);

  // Crear listas de precio
  for (const [nombre, clientes] of listasPrecios) {
    try {
      const existing = await pool.query(`SELECT id FROM crm.listas_precio WHERE nombre = $1`, [nombre]);
      let listaId;
      if (!existing.rows.length) {
        const ins = await pool.query(`INSERT INTO crm.listas_precio (codigo, nombre) VALUES ($1, $2) RETURNING id`, [nombre.substring(0, 30).replace(/\s+/g, '_'), nombre]);
        listaId = ins.rows[0].id;
        listasCreadas++;
      } else {
        listaId = existing.rows[0].id;
      }
    } catch {}
  }

  // Fix: sucursal 001 como principal
  try {
    await pool.query(`UPDATE crm.sucursales s SET es_principal = TRUE WHERE s.codigo = '001' AND s.activa = TRUE AND EXISTS (SELECT 1 FROM crm.sucursales s2 WHERE s2.cliente_id = s.cliente_id AND s2.codigo = '001' AND s2.activa = TRUE)`);
    await pool.query(`UPDATE crm.sucursales s SET es_principal = FALSE WHERE s.codigo != '001' AND s.activa = TRUE AND EXISTS (SELECT 1 FROM crm.sucursales s2 WHERE s2.cliente_id = s.cliente_id AND s2.codigo = '001' AND s2.activa = TRUE)`);
  } catch {}

  return { insertados, actualizados, fallidos, total: rows.length, sucursales: sucursalesCreadas, contactos: contactosCreados, listas: listasCreadas, errores: errores.slice(0, 50) };
}

async function importarContactos(rows) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const nombre = (r.nombre_completo || [r.nombres, r.apellidos].filter(Boolean).join(' ')).trim();
      const email = (r.correo_electronico || r.email || '').trim();
      if (!nombre) { fallidos++; errores.push(`Fila ${i+1}: sin nombre`); continue; }

      // Buscar cliente vinculado
      let clienteId = null;
      const clienteNombre = (r.cliente || r.compania || '').trim();
      if (clienteNombre) {
        const cl = await pool.query(`SELECT id FROM crm.clientes WHERE nombre ILIKE $1 LIMIT 1`, [`%${clienteNombre}%`]);
        if (cl.rows.length) clienteId = cl.rows[0].id;
      }

      const existing = email ? await pool.query(`SELECT id FROM crm.contactos WHERE email = $1`, [email]) : { rows: [] };
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.contactos SET
          nombre = COALESCE(NULLIF($1,''), nombre),
          cargo = COALESCE(NULLIF($2,''), cargo),
          telefono = COALESCE(NULLIF($3,''), telefono),
          whatsapp = COALESCE(NULLIF($4,''), whatsapp),
          es_decision_maker = COALESCE(NULLIF($5,'')::boolean, es_decision_maker)
          WHERE email = $6`,
          [nombre, r.cargo || '', r.telefono_oficina || r.telefono || '', r.telefono_celular || '',
           (r.rol_en_la_compra || '').toLowerCase().includes('decisor') ? true : null, email]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.contactos (cliente_id, nombre, cargo, email, telefono, whatsapp, es_decision_maker)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [clienteId, nombre, r.cargo || '', email || null, r.telefono_oficina || r.telefono || '',
           r.telefono_celular || '', (r.rol_en_la_compra || '').toLowerCase().includes('decisor')]);
        insertados++;
      }
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarLeads(rows) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const razon = (r.razon_social || r.nombre_del_cliente || '').trim();
      const ident = (r.numero_de_identificacion || '').trim();
      if (!razon && !ident) { fallidos++; errores.push(`Fila ${i+1}: sin razón social ni identificación`); continue; }

      const existing = ident ? await pool.query(`SELECT id FROM crm.leads WHERE numero_identificacion = $1`, [ident]) : { rows: [] };
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.leads SET
          raison_social = COALESCE(NULLIF($1,''), raison_social),
          asesor_comercial = COALESCE(NULLIF($2,''), asesor_comercial),
          direccion = COALESCE(NULLIF($3,''), direccion),
          ciudad = COALESCE(NULLIF($4,''), ciudad),
          email = COALESCE(NULLIF($5,''), email),
          telefono = COALESCE(NULLIF($6,''), telefono),
          canal = COALESCE(NULLIF($7,''), canal),
          segmento = COALESCE(NULLIF($8,''), segmento),
          tipo_negocio = COALESCE(NULLIF($9,''), tipo_negocio),
          estado = COALESCE(NULLIF($10,''), estado),
          lista_precios = COALESCE(NULLIF($11,''), lista_precios),
          condicion_pago = COALESCE(NULLIF($12,''), condicion_pago),
          actualizado_en = NOW()
          WHERE numero_identificacion = $13`,
          [razon, r.asesor_comercial || '', r.direccion || '', r.ciudad || '',
           r.correo_electronico || r.correo_electronico_rut || '', r.telefono || r.numero_celular || '',
           r.canal_o_medio_de_ingreso || r.canal || '', r.segmento || '', r.tipo_de_negocio || r.tipo_negocio || '',
           r.estado || '', r.lista_de_precios || r.lista_precios || '', r.condicion_de_pago || '', ident]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.leads (raison_social, numero_identificacion, tipo_identificacion, asesor_comercial,
          nombre_establecimiento, direccion, ciudad, departamento, email, telefono, canal, segmento, tipo_negocio,
          tipo_cliente, lista_precios, condicion_pago, estado, notas, siesa_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [razon, ident || null, r.tipo_identificacion || '', r.asesor_comercial || '',
           r.nombre_de_establecimiento || '', r.direccion || '', r.ciudad || '', r.departamento || '',
           r.correo_electronico || r.correo_electronico_rut || '', r.telefono || r.numero_celular || '',
           r.canal_o_medio_de_ingreso || r.canal || '', r.segmento || '', r.tipo_de_negocio || r.tipo_negocio || '',
           r.tipo_de_cliente || r.tipo_cliente || '', r.lista_de_precios || r.lista_precios || '',
           r.condicion_de_pago || '', r.estado || '', r.observaciones || r.otros || '', r.id || null]);
        insertados++;
      }
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarCotizaciones(rows) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const nombre = (r.nombre || '').trim();
      const consecutivo = (r.consecutivo_interno || '').trim();
      if (!nombre && !consecutivo) { fallidos++; errores.push(`Fila ${i+1}: sin nombre ni consecutivo`); continue; }

      // Buscar cliente
      let clienteId = null;
      const clienteNombre = (r.facturar_a || r.despachar_a || '').trim();
      if (clienteNombre) {
        const cl = await pool.query(`SELECT id FROM crm.clientes WHERE nombre ILIKE $1 LIMIT 1`, [`%${clienteNombre}%`]);
        if (cl.rows.length) clienteId = cl.rows[0].id;
      }

      const numero = nombre || `COT-${consecutivo}`;
      const existing = await pool.query(`SELECT id FROM crm.cotizaciones WHERE numero = $1 OR consecutive_siesa = $2`, [numero, consecutivo || '']);

      const estadoCrm = (r.estado_crm || 'borrador').toLowerCase().replace(/\s+/g, '_');
      const estadoMap = { aprobada: 'aprobada', borrador: 'borrador', enviada: 'enviada', rechazada: 'rechazada' };
      const estado = estadoMap[estadoCrm] || 'borrador';

      if (existing.rows.length) {
        await pool.query(`UPDATE crm.cotizaciones SET
          cliente_id = COALESCE($1, cliente_id),
          valor_total = COALESCE($2, valor_total),
          valor_subtotal = COALESCE($3, valor_subtotal),
          valor_bruto = COALESCE($4, valor_bruto),
          valor_iva = COALESCE($5, valor_iva),
          valor_descuento = COALESCE($6, valor_descuento),
          notas = COALESCE(NULLIF($7,''), notas),
          centro_operacion = COALESCE(NULLIF($8,''), centro_operacion),
          bodega = COALESCE(NULLIF($9,''), bodega),
          condicion_pago = COALESCE(NULLIF($10,''), condicion_pago),
          lista_precios = COALESCE(NULLIF($11,''), lista_precios),
          orden_compra = COALESCE(NULLIF($12,''), orden_compra),
          documento_erp = COALESCE(NULLIF($13,''), documento_erp),
          estado_erp = COALESCE(NULLIF($14,''), estado_erp),
          vendedor_nombre = COALESCE(NULLIF($15,''), vendedor_nombre),
          motivo = COALESCE(NULLIF($16,''), motivo),
          unidad_negocio = COALESCE(NULLIF($17,''), unidad_negocio),
          aprobado = COALESCE($18, aprobado),
          enviado_erp = COALESCE($19, enviado_erp),
          descuento_global_pct = COALESCE($20, descuento_global_pct),
          actualizado_en = NOW()
          WHERE id = $21`,
          [clienteId, r.valor_total || null, r.valor_subtotal || null, r.valor_bruto || null,
           r.impuestos || null, r.descuentos || null, r.notas_pedido || '',
           r.centro_de_operacion || '', r.bodega || '', r.condicion_de_pago || '',
           r.lista_precios || '', r.orden_de_compra || '', r.documento_erp || '',
           r.estado_erp || '', r.vendedor || '', r.motivo || '', r.unidad_de_negocio || '',
           r.aprobado === 'True' || r.aprobado === true, r.enviado_al_erp === 'True',
           r.descuento_global__ || null, existing.rows[0].id]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.cotizaciones (numero, cliente_id, estado, valor_total, valor_subtotal,
          valor_bruto, valor_iva, valor_descuento, notas, centro_operacion, bodega, condicion_pago,
          lista_precios, orden_compra, documento_erp, estado_erp, vendedor_nombre, motivo,
          unidad_negocio, aprobado, enviado_erp, consecutive_siesa, descuento_global_pct, creado_por)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, NULL)`,
          [numero, clienteId, estado, r.valor_total || 0, r.valor_subtotal || 0,
           r.valor_bruto || 0, r.impuestos || 0, r.descuentos || 0, r.notas_pedido || '',
           r.centro_de_operacion || '', r.bodega || '', r.condicion_de_pago || '',
           r.lista_precios || '', r.orden_de_compra || '', r.documento_erp || '',
           r.estado_erp || '', r.vendedor || '', r.motivo || '', r.unidad_de_negocio || '',
           r.aprobado === 'True' || r.aprobado === true, r.enviado_al_erp === 'True',
           consecutivo || null, r.descuento_global__ || 0]);
        insertados++;
      }
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarItems(rows) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const referencia = (r.referencia || r.item || '').trim();
      const nombre = (r.descripcion || r.desc_item || r.nombre || '').trim();
      if (!referencia && !nombre) { fallidos++; errores.push(`Fila ${i+1}: sin referencia ni nombre`); continue; }

      const precio = parseFloat(String(r.vr_unitario || r.precio || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      const tasa = parseFloat(String(r.tasa_impositiva_por_defecto || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      const estadoItem = (r.estado_item || r.estado || '').toLowerCase();
      const activo = !estadoItem.includes('inactivo');

      const existing = referencia ? await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [referencia]) : { rows: [] };
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.productos SET
          nombre = COALESCE(NULLIF($1,''), nombre),
          unidad_medida = COALESCE(NULLIF($2,''), unidad_medida),
          precio_unitario = COALESCE(NULLIF($3,0)::decimal, precio_unitario),
          tasa_impuesto = COALESCE(NULLIF($4,0)::decimal, tasa_impuesto),
          categoria = COALESCE(NULLIF($5,''), categoria),
          activo = $6,
          actualizado_en = NOW()
          WHERE codigo = $7`,
          [nombre, r.unidad_de_venta || r.unidad_de_inventario || r.um_venta || 'UND',
           precio, tasa, r.linea || r.sublinea || '', activo, referencia]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.productos (codigo, nombre, unidad_medida, precio_unitario, tasa_impuesto, categoria, activo)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [referencia, nombre, r.unidad_de_venta || r.unidad_de_inventario || r.um_venta || 'UND',
           precio, tasa, r.linea || r.sublinea || '', activo]);
        insertados++;
      }
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarInventario(rows, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const bodega = (r.bodega || '').trim();
      if (!bodega) { fallidos++; errores.push(`Fila ${i+1}: sin bodega`); continue; }

      // Buscar producto por codigo o referencia (con y sin ceros)
      const codigoRaw = String(r.codigo || '').trim();
      const referenciaRaw = String(r.referencia || '').trim();
      const codigoNum = codigoRaw.replace(/^0+/, '');

      let prod = null;
      // Intentar por codigo exacto
      if (codigoRaw) {
        const res1 = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [codigoRaw]);
        if (res1.rows.length) prod = res1.rows[0];
      }
      // Intentar por codigo sin ceros
      if (!prod && codigoNum && codigoNum !== codigoRaw) {
        const res2 = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [codigoNum]);
        if (res2.rows.length) prod = res2.rows[0];
      }
      // Intentar por referencia
      if (!prod && referenciaRaw) {
        const res3 = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [referenciaRaw]);
        if (res3.rows.length) prod = res3.rows[0];
      }

      if (!prod) { fallidos++; errores.push(`Fila ${i+1}: producto ${codigoRaw || referenciaRaw} no encontrado`); continue; }

      const precio = parseFloat(String(r.precio || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      const disponibilidad = parseFloat(String(r.disponibilidad || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      const existencia = parseFloat(String(r.existencia || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      const comprometida = parseFloat(String(r.comprometida || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

      const existing = await pool.query(`SELECT id FROM crm.inventario WHERE producto_id = $1 AND bodega = $2`, [prod.id, bodega]);
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.inventario SET precio=$1, disponibilidad=$2, existencia=$3, comprometida=$4,
          unidad_medida=$5, extension_1=$6, extension_1_desc=$7, extension_2=$8, extension_2_desc=$9, sincronizado_en=NOW()
          WHERE producto_id=$10 AND bodega=$11`,
          [precio, disponibilidad, existencia, comprometida,
           r.unidad_medida_inv || '', r.extension_1_id || null, r.extension_1_descripcion || null,
           r.extension_2_id || null, r.extension_2_descripcion || null, prod.id, bodega]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.inventario (producto_id, bodega, precio, disponibilidad, existencia, comprometida,
          unidad_medida, extension_1, extension_1_desc, extension_2, extension_2_desc)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [prod.id, bodega, precio, disponibilidad, existencia, comprometida,
           r.unidad_medida_inv || '', r.extension_1_id || null, r.extension_1_descripcion || null,
           r.extension_2_id || null, r.extension_2_descripcion || null]);
        insertados++;
      }
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarCodigosBarra(rows, onProgress) {
  let insertados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const gtin = String(r.codigo || r.c_digo || '').trim();
      const referencia = String(r.referencia || '').trim();
      const descripcion = (r.desc__item || r.desc_item || '').trim();
      const unidad = (r.u_m_ || r.unidad || '').trim();

      if (!gtin || !referencia) { fallidos++; errores.push(`Fila ${i+1}: sin EAN o referencia`); continue; }

      // Buscar producto por referencia (codigo)
      const prod = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [referencia]);
      if (!prod.rows.length) { fallidos++; errores.push(`Fila ${i+1}: producto ${referencia} no encontrado`); continue; }

      // Verificar si ya existe el EAN para este producto
      const existing = await pool.query(`SELECT id FROM crm.productos_ean WHERE producto_id = $1 AND gtin = $2`, [prod.rows[0].id, gtin]);
      if (existing.rows.length) continue; // skip duplicados

      await pool.query(`
        INSERT INTO crm.productos_ean (producto_id, gtin, descripcion, unidad_medida)
        VALUES ($1, $2, $3, $4)
      `, [prod.rows[0].id, gtin, descripcion || null, unidad || null]);
      insertados++;

      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return { insertados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

// ── Endpoint principal ──
const PARSERS = {
  clientes: importarClientes,
  contactos: importarContactos,
  leads: importarLeads,
  cotizaciones: importarCotizaciones,
  items: importarItems,
  inventario: importarInventario,
  codigos_barra: importarCodigosBarra
};

router.post('/', requirePermiso('crear_contacto', 'crm'), upload.single('archivo'), async (req, res) => {
  try {
    const { tipo } = req.body;
    if (!tipo || !PARSERS[tipo]) return res.status(400).json({ error: `Tipo inválido. Opciones: ${Object.keys(PARSERS).join(', ')}` });
    if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });

    const rows = parseFile(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

    const validationError = validateColumns(rows, tipo);
    if (validationError) return res.status(400).json({ error: validationError });

    console.log(`[CRM] Importando ${tipo}: ${rows.length} filas de ${req.file.originalname}`);

    // SSE streaming for progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const onProgress = (current, total) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', current, total })}\n\n`);
    };

    const resultado = await PARSERS[tipo](rows, onProgress);

    await auditarEvento({
      accion: 'importar',
      entidad: tipo,
      usuario_id: req.user.id,
      metadata: { ...resultado, archivo: req.file.originalname, tipo }
    });

    res.write(`data: ${JSON.stringify({ type: 'done', ok: true, ...resultado })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[CRM] Error importar:', err);
    res.status(500).json({ error: err.message || 'Error al importar' });
  }
});

// GET /api/importar/tipos — Listar tipos disponibles
router.get('/tipos', requirePermiso('crear_contacto', 'crm'), (req, res) => {
  res.json({
    ok: true,
    data: [
      { id: 'clientes', nombre: 'Clientes Siesa ERP', extensiones: 'csv', descripcion: 'Clientes del ERP con código, nombre, canal, dirección' },
      { id: 'contactos', nombre: 'Contactos CRM', extensiones: 'xlsx', descripcion: 'Contactos vinculados a clientes' },
      { id: 'leads', nombre: 'Leads CRM', extensiones: 'xlsx', descripcion: 'Clientes potenciales con asesor, segmento, lista de precios' },
      { id: 'cotizaciones', nombre: 'Cotizaciones CRM', extensiones: 'xlsx', descripcion: 'Cotizaciones con estados, bodega, centro de operación' },
      { id: 'items', nombre: 'Items / Productos', extensiones: 'xlsx,csv', descripcion: 'Productos con referencia, precio, impuesto, categoría' },
      { id: 'inventario', nombre: 'Inventario por Bodega', extensiones: 'xlsx', descripcion: 'Stock por bodega con precio, disponibilidad, existencia' },
      { id: 'codigos_barra', nombre: 'Códigos de Barras (EAN)', extensiones: 'csv', descripcion: 'Códigos GS1 vinculados a productos por referencia' }
    ]
  });
});

export default router;
