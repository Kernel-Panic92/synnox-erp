require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const mail = require('./mail');

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// Used by client to detect server restarts (soft reload)
const APP_VER = require('./package.json').version;

app.get('/api/version', (req, res) => {
  res.json({ v: SERVER_START, version: APP_VER });
});

const PORT = parseInt(process.env.PORT || '3002', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const SERVER_START = Date.now();


const db = new Database(path.join(__dirname, 'launcher.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'admin',
    activo INTEGER NOT NULL DEFAULT 1,
    creado TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// Migrate: rename comprador → operador
db.prepare("UPDATE usuarios SET rol = 'operador' WHERE rol = 'comprador'").run();

const adminEmail = 'admin@horix.com';
const userCount = db.prepare('SELECT COUNT(*) as c FROM usuarios').get().c;
if (userCount === 0) {
  db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run('Admin', adminEmail, bcrypt.hashSync('admin123', 10), 'admin');
}

// ── Config table (key-value) ──
db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);

// Seed defaults
const defaults = { smtp_host:'', smtp_port:'587', smtp_secure:'false', smtp_user:'', smtp_pass:'', smtp_from:'', smtp_from_name:'Horix Platform', smtp_allow_self_signed:'false', mcp_oauth_enabled:'false',
  grad_c1:'230,126,34', grad_c2:'247,148,79', grad_c3:'196,98,16',
  rate_limit_max:'5', rate_limit_window:'60',
  ssh_host:'', ssh_user:'root' };
for (const [k, v] of Object.entries(defaults)) {
  db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)").run(k, v);
}

mail.init(db);

// ── Reset tokens table ──
db.exec(`
  CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    creado TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Login logs table ──
db.exec(`
  CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    ip TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    exitoso INTEGER NOT NULL DEFAULT 0
  )
`);
db.exec("DELETE FROM login_logs WHERE id NOT IN (SELECT id FROM login_logs ORDER BY id DESC LIMIT 500)");

// ── New Tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS modulos_plataforma (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '📦',
    mcp_enabled INTEGER NOT NULL DEFAULT 1,
    activo INTEGER NOT NULL DEFAULT 1,
    orden INTEGER NOT NULL DEFAULT 0,
    public_url TEXT NOT NULL DEFAULT '',
    mcp_token TEXT NOT NULL DEFAULT ''
  )
`);

// Migrate columns
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN url TEXT NOT NULL DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN icon TEXT NOT NULL DEFAULT "📦"'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN mcp_enabled INTEGER NOT NULL DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN activo INTEGER NOT NULL DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN orden INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN public_url TEXT NOT NULL DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN mcp_token TEXT NOT NULL DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE modulos_plataforma ADD COLUMN proxy_prefix TEXT NOT NULL DEFAULT ""'); } catch {}

// Seed public_url from url if empty
db.prepare("UPDATE modulos_plataforma SET public_url = url WHERE public_url = '' AND url != ''").run();

function getModulos(onlyMcp) {
  let sql = 'SELECT * FROM modulos_plataforma WHERE activo = 1';
  if (onlyMcp) sql += ' AND mcp_enabled = 1';
  return db.prepare(sql + ' ORDER BY orden').all();
}



function parseCookies(req) {
  const raw = req.headers['cookie'] || '';
  const result = {};
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx !== -1) result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return result;
}

function verificarToken(req, res, next) {
  let token = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies.launcher_jwt;
  }
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function soloAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Se requiere rol admin' });
  next();
}

// ── Login rate limiter ──
var loginAttempts = {};
function loginRateLimit(req, res, next) {
  var ip = req.ip || req.connection.remoteAddress || 'unknown';
  var now = Date.now();
  var max = parseInt(db.prepare("SELECT value FROM config WHERE key = 'rate_limit_max'").get()?.value || '5', 10);
  var windowMs = parseInt(db.prepare("SELECT value FROM config WHERE key = 'rate_limit_window'").get()?.value || '60', 10) * 1000;
  if (!loginAttempts[ip]) loginAttempts[ip] = [];
  loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return now - t < windowMs; });
  if (loginAttempts[ip].length >= max) {
    return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo en ' + (windowMs/1000) + ' segundos.' });
  }
  loginAttempts[ip].push(now);
  next();
}

function logLoginAttempt(ip, email, exitoso) {
  db.prepare("INSERT INTO login_logs (ip, email, exitoso) VALUES (?, ?, ?)").run(ip || '', (email || '').toLowerCase().trim(), exitoso ? 1 : 0);
}

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Campos requeridos' });
  try {
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(email.toLowerCase().trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      logLoginAttempt(req.ip, email, false);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    logLoginAttempt(req.ip, email, true);
    const payload = { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    db.prepare("UPDATE usuarios SET actualizado = datetime('now') WHERE id = ?").run(user.id);
    res.cookie('launcher_jwt', token, { httpOnly: false, secure: false, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
    res.json({ jwt: token, usuario: payload });
  } catch (e) { console.error('[LOGIN]', e.stack || e.message); res.status(500).json({ error: 'Error interno' }); }
});

// ── SMTP config ──
app.get('/api/admin/smtp', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'smtp_%' ORDER BY key").all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ config: cfg, configured: mail.isConfigured() });
});

app.put('/api/admin/smtp', verificarToken, soloAdmin, (req, res) => {
  const allowed = ['smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from','smtp_from_name','smtp_allow_self_signed'];
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) upsert.run(k, String(v ?? ''));
  }
  mail.refresh(db);
  res.json({ ok: true, configured: mail.isConfigured() });
});

