import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
dotenv.config();

async function runMigrations() {
  console.log('Ejecutando migraciones crm...');
  try {
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      console.log(`  ${file}`);
      await pool.query(sql);
    }
    console.log('Migraciones crm completadas');
    process.exit(0);
  } catch (err) {
    console.error('Error en migraciones crm:', err);
    process.exit(1);
  }
}

runMigrations();
