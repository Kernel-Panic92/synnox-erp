// Shared centros cache - reads from launcher.db directly
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let _db = null;
let _centrosCache = null;
let _centrosCacheTs = 0;
const CACHE_TTL = 30000;

function getDb() {
  if (_db) return _db;
  try {
    const path = require('path');
    const fs = require('fs');
    const launcherDbPath = path.resolve(process.cwd(), 'launcher', 'launcher.db');
    if (!fs.existsSync(launcherDbPath)) return null;
    const Database = require('better-sqlite3');
    _db = new Database(launcherDbPath, { readonly: true });
    return _db;
  } catch { return null; }
}

export function getCentros() {
  const now = Date.now();
  if (_centrosCache && (now - _centrosCacheTs) < CACHE_TTL) return _centrosCache;
  const db = getDb();
  if (!db) return [];
  try {
    _centrosCache = db.prepare('SELECT * FROM centros_operacion WHERE activo = 1 ORDER BY nombre').all();
    _centrosCacheTs = now;
    return _centrosCache;
  } catch { return _centrosCache || []; }
}
