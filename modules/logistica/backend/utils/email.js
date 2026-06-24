import nodemailer from 'nodemailer';
import pool from '../config/db.js';

async function cargarConfigLocal() {
  const result = await pool.query('SELECT clave, valor FROM logistics.configuracion');
  const cfg = {};
  for (const row of result.rows) cfg[row.clave] = row.valor;
  return cfg;
}

async function obtenerConfigSmtp() {
  const cfg = await cargarConfigLocal();
  if (cfg.smtp_heredar === '1' || cfg.smtp_heredar === 'true') {
    try {
      const launcherUrl = (cfg.launcher_url || 'http://localhost:3002').replace(/\/+$/, '');
      const res = await fetch(launcherUrl + '/api/smtp/internal', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Launcher responded ' + res.status);
      const data = await res.json();
      return {
        host: data.config.smtp_host || '',
        port: parseInt(data.config.smtp_port || '587'),
        secure: data.config.smtp_secure === 'true',
        user: data.config.smtp_user || '',
        pass: data.config.smtp_pass || '',
        from: data.config.smtp_from || data.config.smtp_user || 'logistics@vitamar.com'
      };
    } catch (e) {
      console.warn('[EMAIL] Fallback a config local (launcher no disponible):', e.message);
    }
  }
  return {
    host: cfg.smtp_host || '',
    port: parseInt(cfg.smtp_puerto || '587'),
    secure: cfg.smtp_tls === '1',
    user: cfg.smtp_usuario || '',
    pass: cfg.smtp_password || '',
    from: cfg.smtp_remitente || cfg.smtp_usuario || 'logistics@vitamar.com'
  };
}

export async function enviarCorreo(to, subject, text, html) {
  const smtp = await obtenerConfigSmtp();
  if (!smtp.host) throw new Error('SMTP no configurado');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
  await transporter.sendMail({
    from: smtp.from,
    to,
    subject,
    text,
    html: html || text.replace(/\n/g, '<br>')
  });
}
