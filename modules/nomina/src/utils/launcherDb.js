const Database = require('better-sqlite3');
const path = require('path');

const LAUNCHER_DB_PATH = path.join(__dirname, '..', '..', '..', '..', 'launcher', 'launcher.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(LAUNCHER_DB_PATH, { readonly: true });
  }
  return _db;
}

function validarSede(sede) {
  if (!sede) return false;
  const row = getDb().prepare('SELECT id FROM centros_operacion WHERE nombre = ? AND activo = 1').get(sede);
  return !!row;
}

function getCentros() {
  return getDb().prepare('SELECT * FROM centros_operacion ORDER BY nombre').all();
}

function getSedesActivas() {
  return getDb().prepare("SELECT nombre FROM centros_operacion WHERE activo = 1 ORDER BY nombre ASC").all().map(c => c.nombre);
}

module.exports = { validarSede, getCentros, getSedesActivas };
