import pdfParse from 'pdf-parse';
import fs from 'fs';

const CIUDADES_CONOCIDAS = [
  'santa bárbara', 'santa barbara', 'la pintada', 'pintada',
  'el jardín', 'el jardin', 'jardín', 'jardin',
  'medellín', 'medellin', 'caldas', 'andes',
  'itagüí', 'itagui', 'envigado', 'bello', 'sabaneta'
];

export async function parsearPdfSiesa(rutaArchivo) {
  try {
    const dataBuffer = fs.readFileSync(rutaArchivo);
    const data = await pdfParse(dataBuffer);
    const texto = data.text;
    const lineas = texto.split('\n').map(l => l.trim());

    const meta = { conductor: null, placa: null, nroGuia: null, fecha: null };
    const pedidos = [];
    const debug = {};

    // 1. Metadata
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const sig = i + 1 < lineas.length ? lineas[i + 1] : null;
      if (!l) continue;
      if (/conductor/i.test(l) && !meta.conductor) meta.conductor = extraerValor(l, sig);
      if (/placa/i.test(l) && !/alias/i.test(l) && !meta.placa) meta.placa = extraerValor(l, sig);
      if (/(nro\.?\s*guia|guía)/i.test(l) && !meta.nroGuia) meta.nroGuia = extraerValor(l, sig);
      if (/fecha/i.test(l) && !/gps/i.test(l) && !meta.fecha) { const f = extraerValor(l, sig); if (f) meta.fecha = f; }
      if (!meta.nroGuia && /^CPL[-]\d+/i.test(l.trim())) meta.nroGuia = l.trim();
    }

    // 2. Buscar FEVs — formato: "ValorContado[?] ValorCredito FEV-XXXXX"
    //    Dos valores separados por espacio, opcional el primero (contado)
    const fevMatches = [];
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      // Captura 1 o 2 valores antes de FEV
      const match = l.match(/(\d[\d\.]*,\d{2})(?:\s+(\d[\d\.]*,\d{2}))?\s+FEV[-\s]?(\d+)/i);
      if (!match) continue;
      const valorContado = match[1];
      const valorCredito = match[2] || match[1];
      const fevNum = match[3];
      // Cliente está en la línea ANTERIOR (si no empieza con dígito de valor)
      let clienteLine = '';
      if (i > 0) {
        const prev = lineas[i - 1];
        if (prev && !/^\d/.test(prev) && !/FEV/i.test(prev) && !/total|documento|conductor|placa|nro\.?guia|viene|continúa/i.test(prev)) {
          clienteLine = prev;
        }
      }
      fevMatches.push({
        lineIndex: i,
        fevNumber: 'FEV-' + fevNum,
        valor: parsearValorColombiano(valorCredito),
        valorContado: parsearValorColombiano(valorContado),
        cliente: clienteLine,
        ciudad: '', direccion: '', telefono: ''
      });
    }

    // 3. Si no se encontraron con el patrón de 2 valores, probar con 1 valor
    if (fevMatches.length === 0) {
      debug.fallbackUsada = true;
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        const match = l.match(/(\d[\d\.]*,\d{2})\s+FEV[-\s]?(\d+)/i);
        if (!match) continue;
        let clienteLine = '';
        if (i > 0) {
          const prev = lineas[i - 1];
          if (prev && !/^\d/.test(prev) && !/FEV/i.test(prev) && !/total|documento|conductor|placa|nro\.?guia|viene|continúa/i.test(prev)) {
            clienteLine = prev;
          }
        }
        const v = parsearValorColombiano(match[1]);
        fevMatches.push({
          lineIndex: i,
          fevNumber: 'FEV-' + match[2],
          valor: v,
          valorContado: v,
          cliente: clienteLine,
          ciudad: '', direccion: '', telefono: ''
        });
      }
    }

    // 4. Extraer ciudad+dirección+tel de la línea SIGUIENTE
    for (const fev of fevMatches) {
      const nextIdx = fev.lineIndex + 1;
      if (nextIdx >= lineas.length) continue;
      const nl = lineas[nextIdx];
      if (!nl || nl.startsWith('**') || /total|documento|conductor|placa|viene|continúa/i.test(nl)) continue;

      const phoneMatch = nl.match(/(\d{7,15})\s*$/);
      fev.telefono = phoneMatch ? phoneMatch[1] : '';
      const resto = phoneMatch ? nl.substring(0, phoneMatch.index).trim() : nl;

      const { ciudad, direccion } = separarCiudadDireccion(resto);
      fev.ciudad = ciudad;
      fev.direccion = direccion;
    }

    // 5. Construir pedidos
    for (const fev of fevMatches) {
      pedidos.push({
        numeroFactura: fev.fevNumber,
        clienteNombre: limpiarNombreCliente(fev.cliente || ''),
        direccion: fev.direccion || '',
        ciudad: fev.ciudad || '',
        telefono: fev.telefono || '',
        valor: fev.valor || 0,
        valorContado: fev.valorContado || 0,
        conductor: meta.conductor || '',
        placa: meta.placa || '',
        nroGuia: meta.nroGuia || ''
      });
    }

    debug.fevEncontrados = fevMatches.length;
    debug.fevs = fevMatches.map(f => ({
      idx: f.lineIndex,
      fev: f.fevNumber,
      cliente: f.cliente,
      valor: f.valor,
      valorContado: f.valorContado,
      ciudad: f.ciudad,
      direccion: f.direccion,
      telefono: f.telefono,
    }));
    debug.rawText = lineas.slice(0, 80).join('\n');
    return {
      exitosa: true,
      ...meta,
      totalPedidos: pedidos.length,
      pedidos,
      _debug: debug
    };
  } catch (err) {
    console.error('Error al parsear PDF:', err);
    return { exitosa: false, error: err.message, pedidos: [], _debug: { error: err.message } };
  }
}

