import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function buildProductosWhere(req) {
  const { search, categoria } = req.query;
  const conditions = ['p.activo = TRUE'];
  const params = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(`(p.codigo ILIKE $${paramIdx} OR p.nombre ILIKE $${paramIdx} OR p.descripcion ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (categoria) {
    conditions.push(`p.categoria = $${paramIdx++}`);
    params.push(categoria);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// GET /api/productos — Listar productos
router.get('/', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const { where, params } = buildProductosWhere(req);
    let paramIdx = params.length + 1;

    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.productos p ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT p.* FROM crm.productos p
      ${where}
      ORDER BY p.codigo
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar productos:', err);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// GET /api/productos/stats — Estadisticas (respetan filtros activos)
router.get('/stats', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { where, params } = buildProductosWhere(req);

    const [total, conPrecio, porCategoria, sinCategoria] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.productos p ${where}`, params),
      pool.query(`SELECT COUNT(*) FROM crm.productos p ${where} AND p.precio_unitario > 0`, params),
      pool.query(`SELECT p.categoria, COUNT(*) AS total FROM crm.productos p ${where} GROUP BY p.categoria ORDER BY total DESC LIMIT 5`, params),
      pool.query(`SELECT COUNT(*) FROM crm.productos p ${where} AND (p.categoria IS NULL OR p.categoria = '')`, params)
    ]);

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      con_precio: parseInt(conPrecio.rows[0].count),
      sin_categoria: parseInt(sinCategoria.rows[0].count),
      por_categoria: porCategoria.rows
    });
  } catch (err) {
    console.error('[CRM] Error stats productos:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/productos/buscar — Buscar para autocompletado
router.get('/buscar', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || q.length < 2) return res.json({ ok: true, data: [] });

    const result = await pool.query(`
      SELECT id, codigo, nombre, unidad_medida, precio_unitario, tasa_impuesto, bodega
      FROM crm.productos
      WHERE activo = TRUE AND (codigo ILIKE $1 OR nombre ILIKE $1)
      ORDER BY codigo
      LIMIT $2
    `, [`%${q}%`, parseInt(limit)]);

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error buscar productos:', err);
    res.status(500).json({ error: 'Error al buscar productos' });
  }
});

