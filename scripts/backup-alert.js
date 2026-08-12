#!/usr/bin/env node
// backup-alert.js — Envía alerta de backup por email SIN depender del launcher.
// Lee config SMTP de launcher.db (mismas claves smtp_* que usa launcher/mail.js)
// y envía a todos los admins activos.
//
// Uso: NODE_PATH=<install>/launcher/node_modules node backup-alert.js <install_dir> <ok|fail> <asunto> <cuerpo>
// Salida: exit 0 si se envió (o si SMTP no está configurado — no debe tumbar el backup).

const path = require('path');
const fs = require('fs');

const INSTALL_DIR = process.argv[2];
const STATUS = process.argv[3] === 'ok' ? 'ok' : 'fail';
const ASUNTO = process.argv[4] || 'Backup SynnoxERP';
const CUERPO = process.argv[5] || '';

if (!INSTALL_DIR) {
  console.error('Uso: backup-alert.js <install_dir> <ok|fail> <asunto> <cuerpo>');
  process.exit(1);
}

let Database, nodemailer;
try {
  Database = require('better-sqlite3');
  nodemailer = require('nodemailer');
} catch (e) {
  console.error(`[alerta] Dependencias no disponibles: ${e.message}`);
  process.exit(0);
}

const dbPath = path.join(INSTALL_DIR, 'launcher', 'launcher.db');
if (!fs.existsSync(dbPath)) {
  console.error('[alerta] launcher.db no encontrado, no se puede enviar alerta');
  process.exit(0);
}

try {
  const db = new Database(dbPath, { readonly: true });

  const cfg = {};
  try {
    for (const r of db.prepare("SELECT key, value FROM config WHERE key LIKE 'smtp_%'").all()) {
      cfg[r.key] = r.value;
    }
  } catch {}

  if (!cfg.smtp_host || !cfg.smtp_port) {
    console.log('[alerta] SMTP no configurado en launcher — alerta omitida');
    db.close();
    process.exit(0);
  }

  let destinatarios = [];
  try {
    destinatarios = db
      .prepare("SELECT email FROM usuarios WHERE rol = 'admin' AND activo = 1")
      .all()
      .map((r) => r.email)
      .filter(Boolean);
  } catch {}
  db.close();

  if (!destinatarios.length && process.env.ADMIN_EMAIL) {
    destinatarios = [process.env.ADMIN_EMAIL];
  }
  if (!destinatarios.length) {
    console.log('[alerta] Sin destinatarios admin — alerta omitida');
    process.exit(0);
  }

  const transport = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port, 10),
    secure: cfg.smtp_secure === 'true',
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass || '' } : undefined,
    tls: { rejectUnauthorized: cfg.smtp_allow_self_signed !== 'true' },
  });

  const fromName = cfg.smtp_from_name || process.env.COMPANY_NAME || 'SynnoxERP';
  const from = cfg.smtp_from || cfg.smtp_user || 'smtp@localhost';
  const icono = STATUS === 'ok' ? '✅' : '❌';
  const color = STATUS === 'ok' ? '#22c55e' : '#ef4444';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body style="font-family:'Inter',Arial,sans-serif;background:#0d0f14;color:#e8ecf5;margin:0;padding:32px;">
<div style="background:#161a23;border:1px solid #2a3045;border-radius:16px;padding:32px;max-width:560px;margin:0 auto;">
  <div style="font-size:22px;font-weight:800;">${icono} <span style="color:${color};">${ASUNTO}</span></div>
  <pre style="background:#0d0f14;border:1px solid #2a3045;border-radius:8px;padding:16px;font-size:13px;white-space:pre-wrap;color:#c9d2e3;">${CUERPO.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>
  <p style="color:#7a85a0;font-size:11px;">&copy; ${new Date().getFullYear()} ${fromName} — Backup automático</p>
</div></body></html>`;

  transport
    .sendMail({ from: `"${fromName}" <${from}>`, to: destinatarios.join(', '), subject: `${icono} ${ASUNTO}`, html, text: `${ASUNTO}\n\n${CUERPO}` })
    .then(() => {
      console.log(`[alerta] Enviada a: ${destinatarios.join(', ')}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`[alerta] Error enviando: ${e.message}`);
      process.exit(0);
    });
} catch (e) {
  console.error(`[alerta] Error: ${e.message}`);
  process.exit(0);
}