app.post('/api/admin/smtp/test', verificarToken, soloAdmin, async (req, res) => {
  if (!mail.isConfigured()) return res.status(400).json({ error: 'SMTP no configurado' });
  try {
    const info = await mail.sendMail({ to: req.usuario.email, subject: 'Prueba SMTP - Horix Platform', html: '<p>Si recibes este correo, la configuración SMTP funciona correctamente.</p>' });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Global config (gradients, etc.) ──
app.get('/api/config', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'grad_%' OR key LIKE 'rate_limit_%' ORDER BY key").all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ config: cfg });
});

app.put('/api/admin/config', verificarToken, soloAdmin, (req, res) => {
  const allowed = ['grad_c1','grad_c2','grad_c3','rate_limit_max','rate_limit_window','ssh_host','ssh_user'];
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) upsert.run(k, String(v ?? ''));
  }
  res.json({ ok: true });
});

app.post('/api/admin/config/test-ssh', verificarToken, soloAdmin, (req, res) => {
  const { host, user } = req.body;
  if (!host) return res.json({ ok: false, error: 'Host requerido' });
  try {
    const out = execSync('ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 ' + (user || 'root') + '@' + host + ' "pm2 --version"', { stdio: 'pipe', timeout: 15000 }).toString().trim();
    res.json({ ok: true, version: out, message: 'Conexión SSH exitosa' });
  } catch (e) {
    res.json({ ok: false, error: 'No se pudo conectar vía SSH: ' + (e.message || 'error') });
  }
});

// Admin GET: returns allowed config keys (grad + rate_limit + ssh)
app.get('/api/admin/config', verificarToken, soloAdmin, (req, res) => {
  const allowed = ['grad_c1','grad_c2','grad_c3','rate_limit_max','rate_limit_window','ssh_host','ssh_user'];
  const placeholders = allowed.map(function() { return '?'; }).join(',');
  const rows = db.prepare("SELECT key, value FROM config WHERE key IN (" + placeholders + ")").all(...allowed);
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ config: cfg });
});

// ── Login logs ──
app.get('/api/admin/login-logs', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, fecha, ip, email, exitoso FROM login_logs ORDER BY id DESC LIMIT 50").all();
  res.json({ logs: rows });
});

// ── Password recovery ──
function getDominioYLauncherPort() {
  const configPath = '/opt/horix-platform/config.env';
  let dominio = 'localhost';
  let launcherPort = String(PORT);
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const dm = raw.match(/^DOMAIN=(.+)$/m);
      if (dm) dominio = dm[1].trim();
      // Try to read launcher port from env, fallback to PORT
      const lp = raw.match(/^LAUNCHER_PORT=(.+)$/m);
      if (lp) launcherPort = lp[1].trim();
    }
  } catch {}
  // If running behind nginx on 443/9443 use those, otherwise use the direct port
  // We check if LAUNCHER_PORT is set in config.env, else PORT
  return { dominio, launcherPort };
}

app.post('/api/auth/forgot', loginRateLimit, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  const user = db.prepare('SELECT id, email, nombre FROM usuarios WHERE email = ? AND activo = 1').get(email.toLowerCase().trim());
  // Always return same message to avoid email enumeration
  if (!user) return res.json({ ok: true, message: 'Si el email existe, recibirás un enlace de recuperación' });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').split('.')[0];
  db.prepare('INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)').run(user.email, token, expiresAt);
  const { dominio } = getDominioYLauncherPort();
  const mode = (() => { try { const r = fs.readFileSync('/opt/horix-platform/config.env','utf8'); const m = r.match(/^MODE=(.+)$/m); return m?.[1]?.trim() || 'test'; } catch { return 'test'; } })();
  // In prod, launcher is behind nginx on 9443 (or 443 if configured); use HTTPS
  const launcherPort = mode === 'prod' ? '9443' : String(PORT);
  const protocol = mode === 'prod' ? 'https' : 'http';
  const resetUrl = `${protocol}://${dominio}:${launcherPort}/reset?token=${token}`;
  if (mail.isConfigured()) {
    mail.sendResetEmail(user.email, resetUrl, user.nombre).catch(e => console.error('[MAIL] sendResetEmail error:', e.message));
    res.json({ ok: true, message: 'Si el email existe, recibirás un enlace de recuperación' });
  } else {
    console.log('[FORGOT] SMTP no configurado — token para', user.email, ':', resetUrl);
    res.json({ ok: true, message: 'SMTP no configurado. Token generado.', resetUrl: '/reset?token=' + token });
  }
});

app.get('/api/auth/reset', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  const row = db.prepare('SELECT * FROM reset_tokens WHERE token = ? AND usado = 0 AND expires_at > datetime("now")').get(token);
  if (!row) return res.status(400).json({ error: 'Token inválido o expirado' });
  res.json({ ok: true, email: row.email });
});

