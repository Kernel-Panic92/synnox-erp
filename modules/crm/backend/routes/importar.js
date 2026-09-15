import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Parseo de precios en formato colombiano ($2.300, $2.300,50) ──
function parsePrecio(valor) {
  if (valor === null || valor === undefined) return 0;
  let s = String(valor).trim().replace(/[^0-9.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    // Formato CO: 1.234.567,89 -> quitar puntos, coma -> punto
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    // Sin coma: si todos los grupos son de 3 digitos, es separador de miles (2.300 -> 2300)
    const parts = s.split('.');
    if (parts.length > 1 && parts.every(p => /^\d+$/.test(p)) && parts.slice(1).every(p => p.length === 3)) {
      s = s.replace(/\./g, '');
    }
  }
  return parseFloat(s) || 0;
}

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
  if (ext === 'xml') {
    const text = buffer.toString('utf-8').includes('�') ? buffer.toString('latin1') : buffer.toString('utf-8');
    // Crystal Reports Motivos: extrae motivo, descmotivo, estado
    const rows = [];
    const groupRegex = /FieldName="\{Motivos_ttx\.motivo\}"[\s\S]*?<Value>(.*?)<\/Value>[\s\S]*?FieldName="\{Motivos_ttx\.descmotivo\}"[\s\S]*?<Value>(.*?)<\/Value>[\s\S]*?FieldName="\{@Estado\}"[\s\S]*?<Value>(.*?)<\/Value>/g;
    let m;
    while ((m = groupRegex.exec(text)) !== null) {
      rows.push({ motivo: m[1].trim(), descmotivo: m[2].trim(), estado: m[3].trim() });
    }
    return rows.map(r => {
      const norm = {};
      for (const [k, v] of Object.entries(r)) norm[normalizeHeader(k)] = v;
      return norm;
    });
  }
  throw new Error('Formato no soportado. Use CSV, XLSX o XML.');
}

// ── Parsers por tipo ──

const REQUIRED_COLUMNS = {
  clientes: [['codigo', 'c_digo', 'rut'], ['razon_social', 'raz_n_social']],
  terceros: [['codigo', 'c_digo'], ['razon_social', 'raz_n_social'], ['numero_de_identificacion', 'numero_identificacion']],
  contactos: [['nombre_completo', 'nombre'], ['correo_electronico', 'email']],
  leads: [['razon_social', 'raz_n_social'], ['numero_de_identificacion', 'numero_de_identificaci_n']],
  cotizaciones: [['nombre'], ['consecutivo_interno']],
  pedidos_erp: [['nro_documento'], ['c_o']],
  pedidos_items: [['nro_documento'], ['item_resumen']],
  items: [['referencia'], ['item'], ['descripcion', 'desc_item', 'desc__item']],
  inventario: [['codigo', 'c_digo', 'referencia'], ['referencia', 'bodega'], ['bodega']],
  codigos_barra: [['codigo', 'c_digo'], ['referencia']],
  bodegas: [['codigo', 'c_digo'], ['descripcion']],
  precios: [['referencia'], ['lista']],
  vendedores: [['codigo', 'c_digo'], ['nombre']]
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
      // Parse fecha_ingreso DD/MM/YYYY -> YYYY-MM-DD
      const fechaIngRaw = (r.fecha_ingreso || '').trim();
      let fechaIngreso = null;
      if (fechaIngRaw && fechaIngRaw.includes('/')) { const [d,m,y]=fechaIngRaw.split('/'); if(d&&m&&y) fechaIngreso = `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      const listaPrecioCodigo = (r.lista_de_precio || '').trim();
      const vendedorCodigo = (r.vendedor || '').trim();
      const esPrincipal = (r.sucursal || '').trim() === '001';
      const nombreTercero = (r.razon_social || r.razon_social_sucursal || r.nombre || '').trim();
      const nombreSucursal = (r.razon_social_sucursal || r.razon_social || nombreTercero).trim();
      const existing = await pool.query(`SELECT id FROM crm.clientes WHERE codigo_siesa = $1`, [codigo]);
      if (existing.rows.length) {
        clienteId = existing.rows[0].id;
        const nombreParaUpdate = esPrincipal ? nombreTercero : null;
        const extraData = JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k,v]) => v !== '' && v !== null && v !== undefined)));
        await pool.query(`UPDATE crm.clientes SET
          nombre = COALESCE(NULLIF($1,''), nombre),
          nit = COALESCE(NULLIF($2,''), nit),
          canal = COALESCE(NULLIF($3,''), canal),
          direccion = COALESCE(NULLIF($4,''), direccion),
          ciudad = COALESCE(NULLIF($5,''), ciudad),
          tipo_negocio = COALESCE(NULLIF($6,''), tipo_negocio),
          email = COALESCE(NULLIF($7,''), email),
          celular = COALESCE(NULLIF($8,''), celular),
          lista_precios = COALESCE(NULLIF($9,''), lista_precios),
          lista_precio_codigo = COALESCE(NULLIF($10,''), lista_precio_codigo),
          vendedor_codigo = COALESCE(NULLIF($11,''), vendedor_codigo),
          medio_pago = COALESCE(NULLIF($12,''), medio_pago),
          medio_pago_desc = COALESCE(NULLIF($13,''), medio_pago_desc),
          iva = COALESCE(NULLIF($14,''), iva),
          frecuencia_entrega = COALESCE(NULLIF($15,''), frecuencia_entrega),
          fecha_ingreso = COALESCE($16::date, fecha_ingreso),
          sucursal = COALESCE(NULLIF($17,''), sucursal),
          cartera_pendiente = COALESCE(NULLIF($18,''), cartera_pendiente),
          antiguedad = COALESCE(NULLIF($19,''), antiguedad),
          punto_envio_desc = COALESCE(NULLIF($20,''), punto_envio_desc),
          motivo_bloqueo_desc = COALESCE(NULLIF($21,''), motivo_bloqueo_desc),
          c_o_factura_desc = COALESCE(NULLIF($22,''), c_o_factura_desc),
          codigo_ean = CASE WHEN $23::boolean THEN COALESCE(NULLIF($24,''), codigo_ean) ELSE codigo_ean END,
          extra_data = COALESCE(extra_data,'{}'::jsonb) || $25::jsonb,
          activo = TRUE,
          actualizado_en = NOW()
          WHERE codigo_siesa = $26`,
          [nombreParaUpdate, codigo, r.canal || '', r.direccion_1 || r.direccion || '', r.ciudad || '', r.tipo_negocio || '', r.email || '',
           r.celular || '', r.desc__lista_de_precio || r.desc_lista_de_precio || '', listaPrecioCodigo, vendedorCodigo,
           r.medio_de_pago || r.medio_pago || '', r.desc__medio_de_pago || r.desc_medio_de_pago || '', r.iva || '', r.frecuencia_entrega || '',
           fechaIngreso, r.sucursal || '', r.cartera_pendiente || '', r.antiguedad || '', r.desc__punto_envio || r.desc_punto_envio || '',
           r.desc__motivo_bloqueo || r.desc_motivo_bloqueo || '', r.desc__c_o_factura || r.desc_c_o_factura || '',
           esPrincipal, r.codigo_ean || '', extraData, codigo]);
        actualizados++;
      } else {
        const tipoTercero = 'real';
        const extraDataIns = JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k,v]) => v !== '' && v !== null && v !== undefined)));
const ins = await pool.query(`INSERT INTO crm.clientes (codigo_siesa, nit, nombre, canal, activo, direccion, ciudad, tipo_negocio, email, tipo, ruta_vehiculos, ruta_motos, sector, departamento, cobrador, correo_fe, asesor_comercial, lista_precios, lista_precio_codigo, vendedor_codigo, medio_pago, medio_pago_desc, iva, frecuencia_entrega, fecha_ingreso, sucursal, cartera_pendiente, antiguedad, punto_envio_desc, motivo_bloqueo_desc, c_o_factura_desc, celular, codigo_ean, sucursal_corporativa, razon_social, extra_data, origen)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37) RETURNING id`,
          [codigo, codigo, nombreTercero, r.canal || '', r.estado === 'Activo', r.direccion_1 || r.direccion || '', r.ciudad || '',
           r.tipo_negocio || '', r.email || '', tipoTercero, r.rutas_vehiculos || '', r.rutas_motos || '', r.region || '',
           r.depto_estado || r.deptoestado || '', r.cobrador || '', r.correo_f_e || r.correo_fe || '', r.asesor_comercial || '',
           r.desc__lista_de_precio || r.desc_lista_de_precio || '', listaPrecioCodigo, vendedorCodigo,
           r.medio_de_pago || r.medio_pago || '', r.desc__medio_de_pago || r.desc_medio_de_pago || '', r.iva || '', r.frecuencia_entrega || '',
 fechaIngreso, r.sucursal || '', r.cartera_pendiente || '', r.antiguedad || '',
            r.desc__punto_envio || r.desc_punto_envio || '', r.desc__motivo_bloqueo || r.desc_motivo_bloqueo || '', r.desc__c_o_factura || r.desc_c_o_factura || '',
            r.celular || '', esPrincipal ? (r.codigo_ean || '') : null, r.sucursal_corporativa || '', r.razon_social || '', extraDataIns, 'siesa']);
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
          await pool.query(`INSERT INTO crm.sucursales (cliente_id, codigo, nombre, direccion, ciudad, departamento, es_principal, codigo_ean)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [clienteId, sucursalCodigo, `${nombre}/${sucursalCodigo}`, r.direccion_1 || r.direccion || '', r.ciudad || '', r.depto_estado || r.deptoestado || '', esPrincipal, r.codigo_ean || r.c_digo_ean || null]);
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