// POST /api/productos/importar — Importar desde CSV
router.post('/importar', requirePermiso('crear_cotizacion', 'crm'), upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se envio archivo' });

    const csv = req.file.buffer.toString('utf-8');
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'El archivo esta vacio o no tiene datos' });

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const mapping = {
      referencia: 'codigo',
      codigo: 'codigo',
      descripcion: 'nombre',
      nombre: 'nombre',
      unidad: 'unidad_medida',
      unidad_medida: 'unidad_medida',
      precio: 'precio_unitario',
      precio_unitario: 'precio_unitario',
      tasa_impositiva: 'tasa_impuesto',
      tasa: 'tasa_impuesto',
      categoria: 'categoria',
      bodega: 'bodega'
    };

    const colMap = {};
    for (let i = 0; i < headers.length; i++) {
      const dbCol = mapping[headers[i]];
      if (dbCol) colMap[i] = dbCol;
    }

    let insertados = 0, actualizados = 0, fallidos = 0;
    const errores = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].match(/(".*?"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) || [];
        const row = {};
        for (const [idx, col] of Object.entries(colMap)) {
          row[col] = values[parseInt(idx)] || null;
        }

        if (!row.codigo && !row.nombre) { fallidos++; errores.push(`Fila ${i + 1}: sin codigo ni nombre`); continue; }
        if (!row.codigo) { fallidos++; errores.push(`Fila ${i + 1}: sin codigo`); continue; }
        if (!row.nombre) { fallidos++; errores.push(`Fila ${i + 1}: sin nombre`); continue; }

        const precio = (() => { let s=String(row.precio_unitario||'0').replace(/[^0-9.,-]/g,''); if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); else if(s.includes('.') && s.split('.').slice(1).every(p=>p.length===3)) s=s.replace(/\./g,''); return parseFloat(s)||0; })();
        const tasa = (() => { let s=String(row.tasa_impuesto||'0').replace(/[^0-9.,-]/g,''); if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); else if(s.includes('.') && s.split('.').slice(1).every(p=>p.length===3)) s=s.replace(/\./g,''); return parseFloat(s)||0; })();

        const existing = await pool.query(`SELECT id FROM crm.productos WHERE codigo = $1`, [row.codigo]);
        if (existing.rows.length) {
          await pool.query(`
            UPDATE crm.productos
            SET nombre = $1, unidad_medida = $2, precio_unitario = $3, tasa_impuesto = $4,
                categoria = $5, bodega = $6, actualizado_en = NOW()
            WHERE codigo = $7
          `, [row.nombre, row.unidad_medida || 'UND', precio, tasa, row.categoria || null, row.bodega || null, row.codigo]);
          actualizados++;
        } else {
          await pool.query(`
            INSERT INTO crm.productos (codigo, nombre, unidad_medida, precio_unitario, tasa_impuesto, categoria, bodega)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [row.codigo, row.nombre, row.unidad_medida || 'UND', precio, tasa, row.categoria || null, row.bodega || null]);
          insertados++;
        }
      } catch (e) {
        fallidos++;
        errores.push(`Fila ${i + 1}: ${e.message}`);
      }
    }

    await auditarEvento({ accion: 'importar', entidad: 'producto', usuario_id: req.user.id, metadata: { insertados, actualizados, fallidos, archivo: req.file.originalname } });

    res.json({
      ok: true,
      insertados,
      actualizados,
      fallidos,
      total: insertados + actualizados + fallidos,
      errores: errores.slice(0, 20)
    });
  } catch (err) {
    console.error('[CRM] Error importar productos:', err);
    res.status(500).json({ error: 'Error al importar productos' });
  }
});

// GET /api/productos/:id — Detalle
router.get('/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM crm.productos WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error obtener producto:', err);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// PUT /api/productos/:id — Editar producto (codigo no editable)
router.put('/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT id FROM crm.productos WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });

    const { nombre, descripcion, unidad_medida, precio_unitario, tasa_impuesto, categoria, bodega } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await pool.query(`
      UPDATE crm.productos
      SET nombre = $1, descripcion = $2, unidad_medida = $3, precio_unitario = $4, tasa_impuesto = $5, categoria = $6, bodega = $7, actualizado_en = NOW()
      WHERE id = $8 RETURNING *
    `, [nombre, descripcion || null, unidad_medida || 'UND', precio_unitario || 0, tasa_impuesto || 0, categoria || null, bodega || null, id]);

    await auditarEvento({ accion: 'editar', entidad: 'producto', entidad_id: id, usuario_id: req.user.id, metadata: { nombre } });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar producto:', err);
    res.status(500).json({ error: 'Error al editar producto' });
  }
});

// POST /api/productos — Crear producto (BLOQUEADO: los productos se gestionan en el ERP SIESA y se importan/sincronizan)
router.post('/', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  return res.status(403).json({ error: 'Los productos se gestionan en el ERP SIESA y se importan/sincronizan al CRM. Usa Importar SIESA → Items para cargarlos.' });
});

// DELETE /api/productos/seleccionados — Bulk delete
router.delete('/seleccionados', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'Sin IDs' });

    const result = await pool.query(`UPDATE crm.productos SET activo = FALSE WHERE id = ANY($1) RETURNING id`, [ids]);
    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error bulk eliminar productos:', err);
    res.status(500).json({ error: 'Error al eliminar productos' });
  }
});

// DELETE /api/productos/:id — Eliminar producto (AFTER /seleccionados)
router.delete('/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE crm.productos SET activo = FALSE WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar producto:', err);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;
