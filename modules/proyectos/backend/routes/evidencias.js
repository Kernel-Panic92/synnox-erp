import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { notificar, getTareaCompleta, getEmailBaseUrl } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { templateGenerico } from '../../../../framework/email-templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'evidencias');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo: JPG, PNG, GIF, WebP, PDF, DOC, DOCX, XLS, XLSX'));
    }
  }
});

const router = express.Router();

router.get('/:id/evidencias', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM projects.evidencias WHERE tarea_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ exitosa: true, evidencias: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/evidencias', requirePermiso('comentar', 'proyectos'), upload.single('archivo'), async (req, res) => {
  try {
    const tareaId = req.params.id;
    const tarea = await pool.query('SELECT id FROM projects.tareas WHERE id = $1', [tareaId]);
    if (tarea.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });

    const descripcion = req.body.descripcion || '';
    let archivoNombre = null, archivoPath = null, archivoTipo = null, archivoTamanio = null;

    if (req.file) {
      archivoNombre = req.file.originalname;
      archivoPath = req.file.filename;
      archivoTipo = req.file.mimetype;
      archivoTamanio = req.file.size;
    }

    const result = await pool.query(
      `INSERT INTO projects.evidencias (tarea_id, usuario_id, descripcion, archivo_nombre, archivo_path, archivo_tipo, archivo_tamanio)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tareaId, req.user.id, descripcion, archivoNombre, archivoPath, archivoTipo, archivoTamanio]
    );

    // Notificar al asignado y reportero
    try {
      const tareaCompleta = await getTareaCompleta(pool, tareaId);
      if (tareaCompleta) {
        const emailBase = await getEmailBaseUrl();
        const notifBase = { modulo: 'proyectos', tipo: 'evidencia_subida', url: '/proyectos/#tareas', enviarCorreo };
        const emailHtml = templateGenerico({ titulo: 'Evidencia subida', mensaje: `${req.user.nombre} subió evidencia en "${tareaCompleta.titulo}"`, detallesExtra: archivoNombre || 'Archivo adjunto', url: `${emailBase}/#tareas`, module: 'proyectos', baseUrl: emailBase });
        // Notificar al asignado
        if (tareaCompleta.asignado_a && tareaCompleta.asignado_a !== req.user.id) {
          notificar({
            ...notifBase,
            usuario_id: tareaCompleta.asignado_a,
            titulo: 'Evidencia subida',
            mensaje: `${req.user.nombre} subió evidencia en "${tareaCompleta.titulo}"`,
            email: tareaCompleta.asignado_email,
            emailAsunto: `[Proyectos] Evidencia subida: ${tareaCompleta.titulo}`,
            emailHtml
          });
        }
        // Notificar al reportero si es diferente
        if (tareaCompleta.reportero && tareaCompleta.reportero !== req.user.id && tareaCompleta.reportero !== tareaCompleta.asignado_a) {
          notificar({
            ...notifBase,
            usuario_id: tareaCompleta.reportero,
            titulo: 'Evidencia subida',
            mensaje: `${req.user.nombre} subió evidencia en "${tareaCompleta.titulo}"`,
            email: tareaCompleta.reportero_email,
            emailAsunto: `[Proyectos] Evidencia subida: ${tareaCompleta.titulo}`,
            emailHtml
          });
        }
      }
    } catch (e) { console.warn('[notify] Error evidencia:', e.message); }

    res.status(201).json({ exitosa: true, evidencia: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/evidencias/:id', requirePermiso('eliminar_tarea', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT archivo_path FROM projects.evidencias WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Evidencia no encontrada' });

    const evidencia = result.rows[0];
    if (evidencia.archivo_path) {
      const filePath = path.join(uploadDir, evidencia.archivo_path);
      try { fs.unlinkSync(filePath); } catch {}
    }

    await pool.query('DELETE FROM projects.evidencias WHERE id = $1', [req.params.id]);
    res.json({ exitosa: true, mensaje: 'Evidencia eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
export { uploadDir };
