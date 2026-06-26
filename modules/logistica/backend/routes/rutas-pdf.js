import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

router.get('/:id/checklist.pdf', soloAdmin, async (req, res) => {
  try {
    const { default: PDFDocument } = await import('pdfkit');
    const { id } = req.params;

    const rutaRes = await pool.query(
      `SELECT r.*, v.placa, v.color 
       FROM logistics.rutas r 
       LEFT JOIN logistics.vehiculos v ON r.vehiculo_id = v.id 
       WHERE r.id = $1`,
      [id]
    );
    if (!rutaRes.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });
    const ruta = rutaRes.rows[0];

    const paradasRes = await pool.query(
      `SELECT p.*, c.nombre as cliente_nombre, c.direccion as cliente_direccion, c.telefono 
       FROM logistics.paradas_ruta p 
       LEFT JOIN logistics.clientes c ON p.cliente_id = c.id 
       WHERE p.ruta_id = $1 
       ORDER BY p.secuencia ASC`,
      [id]
    );
    const paradas = paradasRes.rows;

    const configRes = await pool.query(
      "SELECT clave, valor FROM logistics.configuracion WHERE clave IN ('company_name', 'company_logo', 'company_address', 'company_phone')"
    );
    const cfg = {};
    for (const row of configRes.rows) cfg[row.clave] = row.valor;

    const doc = new PDFDocument({ size: 'letter', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ruta_${ruta.id}_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    const primaryColor = '#1a5276';
    const accentColor = '#2e86c1';
    const lightGray = '#f2f3f4';
    const darkGray = '#2c3e50';

    if (cfg.company_logo) {
      try {
        const imgData = Buffer.from(cfg.company_logo, 'base64');
        doc.image(imgData, 50, 40, { width: 80, height: 80 });
      } catch {}
    }

    const textStartX = cfg.company_logo ? 140 : 50;
    doc.fontSize(20).fillColor(primaryColor).font('Helvetica-Bold')
       .text(cfg.company_name || 'Horix Logistics', textStartX, 45);
    doc.fontSize(9).fillColor(darkGray).font('Helvetica')
       .text(cfg.company_address || '', textStartX, 70)
       .text(cfg.company_phone || '', textStartX, 82);

    doc.moveTo(50, 130).lineTo(562, 130).lineWidth(2).strokeColor(primaryColor).stroke();

    doc.fontSize(16).fillColor(primaryColor).font('Helvetica-Bold')
       .text('LISTA DE VERIFICACIÓN DE RUTA', 50, 145);

    const infoY = 175;
    doc.fontSize(10).fillColor(darkGray).font('Helvetica-Bold');
    doc.text('Ruta:', 50, infoY);
    doc.text('Fecha:', 50, infoY + 18);
    doc.text('Vehículo:', 50, infoY + 36);
    doc.text('Conductor:', 50, infoY + 54);

    doc.font('Helvetica').fillColor(darkGray);
    doc.text(ruta.nombre || `Ruta #${ruta.id}`, 120, infoY);
    doc.text(new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), 120, infoY + 18);
    doc.text(ruta.placa || '—', 120, infoY + 36);
    doc.text('___________________________', 120, infoY + 54);

    doc.moveTo(50, infoY + 75).lineTo(562, infoY + 75).lineWidth(0.5).strokeColor('#bdc3c7').stroke();

    const tableTop = infoY + 90;
    const colWidths = [30, 150, 180, 120, 40];
    const colX = [50, 80, 230, 410, 530];

    doc.rect(50, tableTop, 512, 22).fill(primaryColor);
    doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
    doc.text('#', colX[0] + 8, tableTop + 7);
    doc.text('CLIENTE', colX[1] + 5, tableTop + 7);
    doc.text('DIRECCIÓN', colX[2] + 5, tableTop + 7);
    doc.text('TELÉFONO', colX[3] + 5, tableTop + 7);
    doc.text('☐', colX[4] + 8, tableTop + 7);

    let y = tableTop + 28;
    paradas.forEach((p, i) => {
      if (y > 680) {
        doc.addPage();
        y = 50;
      }

      const rowHeight = 28;
      if (i % 2 === 0) {
        doc.rect(50, y - 4, 512, rowHeight).fill(lightGray);
      }

      doc.fillColor(darkGray).font('Helvetica-Bold').fontSize(9);
      doc.text(String(p.secuencia || i + 1), colX[0] + 8, y + 4);

      doc.font('Helvetica').fontSize(8);
      doc.text(p.cliente_nombre || '—', colX[1] + 5, y + 2, { width: colWidths[1] - 10 });
      doc.text(p.direccion || p.cliente_direccion || '—', colX[2] + 5, y + 2, { width: colWidths[2] - 10 });
      doc.text(p.telefono || '', colX[3] + 5, y + 2, { width: colWidths[3] - 10 });

      doc.rect(colX[4] + 8, y + 2, 12, 12).lineWidth(0.5).strokeColor('#95a5a6').stroke();

      y += rowHeight;
    });

    doc.moveTo(50, y + 10).lineTo(562, y + 10).lineWidth(0.5).strokeColor('#bdc3c7').stroke();

    const footerY = y + 25;
    doc.fontSize(9).fillColor(darkGray).font('Helvetica-Bold');
    doc.text('Observaciones:', 50, footerY);
    doc.moveTo(50, footerY + 50).lineTo(562, footerY + 50).lineWidth(0.5).strokeColor('#bdc3c7').stroke();

    doc.text('Firma del conductor:', 50, footerY + 70);
    doc.moveTo(170, footerY + 90).lineTo(320, footerY + 90).lineWidth(0.5).strokeColor('#bdc3c7').stroke();

    doc.text('Firma del despachador:', 330, footerY + 70);
    doc.moveTo(450, footerY + 90).lineTo(562, footerY + 90).lineWidth(0.5).strokeColor('#bdc3c7').stroke();

    doc.fontSize(7).fillColor('#95a5a6').font('Helvetica')
       .text(`Generado por Horix Logistics • ${new Date().toLocaleString('es-CO')}`, 50, 750, { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Error generando PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error generando PDF' });
    }
  }
});

export default router;
