import express from 'express';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

router.get('/', soloAdmin, async (req, res) => {
  try {
    const zip = new AdmZip();
    const tablas = ['vehiculos', 'pedidos_logistica', 'rutas', 'paradas_ruta', 'configuracion', 'usuarios'];
    const backup = { app: 'HorixLogistics', version: '1.0', generado: new Date().toISOString() };
    for (const t of tablas) {
      try {
        const r = await pool.query(`SELECT * FROM logistics.${t}`);
        backup[t] = r.rows;
        let csv = Object.keys(r.rows[0] || {}).join(',') + '\n';
        for (const row of r.rows) {
          csv += Object.values(row).map(v => {
            if (v === null) return '';
            const s = String(v).replace(/"/g, '""');
            return s.includes(',') || s.includes('"') ? `"${s}"` : s;
          }).join(',') + '\n';
        }
        zip.addFile(`${t}.csv`, Buffer.from(csv, 'utf8'));
      } catch {}
    }
    if (backup.usuarios) backup.usuarios = backup.usuarios.map(u => ({ ...u, password_hash: '(excluido)' }));
    zip.addFile('backup.json', Buffer.from(JSON.stringify(backup, null, 2), 'utf8'));
    const buf = zip.toBuffer();
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="logistics_backup_${new Date().toISOString().slice(0,10)}.zip"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/lista', soloAdmin, async (req, res) => {
  try {
    const cfg = await pool.query('SELECT valor FROM logistics.configuracion WHERE clave=$1', ['backup_dir']);
    const dir = (cfg.rows[0]?.valor || '~/backups/logistics').replace('~', process.env.HOME || '/root');
    if (!fs.existsSync(dir)) return res.json({ exitosa: true, backups: [] });
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.zip'))
      .map(f => {
        const st = fs.statSync(path.join(dir, f));
        return { nombre: f, fecha: st.mtime, tamaño: (st.size / 1024 / 1024).toFixed(2) + ' MB' };
      })
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ exitosa: true, backups: files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/descargar/:filename', soloAdmin, async (req, res) => {
  try {
    const cfg = await pool.query('SELECT valor FROM logistics.configuracion WHERE clave=$1', ['backup_dir']);
    const dir = (cfg.rows[0]?.valor || '~/backups/logistics').replace('~', process.env.HOME || '/root');
    const filepath = path.join(dir, req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.download(filepath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ultimo', soloAdmin, async (req, res) => {
  try {
    const ultimoPath = path.join(__dirname, '..', '..', '.ultimo_backup.json');
    if (fs.existsSync(ultimoPath)) {
      const data = JSON.parse(fs.readFileSync(ultimoPath, 'utf8'));
      return res.json({ exitosa: true, ultimo: data });
    }
    res.json({ exitosa: true, ultimo: null });
  } catch { res.json({ exitosa: true, ultimo: null }); }
});

router.post('/ejecutar', soloAdmin, async (req, res) => {
  try {
    const script = path.join(__dirname, '..', '..', 'backup_logistics.sh');
    if (!fs.existsSync(script)) return res.status(400).json({ error: 'Script backup_logistics.sh no encontrado' });
    execFile('bash', [script], { timeout: 120000 }, (err, stdout, stderr) => {
      const result = { ok: !err, stdout: stdout?.slice(-500), stderr: stderr?.slice(-500) };
      fs.writeFileSync(path.join(__dirname, '..', '..', '.ultimo_backup.json'), JSON.stringify({
        fecha: new Date().toISOString(), exitoso: !err, salida: result
      }));
      res.json(result);
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/restore/local/:filename', soloAdmin, async (req, res) => {
  try {
    const cfg = await pool.query('SELECT valor FROM logistics.configuracion WHERE clave=$1', ['backup_dir']);
    const dir = (cfg.rows[0]?.valor || '~/backups/logistics').replace('~', process.env.HOME || '/root');
    const filepath = path.join(dir, req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    const zip = new AdmZip(filepath);
    const entry = zip.getEntry('backup.json');
    if (!entry) return res.status(400).json({ error: 'backup.json no encontrado en el ZIP' });
    const data = JSON.parse(entry.getData().toString('utf8'));
    await pool.query('BEGIN');
    try {
      const tablas = ['paradas_ruta', 'pedidos_logistica', 'rutas', 'posiciones_gps', 'historico_eficiencia', 'importaciones', 'vehiculos', 'configuracion'];
      for (const t of tablas) await pool.query(`DELETE FROM logistics.${t}`);
      if (data.vehiculos) for (const r of data.vehiculos) await pool.query(
        `INSERT INTO logistics.vehiculos (id, placa, alias, capacidad_peso, capacidad_volumen, sede, estado) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET placa=$2`,
        [r.id, r.placa, r.alias, r.capacidad_peso, r.capacidad_volumen, r.sede, r.estado]);
      if (data.configuracion) for (const r of data.configuracion) await pool.query(
        `INSERT INTO logistics.configuracion (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor=$2`,
        [r.clave, r.valor]);
      await pool.query('COMMIT');
      res.json({ exitosa: true, mensaje: 'Restauración completada' });
    } catch (e) { await pool.query('ROLLBACK'); throw e; }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