// ── Terceros (maestro SIESA: una fila por NIT, sin sucursales) ──
async function importarTerceros(rows, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      // Solo terceros marcados como Cliente=Si
      const esCliente = String(r.cliente || '').trim().toLowerCase();
      if (esCliente && esCliente !== 'si' && esCliente !== 's' && esCliente !== 'true') { continue; }

      const codigo = (r.codigo || r.c_digo || r.numero_de_identificacion || r.numero_identificacion || '').trim().replace(/-0$/, '');
      const razonSocial = (r.razon_social || r.raz_n_social || '').trim();
      const nombreEstablecimiento = (r.nombre_establecimiento || '').trim();
      const nombre = nombreEstablecimiento || razonSocial;
      if (!codigo || !razonSocial) { fallidos++; errores.push(`Fila ${i+1}: sin codigo o razon social`); continue; }

      const tipo = 'real';
      const activo = (r.estado || '').toLowerCase() !== 'inactivo';
      const extraData = JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k,v]) => v !== '' && v !== null && v !== undefined && k !== 'razon_social' && k !== 'raz_n_social')));

      const existing = await pool.query(`SELECT id FROM crm.clientes WHERE codigo_siesa = $1`, [codigo]);
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.clientes SET
          nombre = COALESCE(NULLIF($1,''), nombre),
          razon_social = COALESCE(NULLIF($2,''), razon_social),
          nit = COALESCE(NULLIF($3,''), nit),
          tipo = COALESCE($4, tipo),
          direccion = COALESCE(NULLIF($5,''), direccion),
          ciudad = COALESCE(NULLIF($6,''), ciudad),
          departamento = COALESCE(NULLIF($7,''), departamento),
          telefono = COALESCE(NULLIF($8,''), telefono),
          celular = COALESCE(NULLIF($9,''), celular),
          email = COALESCE(NULLIF($10,''), email),
          contacto = COALESCE(NULLIF($11,''), contacto),
          activo = $12,
          extra_data = COALESCE(extra_data,'{}'::jsonb) || $13::jsonb,
          actualizado_en = NOW()
          WHERE id = $14`,
          [nombre, razonSocial, codigo, tipo, r.direccion_1 || r.direccion || '', r.ciudad || '', r.depto_estado || r.departamento || '',
           r.telefono || '', r.celular || '', r.email || '', r.contacto || '', activo, extraData, existing.rows[0].id]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.clientes (codigo_siesa, nit, nombre, razon_social, tipo, direccion, ciudad, departamento, telefono, celular, email, contacto, activo, origen, extra_data)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'siesa',$14)`,
          [codigo, codigo, nombre, razonSocial, tipo, r.direccion_1 || r.direccion || '', r.ciudad || '', r.depto_estado || r.departamento || '',
           r.telefono || '', r.celular || '', r.email || '', r.contacto || '', activo, extraData]);
        insertados++;
      }
      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
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
  // Cachés para evitar queries repetidos
  const centroCache = new Map(); // nombre -> codigo
  const bodegaCache = new Map(); // nombre -> codigo
  const listaCache = new Map(); // nombre -> codigo

  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const nombre = (r.nombre || '').trim();
      const consecutivo = (r.consecutivo_interno || '').trim();
      if (!nombre && !consecutivo) { fallidos++; errores.push(`Fila ${i+1}: sin nombre ni consecutivo`); continue; }

      // Fechas: Fecha de creación -> vencimiento = +30 días; Fecha de Entrega -> fecha_entrega
      let vencimiento = null;
      let fechaEntrega = (r.fecha_de_entrega || '').trim();
      if (fechaEntrega && fechaEntrega.includes('/')) { const [d,m,y] = fechaEntrega.split('/'); if(d&&m&&y) fechaEntrega = `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      if (!fechaEntrega) fechaEntrega = null;
      if (!vencimiento && r.fecha_de_creacion) {
        let fc = String(r.fecha_de_creacion).trim().split(' ')[0];
        if (fc && fc.includes('/')) {
          const [d,m,y] = fc.split('/');
          if(d&&m&&y) { const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`); if(!isNaN(dt)) { dt.setDate(dt.getDate()+30); vencimiento = dt.toISOString().split('T')[0]; } }
        }
      }

      // Buscar cliente por nombre (quita sufijo de sucursal "/XXX")
      let clienteId = null;
      const clienteNombre = (r.facturar_a || r.despachar_a || '').trim();
      if (clienteNombre) {
        const base = clienteNombre.split('/')[0].trim();
        const cl = await pool.query(`SELECT id FROM crm.clientes WHERE nombre ILIKE $1 AND activo = TRUE LIMIT 1`, [`%${base}%`]);
        if (cl.rows.length) clienteId = cl.rows[0].id;
      }

      // Centro de operación: nombre -> codigo
      let centroCodigo = (r.centro_de_operacion || '').trim();
      if (centroCodigo && !centroCache.has(centroCodigo)) {
        const cc = await pool.query(`SELECT codigo FROM crm.centros_operacion WHERE nombre = $1 LIMIT 1`, [centroCodigo]);
        centroCache.set(centroCodigo, cc.rows.length ? cc.rows[0].codigo : centroCodigo);
      }
      if (centroCodigo) centroCodigo = centroCache.get(centroCodigo) || centroCodigo;

      // Bodega: nombre -> codigo
      let bodegaCodigo = (r.bodega || '').trim();
      if (bodegaCodigo && !bodegaCache.has(bodegaCodigo)) {
        const bc = await pool.query(`SELECT codigo FROM crm.bodegas WHERE nombre = $1 LIMIT 1`, [bodegaCodigo]);
        bodegaCache.set(bodegaCodigo, bc.rows.length ? bc.rows[0].codigo : bodegaCodigo);
      }
      if (bodegaCodigo) bodegaCodigo = bodegaCache.get(bodegaCodigo) || bodegaCodigo;

      // Lista de precios: nombre -> codigo
      let listaCodigo = (r.lista_precios || '').trim();
      if (listaCodigo && !listaCache.has(listaCodigo)) {
        const lc = await pool.query(`SELECT codigo FROM crm.listas_precio
          WHERE lower(regexp_replace(nombre, '[^a-z0-9]', '', 'gi')) = lower(regexp_replace($1, '[^a-z0-9]', '', 'gi'))
             OR codigo = $1
          ORDER BY codigo ~ '^[0-9]+$' DESC
          LIMIT 1`, [listaCodigo]);
        listaCache.set(listaCodigo, lc.rows.length ? lc.rows[0].codigo : listaCodigo);
      }
      if (listaCodigo) listaCodigo = listaCache.get(listaCodigo) || listaCodigo;

      const numero = nombre || `COT-${consecutivo}`;
      const existing = await pool.query(`SELECT id FROM crm.cotizaciones WHERE numero = $1 OR consecutive_siesa = $2`, [numero, consecutivo || '']);

      const estadoCrm = (r.estado_crm || 'borrador').toLowerCase().replace(/\s+/g, '_');
      const estadoMap = { aprobada: 'aprobada', borrador: 'borrador', enviada: 'enviada', rechazada: 'rechazada', cumplida: 'aprobada', cancelada: 'rechazada' };
      const estado = estadoMap[estadoCrm] || 'borrador';
      const vendedor = (r.propietario || r.vendedor || r.vendedor_nombre || '').trim();

      // Valores numéricos (vienen como número o string "196000.0")
      const valorTotal = parseFloat(r.valor_total) || 0;
      const valorSubtotal = parseFloat(r.valor_subtotal) || 0;
      const valorBruto = parseFloat(r.valor_bruto) || 0;
      const impuestos = parseFloat(r.impuestos) || 0;
      const descuentos = parseFloat(r.descuentos) || 0;

      // Referencia del cliente en notas cuando no se puede vincular (tercero aún no creado en CRM)
      let notas = (r.notas_pedido || '').trim();
      if (!clienteId && clienteNombre) {
        notas = (notas ? notas + ' | ' : '') + `Cliente: ${clienteNombre}`;
      }

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
          vendedor_nombre = COALESCE(NULLIF($13,''), vendedor_nombre),
          motivo = COALESCE(NULLIF($14,''), motivo),
          unidad_negocio = COALESCE(NULLIF($15,''), unidad_negocio),
          aprobado = COALESCE($16, aprobado),
          estado = COALESCE(NULLIF($17,''), estado),
          vencimiento = COALESCE($18::date, vencimiento),
          fecha_entrega = COALESCE($19::date, fecha_entrega),
          actualizado_en = NOW()
          WHERE id = $20`,
          [clienteId, valorTotal || null, valorSubtotal || null, valorBruto || null,
           impuestos || null, descuentos || null, notas,
           centroCodigo || '', bodegaCodigo || '', r.condicion_de_pago || r.condici_n_de_pago || '',
           listaCodigo || '', r.orden_de_compra || '', vendedor,
           r.motivo || '', r.unidad_de_negocio || '',
           r.aprobado === 'True' || r.aprobado === true, estado, vencimiento, fechaEntrega, existing.rows[0].id]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.cotizaciones (numero, cliente_id, estado, valor_total, valor_subtotal,
          valor_bruto, valor_iva, valor_descuento, notas, centro_operacion, bodega, condicion_pago,
          lista_precios, orden_compra, vendedor_nombre, motivo,
          unidad_negocio, aprobado, enviado_erp, consecutive_siesa, vencimiento, fecha_entrega, creado_por)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, NULL)`,
          [numero, clienteId, estado, valorTotal, valorSubtotal,
           valorBruto, impuestos, descuentos, notas,
           centroCodigo || '', bodegaCodigo || '', r.condicion_de_pago || r.condici_n_de_pago || '',
           listaCodigo || '', r.orden_de_compra || '', vendedor,
           r.motivo || '', r.unidad_de_negocio || '',
           r.aprobado === 'True' || r.aprobado === true, false,
           consecutivo || null, vencimiento, fechaEntrega]);
        insertados++;
      }
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

