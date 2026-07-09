import crypto from 'crypto';
import pool from '../config/db.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'HorixLogistics/1.0 (vitamar)';
let ultimaSolicitud = 0;

function esperarMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hashDireccion(dir) {
  return crypto.createHash('sha256').update(dir.toLowerCase().trim()).digest('hex');
}

function normalizarDireccion(dir) {
  if (!dir) return '';
  return dir
    .replace(/\bCarrera\b/gi, 'Cra')
    .replace(/\bCalle\b/gi, 'Cl')
    .replace(/\bAvenida\b/gi, 'Av')
    .replace(/\bTransversal\b/gi, 'Tv')
    .replace(/\bDiagonal\b/gi, 'Dg')
    .replace(/\bCircular\b/gi, 'Cr')
    .replace(/\bAutopista\b/gi, 'Aut')
    .replace(/\bNorte\b/gi, 'N')
    .replace(/\bSur\b/gi, 'S')
    .replace(/\bEste\b/gi, 'E')
    .replace(/\bOeste\b/gi, 'O')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function geocodificar(direccion, ciudad, pais = 'Colombia') {
  if (!direccion) return null;

  const dirNormalizada = normalizarDireccion(direccion);
  const h = hashDireccion(dirNormalizada + ciudad);

  const cache = await pool.query('SELECT latitud, longitud, display_name, es_exacto FROM logistics.cache_geocoding WHERE direccion_hash=$1', [h]);
  if (cache.rows.length > 0) {
    const r = cache.rows[0];
    return r.latitud ? { lat: r.latitud, lng: r.longitud, displayName: r.display_name, exacto: r.es_exacto, cache: true } : null;
  }

  const q = encodeURIComponent([dirNormalizada, ciudad, pais].filter(Boolean).join(', '));
  const url = `${NOMINATIM_URL}/search?q=${q}&format=json&limit=1&addressdetails=0`;

  const ahora = Date.now();
  const diff = ahora - ultimaSolicitud;
  if (diff < 1100) await esperarMs(1100 - diff);
  ultimaSolicitud = Date.now();

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = await res.json();

    if (data && data.length > 0) {
      const r = data[0];
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      const exacto = r.importance > 0.5 || r.type === 'house_number' || r.type === 'amenity';
      await pool.query(
        'INSERT INTO logistics.cache_geocoding (direccion_hash, direccion_original, latitud, longitud, display_name, es_exacto) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (direccion_hash) DO NOTHING',
        [h, dirNormalizada + ', ' + ciudad, lat, lng, r.display_name || '', exacto]
      );
      return { lat, lng, displayName: r.display_name, exacto, cache: false };
    }

    await pool.query(
      'INSERT INTO logistics.cache_geocoding (direccion_hash, direccion_original) VALUES ($1,$2) ON CONFLICT (direccion_hash) DO NOTHING',
      [h, dirNormalizada + ', ' + ciudad]
    );
    return null;
  } catch (err) {
    console.error('Error geocodificando:', direccion, err.message);
    return null;
  }
}

export async function geocodificarLote(pedidos, onProgreso) {
  const resultados = [];
  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    const coords = await geocodificar(p.direccion, p.ciudad);
    resultados.push({ ...p, latitud: coords?.lat || null, longitud: coords?.lng || null });
    if (onProgreso) onProgreso(i + 1, pedidos.length);
  }
  return resultados;
}
