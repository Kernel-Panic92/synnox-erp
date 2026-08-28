import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getUsuarioNombre(id) {
  try {
    const dbPath = path.join(__dirname, '..', '..', '..', '..', 'launcher', 'launcher.db');
    const ldb = new Database(dbPath, { readonly: true });
    const row = ldb.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id);
    ldb.close();
    return row?.nombre || null;
  } catch { return null; }
}

const _usuarioCache = {};
function resolveUsuario(id) {
  if (!id) return null;
  if (_usuarioCache[id] !== undefined) return _usuarioCache[id];
  _usuarioCache[id] = getUsuarioNombre(id);
  return _usuarioCache[id];
}
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'visitas');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo: JPG, PNG, GIF, WebP'));
    }
  }
});

const router = express.Router();

// Helper para guardar visita
async function guardarVisita({ tipo, cliente_id, contacto_id, oportunidad_id, vendedor_id, latitud, longitud, precision_gps, notas, evidencia_foto, asunto, lugar, tipo_actividad, descripcion, fecha_inicio, req }) {
  const result = await pool.query(`
    INSERT INTO crm.visitas (tipo, cliente_id, contacto_id, oportunidad_id, vendedor_id, latitud, longitud, precision_gps, notas, evidencia_foto, asunto, lugar, tipo_actividad, descripcion, fecha_inicio)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `, [tipo, cliente_id || null, contacto_id || null, oportunidad_id || null, vendedor_id, latitud, longitud, precision_gps || null, notas || null, evidencia_foto || null,
      asunto || null, lugar || null, tipo_actividad || 'visita', descripcion || null, fecha_inicio || null]);

  await auditarEvento({ accion: tipo, entidad: 'actividad', entidad_id: result.rows[0].id, usuario_id: vendedor_id, metadata: { cliente_id, latitud, longitud } });

  return result.rows[0];
}

// POST /api/visitas/checkin
router.post('/checkin', requirePermiso('registrar_visita', 'crm'), upload.single('foto'), async (req, res) => {
  try {
    const { cliente_id, contacto_id, oportunidad_id, latitud, longitud, precision_gps, notas,
            asunto, lugar, tipo_actividad, descripcion } = req.body;
    if (!cliente_id) return res.status(400).json({ error: 'El cliente es obligatorio' });
    if (!latitud || !longitud) return res.status(400).json({ error: 'Las coordenadas GPS son obligatorias' });

    const evidencia_foto = req.file ? `/crm/uploads/visitas/${req.file.filename}` : null;

    // Verificar que no haya un checkin sin checkout
    const pendiente = await pool.query(
      `SELECT id FROM crm.visitas WHERE vendedor_id = $1 AND tipo = 'checkin'
       AND NOT EXISTS (SELECT 1 FROM crm.visitas v2 WHERE v2.vendedor_id = $1 AND v2.cliente_id = crm.visitas.cliente_id AND v2.tipo = 'checkout' AND v2.fecha > crm.visitas.fecha)
       ORDER BY fecha DESC LIMIT 1`,
      [req.user.id]
    );

    if (pendiente.rows.length) {
      return res.status(400).json({ error: 'Ya tienes un check-in pendiente. Haz check-out primero.', checkin_pendiente: pendiente.rows[0].id });
    }

    const visita = await guardarVisita({
      tipo: 'checkin', cliente_id, contacto_id, oportunidad_id,
      vendedor_id: req.user.id, latitud, longitud, precision_gps, notas, evidencia_foto,
      asunto, lugar, tipo_actividad, descripcion, fecha_inicio: new Date()
    });

    res.status(201).json({ ok: true, data: visita });
  } catch (err) {
    console.error('[CRM] Error checkin:', err);
    res.status(500).json({ error: err.message || 'Error al registrar check-in' });
  }
});

// POST /api/visitas/checkout
router.post('/checkout', requirePermiso('registrar_visita', 'crm'), upload.single('foto'), async (req, res) => {
  try {
    const { cliente_id, contacto_id, oportunidad_id, latitud, longitud, precision_gps, notas,
            asunto, lugar, tipo_actividad, descripcion } = req.body;
    if (!cliente_id) return res.status(400).json({ error: 'El cliente es obligatorio' });
    if (!latitud || !longitud) return res.status(400).json({ error: 'Las coordenadas GPS son obligatorias' });

    const evidencia_foto = req.file ? `/crm/uploads/visitas/${req.file.filename}` : null;

    const visita = await guardarVisita({
      tipo: 'checkout', cliente_id, contacto_id, oportunidad_id,
      vendedor_id: req.user.id, latitud, longitud, precision_gps, notas, evidencia_foto,
      asunto, lugar, tipo_actividad, descripcion
    });

    res.status(201).json({ ok: true, data: visita });
  } catch (err) {
    console.error('[CRM] Error checkout:', err);
    res.status(500).json({ error: err.message || 'Error al registrar check-out' });
  }
});

// GET /api/visitas — Listar visitas con filtros
router.get('/', requirePermiso('ver_visitas', 'crm'), async (req, res) => {
  try {
    const { vendedor, cliente_id, tipo, desde, hasta, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (vendedor) {
      conditions.push(`v.vendedor_id = $${paramIdx++}`);
      params.push(parseInt(vendedor));
    }
    if (cliente_id) {
      conditions.push(`v.cliente_id = $${paramIdx++}`);
      params.push(cliente_id);
    }
    if (tipo) {
      conditions.push(`v.tipo = $${paramIdx++}`);
      params.push(tipo);
    }
    if (desde) {
      conditions.push(`v.fecha >= $${paramIdx++}`);
      params.push(desde);
    }
    if (hasta) {
      conditions.push(`v.fecha <= $${paramIdx++}`);
      params.push(hasta + ' 23:59:59');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.visitas v ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT v.*, e.nombre AS cliente_nombre, c.nombre AS contacto_nombre
      FROM crm.visitas v
      LEFT JOIN crm.clientes e ON e.id = v.cliente_id
      LEFT JOIN crm.contactos c ON c.id = v.contacto_id
      ${where}
      ORDER BY v.fecha DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    const data = result.rows.map(r => ({
      ...r,
      vendedor_nombre: resolveUsuario(r.vendedor_id)
    }));

    res.json({ ok: true, data, total });
  } catch (err) {
    console.error('[CRM] Error listar visitas:', err);
    res.status(500).json({ error: 'Error al listar visitas' });
  }
});

// GET /api/visitas/resumen — Resumen diario
router.get('/resumen', requirePermiso('ver_visitas', 'crm'), async (req, res) => {
  try {
    const { vendedor, fecha } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (vendedor) {
      conditions.push(`vendedor_id = $${paramIdx++}`);
      params.push(parseInt(vendedor));
    }
    if (fecha) {
      conditions.push(`fecha = $${paramIdx++}`);
      params.push(fecha);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`SELECT * FROM crm.visitas_resumen_diario ${where} ORDER BY fecha DESC LIMIT 30`, params);

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error resumen visitas:', err);
    res.status(500).json({ error: 'Error al cargar resumen' });
  }
});

// DELETE /api/visitas/:id — Eliminar actividad
router.delete('/:id', requirePermiso('registrar_visita', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM crm.visitas WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Actividad no encontrada' });
    await auditarEvento({ accion: 'eliminar', entidad: 'actividad', entidad_id: req.params.id, usuario_id: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar actividad:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

export default router;
export { uploadDir };