// ── Pedidos del ERP (Pedidos mes corriente.csv) — vincula CPV a cotizaciones por COT-xxxxx ──
async function importarPedidosERP(buffer, onProgress) {
  let vinculados = 0, sinCot = 0, errores = [];
  const cotCache = new Map(); // numero -> id
  try {
    // Parsear como arrays (el CSV tiene una columna extra "COT-xxxxx" sin header)
    let text;
    try { text = buffer.toString('utf-8'); if (text.includes('\ufffd')) throw new Error('l'); } catch { text = buffer.toString('latin1'); }
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { vinculados: 0, sin_cotizacion: 0, total: 0, errores: ['Archivo vacío'] };
    const header = lines[0];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      // dividir respetando comillas
      const vals = lines[i].match(/("[^"]*"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];
      rows.push(vals);
    }
    for (let i = 0; i < rows.length; i++) {
      try {
        const vals = rows[i];
        const cpv = (vals[1] || '').trim();
        if (!cpv) continue;
        // COT-xxxxx está en la columna extra (más allá del header)
        let cotNum = null;
        for (const v of vals) {
          const m = String(v || '').match(/COT-(\d+)/);
          if (m) { cotNum = m[1]; break; }
        }
        if (!cotNum) continue; // pedido directo sin cotización CRM
        const numero = `COT-${cotNum}`;
        let cotId = cotCache.get(numero);
        if (cotId === undefined) {
          const c = await pool.query(`SELECT id FROM crm.cotizaciones WHERE numero = $1 OR consecutive_siesa = $2`, [numero, cotNum]);
          cotId = c.rows.length ? c.rows[0].id : null;
          cotCache.set(numero, cotId);
        }
        if (!cotId) { sinCot++; continue; }
        // Estado ERP: buscar columna "Estado" (índice 3 en header)
        const estadoErp = (vals[3] || '').trim();
        await pool.query(`UPDATE crm.cotizaciones SET documento_erp = $1, estado_erp = $2, enviado_erp = TRUE, actualizado_en = NOW() WHERE id = $3`,
          [cpv, estadoErp || 'enviado', cotId]);
        vinculados++;
        if (onProgress && i % 25 === 0) onProgress(i + 1, rows.length);
      } catch (e) { errores.push(`Fila ${i+1}: ${e.message}`); }
    }
    if (onProgress) onProgress(rows.length, rows.length);
    return { vinculados, sin_cotizacion: sinCot, total: rows.length, errores: errores.slice(0, 50) };
  } catch (err) {
    console.error('[CRM] Error importar pedidos ERP:', err);
    throw new Error('No se pudo leer el archivo de pedidos del ERP');
  }
}

