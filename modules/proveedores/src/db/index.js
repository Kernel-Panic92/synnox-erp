const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PGHOST     || process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || process.env.DB_PORT || '5432'),
  database: process.env.PGDATABASE || process.env.DB_NAME     || 'synnox_erp',
  user:     process.env.PGUSER     || process.env.DB_USER     || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en cliente idle:', err.message);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
