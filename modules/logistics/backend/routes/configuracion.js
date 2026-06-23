import express from 'express';
import nodemailer from 'nodemailer';
import pool from '../config/db.js';

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

async function obtenerConfigSmtp() {
  const result = await pool.query('SELECT clave, valor FROM logistics.configuracion');
  const cfg = {};
  for (const row of result.rows) cfg[row.clave] = row.valor;
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
      console.warn('[CONFIG] Fallback SMTP local (launcher no disponible):', e.message);
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

router.get('/', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT clave, valor FROM logistics.configuracion');
    const cfg = {};
    for (const row of result.rows) cfg[row.clave] = row.valor;
    res.json({ exitosa: true, config: cfg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/', soloAdmin, async (req, res) => {
  try {
    const updates = req.body;
    for (const [clave, valor] of Object.entries(updates)) {
      if (clave === 'smtp_password' && typeof valor === 'string' && valor.includes('•')) continue;
      await pool.query(
        `INSERT INTO logistics.configuracion (clave, valor, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = CURRENT_TIMESTAMP`,
        [clave, String(valor)]
      );
    }
    res.json({ exitosa: true, mensaje: 'Configuración guardada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Seguridad config ── */
router.get('/seguridad', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT clave, valor FROM logistics.configuracion WHERE clave IN ('login_max_attempts','login_window_minutes','login_block_minutes','rate_limit_window','rate_limit_max','fail2ban_enabled','fail2ban_bantime','fail2ban_findtime','fail2ban_maxretry','app_url')");
    const cfg = {};
    for (const row of result.rows) cfg[row.clave] = row.valor;
    let fail2ban = { installed: false, active: false };
    try {
      const { execSync } = await import('child_process');
      fail2ban.installed = execSync('which fail2ban-client 2>/dev/null || echo ""', { encoding: 'utf8' }).trim().length > 0;
      if (fail2ban.installed) {
        const status = execSync('systemctl is-active fail2ban 2>/dev/null || echo "inactive"', { encoding: 'utf8' }).trim();
        fail2ban.active = status === 'active';
      }
    } catch {}
    res.json({ config: cfg, fail2ban });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/seguridad', soloAdmin, async (req, res) => {
  try {
    const allowed = ['login_max_attempts','login_window_minutes','login_block_minutes','rate_limit_window','rate_limit_max','fail2ban_enabled','fail2ban_bantime','fail2ban_findtime','fail2ban_maxretry','app_url'];
    for (const [clave, valor] of Object.entries(req.body)) {
      if (!allowed.includes(clave)) continue;
      let v = String(valor);
      if (['login_max_attempts','login_window_minutes','login_block_minutes','rate_limit_window','rate_limit_max','fail2ban_bantime','fail2ban_findtime','fail2ban_maxretry'].includes(clave)) {
        const n = parseInt(valor);
        if (isNaN(n) || n < 1) continue;
        v = String(n);
      }
      await pool.query(
        `INSERT INTO logistics.configuracion (clave, valor, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = CURRENT_TIMESTAMP`,
        [clave, v]
      );
    }
    res.json({ exitosa: true, mensaje: 'Configuración de seguridad guardada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/fail2ban/:action', soloAdmin, async (req, res) => {
  const action = req.params.action;
  if (!['start','stop','restart','reload'].includes(action)) return res.status(400).json({ error: 'Acción inválida' });
  try {
    const { execSync } = await import('child_process');
    const result = execSync(`sudo systemctl ${action} fail2ban 2>&1 || true`, { encoding: 'utf8' }).trim();
    res.json({ ok: true, mensaje: `fail2ban ${action}: ${result || 'ok'}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/test', soloAdmin, async (req, res) => {
  try {
    let smtp;
    const { host, puerto, tls } = req.body;
    if (host) {
      smtp = {
        host, port: parseInt(puerto) || 587,
        secure: tls === '1' || tls === true,
        user: req.body.usuario || '',
        pass: req.body.password || '',
        from: req.body.remitente || req.body.usuario || 'logistics@vitamar.com'
      };
    } else if (req.body.smtp_heredar === '1') {
      const launcherUrl = (req.body.launcher_url || 'http://localhost:3002').replace(/\/+$/, '');
      const launcherRes = await fetch(launcherUrl + '/api/smtp/internal', { signal: AbortSignal.timeout(5000) });
      if (!launcherRes.ok) throw new Error('Launcher responded ' + launcherRes.status);
      const data = await launcherRes.json();
      smtp = {
        host: data.config.smtp_host || '',
        port: parseInt(data.config.smtp_port || '587'),
        secure: data.config.smtp_secure === 'true',
        user: data.config.smtp_user || '',
        pass: data.config.smtp_pass || '',
        from: data.config.smtp_from || data.config.smtp_user || 'logistics@vitamar.com'
      };
    } else {
      smtp = await obtenerConfigSmtp();
    }
    if (!smtp.host) throw new Error('SMTP no configurado');
    const transporter = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
    });
    await transporter.sendMail({
      from: smtp.from, to: req.usuario.email,
      subject: '🔧 Prueba SMTP - Horix Logistics',
      text: 'Si recibes esto, la configuración SMTP funciona correctamente.'
    });
    res.json({ exitosa: true, mensaje: 'Correo de prueba enviado a ' + req.usuario.email });
  } catch (err) {
    res.status(500).json({ error: 'Error al enviar: ' + err.message });
  }
});

export default router;