// Recalcula totales de una cotización (subtotal, IVA, total) tras importar items
async function recalcularTotalesFromImport(cotizacionId) {
  try {
    const items = await pool.query(`SELECT cantidad, precio_unitario, descuento_pct FROM crm.cotizacion_items WHERE cotizacion_id = $1`, [cotizacionId]);
    let subtotal = 0;
    for (const it of items.rows) {
      const base = parseFloat(it.cantidad) * parseFloat(it.precio_unitario);
      subtotal += base * (1 - (parseFloat(it.descuento_pct || 0) / 100));
    }
    const cfg = await pool.query(`SELECT valor FROM crm.configuracion WHERE clave = 'iva_porcentaje'`);
    const ivaPct = parseFloat(cfg.rows[0]?.valor || '19');
    const iva = subtotal * (ivaPct / 100);
    const total = subtotal + iva;
    await pool.query(`UPDATE crm.cotizaciones SET valor_subtotal=$1, valor_iva=$2, valor_total=$3, actualizado_en=NOW() WHERE id=$4`,
      [subtotal, iva, total, cotizacionId]);
  } catch {}
}

// ── Pedidos por item.csv — líneas de cada CPV (completa los items de las cotizaciones) ──
async function importarPedidosItems(buffer, onProgress) {
  let itemsAgregados = 0, cpvs = 0, sinCot = 0, errores = [];
  const cotCache = new Map(); // documento_erp -> cotizacion_id
  const prodCache = new Map(); // codigo -> {id, precio}
  try {
    let text;
    try { text = buffer.toString('utf-8'); if (text.includes('\ufffd')) throw new Error('l'); } catch { text = buffer.toString('latin1'); }
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].match(/("[^"]*"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];
      rows.push(vals);
    }
    for (let i = 0; i < rows.length; i++) {
      try {
        const vals = rows[i];
        const cpv = (vals[1] || '').trim();
        if (!cpv) continue;
        // Item resumen en [5]: código del producto al inicio (ej "0422 SUBPRODUCTO...")
        const itemResumen = (vals[5] || '').trim();
        const m = itemResumen.match(/^(\d{3,6})\s+(.*)$/);
        const cant = parseFloat(vals[7]) || 0;
        if (!m || cant <= 0) continue;
        const codigo = m[1];
        const descripcion = m[2].trim();

        // Cotización por documento_erp
        let cotId = cotCache.get(cpv);
        if (cotId === undefined) {
          const c = await pool.query(`SELECT id, lista_precios FROM crm.cotizaciones WHERE documento_erp = $1`, [cpv]);
          cotId = c.rows.length ? { id: c.rows[0].id, lista: c.rows[0].lista_precios || null } : null;
          cotCache.set(cpv, cotId);
        }
        if (!cotId) { sinCot++; continue; }

        // Producto por código
        let prod = prodCache.get(codigo);
        if (prod === undefined) {
          const p = await pool.query(`SELECT id, precio_unitario FROM crm.productos WHERE codigo = $1 AND activo = TRUE`, [codigo]);
          prod = p.rows.length ? { id: p.rows[0].id, precio: parseFloat(p.rows[0].precio_unitario) || 0 } : null;
          prodCache.set(codigo, prod);
        }

        // Precio: 1) lista de precio de la cotización, 2) precio unitario del maestro, 3) 0
        let precio = 0;
        if (prod) {
          precio = prod.precio;
          if (cotId.lista) {
            const lp = await pool.query(`SELECT lpi.precio FROM crm.lista_precio_items lpi
              JOIN crm.listas_precio lp ON lp.id = lpi.lista_id
              WHERE (lp.codigo = $1 OR lp.nombre = $1) AND lpi.producto_id = $2 LIMIT 1`, [cotId.lista, prod.id]);
            if (lp.rows.length) precio = parseFloat(lp.rows[0].precio) || 0;
          }
        }

        // Insertar item (si no existe mismo referencia+descripcion para esa cotización)
        const ex = await pool.query(`SELECT 1 FROM crm.cotizacion_items WHERE cotizacion_id=$1 AND referencia=$2 AND descripcion=$3`, [cotId.id, codigo, descripcion]);
        if (!ex.rows.length) {
          const subtotal = cant * precio;
          await pool.query(`INSERT INTO crm.cotizacion_items (cotizacion_id, descripcion, referencia, unidad_medida, cantidad, precio_unitario, subtotal, estado_item)
            VALUES ($1,$2,$3,'UND',$4,$5,$6,$7)`, [cotId.id, descripcion, codigo, cant, precio, subtotal, 'importado']);
          itemsAgregados++;
        }
      } catch (e) { errores.push(`Fila ${i+1}: ${e.message}`); }
      if (onProgress && i % 50 === 0) onProgress(i + 1, rows.length);
    }
    // Recalcular totales SOLO si hay precios reales (productos con precio_unitario > 0)
    for (const [cpv, cotId] of cotCache) {
      if (!cotId) continue;
      try {
        const hayPrecio = await pool.query(`SELECT 1 FROM crm.cotizacion_items WHERE cotizacion_id=$1 AND precio_unitario > 0 LIMIT 1`, [cotId.id]);
        if (hayPrecio.rows.length) await recalcularTotalesFromImport(cotId.id);
      } catch {}
    }
    if (onProgress) onProgress(rows.length, rows.length);
    return { items_agregados: itemsAgregados, cpvs: cpvs, sin_cotizacion: sinCot, total: rows.length, errores: errores.slice(0, 50) };
  } catch (err) {
    console.error('[CRM] Error importar pedidos por item:', err);
    throw new Error('No se pudo leer el archivo de pedidos por item del ERP');
  }
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

      const precio = parsePrecio(r.vr_unitario || r.precio || '0');
      const tasa = parsePrecio(r.tasa_impositiva_por_defecto || '0');
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

      const precio = parsePrecio(r.precio || '0');
      const disponibilidad = parsePrecio(r.disponibilidad || '0');
      const existencia = parsePrecio(r.existencia || '0');
      const comprometida = parsePrecio(r.comprometida || '0');

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

