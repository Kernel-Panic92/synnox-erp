import express from 'express';
import nodemailer from 'nodemailer';
import pool from '../config/db.js';

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
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
        from: data.config.smtp_from || data.config.smtp_user || 'smtp@localhost'
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
    from: cfg.smtp_remitente || cfg.smtp_usuario || 'smtp@localhost'
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
        from: req.body.remitente || req.body.usuario || 'smtp@localhost'
      };
    } else if (req.body.smtp_heredar === '1') {
      const launcherUrl = (req.body.launcher_url || 'http://localhost:3002').replace(/\/+$/, '');
      if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/.test(launcherUrl)) {
        return res.status(400).json({ error: 'URL del Launcher inválida' });
      }
      const launcherRes = await fetch(launcherUrl + '/api/smtp/internal', { signal: AbortSignal.timeout(5000) });
      if (!launcherRes.ok) throw new Error('Launcher responded ' + launcherRes.status);
      const data = await launcherRes.json();
      smtp = {
        host: data.config.smtp_host || '',
        port: parseInt(data.config.smtp_port || '587'),
        secure: data.config.smtp_secure === 'true',
        user: data.config.smtp_user || '',
        pass: data.config.smtp_pass || '',
        from: data.config.smtp_from || data.config.smtp_user || 'smtp@localhost'
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
      from: smtp.from, to: req.user.email,
      subject: '🔧 Prueba SMTP - SynnoxERP Logistics',
      text: 'Si recibes esto, la configuración SMTP funciona correctamente.'
    });
    res.json({ exitosa: true, mensaje: 'Correo de prueba enviado a ' + req.user.email });
  } catch (err) {
    res.status(500).json({ error: 'Error al enviar: ' + err.message });
  }
});

/* ── Company Logo (base64 in config) ── */
router.get('/logo', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT valor FROM logistics.configuracion WHERE clave = 'company_logo'");
    const logo = result.rows[0]?.valor || '';
    res.json({ logo: logo ? `data:image/png;base64,${logo}` : '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/logo', soloAdmin, async (req, res) => {
  try {
    const { logo } = req.body;
    if (!logo || typeof logo !== 'string') return res.status(400).json({ error: 'Logo requerido (base64)' });
    const base64 = logo.replace(/^data:image\/\w+;base64,/, '');
    if (base64.length > 500000) return res.status(400).json({ error: 'Logo demasiado grande (máx 500KB)' });
    await pool.query(
      `INSERT INTO logistics.configuracion (clave, valor, updated_at) VALUES ('company_logo', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (clave) DO UPDATE SET valor = $1, updated_at = CURRENT_TIMESTAMP`,
      [base64]
    );
    res.json({ ok: true, mensaje: 'Logo guardado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/logo', soloAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM logistics.configuracion WHERE clave = 'company_logo'");
    res.json({ ok: true, mensaje: 'Logo eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Company Info (for PDF branding) ── */
router.get('/company', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT clave, valor FROM logistics.configuracion WHERE clave IN ('company_name','company_address','company_phone','company_nit','company_latitud','company_longitud')"
    );
    const cfg = {};
    for (const row of result.rows) cfg[row.clave] = row.valor;
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/company', soloAdmin, async (req, res) => {
  try {
    const { company_name, company_address, company_phone, company_nit, company_latitud, company_longitud } = req.body;
    const updates = [
      ['company_name', company_name],
      ['company_address', company_address],
      ['company_phone', company_phone],
      ['company_nit', company_nit],
      ['company_latitud', company_latitud],
      ['company_longitud', company_longitud],
    ];
    for (const [clave, valor] of updates) {
      if (valor !== undefined) {
        await pool.query(
          `INSERT INTO logistics.configuracion (clave, valor, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = CURRENT_TIMESTAMP`,
          [clave, String(valor)]
        );
      }
    }
    res.json({ ok: true, mensaje: 'Datos de empresa guardados' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Google Maps API Key (server-side) ── */
router.get('/gmaps/key', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT valor FROM logistics.configuracion WHERE clave = 'google_maps_key'");
    const key = result.rows[0]?.valor || '';
    res.json({ key, configured: !!key });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/gmaps/key', soloAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'API key requerida' });
    await pool.query(
      `INSERT INTO logistics.configuracion (clave, valor, updated_at) VALUES ('google_maps_key', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (clave) DO UPDATE SET valor = $1, updated_at = CURRENT_TIMESTAMP`,
      [key.trim()]
    );
    res.json({ ok: true, mensaje: 'API key guardada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/gmaps/key', soloAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM logistics.configuracion WHERE clave = 'google_maps_key'");
    res.json({ ok: true, mensaje: 'API key eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/gmaps/geocode', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT valor FROM logistics.configuracion WHERE clave = 'google_maps_key'");
    const key = result.rows[0]?.valor;
    if (!key) return res.status(400).json({ error: 'API key de Google Maps no configurada' });
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'Parámetro address requerido' });
    const gRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
    const data = await gRes.json();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/gmaps/js-url', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT valor FROM logistics.configuracion WHERE clave = 'google_maps_key'");
    const key = result.rows[0]?.valor || '';
    if (!key) return res.json({ url: '' });
    res.json({ url: `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
