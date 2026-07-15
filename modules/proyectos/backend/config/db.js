import pkg from 'pg';

const { Pool } = pkg;

const pool = new Pool({
  host:     process.env.PGHOST     || process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.PGPORT || process.env.DB_PORT || '5432'),
  database: process.env.PGDATABASE || process.env.DB_NAME     || 'synnox_erp',
  user:     process.env.PGUSER     || process.env.DB_USER     || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