// ── EANGS1.xlsx — catálogo GS1 de la compañía (header en fila 6, 3 hojas) ──
async function importarEANGS1(buffer, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0, vinculados = 0;
  const errores = [];
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const filas = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (rows.length < 7) continue;
      const header = rows[5] || [];
      const normHeader = header.map(h => normalizeHeader(String(h||'')));
      const idx = {
        gtin: normHeader.indexOf('id'),
        tipo: normHeader.findIndex(h => h.includes('tipo_producto')),
        estado: normHeader.indexOf('estado'),
        fecha: normHeader.findIndex(h => h.includes('fecha_de_creacion')),
        url: normHeader.findIndex(h => h.includes('url_imagen')),
        desc: normHeader.findIndex(h => h.includes('descripcion')),
        marca: normHeader.findIndex(h => h.includes('marca')),
        cantidad: normHeader.findIndex(h => h.includes('cantidad_contenida')),
        gpc: normHeader.findIndex(h => h.includes('categoria_gpc')),
        mercado: normHeader.findIndex(h => h.includes('mercado_objetivo')),
        estadoProd: normHeader.findIndex(h => h.includes('estado_del_producto')),
        unidad: normHeader.findIndex(h => h.includes('unidad_de_cantidad')),
      };
      for (let i = 6; i < rows.length; i++) {
        const r = rows[i];
        const gtin = r[idx.gtin] !== undefined ? String(r[idx.gtin]).trim() : '';
        if (!gtin || !/^\d{8,14}$/.test(gtin)) continue;
        filas.push({
          gtin,
          tipo_producto: idx.tipo >= 0 ? String(r[idx.tipo]||'').trim() : '',
          estado: idx.estado >= 0 ? String(r[idx.estado]||'').trim() : '',
          fecha_creacion: idx.fecha >= 0 ? String(r[idx.fecha]||'').trim() : '',
          url_imagen: idx.url >= 0 ? String(r[idx.url]||'').trim() : '',
          descripcion: idx.desc >= 0 ? String(r[idx.desc]||'').trim() : '',
          marca: idx.marca >= 0 ? String(r[idx.marca]||'').trim() : '',
          cantidad: idx.cantidad >= 0 ? String(r[idx.cantidad]||'').trim() : '',
          categoria_gpc: idx.gpc >= 0 ? String(r[idx.gpc]||'').trim() : '',
          mercado: idx.mercado >= 0 ? String(r[idx.mercado]||'').trim() : '',
          estado_producto: idx.estadoProd >= 0 ? String(r[idx.estadoProd]||'').trim() : '',
          unidad_cantidad: idx.unidad >= 0 ? String(r[idx.unidad]||'').trim() : ''
        });
      }
    }

    for (let i = 0; i < filas.length; i++) {
      try {
        const f = filas[i];
        // Fecha DD/MM/YYYY -> YYYY-MM-DD
        let fecha = null;
        if (f.fecha_creacion && f.fecha_creacion.includes('/')) {
          const [d, m, y] = f.fecha_creacion.split('/');
          if (d && m && y) fecha = `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        const activo = f.estado_producto ? !f.estado_producto.toLowerCase().includes('inactivo') : true;

        // Buscar en catálogo
        const existing = await pool.query(`SELECT id FROM crm.gs1_catalogo WHERE gtin = $1`, [f.gtin]);
        if (existing.rows.length) {
          await pool.query(`UPDATE crm.gs1_catalogo SET descripcion = COALESCE(NULLIF($1,''), descripcion),
            marca = COALESCE(NULLIF($2,''), marca), url_imagen = COALESCE(NULLIF($3,''), url_imagen),
            estado = $4, estado_producto = $5, actualizado_en = NOW() WHERE gtin = $6`,
            [f.descripcion, f.marca, f.url_imagen, f.estado, f.estado_producto, f.gtin]);
          actualizados++;
        } else {
          await pool.query(`INSERT INTO crm.gs1_catalogo (gtin, tipo_producto, estado, fecha_creacion, url_imagen, descripcion, marca, cantidad, categoria_gpc, mercado, estado_producto, unidad_cantidad)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [f.gtin, f.tipo_producto, f.estado, fecha, f.url_imagen, f.descripcion, f.marca, f.cantidad, f.categoria_gpc, f.mercado, f.estado_producto, f.unidad_cantidad]);
          insertados++;
        }

        // Vincular con producto: 1) EAN ya registrado en productos_ean, 2) descripción que contiene código del producto
        if (!existing.rows.length || !(await pool.query(`SELECT 1 FROM crm.gs1_catalogo WHERE gtin=$1 AND vinculado`, [f.gtin])).rows.length) {
          let prod = null;
          const porEan = await pool.query(`SELECT pe.producto_id FROM crm.productos_ean pe WHERE pe.gtin = $1 AND pe.activo = TRUE LIMIT 1`, [f.gtin]);
          if (porEan.rows.length) prod = porEan.rows[0].producto_id;
          if (!prod) {
            // Buscar por código del producto en la descripción GS1 (ej: "BONDIOLA... PT 6002")
            const m = f.descripcion.match(/(?:^|\s)(\d{4,6})(?:\s|$)/);
            if (m) {
              const p = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1 AND activo = TRUE LIMIT 1`, [m[1]]);
              if (p.rows.length) prod = p.rows[0].id;
            }
          }
          if (prod) {
            await pool.query(`UPDATE crm.gs1_catalogo SET producto_id = $1, vinculado = TRUE, actualizado_en = NOW() WHERE gtin = $2`, [prod, f.gtin]);
            // Insertar en productos_ean si no existe
            const eanEx = await pool.query(`SELECT 1 FROM crm.productos_ean WHERE producto_id=$1 AND gtin=$2`, [prod, f.gtin]);
            if (!eanEx.rows.length) {
              await pool.query(`INSERT INTO crm.productos_ean (producto_id, gtin, descripcion, unidad_medida, es_principal) VALUES ($1,$2,$3,$4,FALSE)`,
                [prod, f.gtin, f.descripcion, f.unidad_cantidad]);
            }
            vinculados++;
          }
        }
      } catch (e) { fallidos++; errores.push(`GTIN ${filas[i].gtin}: ${e.message}`); }
      if (onProgress && i % 25 === 0) onProgress(i + 1, filas.length);
    }
    if (onProgress) onProgress(filas.length, filas.length);
    return { insertados, actualizados, fallidos, total: filas.length, vinculados, errores: errores.slice(0, 50) };
  } catch (err) {
    console.error('[CRM] Error importar EAN GS1:', err);
    throw new Error('No se pudo leer el archivo EANGS1.xlsx. Asegúrate que es el reporte GS1 exportado.');
  }
}

async function importarBodegas(rows, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const codigo = (r.codigo || r.c_digo || '').trim();
      const nombre = (r.descripcion || r.descripci_n || '').trim();
      if (!codigo || !nombre) { fallidos++; errores.push(`Fila ${i+1}: sin código o nombre`); continue; }

      const existing = await pool.query(`SELECT id FROM crm.bodegas WHERE codigo = $1`, [codigo]);
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.bodegas SET nombre = $1 WHERE codigo = $2`, [nombre, codigo]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.bodegas (codigo, nombre, ciudad) VALUES ($1, $2, $3)`, [codigo, nombre, r.ciudad || '']);
        insertados++;
      }
      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarPrecios(rows, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const referencia = (r.referencia || '').trim();
      const listaCodigo = (r.lista || '').trim();
      const precio = parsePrecio(r.precio || '0');
      if (!referencia || !listaCodigo) { fallidos++; errores.push(`Fila ${i+1}: sin referencia o lista`); continue; }

      // Buscar producto
      const prod = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [referencia]);
      if (!prod.rows.length) { fallidos++; errores.push(`Fila ${i+1}: producto ${referencia} no encontrado`); continue; }

      // Buscar o crear lista de precio
      let lista = await pool.query(`SELECT id FROM crm.listas_precio WHERE codigo = $1`, [listaCodigo]);
      if (!lista.rows.length) {
        const nombre = (r.desc__lista_de_precio || r.desc_lista_de_precio || listaCodigo).trim();
        const ins = await pool.query(`INSERT INTO crm.listas_precio (codigo, nombre, moneda) VALUES ($1, $2, $3) RETURNING id`, [listaCodigo, nombre, r.moneda || 'COP']);
        lista = ins;
      }

      // Upsert precio
      const existing = await pool.query(`SELECT id FROM crm.lista_precio_items WHERE lista_id = $1 AND producto_id = $2`, [lista.rows[0].id, prod.rows[0].id]);
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.lista_precio_items SET precio = $1 WHERE id = $2`, [precio, existing.rows[0].id]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.lista_precio_items (lista_id, producto_id, precio, moneda) VALUES ($1, $2, $3, $4)`, [lista.rows[0].id, prod.rows[0].id, precio, r.moneda || 'COP']);
        insertados++;
      }
      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarVendedores(rows, onProgress) {
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const codigo = (r.codigo || r.c_digo || '').trim();
      const nombre = (r.nombre || '').trim();
      if (!codigo || !nombre) { fallidos++; errores.push(`Fila ${i+1}: sin código o nombre`); continue; }
      const cobrador = r.cobrador === 'Si';
      const esVendedor = r.vendedor === 'Si' || r.vendedor === undefined || r.vendedor === '';
      // Upsert en tabla dedicada (Hub-ready) + mantener espejo en configuracion para compatibilidad
      const existing = await pool.query(`SELECT codigo FROM crm.vendedores WHERE codigo = $1`, [codigo]);
      if (existing.rows.length) {
        await pool.query(`UPDATE crm.vendedores SET nombre = $1, cobrador = $2, es_vendedor = $3 WHERE codigo = $4`, [nombre, cobrador, esVendedor, codigo]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO crm.vendedores (codigo, nombre, cobrador, es_vendedor) VALUES ($1,$2,$3,$4)`, [codigo, nombre, cobrador, esVendedor]);
        insertados++;
      }
      // Espejo legacy en configuracion
      const key = `vendedor_${codigo}`;
      const data = JSON.stringify({ codigo, nombre, cobrador, vendedor: esVendedor });
      const cfgExisting = await pool.query(`SELECT clave FROM crm.configuracion WHERE clave = $1`, [key]);
      if (cfgExisting.rows.length) await pool.query(`UPDATE crm.configuracion SET valor = $1 WHERE clave = $2`, [data, key]);
      else await pool.query(`INSERT INTO crm.configuracion (clave, valor, descripcion) VALUES ($1,$2,$3)`, [key, data, `Vendedor: ${nombre}`]);
      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}

async function importarMaestroGenerico(rows, table, onProgress, opts = {}) {
  const { codigoKeys = ['codigo','c_digo'], nombreKeys = ['descripcion','descripci_n','nombre'], estadoKey = 'estado', activoValues = ['activo','si'] } = opts;
  let insertados = 0, actualizados = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = rows[i];
      const codigo = findCol(r, codigoKeys).trim();
      const nombre = findCol(r, nombreKeys).trim();
      const estadoVal = estadoKey ? findCol(r, [estadoKey]).toLowerCase() : '';
      const activo = !estadoVal || activoValues.some(v => estadoVal.includes(v)) || estadoVal === '';
      if (!codigo || !nombre) { fallidos++; errores.push(`Fila ${i+1}: sin código o nombre`); continue; }
      const existing = await pool.query(`SELECT codigo FROM ${table} WHERE codigo = $1`, [codigo]);
      if (existing.rows.length) {
        await pool.query(`UPDATE ${table} SET nombre = $1, activo = $2 WHERE codigo = $3`, [nombre, activo, codigo]);
        actualizados++;
      } else {
        await pool.query(`INSERT INTO ${table} (codigo, nombre, activo) VALUES ($1,$2,$3)`, [codigo, nombre, activo]);
        insertados++;
      }
      if (onProgress && i % 10 === 0) onProgress(i + 1, rows.length);
    } catch (e) { fallidos++; errores.push(`Fila ${i+1}: ${e.message}`); }
  }
  if (onProgress) onProgress(rows.length, rows.length);
  return { insertados, actualizados, fallidos, total: rows.length, errores: errores.slice(0, 50) };
}
async function importarMotivos(rows, onProgress) {
  // XML rows vienen como {motivo, descmotivo, estado}
  return importarMaestroGenerico(rows, 'crm.motivos_venta', onProgress, { codigoKeys: ['motivo','codigo','c_digo'], nombreKeys: ['descmotivo','descripcion','nombre'], estadoKey: 'estado' });
}
async function importarTiposDocumento(rows, onProgress) {
  // CSV: C.O., Tipo docto (ej "CPV - PEDIDO DE VENTA CRM") -> codigo = CPV, nombre = PEDIDO DE VENTA CRM, filtrar solo CRM relevantes pero importamos todos y marcamos activo
  // Para SIESA CRM solo CPE/CPV/CPR son relevantes, pero importamos todos; el perfil filtrará
  const mapped = rows.map(r => {
    const tipoFull = findCol(r, ['tipo_docto','tipo_de_documento','tipo']) || '';
    const codigo = tipoFull.split('-')[0].trim().split(' ')[0] || tipoFull.trim();
    const nombre = tipoFull.trim();
    const activo = true; // todos activos, el perfil decide
    return { codigo, nombre, estado: activo ? 'Activo' : 'Inactivo', c_o: findCol(r, ['c_o','centro','codigo']) };
  }).filter(r => r.codigo);
  // Deduplicar por codigo (varios C.O. tienen mismo tipo)
  const uniq = new Map();
  for (const m of mapped) if (!uniq.has(m.codigo)) uniq.set(m.codigo, m);
  return importarMaestroGenerico([...uniq.values()], 'crm.tipos_documento', onProgress, { codigoKeys: ['codigo'], nombreKeys: ['nombre'], estadoKey: 'estado' });
}
async function importarCentrosCosto(rows, onProgress) {
  return importarMaestroGenerico(rows, 'crm.centros_costo', onProgress, { codigoKeys: ['centro_de_costo','codigo','c_digo','centro'], nombreKeys: ['descripcion_del_centro_de_costo','descripcion','nombre'], estadoKey: 'estado' });
}
async function importarUnidadesNegocio(rows, onProgress) {
  return importarMaestroGenerico(rows, 'crm.unidades_negocio', onProgress, { codigoKeys: ['un','codigo','c_digo'], nombreKeys: ['descripcion','nombre'], estadoKey: 'activa' });
}