function separarCiudadDireccion(texto) {
  if (!texto) return { ciudad: '', direccion: '' };
  const candidatas = [...CIUDADES_CONOCIDAS].sort((a, b) => b.length - a.length);
  const lower = texto.toLowerCase();
  for (const ciudad of candidatas) {
    if (lower.startsWith(ciudad)) {
      return {
        ciudad: texto.substring(0, ciudad.length),
        direccion: texto.substring(ciudad.length).trim()
      };
    }
  }
  const partes = texto.split(/\s+/);
  return { ciudad: partes[0] || texto, direccion: partes.slice(1).join(' ') || '' };
}

function extraerValor(lineaActual, lineaSiguiente) {
  if (lineaActual.includes(':')) {
    const parts = lineaActual.split(':');
    if (parts.length >= 2) {
      const v = parts.slice(1).join(':').trim();
      if (v && v.length < 80) return v;
    }
  }
  if (lineaSiguiente && lineaSiguiente.length < 80 && !/FEV|total|documento|\*\*/i.test(lineaSiguiente)) {
    return lineaSiguiente.trim();
  }
  return null;
}

function limpiarNombreCliente(nombre) {
  if (!nombre) return '';
  let limpio = nombre
    .replace(/\s+\d[\d\.,]+\s*(FEV[-\s]\d+)?\s*$/i, '')
    .replace(/\s+FEV[-\s]\d+\s*$/i, '')
    .replace(/\s+$/, '')
    .trim();
  if (/^[\d\.,\s]+$/.test(limpio)) return '';
  return limpio;
}

function parsearValorColombiano(s) {
  if (!s) return 0;
  let limpio = String(s).trim();
  const commaCount = (limpio.match(/,/g) || []).length;
  if (commaCount > 1) {
    const lastComma = limpio.lastIndexOf(',');
    limpio = limpio.substring(0, lastComma).replace(/\./g, '') + '.' + limpio.substring(lastComma + 1);
  } else if (commaCount === 1) {
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    limpio = limpio.replace(/\./g, '');
  }
  const n = parseFloat(limpio);
  return isNaN(n) ? 0 : n;
}
