const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');

let _sqlite = null;

function getSQLite(dbPath) {
  if (!_sqlite) {
    _sqlite = new Database(dbPath || path.join(__dirname, '..', 'data', 'horix.db'));
    _sqlite.pragma('journal_mode = WAL');
  }
  return _sqlite;
}

const pg = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'horix_erp',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pg.on('error', (err) => console.error('[DB] PostgreSQL error:', err.message));

module.exports = { pg, getSQLite };