// ── Endpoint principal ──
const PARSERS = {
  clientes: importarClientes,
  terceros: importarTerceros,
  contactos: importarContactos,
  leads: importarLeads,
  cotizaciones: importarCotizaciones,
  pedidos_erp: importarPedidosERP,
  pedidos_items: importarPedidosItems,
  items: importarItems,
  inventario: importarInventario,
  codigos_barra: importarCodigosBarra,
  bodegas: importarBodegas,
  precios: importarPrecios,
  vendedores: importarVendedores,
  motivos_venta: importarMotivos,
  tipos_documento: importarTiposDocumento,
  centros_costo: importarCentrosCosto,
  unidades_negocio: importarUnidadesNegocio,
  eans_gs1: importarEANGS1
};

router.post('/', requirePermiso('crear_contacto', 'crm'), upload.single('archivo'), async (req, res) => {
  try {
    const { tipo } = req.body;
    if (!tipo || !PARSERS[tipo]) return res.status(400).json({ error: `Tipo inválido. Opciones: ${Object.keys(PARSERS).join(', ')}` });
    if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });

    // eans_gs1 y pedidos_erp necesitan el buffer completo (parseo especial)
    let rows = null;
    if (tipo === 'eans_gs1' || tipo === 'pedidos_erp' || tipo === 'pedidos_items') {
      // validar extensión
      const okExt = tipo === 'eans_gs1' ? /\.(xlsx|xls)$/i.test(req.file.originalname) : /\.(csv|txt)$/i.test(req.file.originalname);
      if (!okExt) return res.status(400).json({ error: tipo === 'eans_gs1' ? 'El archivo debe ser XLSX (reporte GS1)' : 'El archivo debe ser CSV (pedidos del ERP)' });
    } else {
      rows = parseFile(req.file.buffer, req.file.originalname);
      if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });
      const validationError = validateColumns(rows, tipo);
      if (validationError) return res.status(400).json({ error: validationError });
    }

    console.log(`[CRM] Importando ${tipo}: ${req.file.originalname}`);

    // SSE streaming for progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const onProgress = (current, total) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', current, total })}\n\n`);
    };

    const resultado = tipo === 'eans_gs1'
      ? await importarEANGS1(req.file.buffer, onProgress)
      : tipo === 'pedidos_erp'
        ? await importarPedidosERP(req.file.buffer, onProgress)
        : tipo === 'pedidos_items'
          ? await importarPedidosItems(req.file.buffer, onProgress)
          : await PARSERS[tipo](rows, onProgress);

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

