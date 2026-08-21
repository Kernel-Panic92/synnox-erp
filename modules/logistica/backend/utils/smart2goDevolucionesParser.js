import ExcelJS from 'exceljs';
import fs from 'fs';

const CAUSA_MAP = {
  'f.v': 'VENCIDO O PROXIMO A VENCER',
  'fv': 'VENCIDO O PROXIMO A VENCER',
  'fecha': 'VENCIDO O PROXIMO A VENCER',
  'fecha vencimiento': 'VENCIDO O PROXIMO A VENCER',
  'fecha de vencimiento': 'VENCIDO O PROXIMO A VENCER',
  'fecha vto': 'VENCIDO O PROXIMO A VENCER',
  'vencidos': 'VENCIDO O PROXIMO A VENCER',
  'vencimiento': 'VENCIDO O PROXIMO A VENCER',
  'vencido': 'VENCIDO O PROXIMO A VENCER',
  'vencido o proximo a vencer': 'VENCIDO O PROXIMO A VENCER',
  'v vencido o proximo a vencer': 'VENCIDO O PROXIMO A VENCER',
  '01vencido o proximo a vencer': 'VENCIDO O PROXIMO A VENCER',
  'calidad': 'MALA PRESENTACION',
  'mal estado': 'MAL ESTADO',
  'mala presentacion': 'MALA PRESENTACION',
  'mala presentación': 'MALA PRESENTACION',
  'choque termico': 'CHOQUE TERMICO',
  'choque térmico': 'CHOQUE TERMICO',
  'rotura': 'PROBLEMAS EN EL EMPAQUE',
  'roto': 'PROBLEMAS EN EL EMPAQUE',
  'dano': 'DAÑO EN NEVERA DEL ALMACEN',
  'daño': 'DAÑO EN NEVERA DEL ALMACEN',
  'perdida de vacio': 'PERDIDA DE VACIO',
  'pérdida de vacío': 'PERDIDA DE VACIO',
  'perdida vacio': 'PERDIDA DE VACIO',
  'secos': 'SECOS',
  'fechas borradas': 'Otra',
};

const CAUSA_KEYWORDS = [
  { keywords: ['vencim', 'vencid', 'f.v', 'fv', 'proximo a vencer'], result: 'VENCIDO O PROXIMO A VENCER' },
  { keywords: ['vacío', 'vacio', 'escarcha', 'frizado', 'frizados', 'perdida de vacio'], result: 'PERDIDA DE VACIO' },
  { keywords: ['choque termico', 'choque térmico'], result: 'CHOQUE TERMICO' },
  { keywords: ['rotura', 'roto', 'empaque', 'avería', 'averia'], result: 'PROBLEMAS EN EL EMPAQUE' },
  { keywords: ['calidad', 'presentación', 'presentacion', 'mala presentacion'], result: 'MALA PRESENTACION' },
  { keywords: ['mal estado', 'deterioro'], result: 'MAL ESTADO' },
  { keywords: ['daño', 'dano', 'dañado'], result: 'DAÑO EN NEVERA DEL ALMACEN' },
  { keywords: ['seco', 'secos'], result: 'SECOS' },
];

function normalizeHeader(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isPlaceholder(v) {
  if (!v) return true;
  const s = String(v).trim().toLowerCase();
  return ['generic', 'item1', 'item2', 'item3', 'item 1', 'item 2', 'item 3', '-', '--', 'n/a', 'na'].includes(s);
}

function extraerValorCelda(cell) {
  if (!cell) return '';
  // ExcelJS hyperlink: cell.value = { text, hyperlink } or cell.hyperlink
  if (cell.hyperlink) return String(cell.hyperlink).trim();
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.hyperlink) return String(v.hyperlink).trim();
    if (v.text && v.hyperlink) return String(v.hyperlink).trim();
    if (v.text) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (v.richText) return v.richText.map(t => t.text).join('').trim();
    // Date
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).trim();
}

function pickValor(rowNorm, aliases) {
  for (const alias of aliases) {
    const an = normalizeHeader(alias);
    // exact match first
    if (rowNorm[an] !== undefined && String(rowNorm[an]).trim() !== '') return rowNorm[an];
    // includes match
    for (const [k, val] of Object.entries(rowNorm)) {
      if (k === an || k.includes(an) || an.includes(k)) {
        // avoid false positive: 'activo' should not match 'activo grupos' via includes? handle that
        // For 'activo' distinct from 'activo grupos', require exact or k startsWith alias + ' '
        if (an === 'activo' && k === 'activo grupos') continue;
        if (String(val).trim() !== '') return val;
      }
    }
  }
  return '';
}

