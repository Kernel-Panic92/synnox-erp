require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const AdmZip  = require('adm-zip');
const db      = require('../db');
const syncState = require('./sync-state');

let cachedConfig = null;

async function getConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const { rows } = await db.query('SELECT clave, valor FROM configuracion');
    cachedConfig = {};
    for (const row of rows) {
      cachedConfig[row.clave] = row.valor;
    }
    return cachedConfig;
  } catch (e) {
    console.error('[IMAP] Error cargando config:', e.message);
    return {};
  }
}

function clearConfigCache() {
  cachedConfig = null;
}

function extraerInvoiceEmbebido(xml) {
  const invoiceMatch = xml.match(/<cbc:Description><!\[CDATA\[([\s\S]*?)\]\]><\/cbc:Description>/);
  if (invoiceMatch) {
    const contenido = invoiceMatch[1];
    if (contenido.includes('<Invoice')) {
      return contenido;
    }
  }
  return null;
}

function parsearXml(xmlContent) {
  const data = {
    numeroFactura: null,
    fecha: null,
    cufe: null,
    nombreEmisor: null,
    nitEmisor: null,
    nombreReceptor: null,
    nitReceptor: null,
    valorBruto: 0,
    iva: 0,
    valorTotal: 0,
    ordenCompra: null,
    limitePago: null
  };

  try {
    const xml = xmlContent.toString('utf8');
    
    const invoiceEmbebido = extraerInvoiceEmbebido(xml);
    const xmlFinal = invoiceEmbebido || xml;

    if (invoiceEmbebido) {
      console.log(`  [Parser] Invoice embebido detectado — extrayendo datos`);
    }

    const idMatch = xmlFinal.match(/<cbc:ID>([^<]+)<\/cbc:ID>/);
    if (idMatch) {
      const id = idMatch[1].trim();
      if (id !== '01' && /[A-Z0-9\-]{3,}/i.test(id)) {
        data.numeroFactura = id;
      }
    }

    const fechaMatch = xmlFinal.match(/<cbc:IssueDate>(\d{4}-\d{2}-\d{2})<\/cbc:IssueDate>/);
    if (fechaMatch) data.fecha = fechaMatch[1];

    // Extraer orden de compra / contract reference
    const orderRefMatch = xmlFinal.match(/<cac:OrderReference>([\s\S]*?)<\/cac:OrderReference>/);
    if (orderRefMatch) {
      const orderIdMatch = orderRefMatch[1].match(/<cbc:ID>([^<]+)<\/cbc:ID>/);
      if (orderIdMatch) {
        data.ordenCompra = orderIdMatch[1].trim();
        console.log(`  [Parser] Orden de compra: ${data.ordenCompra}`);
      }
    }

    // También buscar ContractDocumentReference
    if (!data.ordenCompra) {
      const contractMatch = xmlFinal.match(/<cac:ContractDocumentReference>([\s\S]*?)<\/cac:ContractDocumentReference>/);
      if (contractMatch) {
        const contractIdMatch = contractMatch[1].match(/<cbc:ID>([^<]+)<\/cbc:ID>/);
        if (contractIdMatch) {
          data.ordenCompra = contractIdMatch[1].trim();
          console.log(`  [Parser] Referencia contractual: ${data.ordenCompra}`);
        }
      }
    }

    const cufeMatch = xmlFinal.match(/<cbc:UUID[^>]*schemeName="CUFE-SHA384"[^>]*>([^<]+)<\/cbc:UUID>/);
    if (!cufeMatch) {
      const uuidMatch = xmlFinal.match(/<cbc:UUID[^>]*>([^<]+)<\/cbc:UUID>/);
      data.cufe = uuidMatch ? uuidMatch[1].trim() : null;
    } else {
      data.cufe = cufeMatch[1].trim();
    }

    const supplierMatch = xmlFinal.match(/<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/);
    if (supplierMatch) {
      const supplier = supplierMatch[1];
      const nombreMatch = supplier.match(/<cbc:Name>([^<]+)<\/cbc:Name>/);
      if (nombreMatch) data.nombreEmisor = nombreMatch[1].trim();
      
      const nitMatch = supplier.match(/CompanyID[^>]*schemeName="31"[^>]*>([^<]+)<\/cbc:CompanyID>/);
      if (nitMatch) {
        data.nitEmisor = nitMatch[1].trim().replace(/[^0-9]/g, '');
      } else {
        const nitMatch2 = supplier.match(/<cbc:CompanyID[^>]*>(\d+)<\/cbc:CompanyID>/);
        if (nitMatch2) data.nitEmisor = nitMatch2[1].trim();
      }
    }

    const customerMatch = xmlFinal.match(/<cac:AccountingCustomerParty>([\s\S]*?)<\/cac:AccountingCustomerParty>/);
    if (customerMatch) {
      const customer = customerMatch[1];
      const nombreMatch = customer.match(/<cbc:Name>([^<]+)<\/cbc:Name>/);
      if (nombreMatch) data.nombreReceptor = nombreMatch[1].trim();
      
      const nitMatch = customer.match(/CompanyID[^>]*schemeName="31"[^>]*>([^<]+)<\/cbc:CompanyID>/);
      if (nitMatch) {
        data.nitReceptor = nitMatch[1].trim().replace(/[^0-9]/g, '');
      } else {
        const nitMatch2 = customer.match(/<cbc:CompanyID[^>]*>(\d+)<\/cbc:CompanyID>/);
        if (nitMatch2) data.nitReceptor = nitMatch2[1].trim();
      }
    }

    const monetaryMatch = xmlFinal.match(/<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/);
    if (monetaryMatch) {
      const monetary = monetaryMatch[1];
      
      const brutoMatch = monetary.match(/<cbc:LineExtensionAmount[^>]*currencyID="COP">([^<]+)<\/cbc:LineExtensionAmount>/);
      if (brutoMatch) data.valorBruto = parseFloat(brutoMatch[1]);
      
      const taxInclusiveMatch = monetary.match(/<cbc:TaxInclusiveAmount[^>]*currencyID="COP">([^<]+)<\/cbc:TaxInclusiveAmount>/);
      const payableMatch = monetary.match(/<cbc:PayableAmount[^>]*currencyID="COP">([^<]+)<\/cbc:PayableAmount>/);
      
      if (taxInclusiveMatch) {
        data.valorTotal = parseFloat(taxInclusiveMatch[1]);
      } else if (payableMatch) {
        data.valorTotal = parseFloat(payableMatch[1]);
      }
    }

    if (data.valorTotal === 0) {
      const totalMatch = xmlFinal.match(/<cbc:PayableAmount[^>]*currencyID="COP">([^<]+)<\/cbc:PayableAmount>/);
      if (totalMatch) data.valorTotal = parseFloat(totalMatch[1]);
    }

    const taxTotalMatch = xmlFinal.match(/<cac:TaxTotal>([\s\S]*?)<\/cac:TaxTotal>/);
    if (taxTotalMatch) {
      const taxTotal = taxTotalMatch[1];
      const taxAmountMatch = taxTotal.match(/<cbc:TaxAmount[^>]*currencyID="COP">([^<]+)<\/cbc:TaxAmount>/);
      if (taxAmountMatch) data.iva = parseFloat(taxAmountMatch[1]);
    }

    if (data.iva === 0 && data.valorTotal > data.valorBruto) {
      data.iva = data.valorTotal - data.valorBruto;
    }

    // Extraer fecha de vencimiento (DueDate)
    const dueDateMatch = xmlFinal.match(/<cbc:DueDate>(\d{4}-\d{2}-\d{2})<\/cbc:DueDate>/);
    if (dueDateMatch) {
      data.limitePago = dueDateMatch[1];
      console.log(`  [Parser] Fecha vencimiento: ${data.limitePago}`);
    } else {
      // Buscar en PaymentTerms
      const paymentTermsMatch = xmlFinal.match(/<cac:PaymentTerms>([\s\S]*?)<\/cac:PaymentTerms>/);
      if (paymentTermsMatch) {
        const dueDateInTerms = paymentTermsMatch[1].match(/<cbc:PaymentDueDate>(\d{4}-\d{2}-\d{2})<\/cbc:PaymentDueDate>/);
        if (dueDateInTerms) {
          data.limitePago = dueDateInTerms[1];
          console.log(`  [Parser] Fecha vencimiento (PaymentTerms): ${data.limitePago}`);
        }
      }
    }

  } catch (err) {
    console.log(`  [Parser] Error: ${err.message}`);
  }

  return data;
}