app.post('/api/auth/reset', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const row = db.prepare('SELECT * FROM reset_tokens WHERE token = ? AND usado = 0 AND expires_at > datetime("now")').get(token);
  if (!row) return res.status(400).json({ error: 'Token inválido o expirado' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE usuarios SET password_hash = ?, actualizado = datetime('now') WHERE email = ?").run(hash, row.email);
  db.prepare('UPDATE reset_tokens SET usado = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});

app.get('/api/modulos', verificarToken, (req, res) => {
  res.json(getModulos(false).map(m => ({ id: m.id, nombre: m.nombre, url: m.public_url || m.url, icon: m.icon, descripcion: m.descripcion })));
});

app.get('/api/auth/me', verificarToken, (req, res) => {
  const user = db.prepare('SELECT id, nombre, email, rol, activo, creado FROM usuarios WHERE id = ?').get(req.usuario.id);
  res.json(user);
});

app.get('/api/admin/usuarios', verificarToken, soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, nombre, email, rol, activo, creado, actualizado FROM usuarios ORDER BY id').all());
});

app.post('/api/admin/usuarios', verificarToken, soloAdmin, (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Campos requeridos' });
  const userRol = (rol === 'admin' || rol === 'operador') ? rol : 'operador';
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, email.toLowerCase().trim(), hash, userRol);
    res.json({ id: result.lastInsertRowid, nombre, email: email.toLowerCase().trim(), rol: userRol, activo: 1 });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El email ya existe' });
    console.error('[Create user]', e); res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, email, password, activo, rol } = req.body;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  const updates = []; const params = [];
  if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email.toLowerCase().trim()); }
  if (password) { updates.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }
  if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
  if (rol && (rol === 'admin' || rol === 'operador')) { updates.push('rol = ?'); params.push(rol); }
  if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });
  updates.push("actualizado = datetime('now')"); params.push(id);
  try {
    db.prepare(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.delete('/api/admin/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id === req.usuario.id) return res.status(400).json({ error: 'ID inválido o no puedes desactivarte' });
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("UPDATE usuarios SET activo = 0, actualizado = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.delete('/api/admin/usuarios/:id/permanent', verificarToken, soloAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id === req.usuario.id) return res.status(400).json({ error: 'ID inválido o no puedes eliminarte' });
  const result = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

// ── API: Módulos ──
app.get('/api/admin/modulos', verificarToken, soloAdmin, (req, res) => {
  res.json(getModulos(false));
});

app.post('/api/admin/modulos', verificarToken, soloAdmin, (req, res) => {
  const { id, nombre, url, public_url, icon, descripcion, mcp_enabled, activo, proxy_prefix } = req.body;
  if (!id || !nombre) return res.status(400).json({ error: 'ID y nombre requeridos' });
  db.prepare('INSERT OR REPLACE INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, proxy_prefix) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, nombre, descripcion || '', url || '', public_url || url || '', icon || '📦', mcp_enabled !== false ? 1 : 0, activo !== false ? 1 : 0, proxy_prefix || '');
  res.json({ ok: true });
});

app.put('/api/admin/modulos/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, url, public_url, icon, descripcion, mcp_enabled, activo, proxy_prefix } = req.body;
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM modulos_plataforma WHERE id = ?').get(id)) return res.status(404).json({ error: 'No encontrado' });
  const u = [];
  const p = [];
  if (nombre !== undefined) { u.push('nombre = ?'); p.push(nombre); }
  if (url !== undefined) { u.push('url = ?'); p.push(url); }
  if (public_url !== undefined) { u.push('public_url = ?'); p.push(public_url); }
  if (icon !== undefined) { u.push('icon = ?'); p.push(icon); }
  if (descripcion !== undefined) { u.push('descripcion = ?'); p.push(descripcion); }
  if (mcp_enabled !== undefined) { u.push('mcp_enabled = ?'); p.push(mcp_enabled ? 1 : 0); }
  if (activo !== undefined) { u.push('activo = ?'); p.push(activo ? 1 : 0); }
  if (proxy_prefix !== undefined) { u.push('proxy_prefix = ?'); p.push(proxy_prefix); }
  if (!u.length) return res.status(400).json({ error: 'Sin cambios' });
  p.push(id);
  db.prepare(`UPDATE modulos_plataforma SET ${u.join(', ')} WHERE id = ?`).run(...p);
  res.json({ ok: true });
});

app.delete('/api/admin/modulos/:id', verificarToken, soloAdmin, (req, res) => {
  db.prepare('DELETE FROM modulos_plataforma WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── API: Health check ──
app.get('/api/admin/health', verificarToken, soloAdmin, async (req, res) => {
  const modulos = getModulos(false);
  const results = await Promise.all(modulos.map(async (m) => {
    try {
      const sessionId = await ensureMcpSession(m);
      const headers = { 'Content-Type': 'application/json' };
      if (m.mcp_token) headers['Authorization'] = 'Bearer ' + m.mcp_token;
      if (sessionId) headers['mcp-session-id'] = sessionId;
      const r = await fetch(mcpUrl(m), {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: AbortSignal.timeout(3000),
      });
      return { id: m.id, nombre: m.nombre, estado: r.ok ? 'online' : 'error', status: r.status };
    } catch (e) {
      return { id: m.id, nombre: m.nombre, estado: 'offline', error: e.message };
    }
  }));
  res.json(results);
});

// ── API: MCP config ──
app.get('/api/admin/mcp', verificarToken, soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, nombre, icon, url, mcp_enabled, mcp_token FROM modulos_plataforma ORDER BY orden').all());
});

app.put('/api/admin/mcp/:id', verificarToken, soloAdmin, (req, res) => {
  const { url, mcp_enabled, mcp_token } = req.body;
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM modulos_plataforma WHERE id = ?').get(id)) return res.status(404).json({ error: 'No encontrado' });
  const u = []; const p = [];
  if (url !== undefined) { u.push('url = ?'); p.push(url); }
  if (mcp_enabled !== undefined) { u.push('mcp_enabled = ?'); p.push(mcp_enabled ? 1 : 0); }
  if (mcp_token !== undefined) { u.push('mcp_token = ?'); p.push(mcp_token); }
  if (!u.length) return res.status(400).json({ error: 'Sin cambios' });
  p.push(id);
  db.prepare(`UPDATE modulos_plataforma SET ${u.join(', ')} WHERE id = ?`).run(...p);
  res.json({ ok: true });
});

app.all('/api/admin/mcp/:id/test', verificarToken, soloAdmin, async (req, res) => {
  const mod = db.prepare('SELECT * FROM modulos_plataforma WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'No encontrado' });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (mod.mcp_token) headers['Authorization'] = 'Bearer ' + mod.mcp_token;
      const sessionId = await ensureMcpSession(mod);
      if (sessionId) headers['mcp-session-id'] = sessionId;
      const r = await fetch(mcpUrl(mod), {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await r.json().catch(() => null);
      res.json({ ok: r.ok, status: r.status, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Nginx config generation ──
function generarNginx() {
  const configPath = '/opt/horix-platform/config.env';
  let dominio = 'localhost';
  let mode = 'test';
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const m = raw.match(/^DOMAIN=(.+)$/m);
      if (m) dominio = m[1].trim();
      const mm = raw.match(/^MODE=(.+)$/m);
      if (mm) mode = mm[1].trim();
    }
  } catch {}

  const isProd = mode === 'prod';
  const port = isProd ? 443 : 8445;
  const sslCert = isProd
    ? `/etc/letsencrypt/live/${dominio}/fullchain.pem`
    : '/etc/ssl/platform/cert.pem';
  const sslKey = isProd
    ? `/etc/letsencrypt/live/${dominio}/privkey.pem`
    : '/etc/ssl/platform/key.pem';

  const modulos = db.prepare("SELECT * FROM modulos_plataforma WHERE activo = 1 AND proxy_prefix != '' ORDER BY orden").all();

  let locations = '';
  for (const m of modulos) {
    if (!m.url) continue;
    const prefix = m.proxy_prefix.startsWith('/') ? m.proxy_prefix : '/' + m.proxy_prefix;
    const prefixClean = prefix.replace(/\/+$/, '');
    const prefixMatch = prefixClean.replace(/\//g, '\\/');
    locations += `
    location ${prefix} {
        rewrite ^${prefixMatch}(/.*)$ $1 break;
        proxy_pass ${m.url};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
`;
  }

  return `# Auto-generated by horix-launcher
server {
    listen ${port} ssl http2;
    server_name ${isProd ? dominio : '_'};

    ssl_certificate     ${sslCert};
    ssl_certificate_key ${sslKey};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    client_max_body_size 50M;

    # Launcher: API + SPA + MCP
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Gateway MCP al launcher (accesible desde puerto 443)
    location /mcp-gateway/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
${locations}}
`;
}

// ── MCP connection info ──
app.get('/api/admin/mcp/url', verificarToken, soloAdmin, (req, res) => {
  const configPath = '/opt/horix-platform/config.env';
  let dominio = 'localhost';
  let mcpPort = '9443';
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const dm = raw.match(/^DOMAIN=(.+)$/m);
      if (dm) dominio = dm[1].trim();
      const pm = raw.match(/^MCP_PORT=(.+)$/m);
      if (pm) mcpPort = pm[1].trim();
    }
  } catch {}
  // Use the Host header as dynamic domain when behind nginx
  const host = req.headers['x-forwarded-host'] || req.headers.host || dominio;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  // If the request came through on a specific host, use that
  const dynamicHost = host.includes(':') ? host.split(':')[0] : host;
  res.json({
    url_directa: `${proto}://${dynamicHost}:${mcpPort}/mcp`,
    url_gateway: `${proto}://${dynamicHost}/mcp-gateway/mcp`,
    dominio: dynamicHost,
    puerto: mcpPort,
    url: `${proto}://${dynamicHost}:${mcpPort}/mcp`
  });
});

app.get('/api/admin/nginx', verificarToken, soloAdmin, (req, res) => {
  const config = generarNginx();
  const configPath = '/etc/nginx/sites-available/horix-erp';
  let actual = '';
  try { actual = fs.readFileSync(configPath, 'utf8'); } catch {}
  res.json({ config, actual, matches: config === actual });
});

app.post('/api/admin/nginx/generate', verificarToken, soloAdmin, (req, res) => {
  const config = generarNginx();
  const configPath = '/etc/nginx/sites-available/horix-erp';
  try {
    fs.writeFileSync(configPath, config, 'utf8');
    try {
      fs.symlinkSync('/etc/nginx/sites-available/horix-erp', '/etc/nginx/sites-enabled/horix-erp');
    } catch {}
    try {
      fs.unlinkSync('/etc/nginx/sites-enabled/default');
    } catch {}
    const { execSync } = require('child_process');
    execSync('nginx -t', { timeout: 5000 });
    execSync('systemctl reload nginx', { timeout: 5000 });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message || 'Error al generar nginx' });
  }
});

// ── Session cache for MCP modules ──
const mcpSessions = new Map();

function mcpUrl(mod) {
  const base = mod.url.replace(/\/+$/, '');
  return base + '/mcp';
}

async function ensureMcpSession(mod) {
  const cached = mcpSessions.get(mod.id);
  if (cached?.sessionId && Date.now() - cached.ts < 3600000) return cached.sessionId;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (mod.mcp_token) headers['Authorization'] = 'Bearer ' + mod.mcp_token;
    const r = await fetch(mcpUrl(mod), {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      signal: AbortSignal.timeout(5000),
    });
    const sessionId = r.headers.get('mcp-session-id');
    const data = await r.json();
    if (data.result?.protocolVersion && sessionId) {
      mcpSessions.set(mod.id, { sessionId, ts: Date.now() });
      return sessionId;
    }
    if (data.error) console.warn(`[MCP] ${mod.id} init error:`, data.error.message);
  } catch (e) { console.warn(`[MCP] Failed to initialize session for ${mod.id}:`, e.message); }
  return null;
}

async function forwardMcpRequest(mod, body, timeout = 30000) {
  const headers = { 'Content-Type': 'application/json' };
  if (mod.mcp_token) headers['Authorization'] = 'Bearer ' + mod.mcp_token;
  const sessionId = await ensureMcpSession(mod);
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const r = await fetch(mcpUrl(mod), {
    method: 'POST', headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await r.json();
  if (data.error?.code === -32001) {
    mcpSessions.delete(mod.id);
    const sessionId2 = await ensureMcpSession(mod);
    if (sessionId2) headers['mcp-session-id'] = sessionId2;
    const r2 = await fetch(mcpUrl(mod), {
      method: 'POST', headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    return r2.json();
  }
  return data;
}

// ── MCP Gateway + OAuth ──
const mcpGatewaySessions = new Map();
const mcpOAuthClients = new Map();
const mcpOAuthCodes = new Map();

// Cleanup stale gateway sessions every 10 min
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [sid, s] of mcpGatewaySessions) {
    if (s.createdAt < cutoff) mcpGatewaySessions.delete(sid);
  }
}, 600000);

function rpcResult(id, result) { return { jsonrpc: '2.0', result, id }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', error: { code, message }, id }; }

async function processMcpMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid Request');
  const id = msg.id ?? null;

  if (msg.method === 'initialize') {
    const sessionId = crypto.randomUUID();
    mcpGatewaySessions.set(sessionId, { createdAt: Date.now() });
    return { sessionId, body: rpcResult(id, { protocolVersion: '2025-03-26', serverInfo: { name: 'horix-launcher', version: '1.0.0' }, capabilities: { tools: {} } }) };
  }

  if (msg.method === 'ping') {
    return rpcResult(id, {});
  }

  const sessionId = msg.sessionId || '';
  if (sessionId && !mcpGatewaySessions.has(sessionId)) {
    console.warn('[MCP] Unknown sessionId, proceeding anyway');
  }

  if (msg.method === 'tools/list') {
    const allTools = [];
    const modulos = getModulos(true);
    for (const m of modulos) {
      try {
        const data = await forwardMcpRequest(m, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, 5000);
        if (data.result?.tools) {
          for (const t of data.result.tools) allTools.push({ ...t, name: m.id + '_' + t.name });
        }
      } catch (e) { console.warn(`[MCP] Failed to list tools from ${m.id}:`, e.message); }
    }
    return rpcResult(id, { tools: allTools });
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    if (!name) return rpcError(id, -32602, 'Missing tool name');
    const parts = name.split('_');
    const prefix = parts[0];
    const modulos = getModulos(true);
    const mod = modulos.find(m => m.id === prefix);
    if (!mod) return rpcError(id, -32601, 'Unknown or disabled module: ' + prefix);
    try {
      return await forwardMcpRequest(mod, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: parts.slice(1).join('_'), arguments: args } }, 30000);
    } catch (e) {
      return rpcError(id, -32000, 'Error contacting ' + prefix + ': ' + e.message);
    }
  }

  if (msg.method?.startsWith('notifications/')) return rpcResult(null, null);
  return rpcError(id, -32601, 'Method not found: ' + msg.method);
}

// MCP POST handler
app.post('/mcp', async (req, res) => {
  const msg = req.body;
  const sessionId = req.headers['mcp-session-id'] || '';
  if (msg && typeof msg === 'object') msg.sessionId = sessionId;
  const result = await processMcpMessage(msg);
  if (result.sessionId) {
    res.setHeader('mcp-session-id', result.sessionId);
    if (msg?.method?.startsWith('notifications/')) return res.status(202).end();
    return res.json(result.body);
  }
  if (msg?.method?.startsWith('notifications/')) return res.status(202).end();
  res.json(result);
});

app.get('/mcp', (req, res) => {
  res.json({ status: 'ok', server: 'horix-launcher', version: '1.0.0' });
});

app.options('/mcp', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.status(204).end();
});

// ── OAuth guard middleware ──
function requireOauth(req, res, next) {
  const row = db.prepare("SELECT value FROM config WHERE key = 'mcp_oauth_enabled'").get();
  if (row?.value !== 'true') return res.status(404).json({ error: 'not_found' });
  next();
}

// ── MCP OAuth 2.0 (DCR + Authorization Code flow) ──

// DCR — Dynamic Client Registration
app.post('/mcp/oauth/register', requireOauth, express.json(), (req, res) => {
  const { redirect_uris, client_name } = req.body || {};
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
  }
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  mcpOAuthClients.set(clientId, {
    client_secret: clientSecret,
    redirect_uris,
    client_name: client_name || 'Claude',
    createdAt: Date.now()
  });
  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_secret_expires_at: 0,
    client_name: client_name || 'Claude',
    redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  });
});

// Authorize endpoint
app.get('/mcp/oauth/authorize', requireOauth, (req, res) => {
  const { state, client_id, redirect_uri, response_type } = req.query;
  if (response_type !== 'code') return res.status(400).send('Invalid response_type');
  if (!mcpOAuthClients.has(client_id)) {
    mcpOAuthClients.set(client_id, {
      client_secret: crypto.randomUUID(), redirect_uris: [],
      client_name: 'Claude', autoRegistered: true, createdAt: Date.now()
    });
  }
  const client = mcpOAuthClients.get(client_id);
  const rUri = redirect_uri || client.redirect_uris[0] || 'https://claude.ai/api/mcp/auth_callback';
  if (!client.redirect_uris.includes(rUri) && /^https:\/\/claude\.ai\//.test(rUri)) {
    client.redirect_uris.push(rUri);
  }
  const code = crypto.randomUUID();
  mcpOAuthCodes.set(code, { client_id, redirect_uri: rUri, createdAt: Date.now() });
  const url = new URL(rUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state || '');
  res.redirect(302, url.toString());
});

// Token endpoint
app.post('/mcp/oauth/token', requireOauth, express.urlencoded({ extended: false }), (req, res) => {
  const { grant_type, code, redirect_uri } = req.body;
  let client_id = req.body.client_id;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    client_id = decoded.split(':')[0];
  }
  if (grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
  const stored = mcpOAuthCodes.get(code);
  if (!stored) return res.status(400).json({ error: 'invalid_grant' });
  mcpOAuthCodes.delete(code);
  const accessToken = crypto.randomUUID();
  res.json({
    access_token: accessToken, token_type: 'Bearer',
    expires_in: 86400,
    refresh_token: crypto.randomUUID()
  });
});

// Fallback: Claude sometimes POSTs to /register directly
app.post('/register', requireOauth, express.json(), (req, res) => {
  const { redirect_uris, client_name } = req.body || {};
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
  }
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  mcpOAuthClients.set(clientId, {
    client_secret: clientSecret, redirect_uris,
    client_name: client_name || 'Claude', createdAt: Date.now()
  });
  res.status(201).json({
    client_id: clientId, client_secret: clientSecret,
    client_secret_expires_at: 0, client_name: client_name || 'Claude',
    redirect_uris, grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none'
  });
});

// ── Well-known OAuth metadata ──
function getBaseUrl() {
  const configPath = '/opt/horix-platform/config.env';
  let dominio = 'localhost';
  let mcpPort = '9443';
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const dm = raw.match(/^DOMAIN=(.+)$/m);
      if (dm) dominio = dm[1].trim();
      const pm = raw.match(/^MCP_PORT=(.+)$/m);
      if (pm) mcpPort = pm[1].trim();
    }
  } catch {}
  return `https://${dominio}:${mcpPort}`;
}

