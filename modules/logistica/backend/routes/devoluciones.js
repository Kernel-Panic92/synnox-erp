import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { parsearSmart2GoDevoluciones } from '../utils/smart2goDevolucionesParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const router = express.Router();
const MODULE = 'logistica';

function sanitizePath(input, base) {
  const resolved = path.resolve(base, input);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.resolve(base))) {
    throw new Error('Path fuera del directorio permitido');
  }
  return normalized;
}

// ── GET / — Lista con filtros y paginación ──
router.get('/', requirePermiso('ver', MODULE), async (req, res) => {
  try {
    const {
      fecha_inicio, fecha_fin, cliente, centro_operaciones, causa,
      estado, fuente, busqueda, page = 1, limit = 50, sort = 'fecha_reporte', order = 'DESC'
    } = req.query;

    let sql = 'SELECT * FROM logistics.devoluciones WHERE 1=1';
    const params = [];

    if (fecha_inicio) { params.push(fecha_inicio); sql += ` AND fecha_reporte >= $${params.length}`; }
    if (fecha_fin) { params.push(fecha_fin); sql += ` AND fecha_reporte <= $${params.length}`; }
    if (cliente) { params.push(`%${cliente}%`); sql += ` AND cliente_nombre ILIKE $${params.length}`; }
    if (centro_operaciones) { params.push(centro_operaciones); sql += ` AND centro_operaciones = $${params.length}`; }
    if (causa) { params.push(causa); sql += ` AND causa = $${params.length}`; }
    if (estado) { params.push(estado); sql += ` AND estado = $${params.length}`; }
    if (fuente) { params.push(fuente); sql += ` AND fuente = $${params.length}`; }
    if (busqueda) {
      params.push(`%${busqueda}%`);
      sql += ` AND (cliente_nombre ILIKE $${params.length} OR sucursal ILIKE $${params.length} OR mercaderista ILIKE $${params.length} OR productos_texto ILIKE $${params.length})`;
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql}) _sub`;
    const allowedSort = ['fecha_reporte', 'created_at', 'cliente_nombre', 'valor_total', 'causa', 'estado'];
    const sortCol = allowedSort.includes(sort) ? sort : 'fecha_reporte';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const dataSql = `${sql} ORDER BY ${sortCol} ${sortOrder} LIMIT ${parseInt(limit)} OFFSET ${offset}`;

    const [countResult, dataResult] = await Promise.all([
      pool.query(countSql, params),
      pool.query(dataSql, params)
    ]);

    const total = parseInt(countResult.rows[0].total, 10);
    res.json({
      exitosa: true,
      rows: dataResult.rows,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /resumen — Stats para dashboard ──
router.get('/resumen', requirePermiso('ver', MODULE), async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;
    let whereClause = '';
    const params = [];
    if (fecha_inicio) { params.push(fecha_inicio); whereClause += ` AND fecha_reporte >= $${params.length}`; }
    if (fecha_fin) { params.push(fecha_fin); whereClause += ` AND fecha_reporte <= $${params.length}`; }

    const [totalResult, porCausa, porCliente, tendencia, porEstado, conConductor, valorTotal] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM logistics.devoluciones WHERE 1=1${whereClause}`, params),
      pool.query(`SELECT causa, COUNT(*) as cantidad FROM logistics.devoluciones WHERE 1=1${whereClause} GROUP BY causa ORDER BY cantidad DESC`, params),
      pool.query(`SELECT cliente_nombre, COUNT(*) as cantidad, SUM(valor_total) as valor FROM logistics.devoluciones WHERE 1=1${whereClause} GROUP BY cliente_nombre ORDER BY cantidad DESC LIMIT 10`, params),
      pool.query(`SELECT fecha_reporte as fecha, COUNT(*) as cantidad FROM logistics.devoluciones WHERE 1=1${whereClause} GROUP BY fecha_reporte ORDER BY fecha_reporte ASC`, params),
      pool.query(`SELECT estado, COUNT(*) as cantidad FROM logistics.devoluciones WHERE 1=1${whereClause} GROUP BY estado`, params),
      pool.query(`SELECT COUNT(*) as total FROM logistics.devoluciones WHERE entregado_conductor = true${whereClause}`, params),
      pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM logistics.devoluciones WHERE 1=1${whereClause}`, params),
    ]);

    res.json({
      exitosa: true,
      total: parseInt(totalResult.rows[0].total, 10),
      valor_total: parseFloat(valorTotal.rows[0].total || 0),
      con_conductor: parseInt(conConductor.rows[0].total || 0),
      por_causa: porCausa.rows,
      por_cliente: porCliente.rows,
      tendencia: tendencia.rows,
      por_estado: porEstado.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /clientes — Lista única de clientes para filtros ──
router.get('/clientes', requirePermiso('ver', MODULE), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT cliente_nombre FROM logistics.devoluciones ORDER BY cliente_nombre'
    );
    res.json({ exitosa: true, rows: result.rows.map(r => r.cliente_nombre) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /centros — Lista única de centros para filtros ──
router.get('/centros', requirePermiso('ver', MODULE), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT centro_operaciones FROM logistics.devoluciones WHERE centro_operaciones IS NOT NULL ORDER BY centro_operaciones'
    );
    res.json({ exitosa: true, rows: result.rows.map(r => r.centro_operaciones) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — Detalle ──
router.get('/:id', requirePermiso('ver', MODULE), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logistics.devoluciones WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devolución no encontrada' });
    res.json({ exitosa: true, row: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — Crear manual ──
router.post('/', requirePermiso('crear', MODULE), async (req, res) => {
  try {
    const {
      fecha_reporte, centro_operaciones, cliente_nombre, sucursal,
      latitud, longitud, direccion, documento_devolucion, quien_recibe,
      mercaderista, productos, productos_texto, valor_total, causa,
      causa_detalle, entregado_conductor, conductor_nombre, conductor_placa,
      foto_url, numero_factura, estado
    } = req.body;

    if (!fecha_reporte || !cliente_nombre || !causa) {
      return res.status(400).json({ error: 'Falta campos requeridos: fecha_reporte, cliente_nombre, causa' });
    }

    const result = await pool.query(
      `INSERT INTO logistics.devoluciones (
        fuente, fecha_reporte, centro_operaciones, cliente_nombre, sucursal,
        latitud, longitud, direccion, documento_devolucion, quien_recibe,
        mercaderista, productos, productos_texto, valor_total, causa,
        causa_detalle, entregado_conductor, conductor_nombre, conductor_placa,
        foto_url, numero_factura, estado, creado_por
      ) VALUES ('manual', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        fecha_reporte, centro_operaciones || null, cliente_nombre, sucursal || null,
        latitud || null, longitud || null, direccion || null, documento_devolucion || null,
        quien_recibe || null, mercaderista || null,
        JSON.stringify(productos || []), productos_texto || null,
        valor_total || 0, causa, causa_detalle || null,
        entregado_conductor || false, conductor_nombre || null, conductor_placa || null,
        foto_url || null, numero_factura || null, estado || 'registrada', req.user?.id || null
      ]
    );
    res.json({ exitosa: true, row: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — Editar ──
router.put('/:id', requirePermiso('editar', MODULE), async (req, res) => {
  try {
    const {
      fecha_reporte, centro_operaciones, cliente_nombre, sucursal,
      latitud, longitud, direccion, documento_devolucion, quien_recibe,
      mercaderista, productos, productos_texto, valor_total, causa,
      causa_detalle, entregado_conductor, conductor_nombre, conductor_placa,
      foto_url, numero_factura, estado
    } = req.body;

    const result = await pool.query(
      `UPDATE logistics.devoluciones SET
        fecha_reporte = COALESCE($1, fecha_reporte),
        centro_operaciones = COALESCE($2, centro_operaciones),
        cliente_nombre = COALESCE($3, cliente_nombre),
        sucursal = COALESCE($4, sucursal),
        latitud = COALESCE($5, latitud),
        longitud = COALESCE($6, longitud),
        direccion = COALESCE($7, direccion),
        documento_devolucion = COALESCE($8, documento_devolucion),
        quien_recibe = COALESCE($9, quien_recibe),
        mercaderista = COALESCE($10, mercaderista),
        productos = COALESCE($11, productos),
        productos_texto = COALESCE($12, productos_texto),
        valor_total = COALESCE($13, valor_total),
        causa = COALESCE($14, causa),
        causa_detalle = COALESCE($15, causa_detalle),
        entregado_conductor = COALESCE($16, entregado_conductor),
        conductor_nombre = COALESCE($17, conductor_nombre),
        conductor_placa = COALESCE($18, conductor_placa),
        foto_url = COALESCE($19, foto_url),
        numero_factura = COALESCE($20, numero_factura),
        estado = COALESCE($21, estado),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $22 RETURNING *`,
      [
        fecha_reporte || null, centro_operaciones || null, cliente_nombre || null,
        sucursal || null, latitud || null, longitud || null, direccion || null,
        documento_devolucion || null, quien_recibe || null, mercaderista || null,
        productos ? JSON.stringify(productos) : null, productos_texto || null,
        valor_total || null, causa || null, causa_detalle || null,
        entregado_conductor !== undefined ? entregado_conductor : null,
        conductor_nombre || null, conductor_placa || null,
        foto_url || null, numero_factura || null, estado || null,
        req.params.id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devolución no encontrada' });
    res.json({ exitosa: true, row: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/estado — Cambiar estado ──
router.put('/:id/estado', requirePermiso('editar', MODULE), async (req, res) => {
  try {
    const { estado } = req.body;
    const validos = ['registrada', 'en_proceso', 'resuelta', 'cerrada'];
    if (!validos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Válidos: ${validos.join(', ')}` });
    }
    const result = await pool.query(
      'UPDATE logistics.devoluciones SET estado = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [estado, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devolución no encontrada' });
    res.json({ exitosa: true, row: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /importar-smart2go — Importar Excel/CSV ──
router.post('/importar-smart2go', requirePermiso('crear', MODULE), upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const safeFilePath = sanitizePath(req.file.path, uploadDir);
    const resultado = await parsearSmart2GoDevoluciones(safeFilePath);

    // Cleanup temp file
    try { fs.unlinkSync(safeFilePath); } catch {}

    if (!resultado.exitosa) {
      return res.status(422).json({ error: resultado.error });
    }

    let importadas = 0;
    let duplicadas = 0;
    const errores = [];

    for (const reg of resultado.registros) {
      try {
        // Check duplicate by fuente_id
        if (reg.fuente_id) {
          const existing = await pool.query(
            'SELECT id FROM logistics.devoluciones WHERE fuente_id = $1',
            [reg.fuente_id]
          );
          if (existing.rows.length > 0) {
            duplicadas++;
            continue;
          }
        }

        // Try to match with existing pedido
        let pedidoId = null;
        if (reg.documento_devolucion) {
          const pedidoMatch = await pool.query(
            'SELECT id FROM logistics.pedidos_logistica WHERE numero_factura = $1 LIMIT 1',
            [reg.documento_devolucion]
          );
          if (pedidoMatch.rows.length > 0) pedidoId = pedidoMatch.rows[0].id;
        }

        await pool.query(
          `INSERT INTO logistics.devoluciones (
            fuente, fuente_id, fecha_reporte, hora_reporte, centro_operaciones,
            cliente_nombre, sucursal, latitud, longitud, direccion,
            documento_devolucion, quien_recibe, mercaderista,
            productos, productos_texto, valor_total, causa, causa_detalle,
            entregado_conductor, conductor_nombre, conductor_placa,
            foto_url, pedido_id, numero_factura, estado
          ) VALUES (
            'smart2go', $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, 'registrada'
          )`,
          [
            reg.fuente_id, reg.fecha_reporte, reg.hora_reporte, reg.centro_operaciones || null,
            reg.cliente_nombre, reg.sucursal || null, reg.latitud, reg.longitud,
            reg.direccion || null, reg.documento_devolucion || null,
            reg.quien_recibe || null, reg.mercaderista || null,
            JSON.stringify(reg.productos), reg.productos_texto || null,
            reg.valor_total, reg.causa, reg.causa_detalle || null,
            reg.entregado_conductor, reg.conductor_nombre || null,
            reg.conductor_placa || null, reg.foto_url || null,
            pedidoId, reg.documento_devolucion || null
          ]
        );
        importadas++;
      } catch (e) {
        errores.push({ fuente_id: reg.fuente_id, error: e.message });
      }
    }

    // Log import
    await pool.query(
      `INSERT INTO logistics.importaciones (tipo, nombre_archivo, registros_importados, registros_fallidos, estado, detalles)
       VALUES ('smart2go_devoluciones', $1, $2, $3, $4, $5)`,
      [req.file.originalname, importadas, errores.length, errores.length > 0 ? 'parcial' : 'exitosa',
       JSON.stringify({ duplicadas, errores_parseo: resultado.errores.length, errores_db: errores.length })]
    );

    res.json({
      exitosa: true,
      importadas,
      duplicadas,
      errores_parseo: resultado.errores.length,
      errores_db: errores.length,
      total_registros: resultado.total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — Eliminar ──
router.delete('/:id', requirePermiso('eliminar', MODULE), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logistics.devoluciones WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devolución no encontrada' });
    res.json({ exitosa: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /seleccionados — Bulk delete ──
router.delete('/seleccionados', requirePermiso('eliminar', MODULE), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array de IDs requerido' });
    }
    const result = await pool.query(
      `DELETE FROM logistics.devoluciones WHERE id = ANY($1)`,
      [ids]
    );
    res.json({ exitosa: true, eliminadas: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