function extraerZip(zipBuffer) {
  const archivos = { pdf: null, xml: null };
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    for (const entry of entries) {
      const nombre = entry.entryName.toLowerCase();
      if (nombre.endsWith('.pdf') && !archivos.pdf) {
        archivos.pdf = { nombre: entry.entryName, contenido: entry.getData() };
        console.log(`  [ZIP] PDF: ${entry.entryName}`);
      } else if (nombre.endsWith('.xml')) {
        if (!archivos.xml) {
          archivos.xml = { nombre: entry.entryName, contenido: entry.getData() };
          console.log(`  [ZIP] XML: ${entry.entryName}`);
        }
      }
    }
  } catch (err) {
    console.log(`  [ZIP] Error extrayendo: ${err.message}`);
  }
  return archivos;
}

async function crearProveedorSiNoExiste(client, nitEmisor, nombreEmisor, emailOrigen) {
  if (!nitEmisor) return { id: null, categoria_default_id: null };
  
  const existente = await client.query(
    'SELECT id, categoria_default_id FROM proveedores WHERE nit = $1 AND activo = TRUE LIMIT 1',
    [nitEmisor]
  );
  
  if (existente.rows.length > 0) {
    const row = existente.rows[0];
    return { id: row.id, categoria_default_id: row.categoria_default_id };
  }
  
  const nombre = nombreEmisor || `Proveedor NIT ${nitEmisor}`;
  const email = emailOrigen || null;
  
  const result = await client.query(
    `INSERT INTO proveedores (nit, nombre, email_facturacion, telefono, direccion)
     VALUES ($1, $2, $3, NULL, NULL)
     ON CONFLICT (nit) DO UPDATE SET nombre = EXCLUDED.nombre, email_facturacion = COALESCE(EXCLUDED.email_facturacion, proveedores.email_facturacion)
     RETURNING id, categoria_default_id`,
    [nitEmisor, nombre, email]
  );
  
  console.log(`  [IMAP] Proveedor creado/encontrado: ${nombre} (NIT: ${nitEmisor})`);
  const row = result.rows[0];
  return { id: row.id, categoria_default_id: row.categoria_default_id };
}

