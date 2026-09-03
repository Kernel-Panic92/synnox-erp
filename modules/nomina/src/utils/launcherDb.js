/**
 * Centros de operación — Nómina
 *
 * Antes: leía launcher.db con better-sqlite3 de forma síncrona en cada request
 *        (bloquea el event loop, acopla al filesystem, bypassa el cache del launcher).
 * Ahora: sin I/O síncrono. Usa el cache en memoria del launcher cuando Nómina
 *        corre como sub-app (mismo proceso Node, `globalThis.__centrosCache`),
 *        y fallback HTTP con cache TTL 30s cuando corre standalone.
 *
 * Launcher es fuente única de verdad. CRUD en launcher, nómina solo consume
 * vía GET /api/centros (convención AGENTS.md).
 */

const LAUNCHER_URL = process.env.LAUNCHER_URL || `http://127.0.0.1:${process.env.PORT || 3002}`;
const TTL_MS = 30000;

let _cache = null;      // Array de centros o null (no cargado)
let _cacheTs = 0;
let _fetchInFlight = null;

function readGlobalCache() {
  const gc = globalThis.__centrosCache;
  if (Array.isArray(gc)) return gc;
  return null;
}

function getCachedSync() {
  const gc = readGlobalCache();
  if (gc) {
    // Sincronizar cache local con el global (el launcher invalida cada 30s)
    if (gc !== _cache) {
      _cache = gc;
      _cacheTs = Date.now();
    }
    return gc;
  }
  if (_cache && (Date.now() - _cacheTs) < TTL_MS) return _cache;
  return _cache || [];
}

async function refreshFromLauncher() {
  const gc = readGlobalCache();
  if (gc) {
    _cache = gc;
    _cacheTs = Date.now();
    return _cache;
  }
  if (_cache && (Date.now() - _cacheTs) < TTL_MS) return _cache;
  if (_fetchInFlight) return _fetchInFlight;
  _fetchInFlight = (async () => {
    try {
      const res = await fetch(`${LAUNCHER_URL}/api/centros`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          _cache = data;
          _cacheTs = Date.now();
        }
      }
    } catch {}
    _fetchInFlight = null;
    return _cache || [];
  })();
  return _fetchInFlight;
}

// Warm cache en background al cargar el módulo (no bloquea el require)
if (readGlobalCache()) {
  getCachedSync();
} else {
  refreshFromLauncher().catch(() => {});
}

// Sincronizar periódicamente con el global (invalida cuando el launcher hace POST/PUT/DELETE)
const _syncInterval = setInterval(() => {
  const gc = readGlobalCache();
  if (gc && gc !== _cache) {
    _cache = gc;
    _cacheTs = Date.now();
  }
}, 5000);
if (_syncInterval.unref) _syncInterval.unref();

// ── API síncrona (lee del cache en memoria, sin I/O) ──
function validarSede(sede) {
  if (!sede) return false;
  const centros = getCachedSync();
  return centros.some(c => c.nombre === sede && c.activo !== 0);
}

function getCentros() {
  return [...getCachedSync()];
}

function getSedesActivas() {
  return getCachedSync()
    .filter(c => c.activo !== 0)
    .map(c => c.nombre)
    .sort((a, b) => a.localeCompare(b));
}

// ── API asíncrona (refresca si el cache expiró / no cargado) ──
async function validarSedeAsync(sede) {
  if (!sede) return false;
  const centros = await refreshFromLauncher();
  return centros.some(c => c.nombre === sede && c.activo !== 0);
}

async function getCentrosAsync() {
  const centros = await refreshFromLauncher();
  return [...centros];
}

async function getSedesActivasAsync() {
  const centros = await refreshFromLauncher();
  return centros.filter(c => c.activo !== 0).map(c => c.nombre).sort((a, b) => a.localeCompare(b));
}

function _getCacheStats() {
  return { cached: _cache ? _cache.length : null, ts: _cacheTs, hasGlobal: !!readGlobalCache() };
}

module.exports = {
  validarSede,
  getCentros,
  getSedesActivas,
  validarSedeAsync,
  getCentrosAsync,
  getSedesActivasAsync,
  refreshFromLauncher,
  _getCacheStats,
};