app.get('/.well-known/oauth-authorization-server', requireOauth, (req, res) => {
  const base = getBaseUrl();
  res.json({
    issuer: base,
    authorization_endpoint: base + '/mcp/oauth/authorize',
    token_endpoint: base + '/mcp/oauth/token',
    registration_endpoint: base + '/mcp/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: []
  });
});

app.get('/.well-known/oauth-protected-resource', requireOauth, (req, res) => {
  const base = getBaseUrl();
  res.json({
    resource: base + '/mcp',
    authorization_servers: [base]
  });
});

// ── Updater ──
const LAUNCHER_DIR = path.resolve(__dirname, '..');

function pm2Exec(args) {
  // 1) Try local pm2
  try { return execSync('pm2 ' + args, { stdio: 'pipe' }); } catch {}
  // 2) Try local sudo pm2
  try { return execSync('sudo pm2 ' + args, { stdio: 'pipe' }); } catch {}
  // 3) Try remote via SSH if configured
  const sshHost = db.prepare("SELECT value FROM config WHERE key = 'ssh_host'").get()?.value;
  const sshUser = db.prepare("SELECT value FROM config WHERE key = 'ssh_user'").get()?.value || 'root';
  if (sshHost) {
    const cmd = 'ssh -o StrictHostKeyChecking=no -o BatchMode=yes ' + sshUser + '@' + sshHost + ' "sudo pm2 ' + args + '"';
    return execSync(cmd, { stdio: 'pipe', timeout: 10000 });
  }
  throw new Error('PM2 no disponible localmente ni vía SSH');
}
const UPDATER_LOG = path.join(__dirname, 'logs', 'updater.log');
if (!fs.existsSync(path.join(__dirname, 'logs'))) fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
function logUpdater(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(UPDATER_LOG, line + '\n');
}
function getUpdaterLog() {
  try { return fs.readFileSync(UPDATER_LOG, 'utf8'); } catch { return ''; }
}

