import express from 'express';
import pool from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_LOGO = path.join(__dirname, '..', '..', '..', '..', 'media', 'LogoERP.png');

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
      `SELECT p.*, pl.numero_factura
       FROM logistics.paradas_ruta p 
       LEFT JOIN logistics.pedidos_logistica pl ON p.pedido_id = pl.id
       WHERE p.ruta_id = $1 
       ORDER BY p.secuencia ASC`,
      [id]
    );
    const paradas = paradasRes.rows;

    const configRes = await pool.query(
      "SELECT clave, valor FROM logistics.configuracion WHERE clave IN ('company_name', 'company_logo', 'company_address', 'company_phone', 'company_nit')"
    );
    const cfg = {};
    for (const row of configRes.rows) cfg[row.clave] = row.valor;

    const doc = new PDFDocument({ size: 'letter', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    const preview = req.query.preview === '1';
    const filename = `ruta_${ruta.id}_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Disposition', preview ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`);
    doc.pipe(res);

    const primaryColor = '#1a5276';
    const accentColor = '#2e86c1';
    const lightGray = '#f2f3f4';
    const darkGray = '#2c3e50';

    // Logo: company_logo (DB) > launcher logo (file) > none
    let logoImg = null;
    if (cfg.company_logo) {
      try { logoImg = Buffer.from(cfg.company_logo, 'base64'); } catch {}
    } else if (fs.existsSync(LAUNCHER_LOGO)) {
      try { logoImg = fs.readFileSync(LAUNCHER_LOGO); } catch {}
    }

    const logoW = logoImg ? 90 : 0;
    const headerH = logoW || 60;

    if (logoImg) {
      doc.image(logoImg, 50, 35, { width: logoW, height: logoW, fit: [logoW, logoW] });
    }

    // Company info aligned to right, vertically centered with logo
    const nameY = 38;
    doc.fontSize(16).fillColor(primaryColor).font('Helvetica-Bold')
       .text(cfg.company_name || 'SynnoxERP', 50, nameY, { align: 'right', width: 512 });

    let detY = 58;
    doc.fontSize(9).fillColor(darkGray).font('Helvetica');
    if (cfg.company_address) { doc.text(`Dirección: ${cfg.company_address}`, 50, detY, { align: 'right', width: 512 }); detY += 13; }
    if (cfg.company_phone) { doc.text(`Teléfono: ${cfg.company_phone}`, 50, detY, { align: 'right', width: 512 }); detY += 13; }
    if (cfg.company_nit) { doc.text(`NIT: ${cfg.company_nit}`, 50, detY, { align: 'right', width: 512 }); detY += 13; }

    const headerBottom = 35 + headerH + 5;
    doc.moveTo(50, headerBottom).lineTo(562, headerBottom).lineWidth(2).strokeColor(primaryColor).stroke();

    const titleY = headerBottom + 8;
    doc.fontSize(14).fillColor(primaryColor).font('Helvetica-Bold')
       .text('LISTA DE VERIFICACIÓN DE RUTA', 50, titleY);

    const infoY = titleY + 22;
    doc.fontSize(10).fillColor(darkGray).font('Helvetica-Bold');
    doc.text('Ruta:', 50, infoY);
    doc.text('Fecha:', 50, infoY + 18);
    doc.text('Vehículo:', 50, infoY + 36);
    doc.text('Conductor:', 50, infoY + 54);
    doc.text('Sede:', 300, infoY);
    doc.text('Km inicial:', 300, infoY + 18);
    doc.text('Km final:', 300, infoY + 36);

    doc.font('Helvetica').fillColor(darkGray);
    doc.text(ruta.nombre || `Ruta #${ruta.id}`, 120, infoY);
    doc.text(new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), 120, infoY + 18);
    doc.text(ruta.placa || '—', 120, infoY + 36);
    doc.text('___________________________', 120, infoY + 54);
    doc.text(ruta.sede || '—', 370, infoY);
    doc.text('___________', 370, infoY + 18);
    doc.text('___________', 370, infoY + 36);

    doc.moveTo(50, infoY + 75).lineTo(562, infoY + 75).lineWidth(0.5).strokeColor('#bdc3c7').stroke();

    const tableTop = infoY + 90;
    const colWidths = [25, 100, 120, 60, 80, 87, 25];
    const colX = [50, 75, 175, 295, 355, 435, 522];

    doc.rect(50, tableTop, 512, 22).fill(primaryColor);
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold');
    doc.text('#', colX[0] + 5, tableTop + 7);
    doc.text('CLIENTE', colX[1] + 5, tableTop + 7);
    doc.text('DIRECCIÓN', colX[2] + 5, tableTop + 7);
    doc.text('FACTURA', colX[3] + 5, tableTop + 7);
    doc.text('FIRMA', colX[4] + 5, tableTop + 7);
    doc.text('OBS.', colX[5] + 5, tableTop + 7);
    doc.text('☐', colX[6] + 5, tableTop + 7);

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

      doc.fillColor(darkGray).font('Helvetica-Bold').fontSize(8);
      doc.text(String(p.secuencia || i + 1), colX[0] + 5, y + 4);

      doc.font('Helvetica').fontSize(7);
      doc.text(p.cliente_nombre || '—', colX[1] + 5, y + 2, { width: colWidths[1] - 10 });
      doc.text(p.direccion || '—', colX[2] + 5, y + 2, { width: colWidths[2] - 10 });
      doc.text(p.numero_factura || '', colX[3] + 5, y + 2, { width: colWidths[3] - 10 });

      // Signature line
      doc.moveTo(colX[4] + 5, y + 16).lineTo(colX[4] + colWidths[4] - 5, y + 16).lineWidth(0.3).strokeColor('#95a5a6').stroke();

      // Observations line
      doc.moveTo(colX[5] + 5, y + 16).lineTo(colX[5] + colWidths[5] - 5, y + 16).lineWidth(0.3).strokeColor('#95a5a6').stroke();

      doc.rect(colX[6] + 5, y + 2, 10, 10).lineWidth(0.5).strokeColor('#95a5a6').stroke();

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
       .text(`Generado por SynnoxERP • ${new Date().toLocaleString('es-CO')}`, 50, footerY + 110, { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Error generando PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error generando PDF' });
    }
  }
});

export default router;