const MAX_ATTACHMENT_MB = parseInt(process.env.MAX_ATTACHMENT_MB || '50');

async function procesarCorreo(parsed, msgId) {
  const uploadDir = process.env.UPLOAD_DIR || './uploads/facturas';
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  let archivoPdf = null;
  let archivoXml = null;
  let datosFactura = {};

  for (const att of parsed.attachments || []) {
    const filename = att.filename || '';
    const ext = path.extname(filename).toLowerCase();

    if (att.size && att.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      console.log(`  [IMAP] Adjunto omitido por tamaño (${(att.size / 1024 / 1024).toFixed(1)}MB): ${filename}`);
      continue;
    }

    if (ext === '.zip' || filename.toLowerCase().includes('.zip')) {
      console.log(`  [IMAP] Procesando ZIP: ${filename}`);
      const archivos = extraerZip(att.content);
      
      if (archivos.xml) {
        const xmlNombre = `${uuidv4()}.xml`;
        fs.writeFileSync(path.join(uploadDir, xmlNombre), archivos.xml.contenido);
        archivoXml = xmlNombre;
        console.log(`  [IMAP] XML guardado: ${xmlNombre}`);
        
        datosFactura = parsearXml(archivos.xml.contenido);
        console.log(`  [IMAP] Datos:`, JSON.stringify(datosFactura));
      }
      
      if (archivos.pdf && !archivoPdf) {
        const pdfNombre = `${uuidv4()}.pdf`;
        fs.writeFileSync(path.join(uploadDir, pdfNombre), archivos.pdf.contenido);
        archivoPdf = pdfNombre;
        console.log(`  [IMAP] PDF guardado: ${pdfNombre}`);
      }
    } else if ((ext === '.pdf' || filename.toLowerCase().includes('pdf')) && !archivoPdf) {
      const nombre = `${uuidv4()}.pdf`;
      fs.writeFileSync(path.join(uploadDir, nombre), att.content);
      archivoPdf = nombre;
      console.log(`  [IMAP] PDF directo guardado: ${nombre}`);
    } else if ((ext === '.xml' || filename.toLowerCase().includes('xml')) && !archivoXml) {
      const nombre = `${uuidv4()}.xml`;
      fs.writeFileSync(path.join(uploadDir, nombre), att.content);
      archivoXml = nombre;
      datosFactura = parsearXml(att.content);
      console.log(`  [IMAP] XML directo guardado: ${nombre}`);
    }
  }

  if (!archivoPdf && !archivoXml) {
    console.log(`  [IMAP] Sin adjuntos relevantes en: "${parsed.subject}" — omitiendo`);
    return 'omitido';
  }

  const { numeroFactura, nitEmisor, nombreEmisor, valorTotal, iva, valorBruto, fecha, cufe, ordenCompra, limitePago } = datosFactura;
  const fechaFactura = fecha ? new Date(fecha.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3')) : null;
  const emailOrigen = parsed.from?.value?.[0]?.address || null;
  const asunto = parsed.subject || '';
  
  console.log(`  [IMAP] Número: ${numeroFactura}, Valor: ${valorTotal}, IVA: ${iva}${ordenCompra ? ', OC: ' + ordenCompra : ''}${limitePago ? ', Vence: ' + limitePago : ''}`);

  if (!numeroFactura) {
    console.log(`  [IMAP] No se pudo extraer número de factura — omitiendo`);
    // Clean up files that were already written
    if (archivoPdf) { try { fs.unlinkSync(path.join(uploadDir, archivoPdf)); } catch {} }
    if (archivoXml) { try { fs.unlinkSync(path.join(uploadDir, archivoXml)); } catch {} }
    return 'sin_numero';
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const dup = nitEmisor
      ? await client.query(
          'SELECT id FROM facturas WHERE nit_emisor = $1 AND numero_factura = $2',
          [nitEmisor, numeroFactura]
        )
      : await client.query(
          'SELECT id FROM facturas WHERE numero_factura = $1',
          [numeroFactura]
        );
    if (dup.rows.length > 0) {
      console.log(`  [IMAP] Factura ${numeroFactura}${nitEmisor ? ' (' + nitEmisor + ')' : ''} ya existe — omitiendo`);
      await client.query('ROLLBACK');
      client.release();
      // Clean up files that were already written
      if (archivoPdf) { try { fs.unlinkSync(path.join(uploadDir, archivoPdf)); } catch {} }
      if (archivoXml) { try { fs.unlinkSync(path.join(uploadDir, archivoXml)); } catch {} }
      return 'duplicada';
    }

    const proveedor = await crearProveedorSiNoExiste(client, nitEmisor, nombreEmisor, emailOrigen);
    const proveedorId = proveedor?.id;
    const categoriaSugerida = proveedor?.categoria_default_id;

    const ahora = new Date();
    const referencia = fechaFactura ? fechaFactura.toISOString().split('T')[0] : ahora.toISOString().split('T')[0];
    const limiteDian = new Date((fechaFactura || ahora).getTime() + 48 * 60 * 60 * 1000);

    const { rows } = await client.query(
      `INSERT INTO facturas (
          numero_factura, proveedor_id, categoria_id, archivo_pdf, archivo_xml,
          email_origen, email_asunto,
          limite_dian, limite_pago, estado,
          valor_total, valor_iva, valor,
          fecha_factura, nit_emisor, nombre_emisor, cufe,
          orden_compra, referencia
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING id, numero_factura`,
      [
        numeroFactura,
        proveedorId,
        categoriaSugerida || null,
        archivoPdf,
        archivoXml,
        emailOrigen,
        asunto.substring(0, 499),
        limiteDian,
        limitePago || null,
        'recibida',
        valorTotal,
        iva,
        valorBruto,
        fechaFactura,
        nitEmisor,
        nombreEmisor,
        cufe,
        ordenCompra || null,
        referencia
       ]
    );

    await client.query(
      `INSERT INTO eventos_flujo (factura_id, usuario_id, tipo, comentario, metadata)
       VALUES ($1, NULL, 'recibida', $2, $3)`,
      [
        rows[0].id,
        `Factura importada automáticamente desde ${emailOrigen}`,
        JSON.stringify({ email_origen: emailOrigen, asunto, message_id: msgId }),
      ]
    );

    await client.query('COMMIT');
    console.log(`  [IMAP] ✓ Factura creada: ${rows[0].numero_factura} (${rows[0].id})`);
    client.release();
    return 'creada';

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  [IMAP] Error creando factura:`, err.message);
    client.release();
    return 'error';
  }
}

// ── Step 1: Download emails from IMAP to local directory ──
async function downloadEmails(config, rescanAll = false) {
  const pendingDir = process.env.UPLOAD_DIR
    ? path.join(process.env.UPLOAD_DIR, 'pending')
    : './uploads/pending';
  if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });

  const client = new ImapFlow({
    host:   config.imap_host,
    port:   parseInt(config.imap_port || '993'),
    secure: config.imap_tls !== 'false',
    auth: { user: config.imap_user, pass: config.imap_password },
    logger: false,
    socketTimeout: 60000,
    connTimeout: 30000,
  });

  client.on('error', (err) => console.error('[IMAP-Download] Error:', err.message));

  try {
    await client.connect();
    console.log('[IMAP-Download] ✓ Conexión exitosa');
    const lock = await client.getMailboxLock(config.imap_folder || 'INBOX');

    try {
      const searchCriteria = rescanAll ? { all: true } : { unseen: true };
      const seqNumbers = await client.search(searchCriteria);
      console.log(`[IMAP-Download] ${seqNumbers.length} mensajes encontrados`);

      if (seqNumbers.length === 0) {
        console.log('[IMAP-Download] Sin mensajes para descargar');
        return 0;
      }

      syncState.iniciarSync(seqNumbers.length);
      console.log(`[IMAP-Download] Iniciando descarga de ${seqNumbers.length} mensajes (${PARALLEL} en paralelo)...`);
      let descargados = 0;
      let skipped = 0;
      let errors = 0;

      // Process 5 messages in parallel
      const PARALLEL = 10;
      for (let i = 0; i < seqNumbers.length; i += PARALLEL) {
        const batch = seqNumbers.slice(i, i + PARALLEL);
        const promises = batch.map(async (seq) => {
          try {
            const msgs = [];
            for await (const msg of client.fetch([seq], { source: true })) {
              msgs.push(msg);
            }
            const msg = msgs[0];
            if (!msg || !msg.source) { errors++; return; }

            const emlFile = path.join(pendingDir, `msg_${seq}.eml`);
            if (fs.existsSync(emlFile)) { skipped++; return; }

            fs.writeFileSync(emlFile, msg.source);
            descargados++;
            await client.messageFlagsAdd(seq, ['\\Seen']);
          } catch (err) {
            console.error(`[IMAP-Download] Error seq ${seq}:`, err.message);
            errors++;
          }
        });
        await Promise.all(promises);

        // Update progress every batch
        const total = Math.min(i + PARALLEL, seqNumbers.length);
        console.log(`[IMAP-Download] Progreso: ${total}/${seqNumbers.length} (${descargados} descargados)`);
        syncState.actualizarProgreso(total, descargados, skipped, errors, `Descargando: ${total}/${seqNumbers.length}...`);
      }

      console.log(`[IMAP-Download] ✓ ${descargados} descargados, ${skipped} omitidos, ${errors} errores`);
      syncState.actualizarProgreso(seqNumbers.length, descargados, skipped, errors, `Descarga completada: ${descargados} emails`);
      return descargados;
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[IMAP-Download] Error:', err.message);
    return 0;
  } finally {
    try { await client.logout(); } catch {}
  }
}

// ── Step 2: Process downloaded emails ──
async function processDownloadedEmails() {
  const pendingDir = process.env.UPLOAD_DIR
    ? path.join(process.env.UPLOAD_DIR, 'pending')
    : './uploads/pending';

  if (!fs.existsSync(pendingDir)) return { creadas: 0, duplicadas: 0, errores: 0 };

  const emlFiles = fs.readdirSync(pendingDir).filter(f => f.endsWith('.eml'));
  console.log(`[IMAP-Process] ${emlFiles.length} emails pendientes de procesar`);

  if (emlFiles.length === 0) return { creadas: 0, duplicadas: 0, errores: 0 };

  let creadas = 0, duplicadas = 0, errores = 0;

  for (const emlFile of emlFiles) {
    const filePath = path.join(pendingDir, emlFile);
    try {
      const raw = fs.readFileSync(filePath);
      const parsed = await simpleParser(raw);
      const msgId = parsed.messageId || emlFile.replace('.eml', '');

      const resultado = await procesarCorreo(parsed, msgId);

      fs.unlinkSync(filePath);

      if (resultado === 'creada') creadas++;
      else duplicadas++;
    } catch (err) {
      console.error(`[IMAP-Process] Error procesando ${emlFile}:`, err.message);
      errores++;
      try {
        const errorDir = path.join(pendingDir, 'error');
        if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });
        fs.renameSync(filePath, path.join(errorDir, emlFile));
      } catch {}
    }
  }

  console.log(`[IMAP-Process] ✓ ${creadas} creadas, ${duplicadas} duplicadas, ${errores} errores`);
  return { creadas, duplicadas, errores };
}

// ── Main sync function (both steps) ──
async function pollCorreo(rescanAll = false) {
  const config = await getConfig();

  if (!config.imap_host || !config.imap_user) {
    console.log('[IMAP] Configuración IMAP no definida — servicio desactivado');
    return;
  }

  console.log(`[IMAP] Iniciando sync — host: ${config.imap_host}, folder: ${config.imap_folder || 'INBOX'}`);

  // Step 1: Download emails from IMAP (fast - just saves raw .eml files)
  const descargados = await downloadEmails(config, rescanAll);

  // Step 2: Process downloaded emails (can be retried independently)
  const resultado = await processDownloadedEmails();

  syncState.terminarSync(resultado.creadas, resultado.duplicadas, resultado.errores);
  console.log(`[IMAP] ✓ Sync completado: ${resultado.creadas} creadas, ${resultado.duplicadas} duplicadas, ${resultado.errores} errores`);
}

function iniciarServicioImap() {
  const minutos = parseInt(process.env.IMAP_POLL_MINUTES || '5');
  console.log(`[IMAP] Servicio iniciado — revisando cada ${minutos} minutos`);
  pollCorreo().catch(e => console.error('[IMAP] Error inicial:', e.message));
  setInterval(() => {
    pollCorreo().catch(e => console.error('[IMAP] Error en poll:', e.message));
  }, minutos * 60 * 1000);
}

module.exports = { iniciarServicioImap, pollCorreo, processDownloadedEmails, clearConfigCache };