app.get('/api/admin/updater/status', verificarToken, soloAdmin, (req, res) => {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: LAUNCHER_DIR }).toString().trim();
    const currentCommit = execSync('git rev-parse --short HEAD', { cwd: LAUNCHER_DIR }).toString().trim();
    res.json({ ok: true, branch, currentCommit });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/admin/updater/check', verificarToken, soloAdmin, (req, res) => {
  try {
    logUpdater('Verificando actualizaciones...');
    execSync('git fetch origin --prune', { cwd: LAUNCHER_DIR, stdio: 'pipe' });
    const currentCommit = execSync('git rev-parse --short HEAD', { cwd: LAUNCHER_DIR }).toString().trim();
    const remoteCommit = execSync('git rev-parse --short origin/main', { cwd: LAUNCHER_DIR }).toString().trim();
    logUpdater(`Local: ${currentCommit} | Remote: ${remoteCommit}`);
    const behind = currentCommit !== remoteCommit ? 1 : 0;
    let changes = [];
    if (behind > 0) { logUpdater(`Nueva versión disponible: ${remoteCommit}`); changes = [remoteCommit]; }
    else { logUpdater('Sistema actualizado'); }
    res.json({ ok: true, hasUpdates: behind > 0, commitsBehind: behind, currentCommit, remoteCommit, changes });
  } catch (err) { logUpdater(`Error verificando: ${err.message}`); res.json({ ok: false, error: err.message }); }
});

