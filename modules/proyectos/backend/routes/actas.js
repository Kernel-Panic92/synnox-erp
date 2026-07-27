import express from 'express';
import pool from '../config/db.js';
import PDFDocument from 'pdfkit';

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

// GET / — listar actas de un proyecto
router.get('/', soloAdmin, async (req, res) => {
  try {
    const { proyecto_id } = req.query;
    let sql = `SELECT a.*, p.nombre AS proyecto_nombre
               FROM projects.actas_cierre a
               JOIN projects.proyectos p ON p.id = a.proyecto_id`;
    const params = [];
    if (proyecto_id) { params.push(proyecto_id); sql += ` WHERE a.proyecto_id = $1`; }
    sql += ' ORDER BY a.created_at DESC';
    const result = await pool.query(sql, params);
    res.json({ exitosa: true, actas: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id — obtener acta por ID
router.get('/:id', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, p.nombre AS proyecto_nombre, p.descripcion AS proyecto_descripcion,
              p.fecha_limite, p.estado AS proyecto_estado, p.centro_id
       FROM projects.actas_cierre a
       JOIN projects.proyectos p ON p.id = a.proyecto_id
       WHERE a.id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Acta no encontrada' });
    const acta = result.rows[0];

    const tareas = await pool.query(
      `SELECT t.titulo, t.estado, t.prioridad, t.fecha_limite, t.horas_invertidas,
              t.estado_aprobacion, u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN (SELECT id, nombre FROM users) u ON u.id = t.asignado_a
       WHERE t.proyecto_id = $1
       ORDER BY t.estado, t.prioridad`, [acta.proyecto_id]);

    res.json({ exitosa: true, acta, tareas: tareas.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — generar acta de cierre
router.post('/', soloAdmin, async (req, res) => {
  try {
    const { proyecto_id, observaciones, resumen_ejecutivo } = req.body;
    if (!proyecto_id) return res.status(400).json({ error: 'proyecto_id requerido' });

    const proyecto = await pool.query('SELECT * FROM projects.proyectos WHERE id = $1', [proyecto_id]);
    if (proyecto.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const result = await pool.query(
      `INSERT INTO projects.actas_cierre (proyecto_id, cerrado_por, observaciones, resumen_ejecutivo)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [proyecto_id, req.user?.id || null, observaciones || '', resumen_ejecutivo || '']);

    res.status(201).json({ exitosa: true, acta: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id/pdf — exportar acta a PDF
router.get('/:id/pdf', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, p.nombre AS proyecto_nombre, p.descripcion AS proyecto_descripcion,
              p.fecha_limite, p.estado AS proyecto_estado, p.centro_id
       FROM projects.actas_cierre a
       JOIN projects.proyectos p ON p.id = a.proyecto_id
       WHERE a.id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Acta no encontrada' });
    const acta = result.rows[0];

    const tareas = await pool.query(
      `SELECT t.titulo, t.estado, t.prioridad, t.fecha_limite, t.horas_invertidas,
              u.nombre AS asignado_nombre
       FROM projects.tareas t
       LEFT JOIN (SELECT id, nombre FROM users) u ON u.id = t.asignado_a
       WHERE t.proyecto_id = $1
       ORDER BY t.estado, t.prioridad`, [acta.proyecto_id]);

    const centro = acta.centro_id ? await pool.query(
      `SELECT nombre, direccion, ciudad FROM centros_operacion WHERE id = $1`, [acta.centro_id]) : null;

    const doc = new PDFDocument({ size: 'letter', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="acta_${acta.proyecto_nombre.replace(/\s+/g, '_')}_${acta.created_at.toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('ACTA DE CIERRE DE PROYECTO', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#666')
       .text(`Fecha de generación: ${new Date().toLocaleDateString('es-CO')}`, { align: 'center' });
    doc.moveDown(1);

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(565, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);

    // Datos del proyecto
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('1. DATOS DEL PROYECTO');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    const datos = [
      ['Nombre', acta.proyecto_nombre],
      ['Descripción', acta.proyecto_descripcion || 'Sin descripción'],
      ['Estado', acta.proyecto_estado],
      ['Fecha límite', acta.fecha_limite ? new Date(acta.fecha_limite).toLocaleDateString('es-CO') : 'Sin fecha'],
      ['Centro', centro?.rows[0]?.nombre || 'Sin centro'],
      ['Fecha de cierre', new Date(acta.created_at).toLocaleDateString('es-CO')]
    ];
    for (const [label, value] of datos) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }
    doc.moveDown(1);

    // Resumen ejecutivo
    if (acta.resumen_ejecutivo) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('2. RESUMEN EJECUTIVO');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor('#333').text(acta.resumen_ejecutivo);
      doc.moveDown(1);
    }

    // Tabla de tareas
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('3. DETALLE DE TAREAS');
    doc.moveDown(0.3);

    const headerY = doc.y;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
    doc.fillColor('#2563EB').rect(50, headerY, 515, 18).fill();
    doc.fillColor('#fff');
    doc.text('Tarea', 55, headerY + 4, { width: 200 });
    doc.text('Estado', 260, headerY + 4, { width: 80 });
    doc.text('Prioridad', 345, headerY + 4, { width: 70 });
    doc.text('Asignado', 420, headerY + 4, { width: 145 });
    doc.y = headerY + 20;

    doc.font('Helvetica').fillColor('#000');
    let rowIdx = 0;
    for (const t of tareas.rows) {
      if (doc.y > 720) { doc.addPage(); doc.y = 50; }
      const bgColor = rowIdx % 2 === 0 ? '#f8f9fa' : '#ffffff';
      doc.fillColor(bgColor).rect(50, doc.y - 2, 515, 16).fill();
      doc.fillColor('#000').fontSize(8);
      doc.text(t.titulo || '—', 55, doc.y, { width: 200, ellipsis: true });
      doc.text(t.estado, 260, doc.y, { width: 80 });
      doc.text(t.prioridad, 345, doc.y, { width: 70 });
      doc.text(t.asignado_nombre || 'Sin asignar', 420, doc.y, { width: 145, ellipsis: true });
      doc.y += 16;
      rowIdx++;
    }
    doc.moveDown(1);

    // Observaciones
    if (acta.observaciones) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('4. OBSERVACIONES');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor('#333').text(acta.observaciones);
      doc.moveDown(1);
    }

    // Firmas
    if (doc.y > 600) doc.addPage();
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('5. FIRMAS');
    doc.moveDown(2);

    const firmY = doc.y;
    doc.fontSize(9).font('Helvetica').fillColor('#333');
    doc.text('_________________________', 80, firmY, { width: 200, align: 'center' });
    doc.text('Responsable del Proyecto', 80, firmY + 20, { width: 200, align: 'center' });
    doc.text('_________________________', 350, firmY, { width: 200, align: 'center' });
    doc.text('Aprobador / Gerente', 350, firmY + 20, { width: 200, align: 'center' });

    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — eliminar acta
router.delete('/:id', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects.actas_cierre WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Acta no encontrada' });
    res.json({ exitosa: true, mensaje: 'Acta eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
