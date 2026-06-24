import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const COLUMNS = [
  'codigo', 'razon_social', 'canal', 'estado', 'direccion',
  'ciudad', 'depto', 'rutas_vehiculos', 'rutas_motos'
];

export async function parsearMaestroClientes(rutaArchivo) {
  try {
    const ext = path.extname(rutaArchivo).toLowerCase();
    let datos = [];

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(rutaArchivo);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      datos = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    } else if (ext === '.txt' || ext === '.csv' || ext === '.tsv') {
      const raw = fs.readFileSync(rutaArchivo, 'utf8');
      const lines = raw.split(/\r?\n/).filter(l => l.trim());
      const delimiter = raw.includes('\t') ? '\t' : ';';
      datos = lines.map(l => l.split(delimiter).map(c => c.trim()));
    } else {
      return { exitosa: false, error: 'Formato no soportado: ' + ext };
    }

    if (datos.length < 2) {
      return { exitosa: false, error: 'El archivo no tiene datos' };
    }

    const headers = datos[0].map(h => normalizarHeader(h));
    const colIndex = {};
    for (const [i, h] of headers.entries()) {
      if (h === 'codigo') colIndex.codigo = i;
      else if (h === 'razon_social' || h.includes('razon')) colIndex.razon_social = i;
      else if (h === 'canal') colIndex.canal = i;
      else if (h === 'estado') colIndex.estado = i;
      else if (h === 'direccion' || h.includes('direccion')) colIndex.direccion = i;
      else if (h === 'ciudad') colIndex.ciudad = i;
      else if (h === 'depto' || h.includes('depto')) colIndex.depto = i;
      else if (h.includes('rutas_vehiculos') || h.includes('ruta_vehiculo')) colIndex.rutas_vehiculos = i;
      else if (h.includes('rutas_motos') || h.includes('ruta_moto')) colIndex.rutas_motos = i;
    }

    if (colIndex.razon_social === undefined) {
      return { exitosa: false, error: 'No se encontró columna "Razón social". Encabezados: ' + headers.join(', ') };
    }

    const clientes = [];
    const errores = [];

    for (let i = 1; i < datos.length; i++) {
      const fila = datos[i];
      if (!fila || fila.every(c => !c)) continue;

      const nombre = String(fila[colIndex.razon_social] || '').trim();
      if (!nombre) continue;

      clientes.push({
        codigo: colIndex.codigo !== undefined ? String(fila[colIndex.codigo] || '').trim() : '',
        nombre,
        canal: colIndex.canal !== undefined ? String(fila[colIndex.canal] || '').trim() : '',
        estado: colIndex.estado !== undefined ? String(fila[colIndex.estado] || '').trim() : '',
        direccion: colIndex.direccion !== undefined ? String(fila[colIndex.direccion] || '').trim() : '',
        ciudad: colIndex.ciudad !== undefined ? String(fila[colIndex.ciudad] || '').trim() : '',
        depto: colIndex.depto !== undefined ? String(fila[colIndex.depto] || '').trim() : '',
        ruta: colIndex.rutas_vehiculos !== undefined ? String(fila[colIndex.rutas_vehiculos] || '').trim() : '',
        ruta_moto: colIndex.rutas_motos !== undefined ? String(fila[colIndex.rutas_motos] || '').trim() : ''
      });
    }

    return {
      exitosa: true,
      total: clientes.length,
      clientes,
      errores
    };
  } catch (err) {
    console.error('Error al parsear maestro clientes:', err);
    return { exitosa: false, error: err.message, clientes: [] };
  }
}

function normalizarHeader(h) {
  return String(h)
    .toLowerCase()
    .replace(/[^a-záéíóúñ0-9_/\s-]/g, '')
    .replace(/[\s/-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}
