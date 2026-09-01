import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { lookupByGTIN } from '../utils/gs1Client.js';

const router = express.Router();

// GET /api/productos/:id/ean — Listar EANs de un producto (con metadata GS1)
router.get('/:id/ean', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, g.marca AS gs1_marca, g.url_imagen AS gs1_foto, g.descripcion AS gs1_descripcion,
              g.categoria_gpc AS gs1_categoria, g.estado_producto AS gs1_estado, g.vinculado AS gs1_vinculado
       FROM crm.productos_ean e
       LEFT JOIN crm.gs1_catalogo g ON g.gtin = e.gtin
       WHERE e.producto_id = $1 AND e.activo = TRUE
       ORDER BY e.es_principal DESC, e.gtin`,
      [req.params.id]
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar EANs:', err);
    res.status(500).json({ error: 'Error al listar EANs' });
  }
});

// GET /api/productos/:id/inventario — Inventario por bodega
router.get('/:id/inventario', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM crm.inventario WHERE producto_id = $1 ORDER BY bodega`,
      [req.params.id]
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar inventario:', err);
    res.status(500).json({ error: 'Error al listar inventario' });
  }
});

// GET /api/productos/:id/precios — Precios por lista
router.get('/:id/precios', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT lpi.*, lp.nombre AS lista_nombre, lp.moneda
      FROM crm.lista_precio_items lpi
      INNER JOIN crm.listas_precio lp ON lp.id = lpi.lista_id
      WHERE lpi.producto_id = $1 AND lp.activa = TRUE
      ORDER BY lp.nombre
    `, [req.params.id]);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error listar precios:', err);
    res.status(500).json({ error: 'Error al listar precios' });
  }
});

// GET /api/productos/ean/buscar/:gtin — Buscar producto por EAN
router.get('/ean/buscar/:gtin', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { gtin } = req.params;
    const result = await pool.query(`
      SELECT p.*, e.gtin, e.es_principal
      FROM crm.productos p
      INNER JOIN crm.productos_ean e ON e.producto_id = p.id
      WHERE e.gtin = $1 AND p.activo = TRUE AND e.activo = TRUE
    `, [gtin]);
    res.json({ ok: true, data: result.rows[0] || null });
  } catch (err) {
    console.error('[CRM] Error buscar por EAN:', err);
    res.status(500).json({ error: 'Error al buscar' });
  }
});

// POST /api/productos/:id/ean — Agregar EAN a producto
router.post('/:id/ean', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { gtin, descripcion, unidad_medida, es_principal } = req.body;
    if (!gtin) return res.status(400).json({ error: 'El GTIN es obligatorio' });

    // Verificar que no exista
    const existing = await pool.query(`SELECT id FROM crm.productos_ean WHERE producto_id = $1 AND gtin = $2`, [req.params.id, gtin]);
    if (existing.rows.length) return res.status(400).json({ error: 'Este EAN ya está registrado para este producto' });

    // Si es principal, desmarcar las demás
    if (es_principal) {
      await pool.query(`UPDATE crm.productos_ean SET es_principal = FALSE WHERE producto_id = $1`, [req.params.id]);
    }

    const result = await pool.query(`
      INSERT INTO crm.productos_ean (producto_id, gtin, descripcion, unidad_medida, es_principal)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [req.params.id, gtin, descripcion || null, unidad_medida || null, es_principal || false]);

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error crear EAN:', err);
    res.status(500).json({ error: 'Error al crear EAN' });
  }
});

// PUT /api/productos/ean/:id — Editar EAN
router.put('/ean/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { es_principal } = req.body;
    const ean = await pool.query(`SELECT * FROM crm.productos_ean WHERE id = $1`, [req.params.id]);
    if (!ean.rows.length) return res.status(404).json({ error: 'EAN no encontrado' });

    if (es_principal) {
      await pool.query(`UPDATE crm.productos_ean SET es_principal = FALSE WHERE producto_id = $1`, [ean.rows[0].producto_id]);
    }

    const result = await pool.query(`UPDATE crm.productos_ean SET es_principal = $1 WHERE id = $2 RETURNING *`, [es_principal || false, req.params.id]);
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[CRM] Error editar EAN:', err);
    res.status(500).json({ error: 'Error al editar EAN' });
  }
});

// DELETE /api/productos/ean/todos — Eliminar todos los EANs (ANTES de /:id)
router.delete('/ean/todos', async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM crm.productos_ean RETURNING id`);
    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error('[CRM] Error eliminar todos EANs:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// DELETE /api/productos/ean/:id — Eliminar EAN (DESPUES de /todos)
router.delete('/ean/:id', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    await pool.query(`UPDATE crm.productos_ean SET activo = FALSE WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error eliminar EAN:', err);
    res.status(500).json({ error: 'Error al eliminar EAN' });
  }
});

// POST /api/productos/gs1/lookup — Buscar info en GS1 por GTIN
router.post('/gs1/lookup', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { gtin } = req.body;
    if (!gtin) return res.status(400).json({ error: 'GTIN requerido' });

    const data = await lookupByGTIN(gtin);
    if (!data) return res.status(404).json({ error: 'Producto no encontrado en GS1' });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[CRM] Error GS1 lookup:', err);
    res.status(500).json({ error: 'Error al consultar GS1' });
  }
});

// GET /api/productos/gs1/catalogo/buscar — Buscar en catálogo GS1 por GTIN o descripción (sin vincular)
router.get('/gs1/catalogo/buscar', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || q.length < 2) return res.json({ ok: true, data: [] });
    const result = await pool.query(`
      SELECT g.* FROM crm.gs1_catalogo g
      WHERE g.gtin ILIKE $1 OR g.descripcion ILIKE $1 OR g.marca ILIKE $1
      ORDER BY g.descripcion LIMIT $2
    `, [`%${q}%`, parseInt(limit)]);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[CRM] Error buscar catálogo GS1:', err);
    res.status(500).json({ error: 'Error al buscar catálogo GS1' });
  }
});

// POST /api/productos/:id/gs1/vincular — Vincular un EAN del catálogo GS1 a este producto
router.post('/:id/gs1/vincular', requirePermiso('crear_cotizacion', 'crm'), async (req, res) => {
  try {
    const { id } = req.params;
    const { gtin } = req.body;
    if (!gtin) return res.status(400).json({ error: 'gtin requerido' });
    const g = await pool.query(`SELECT * FROM crm.gs1_catalogo WHERE gtin = $1`, [gtin]);
    if (!g.rows.length) return res.status(404).json({ error: 'GTIN no encontrado en catálogo GS1' });
    // Insertar en productos_ean si no existe
    const ex = await pool.query(`SELECT 1 FROM crm.productos_ean WHERE producto_id=$1 AND gtin=$2`, [id, gtin]);
    if (!ex.rows.length) {
      await pool.query(`INSERT INTO crm.productos_ean (producto_id, gtin, descripcion, unidad_medida) VALUES ($1,$2,$3,$4)`,
        [id, gtin, g.rows[0].descripcion, g.rows[0].unidad_cantidad]);
    }
    await pool.query(`UPDATE crm.gs1_catalogo SET producto_id=$1, vinculado=TRUE, actualizado_en=NOW() WHERE gtin=$2`, [id, gtin]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[CRM] Error vincular GS1:', err);
    res.status(500).json({ error: 'Error al vincular GS1' });
  }
});

export default router;