// POST /api/importar/reparar-precios — TEMPORAL: corrige precios truncados $2.3 -> 2300
// GET /api/importar/tipos — Listar tipos disponibles
router.get('/tipos', requirePermiso('crear_contacto', 'crm'), (req, res) => {
  res.json({
    ok: true,
    data: [
      { id: 'clientes', nombre: 'Clientes Siesa ERP', extensiones: 'csv', descripcion: 'Clientes del ERP con código, nombre, canal, dirección' },
      { id: 'terceros', nombre: 'Terceros (maestro SIESA)', extensiones: 'csv', descripcion: 'Terceros por NIT: razón social, tipo, contacto, dirección, teléfono' },
      { id: 'contactos', nombre: 'Contactos CRM', extensiones: 'xlsx', descripcion: 'Contactos vinculados a clientes' },
      { id: 'leads', nombre: 'Leads CRM', extensiones: 'xlsx', descripcion: 'Clientes potenciales con asesor, segmento, lista de precios' },
      { id: 'cotizaciones', nombre: 'Cotizaciones CRM', extensiones: 'xlsx', descripcion: 'Cotizaciones con estados, bodega, centro de operación' },
      { id: 'pedidos_erp', nombre: 'Pedidos ERP (vincula CPV a cotizaciones)', extensiones: 'csv', descripcion: 'Pedidos mes corriente del ERP: asigna documento_erp (CPV) a las cotizaciones por su número COT' },
      { id: 'pedidos_items', nombre: 'Pedidos por item ERP (completa items)', extensiones: 'csv', descripcion: 'Líneas de cada CPV: agrega los productos (items) a las cotizaciones ya vinculadas' },
      { id: 'items', nombre: 'Items / Productos', extensiones: 'xlsx,csv', descripcion: 'Productos con referencia, precio, impuesto, categoría' },
      { id: 'inventario', nombre: 'Inventario por Bodega', extensiones: 'xlsx,csv', descripcion: 'Stock por bodega con precio, disponibilidad, existencia (SIESA entrega CSV)' },
      { id: 'codigos_barra', nombre: 'Códigos de Barras (EAN)', extensiones: 'csv', descripcion: 'Códigos GS1 vinculados a productos por referencia' },
      { id: 'eans_gs1', nombre: 'Catálogo GS1 (EANGS1.xlsx)', extensiones: 'xlsx', descripcion: 'Reporte GS1 de la compañía: GTIN, descripción, marca, foto. Vincula por GTIN o código en la descripción' },
      { id: 'bodegas', nombre: 'Bodegas', extensiones: 'csv', descripcion: 'Almacenes con código, nombre y ubicación' },
      { id: 'precios', nombre: 'Precios por Item', extensiones: 'csv', descripcion: 'Precios de productos por lista de precio' },
      { id: 'vendedores', nombre: 'Vendedores', extensiones: 'csv', descripcion: 'Asesores comerciales con código y nombre' },
      { id: 'motivos_venta', nombre: 'Motivos de Venta', extensiones: 'csv,xml', descripcion: 'Motivos SIESA para cotizaciones (VENTAS, etc.) — CSV o XML Crystal' },
      { id: 'tipos_documento', nombre: 'Tipos de Documento', extensiones: 'csv', descripcion: 'Tipos SIESA (PEDIDO DE VENTA CRM, CPE/CPV/CPR, etc.)' },
      { id: 'centros_costo', nombre: 'Centros de Costo', extensiones: 'csv', descripcion: 'Centros de costo SIESA (con C.O. y U.N.)' },
      { id: 'unidades_negocio', nombre: 'Unidades de Negocio', extensiones: 'csv', descripcion: 'Unidades SIESA (PRODUCCION CRUDOS, etc.)' }
    ]
  });
});

export default router;
