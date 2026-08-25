import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { auditarEvento } from '../../../../framework/audit.js';

const router = express.Router();

// GET /api/empresas — Listar empresas con filtros, busqueda y paginacion
router.get('/', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { tipo, vendedor, ciudad, search, page = 1, limit = 20, sort = 'creado_en', order = 'desc' } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = ['e.activo = TRUE'];
    const params = [];
    let paramIdx = 1;

    if (tipo) {
      conditions.push(`e.tipo = $${paramIdx++}`);
      params.push(tipo);
    }
    if (vendedor) {
      conditions.push(`e.vendedor_asignado = $${paramIdx++}`);
      params.push(parseInt(vendedor));
    }
    if (ciudad) {
      conditions.push(`e.ciudad ILIKE $${paramIdx++}`);
      params.push(`%${ciudad}%`);
    }
    if (search) {
      conditions.push(`(e.nombre ILIKE $${paramIdx} OR e.nit ILIKE $${paramIdx} OR e.sector ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const allowedSort = ['nombre', 'ciudad', 'tipo', 'creado_en', 'actualizado_en'];
    const sortCol = allowedSort.includes(sort) ? sort : 'creado_en';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countResult = await pool.query(`SELECT COUNT(*) FROM crm.empresas e ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(`
      SELECT e.*,
        (SELECT COUNT(*) FROM crm.contactos c WHERE c.empresa_id = e.id AND c.activo = TRUE) AS total_contactos
      FROM crm.empresas e
      ${where}
      ORDER BY e.${sortCol} ${sortOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ ok: true, data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[CRM] Error listar empresas:', err);
    res.status(500).json({ error: 'Error al listar empresas' });
  }
});

// GET /api/empresas/stats — Estadisticas del dashboard
router.get('/stats', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const [total, porTipo, porCiudad, recientes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.empresas WHERE activo = TRUE`),
      pool.query(`SELECT tipo, COUNT(*) AS total FROM crm.empresas WHERE activo = TRUE GROUP BY tipo ORDER BY total DESC`),
      pool.query(`SELECT ciudad, COUNT(*) AS total FROM crm.empresas WHERE activo = TRUE AND ciudad IS NOT NULL GROUP BY ciudad ORDER BY total DESC LIMIT 10`),
      pool.query(`SELECT id, nombre, tipo, ciudad, creado_en FROM crm.empresas WHERE activo = TRUE ORDER BY creado_en DESC LIMIT 5`)
    ]);

    res.json({
      ok: true,
      total: parseInt(total.rows[0].count),
      por_tipo: porTipo.rows,
      por_ciudad: porCiudad.rows,
      recientes: recientes.rows
    });
  } catch (err) {
    console.error('[CRM] Error stats empresas:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/empresas/:id — Detalle de empresa con contactos
router.get('/:id', requirePermiso('ver', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const empresa = await pool.query(`SELECT * FROM crm.empresas WHERE id = $1`, [id]);
    if (!empresa.rows.length) return res.status(404).json({ error: 'Empresa no encontrada' });

    const contactos = await pool.query(
      `SELECT * FROM crm.contactos WHERE empresa_id = $1 AND activo = TRUE ORDER BY nombre`,
      [id]
    );

    res.json({ ok: true, data: { ...empresa.rows[0], contactos: contactos.rows } });
  } catch (err) {
    console.error('[CRM] Error obtener empresa:', err);
    res.status(500).json({ error: 'Error al obtener empresa' });
  }
});

// POST /api/empresas — Crear empresa
router.post('/', requirePermiso('crear_contacto', 'crm'), async (req, res) => {
  try {
    const { nombre, nit, tipo, sector, direccion, ciudad, latitud, longitud, telefono, email, website, codigo_siesa, vendedor_asignado, notas, origen } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await pool.query(`
      INSERT INTO crm.empresas (nombre, nit, tipo, sector, direccion, ciudad, latitud, longitud, telefono, email, website, codigo_siesa, vendedor_asignado, notas, origen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [nombre, nit || null, tipo || 'potencial', sector || null, direccion || null, ciudad || null,
        latitud || null, longitud || null, telefono || null, email || null, website || null,
        codigo_siesa || null, vendedor_asignado || null, notas || null, origen || 'manual']);

    await auditarEvento({ accion: 'crear', entidad: 'empresa', entidad_id: result.rows[0].id, usuario_id: req.user.id, metadata: { nombre } });

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear empresa:', err);
    res.status(500).json({ error: 'Error al crear empresa' });
  }
});

// PUT /api/empresas/:id — Editar empresa
router.put('/:id', requirePermiso('editar_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT id FROM crm.empresas WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Empresa no encontrada' });

    const fields = ['nombre', 'nit', 'tipo', 'sector', 'direccion', 'ciudad', 'latitud', 'longitud', 'telefono', 'email', 'website', 'codigo_siesa', 'vendedor_asignado', 'notas', 'activo'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx++}`);
        params.push(req.body[field]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });

    updates.push(`actualizado_en = NOW()`);
    params.push(id);

    const result = await pool.query(`UPDATE crm.empresas SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    await auditarEvento({ accion: 'editar', entidad: 'empresa', entidad_id: id, usuario_id: req.user.id, metadata: { campos: Object.keys(req.body) } });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar empresa:', err);
    res.status(500).json({ error: 'Error al editar empresa' });
  }
});

// DELETE /api/empresas/:id — Soft delete
router.delete('/:id', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`UPDATE crm.empresas SET activo = FALSE WHERE id = $1 RETURNING id, nombre`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Empresa no encontrada' });

    await auditarEvento({ accion: 'eliminar', entidad: 'empresa', entidad_id: id, usuario_id: req.user.id, metadata: { nombre: result.rows[0].nombre } });

    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar empresa:', err);
    res.status(500).json({ error: 'Error al eliminar empresa' });
  }
});

// DELETE /api/empresas/seleccionados — Bulk delete
router.delete('/seleccionados', requirePermiso('eliminar_contacto', 'crm'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'Sin IDs' });

    const result = await pool.query(`UPDATE crm.empresas SET activo = FALSE WHERE id = ANY($1) RETURNING id`, [ids]);

    await auditarEvento({ accion: 'eliminar', entidad: 'empresa', usuario_id: req.user.id, metadata: { count: result.rowCount } });

    res.json({ ok: true, eliminadas: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error bulk eliminar empresas:', err);
    res.status(500).json({ error: 'Error al eliminar empresas' });
  }
});

export default router;
