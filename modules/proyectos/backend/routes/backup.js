import express from 'express';
import AdmZip from 'adm-zip';
import multer from 'multer';
import pool from '../config/db.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

router.get('/', soloAdmin, async (req, res) => {
  try {
    const zip = new AdmZip();
    const tablas = ['proyectos', 'tareas', 'comentarios', 'evidencias'];
    const backup = { app: 'SynnoxERP Proyectos', version: '1.0', generado: new Date().toISOString() };
    for (const t of tablas) {
      try {
        const r = await pool.query(`SELECT * FROM projects.${t}`);
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
    zip.addFile('backup.json', Buffer.from(JSON.stringify(backup, null, 2), 'utf8'));
    const buf = zip.toBuffer();
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="proyectos_backup_${new Date().toISOString().slice(0,10)}.zip"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/restore', soloAdmin, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const zip = new AdmZip(req.file.buffer);
    const entry = zip.getEntry('backup.json');
    if (!entry) return res.status(400).json({ error: 'backup.json no encontrado en el ZIP' });
    const data = JSON.parse(entry.getData().toString('utf8'));
    await pool.query('BEGIN');
    try {
      const tablas = ['evidencias', 'comentarios', 'tareas', 'proyectos'];
      for (const t of tablas) await pool.query(`DELETE FROM projects.${t}`);

      if (data.proyectos) for (const r of data.proyectos) await pool.query(
        `INSERT INTO projects.proyectos (id, nombre, descripcion, estado, fecha_limite, centro_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET nombre=$2`,
        [r.id, r.nombre, r.descripcion, r.estado, r.fecha_limite, r.centro_id, r.created_at, r.updated_at]);

      if (data.tareas) for (const r of data.tareas) await pool.query(
        `INSERT INTO projects.tareas (id, proyecto_id, titulo, descripcion, tipo, prioridad, estado, columna, asignado_a, reportero, fecha_limite, estimacion_horas, horas_invertidas, orden, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO UPDATE SET titulo=$2`,
        [r.id, r.proyecto_id, r.titulo, r.descripcion, r.tipo, r.prioridad, r.estado, r.columna, r.asignado_a, r.reportero, r.fecha_limite, r.estimacion_horas, r.horas_invertidas, r.orden, r.created_at, r.updated_at]);

      if (data.comentarios) for (const r of data.comentarios) await pool.query(
        `INSERT INTO projects.comentarios (id, tarea_id, usuario_id, contenido, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET contenido=$2`,
        [r.id, r.tarea_id, r.usuario_id, r.contenido, r.created_at]);

      if (data.evidencias) for (const r of data.evidencias) await pool.query(
        `INSERT INTO projects.evidencias (id, tarea_id, usuario_id, nombre, mime, tamano, datos, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET nombre=$2`,
        [r.id, r.tarea_id, r.usuario_id, r.nombre, r.mime, r.tamano, r.datos, r.created_at]);

      await pool.query('COMMIT');
      res.json({ exitosa: true, mensaje: 'Restauración completada' });
    } catch (e) { await pool.query('ROLLBACK'); throw e; }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