app.post('/api/admin/updater/update', verificarToken, soloAdmin, async (req, res) => {
  let branch = req.body?.branch || 'main';
  const allowedBranches = ['main', 'master', 'release'];
  if (!allowedBranches.includes(branch)) branch = 'main';
  try {
    logUpdater('INICIANDO ACTUALIZACION (rama: ' + branch + ')');
    logUpdater('Fetch y reset a origin/' + branch + '...');
    execSync('git fetch origin && git reset --hard origin/' + branch, { cwd: LAUNCHER_DIR, stdio: 'pipe' });
    logUpdater('Reset hard completado');
    logUpdater('Instalando dependencias...');
    try { execSync('npm install --production', { cwd: __dirname, stdio: 'pipe' }); logUpdater('Dependencias instaladas'); } catch (e) { logUpdater('npm install: ' + e.message); }
    const newCommit = execSync('git rev-parse --short HEAD', { cwd: LAUNCHER_DIR }).toString().trim();
    logUpdater('ACTUALIZACION COMPLETADA - Commit: ' + newCommit);
    fs.writeFileSync(path.join(__dirname, '.last-update'), new Date().toISOString());

    // Restart wordpress-mcp (separate process, safe)
    try { pm2Exec('restart wordpress-mcp'); logUpdater('wordpress-mcp reiniciado'); } catch { logUpdater('wordpress-mcp no disponible para reiniciar'); }

    // Respond first, then restart self after a brief delay
    res.json({ ok: true, message: 'Actualización aplicada. Reiniciando servicios...', newCommit, restarting: true });
    res.on('finish', () => {
      setTimeout(() => {
        try { pm2Exec('restart horix-launcher'); } catch {
          try { pm2Exec('restart horix-erp'); } catch { logUpdater('PM2 no disponible — reinicio manual requerido'); }
        }
      }, 1500);
    });
  } catch (err) { logUpdater('ERROR: ' + err.message); res.json({ ok: false, error: err.message }); }
});

