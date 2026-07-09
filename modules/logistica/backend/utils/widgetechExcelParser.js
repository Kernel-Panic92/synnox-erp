import XLSX from 'xlsx';

/**
 * Parsea el Excel de Widetech - Histórico Programado
 * Extrae: placa, fecha, lat, lng, velocidad, ubicación
 */
export async function parsearWidetech(rutaArchivo) {
  try {
    const workbook = XLSX.readFile(rutaArchivo);
    const sheetName = workbook.SheetNames[0]; // Primer sheet
    const worksheet = workbook.Sheets[sheetName];

    // Convertir a JSON
    const datos = XLSX.utils.sheet_to_json(worksheet, {
      header: 1, // Array de arrays
      defval: ''
    });

    // Detectar fila de encabezados (generalmente fila 1 después del título)
    let headerIndex = 0;
    for (let i = 0; i < Math.min(5, datos.length); i++) {
      const fila = datos[i];
      if (fila[0] === 'Placa' || (Array.isArray(fila) && fila.some(cell => String(cell).includes('Placa')))) {
        headerIndex = i;
        break;
      }
    }

    const headers = datos[headerIndex] || [];
    const registros = [];

    // Mapear columnas
    const indicePla = headers.indexOf('Placa');
    const indiceAlias = headers.indexOf('Alias');
    const indiceFechaGPS = headers.indexOf('Fecha GPS');
    const indiceLocalizacion = headers.indexOf('Localizacion');
    const indiceVelocidad = headers.indexOf('Velocidad');
    const indiceRumbo = headers.indexOf('Rumbo');
    const indiceLat = headers.indexOf('Lat');
    const indiceLng = headers.indexOf('Lng');
    const indiceTemp1 = headers.indexOf('TEMPS1');
    const indiceTemp2 = headers.indexOf('TEMPS2');

    // Procesar filas de datos
    for (let i = headerIndex + 1; i < datos.length; i++) {
      const fila = datos[i];
      
      if (!fila[indicePla] || String(fila[indicePla]).trim() === '') continue;

      const registro = {
        placa: String(fila[indicePla]).trim(),
        alias: fila[indiceAlias] ? String(fila[indiceAlias]).trim() : null,
        fechaGPS: fila[indiceFechaGPS] ? new Date(fila[indiceFechaGPS]) : null,
        localizacion: fila[indiceLocalizacion] ? String(fila[indiceLocalizacion]).trim() : '',
        velocidad: fila[indiceVelocidad] ? parseFloat(fila[indiceVelocidad]) : 0,
        rumbo: fila[indiceRumbo] ? String(fila[indiceRumbo]).trim() : '',
        latitud: fila[indiceLat] ? parseFloat(fila[indiceLat]) : null,
        longitud: fila[indiceLng] ? parseFloat(fila[indiceLng]) : null,
        tempSensor1: fila[indiceTemp1] ? parseFloat(String(fila[indiceTemp1]).replace('_', '')) : null,
        tempSensor2: fila[indiceTemp2] ? parseFloat(String(fila[indiceTemp2]).replace('_', '')) : null
      };

      if (registro.latitud && registro.longitud) {
        registros.push(registro);
      }
    }

    return {
      exitosa: true,
      totalRegistros: registros.length,
      vehiculosUnicos: [...new Set(registros.map(r => r.placa))].length,
      registros,
      primeras5: registros.slice(0, 5)
    };
  } catch (err) {
    console.error('Error al parsear Widetech:', err);
    return {
      exitosa: false,
      error: err.message,
      registros: []
    };
  }
}

/**
 * Agrupar registros de Widetech por vehículo
 * y obtener la última posición conocida
 */
export function obtenerUltimaPosicionPorVehiculo(registros) {
  const vehiculosMap = {};

  for (const registro of registros) {
    if (!vehiculosMap[registro.placa]) {
      vehiculosMap[registro.placa] = registro;
    } else {
      // Mantener el más reciente
      if (new Date(registro.fechaGPS) > new Date(vehiculosMap[registro.placa].fechaGPS)) {
        vehiculosMap[registro.placa] = registro;
      }
    }
  }

  return Object.values(vehiculosMap);
}

/**
 * Validar que los datos de Widetech sean válidos
 */
export function validarDatosWidetech(registro) {
  const errores = [];

  if (!registro.placa) errores.push('Placa vacía');
  if (!registro.latitud || !registro.longitud) errores.push('Coordenadas inválidas');
  if (!registro.fechaGPS) errores.push('Fecha GPS inválida');

  return {
    valido: errores.length === 0,
    errores
  };
}
