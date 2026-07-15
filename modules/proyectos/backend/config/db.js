import pkg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
dotenv.config();

const { Pool } = pkg;

const pgPassword = process.env.PGPASSWORD || process.env.DB_PASSWORD || undefined;
const pgUser = process.env.PGUSER || process.env.DB_USER || 'postgres';

const pool = new Pool({
  host:     process.env.PGHOST     || process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.PGPORT || process.env.DB_PORT || '5432'),
  database: process.env.PGDATABASE || process.env.DB_NAME     || 'synnox_erp',
  user:     pgUser,
  password: pgPassword,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
