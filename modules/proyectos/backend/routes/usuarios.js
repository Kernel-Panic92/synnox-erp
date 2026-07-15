import express from 'express';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const router = express.Router();
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, '..', '..', '..', '..', 'launcher', 'launcher.db');
    const ldb = new Database(dbPath, { readonly: true });
    let sql = 'SELECT id, nombre, email, rol FROM usuarios WHERE activo = 1';
    const params = [];
    if (q) { sql += ' AND (nombre LIKE ? OR email LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
    sql += ' ORDER BY nombre ASC';
    const rows = ldb.prepare(sql).all(...params);
    ldb.close();
    res.json({ exitosa: true, usuarios: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