app.post('/api/admin/updater/restart', verificarToken, soloAdmin, async (req, res) => {
  try {
    logUpdater('Reiniciando servicio...');
    try {
      pm2Exec('restart horix-launcher');
    } catch {
      try {
        pm2Exec('restart horix-erp');
      } catch {
        logUpdater('PM2 no disponible — reinicio manual requerido');
        res.json({ ok: false, message: 'PM2 no disponible. Debes reiniciar el servidor manualmente.' });
        return;
      }
    }
    logUpdater('Servicio reiniciado');
    res.json({ ok: true, message: 'Servicio reiniciado' });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.get('/api/admin/updater/logs', verificarToken, soloAdmin, (req, res) => {
  res.json({ log: getUpdaterLog() });
});

// ── MCP Modules management (generic) ──
function pm2Name(modId) {
  return modId === 'wordpress' ? 'wordpress-mcp' : modId;
}

app.get('/api/admin/mcp-modules/status', verificarToken, soloAdmin, async (req, res) => {
  try {
    const modules = getModulos(true);
    const results = [];
    for (const m of modules) {
      const entry = { id: m.id, nombre: m.nombre, url: m.public_url || m.url };
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch(m.url + '/health', { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) { entry.status = 'online'; const body = await r.json(); entry.health = body; }
        else { throw new Error('status ' + r.status); }
      } catch {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 3000);
          const r = await fetch(m.url + '/mcp', { signal: ctrl.signal });
          clearTimeout(t);
          entry.status = r.ok ? 'online' : 'error';
        } catch { entry.status = 'offline'; }
      }
      try {
        const pid = pm2Exec('pid ' + pm2Name(m.id)).toString().trim();
        entry.pm2 = pid.length > 0 && parseInt(pid) > 0 ? 'running' : 'stopped';
      } catch { entry.pm2 = 'stopped'; }
      results.push(entry);
    }
    res.json({ ok: true, modules: results });
  } catch (err) {
    console.error('[MCP Modules] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/mcp-modules/:id/restart', verificarToken, soloAdmin, async (req, res) => {
  try {
    const modId = req.params.id;
    try {
      pm2Exec('restart ' + pm2Name(modId));
      res.json({ ok: true, message: modId + ' reiniciado' });
    } catch {
      res.json({ ok: false, message: 'PM2 no disponible. Debes reiniciar ' + modId + ' manualmente.' });
    }
  } catch (err) { console.error('[MCP Modules]', err.message); res.json({ ok: false, error: err.message }); }
});

app.get('/api/admin/mcp-modules/:id/logs', verificarToken, soloAdmin, async (req, res) => {
  try {
    const modId = req.params.id;
    const modDir = modId === 'wordpress' ? 'wordpress-mcp' : modId;
    const logDir = path.resolve(__dirname, '..', modDir, 'logs');
    const logFile = path.join(logDir, modDir + '.log');
    const logData = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    res.json({ log: logData });
  } catch { res.json({ log: '' }); }
});

// ── Server Stats ──
const os = require('os');

app.get('/api/admin/server/stats', verificarToken, soloAdmin, (req, res) => {
  try {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    let disk = '';
    try { disk = execSync('df -h / | tail -1', { stdio: 'pipe', timeout: 3000 }).toString().trim().split(/\s+/); } catch {}
    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      cpus: cpus.length,
      cpuModel: cpus[0]?.model || '',
      cpuLoad: loadAvg,
      memory: { total: totalMem, free: freeMem, used: totalMem - freeMem },
      disk: disk.length >= 6 ? { size: disk[1], used: disk[2], avail: disk[3], usePct: disk[4], mount: disk[5] } : null,
      node: process.version
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Export / Import ──
app.get('/api/admin/export', verificarToken, soloAdmin, (req, res) => {
  try {
    const modulos = db.prepare('SELECT * FROM modulos_plataforma ORDER BY orden').all();
    const configRows = db.prepare('SELECT key, value FROM config ORDER BY key').all();
    const config = {};
    for (const r of configRows) config[r.key] = r.value;
    const usuarios = db.prepare('SELECT id, nombre, email, rol, activo, creado, actualizado FROM usuarios ORDER BY id').all();
    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      modulos,
      config,
      usuarios
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/import', verificarToken, soloAdmin, (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.version) return res.status(400).json({ error: 'JSON inválido' });
    const stats = { modulos: 0, config: 0, usuarios: 0 };
    if (data.modulos) {
      db.prepare('DELETE FROM modulos_plataforma').run();
      const ins = db.prepare('INSERT INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, orden, proxy_prefix) VALUES (?,?,?,?,?,?,?,?,?,?)');
      for (const m of data.modulos) {
        ins.run(m.id, m.nombre, m.descripcion || '', m.url || '', m.public_url || '', m.icon || '📦', m.mcp_enabled != null ? m.mcp_enabled : 1, m.activo != null ? m.activo : 1, m.orden || 0, m.proxy_prefix || '');
        stats.modulos++;
      }
    }
    if (data.config) {
      db.prepare('DELETE FROM config').run();
      const ins = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)');
      for (const [k, v] of Object.entries(data.config)) {
        ins.run(k, String(v));
        stats.config++;
      }
    }
    if (data.usuarios) {
      const ins = db.prepare('INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, activo, creado, actualizado) VALUES (?,?,?,?,?,?,?)');
      for (const u of data.usuarios) {
        ins.run(u.nombre, u.email, u.password_hash || '$2a$10$imported', u.rol || 'operador', u.activo != null ? u.activo : 1, u.creado || new Date().toISOString(), u.actualizado || new Date().toISOString());
        stats.usuarios++;
      }
    }
    res.json({ ok: true, message: `Importados ${stats.modulos} módulos, ${stats.config} configuraciones, ${stats.usuarios} usuarios` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use(express.static(path.join(__dirname, 'shell')));
app.get('*', (req, res) => {
  const htmlPath = path.join(__dirname, 'shell', 'index.html');
  if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
  res.status(404).json({ error: 'Not found: ' + req.path });
});

app.listen(PORT, () => console.log('Launcher on port ' + PORT));