function pickValorPreferNoPlaceholder(rowNorm, aliasesInOrder) {
  let firstNonPlaceholder = null;
  let firstAny = null;
  for (const alias of aliasesInOrder) {
    const an = normalizeHeader(alias);
    let candidate = null;
    if (rowNorm[an] !== undefined) candidate = rowNorm[an];
    else {
      for (const [k, val] of Object.entries(rowNorm)) {
        if (k === an || k.includes(an) || an.includes(k)) {
          if (an === 'activo' && k === 'activo grupos') continue;
          candidate = val;
          break;
        }
      }
    }
    if (candidate == null || String(candidate).trim() === '') continue;
    if (firstAny == null) firstAny = candidate;
    if (!isPlaceholder(candidate)) {
      // prefer non-placeholder of higher priority alias
      return candidate;
    }
    if (firstNonPlaceholder == null && !isPlaceholder(candidate)) firstNonPlaceholder = candidate;
  }
  return firstNonPlaceholder ?? firstAny ?? '';
}

function parsearValor(str) {
  if (!str) return 0;
  let s = String(str).trim();
  s = s.replace(/^\$/, '').trim();
  // Colombian thousands: "$247.090" -> 247090, "230,452" -> 230452
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1] && parts[1].length === 3 && /^\d+$/.test(parts[1])) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else if (s.includes('.')) {
    // "247.090" thousands, "15884" no sep, "0.480" would be decimal but not in valor
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
  }
  // remove any remaining spaces
  s = s.replace(/\s/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

function parsearCantidad(str) {
  if (!str) return 1;
  const s = String(str).trim().toLowerCase();
  // extract first number (allow decimal comma/dot)
  const m = s.match(/[\d]+(?:[.,]\d+)?/);
  if (!m) return 1;
  let numStr = m[0].replace(',', '.');
  const n = parseFloat(numStr);
  if (isNaN(n)) return 1;
  return n;
}

function parsearFecha(str) {
  if (!str) return null;
  if (str instanceof Date) {
    if (!isNaN(str.getTime())) return str.toISOString().split('T')[0];
    return null;
  }
  const s = String(str).trim();
  const parts = s.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function parsearHora(str) {
  if (!str) return null;
  if (str instanceof Date) {
    return `${String(str.getHours()).padStart(2, '0')}:${String(str.getMinutes()).padStart(2, '0')}:00`;
  }
  const s = String(str).trim();
  // support "07:34" or "7:34"
  const parts = s.split(':');
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  }
  return null;
}

function parsearCoordenadas(str) {
  if (!str) return { latitud: null, longitud: null };
  const s = String(str).trim();
  const parts = s.split(',').map(p => parseFloat(p.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { latitud: parts[0], longitud: parts[1] };
  }
  return { latitud: null, longitud: null };
}

function normalizarCausa(str) {
  if (!str) return 'Otra';
  const raw = String(str).trim();
  const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // direct map after normalizing key
  const normKey = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (CAUSA_MAP[normKey]) return CAUSA_MAP[normKey];
  if (CAUSA_MAP[s]) return CAUSA_MAP[s];
  for (const rule of CAUSA_KEYWORDS) {
    if (rule.keywords.some(kw => {
      const kn = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return s.includes(kn);
    })) return rule.result;
  }
  return raw || 'Otra';
}

function normalizarNombre(str) {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function parsearProductos(texto) {
  if (!texto) return [];
  const lineas = String(texto).split(/\n/).map(l => l.trim()).filter(Boolean);
  return lineas.map(linea => {
    // New format contains comma as separator: "REF, cantidad, causal"
    if (linea.includes(',')) {
      const parts = linea.split(',').map(p => p.trim());
      // Heuristic: if at least 2 parts, treat as new format
      // Old format never has comma, so safe
      const nombreRaw = parts[0] || linea;
      const cantidadRaw = parts[1] || '';
      const causalRaw = parts.slice(2).join(',').trim();
      const cantidad = cantidadRaw ? parsearCantidad(cantidadRaw) : 1;
      // keep causal per product if present
      if (causalRaw) {
        return { nombre: nombreRaw, cantidad, causa: causalRaw, causa_normalizada: normalizarCausa(causalRaw) };
      }
      // if no causal, fallback to simple
      return { nombre: nombreRaw, cantidad };
    }
    const match = linea.match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\)\s*$/);
    if (match) {
      return { nombre: match[1].trim(), cantidad: parsearCantidad(match[2]) };
    }
    return { nombre: linea, cantidad: 1 };
  });
}

function derivarCausaGlobal(productos, causaRawLegacy) {
  // If productos have per-product causas, pick most frequent normalized
  const causas = productos.map(p => p.causa_normalizada || (p.causa ? normalizarCausa(p.causa) : null)).filter(Boolean);
  if (causas.length > 0) {
    const freq = {};
    for (const c of causas) freq[c] = (freq[c] || 0) + 1;
    let best = 'Otra';
    let max = 0;
    for (const [k, v] of Object.entries(freq)) {
      if (v > max && k !== 'Otra') { best = k; max = v; }
    }
    // if all 'Otra', return first causa raw normalized
    if (max === 0) return normalizarCausa(causas[0]);
    return best;
  }
  if (causaRawLegacy) return normalizarCausa(causaRawLegacy);
  return 'Otra';
}

export async function parsearSmart2GoDevoluciones(rutaArchivo) {
  try {
    const ext = rutaArchivo.toLowerCase().split('.').pop();
    let rows = [];

    if (ext === 'csv') {
      const contenido = fs.readFileSync(rutaArchivo, 'utf8');
      const lineas = contenido.split('\n').filter(l => l.trim());
      if (lineas.length < 2) return { exitosa: false, error: 'Archivo CSV vacío o sin datos' };

      const headers = lineas[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
      for (let i = 1; i < lineas.length; i++) {
        const vals = lineas[i].split(';').map(v => v.replace(/^"|"$/g, '').trim());
        const row = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
        rows.push(row);
      }
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(rutaArchivo);
      const ws = workbook.worksheets[0];
      const headerRow = ws.getRow(1);
      const headers = [];
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = extraerValorCelda(cell) || String(cell.value || '').trim();
      });

      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};
        row.eachCell((cell, colNumber) => {
          const key = headers[colNumber];
          if (key) obj[key] = extraerValorCelda(cell);
          // also fallback: if header missing but cell has value, ignore
        });
        // skip completely empty rows
        const hasAny = Object.values(obj).some(v => String(v).trim() !== '');
        if (hasAny) rows.push(obj);
      });
    }

    const registros = [];
    const errores = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const r = rows[i];
        // Build normalized map for flexible lookup
        const rowNorm = {};
        for (const [k, v] of Object.entries(r)) {
          const nk = normalizeHeader(k);
          if (nk) rowNorm[nk] = v;
        }

        const fuenteId = pickValor(rowNorm, ['id']) || null;
        const fechaRaw = pickValor(rowNorm, ['fecha reporte', 'fecha']);
        const fechaReporte = parsearFecha(fechaRaw);
        const horaReporte = parsearHora(pickValor(rowNorm, ['hora']));
        const posicionRaw = pickValor(rowNorm, ['posicion', 'posicion ']);
        const { latitud, longitud } = parsearCoordenadas(posicionRaw);

        // Cliente: prefer NOMBRE DEL CLIENTE, fallback Cliente
        const cliente = pickValorPreferNoPlaceholder(rowNorm, ['nombre del cliente', 'cliente']);
        const causaRawLegacy = pickValor(rowNorm, ['causa de devolucion', 'causa devolucion']);
        const valorRaw = pickValor(rowNorm, ['valor de devolucion', 'valor devolucion', 'valor devolucion ']) || '0';
        // Productos: referencias
        const productosTexto = pickValor(rowNorm, ['referencias', 'referencias a devolver']) || '';
        const conductorRaw = pickValor(rowNorm, ['nombre del conductor y placas del vehiculo', 'nombre conductor y placa vehiculo', 'nombre del conductor', 'nombre conductor']) || '';
        const entregadoRaw = pickValor(rowNorm, ['entrego la devoluion al conductor', 'le entrego la devolucion a un conductor', 'entrego la devolucion', 'entregado conductor']) || '';
        const entregadoNorm = normalizeHeader(entregadoRaw);

        if (!cliente || isPlaceholder(cliente) || !fechaReporte) {
          errores.push({ fila: i + 2, error: 'Falta cliente o fecha', datos: r });
          continue;
        }

        // Centro: normalize placeholders item* -> null
        let centroRaw = pickValor(rowNorm, ['centro de operaciones', 'centro operaciones']) || '';
        if (isPlaceholder(centroRaw)) centroRaw = '';

        const placaMatch = conductorRaw.match(/([A-Z]{3}\d{3}|[A-Z]{3}\s?\d{2}[A-Z]|[A-Z]{3}-?\d{3})/i);
        let conductorNombre = conductorRaw.replace(/([A-Z]{3}\d{3}|[A-Z]{3}\s?\d{2}[A-Z]|[A-Z]{3}-?\d{3})/i, '').replace(/\n/g, ' ').trim();
        if (conductorNombre && normalizeHeader(conductorNombre) === 'no') conductorNombre = '';

        const productos = parsearProductos(productosTexto);
        const causa = derivarCausaGlobal(productos, causaRawLegacy);
        // causa_detalle: solo columna exacta "Observaciones" (evita confundir con "REFERENCIAS ... OBSERVACIONES")
        let causaDetalle = rowNorm['observaciones'] || rowNorm['observacion'] || '';
        // Si la cabecera combinada contiene referencias, no es observaciones real -> ignorar
        if (causaDetalle && Object.keys(rowNorm).some(k => k.includes('referencias') && k.includes('observaciones'))) {
          // Si existe header combinado, el valor ya es productos_texto, no detalle
          const headerEsCombinado = Object.keys(rowNorm).some(k => k.includes('referencias') && k.includes('observaciones'));
          if (headerEsCombinado) causaDetalle = '';
        }
        if (!causaDetalle && productos.some(p => p.causa)) {
          const causalesUnicas = [...new Set(productos.map(p => p.causa).filter(Boolean))];
          if (causalesUnicas.length > 1) causaDetalle = causalesUnicas.join(' | ');
          else if (causalesUnicas.length === 1 && normalizarCausa(causalesUnicas[0]) !== causa) causaDetalle = causalesUnicas[0];
        }

        const fotoRaw = pickValor(rowNorm, ['foto del documento de la devolucion', 'foto del documento o de la devolucion']) || null;
        const fotoUrl = fotoRaw && String(fotoRaw).trim() && !isPlaceholder(fotoRaw) ? String(fotoRaw).trim() : null;

        registros.push({
          fuente_id: fuenteId ? String(fuenteId).trim() : null,
          fecha_reporte: fechaReporte,
          hora_reporte: horaReporte,
          centro_operaciones: centroRaw ? String(centroRaw).trim() : null,
          cliente_nombre: String(cliente).trim(),
          sucursal: (pickValor(rowNorm, ['sucursal']) || '').trim() || null,
          latitud,
          longitud,
          direccion: (pickValor(rowNorm, ['direccion']) || '').trim() || null,
          documento_devolucion: (pickValor(rowNorm, ['n de documento devolucion', 'n documento devolucion', 'numero de documento', 'n documento']) || '').trim() || null,
          quien_recibe: (pickValor(rowNorm, ['quien recibe la devolucion']) || '').trim() || null,
          mercaderista: normalizarNombre(pickValor(rowNorm, ['activo']) || ''),
          productos,
          productos_texto: String(productosTexto).trim(),
          valor_total: parsearValor(valorRaw),
          causa,
          causa_detalle: causaDetalle ? String(causaDetalle).trim() : null,
          entregado_conductor: entregadoNorm === 'si' || entregadoNorm === 's' || entregadoNorm.startsWith('si'),
          conductor_nombre: conductorNombre && !isPlaceholder(conductorNombre) ? conductorNombre : null,
          conductor_placa: placaMatch ? placaMatch[0].toUpperCase().replace(/\s/g, '').replace(/-/g, '') : null,
          foto_url: fotoUrl,
        });
      } catch (e) {
        errores.push({ fila: i + 2, error: e.message });
      }
    }

    return { exitosa: true, registros, errores, total: rows.length };
  } catch (err) {
    return { exitosa: false, error: err.message };
  }
}
