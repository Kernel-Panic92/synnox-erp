import ExcelJS from 'exceljs';
import fs from 'fs';

const CAUSA_MAP = {
  'f.v': 'Fecha vencimiento',
  'fv': 'Fecha vencimiento',
  'fecha': 'Fecha vencimiento',
  'fecha vencimiento': 'Fecha vencimiento',
  'fecha vto': 'Fecha vencimiento',
  'calidad': 'Calidad',
  'mal estado': 'Mal estado',
  'rotura': 'Rotura',
  'dano': 'Daño',
  'daño': 'Daño',
};

function parsearValor(str) {
  if (!str) return 0;
  let s = String(str).trim();
  s = s.replace(/^\$/, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parsearFecha(str) {
  if (!str) return null;
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
  const s = String(str).trim();
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
  const s = String(str).trim().toLowerCase();
  return CAUSA_MAP[s] || str.trim();
}

function parsearProductos(texto) {
  if (!texto) return [];
  const lineas = String(texto).split(/\n/).map(l => l.trim()).filter(Boolean);
  return lineas.map(linea => {
    const match = linea.match(/^(.+?)\s*\((\d+)\)\s*$/);
    if (match) {
      return { nombre: match[1].trim(), cantidad: parseInt(match[2]) };
    }
    return { nombre: linea, cantidad: 1 };
  });
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
        headers[colNumber] = String(cell.value || '').trim();
      });

      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};
        row.eachCell((cell, colNumber) => {
          const key = headers[colNumber];
          if (key) obj[key] = cell.value ?? '';
        });
        rows.push(obj);
      });
    }

    const registros = [];
    const errores = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const r = rows[i];
        const fuenteId = r['ID'] || r['id'] || null;
        const fechaReporte = parsearFecha(r['FECHA REPORTE'] || r['Fecha']);
        const horaReporte = parsearHora(r['Hora']);
        const { latitud, longitud } = parsearCoordenadas(r['Posición'] || r['Posicion']);
        const cliente = r['CLIENTE'] || r['Cliente'] || '';
        const causaRaw = r['CAUSA DEVOLUCIÓN'] || r['CAUSA DEVOLUCION'] || '';
        const valorRaw = r['Valor devolución.'] || r['Valor devolución'] || r['Valor devolucion'] || '0';
        const productosTexto = r['REFERENCIAS A DEVOLVER'] || '';
        const conductorRaw = r['NOMBRE CONDUCTOR Y PLACA VEHICULO'] || '';
        const entregado = (r['¿Le entregó la devolución a un conductor?'] || '').toUpperCase().trim();

        if (!cliente || !fechaReporte) {
          errores.push({ fila: i + 2, error: 'Falta cliente o fecha', datos: r });
          continue;
        }

        const placaMatch = conductorRaw.match(/([A-Z]{3}\d{3}|[A-Z]{3}\s?\d{2}[A-Z])/i);
        const conductorNombre = conductorRaw.replace(/[A-Z]{3}\d{3}|[A-Z]{3}\s?\d{2}[A-Z]/i, '').replace(/\n/g, ' ').trim();

        registros.push({
          fuente_id: fuenteId,
          fecha_reporte: fechaReporte,
          hora_reporte: horaReporte,
          centro_operaciones: (r['CENTRO OPERACIONES'] || '').trim(),
          cliente_nombre: cliente.trim(),
          sucursal: (r['SUCURSAL'] || '').trim(),
          latitud,
          longitud,
          direccion: (r['Dirección'] || r['Direccion'] || '').trim(),
          documento_devolucion: (r['N°  DOCUMENTO DE DEVOLUCIÓN '] || r['N° DOCUMENTO DE DEVOLUCIÓN'] || '').trim(),
          quien_recibe: (r['¿Quien recibe la devolución?'] || '').trim(),
          mercaderista: (r['Activo'] || '').trim(),
          productos: parsearProductos(productosTexto),
          productos_texto: productosTexto.trim(),
          valor_total: parsearValor(valorRaw),
          causa: normalizarCausa(causaRaw),
          causa_detalle: (r['Observaciones'] || '').trim(),
          entregado_conductor: entregado === 'SI',
          conductor_nombre: conductorNombre || null,
          conductor_placa: placaMatch ? placaMatch[0].toUpperCase().replace(/\s/g, '') : null,
          foto_url: (r['Foto del documento o de la devolución'] || '').trim() || null,
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
