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
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });

const app = express();
app.set('trust proxy', true);
app.use(express.json());

function sanitizePath(input, base) {
  const resolved = path.resolve(base, input);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.resolve(base))) {
    throw new Error('Path fuera del directorio permitido');
  }
  return normalized;
}

// Used by client to detect server restarts (soft reload)
const APP_VER = require('./package.json').version;

app.get('/api/version', (req, res) => {
  res.json({ v: SERVER_START, version: APP_VER });
});

// Track submodule visits from modules
app.post('/api/track', (req, res) => {
  const { submodule } = req.body;
  if (!submodule) return res.status(400).json({ error: 'submodule required' });
  // Store in a simple file-based counter
  const trackFile = path.join(LAUNCHER_DIR, 'logs', 'track.json');
  try {
    let track = {};
    if (fs.existsSync(trackFile)) track = JSON.parse(fs.readFileSync(trackFile, 'utf8'));
    track[submodule] = (track[submodule] || 0) + 1;
    fs.writeFileSync(trackFile, JSON.stringify(track, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/track', (req, res) => {
  const trackFile = path.join(LAUNCHER_DIR, 'logs', 'track.json');
  try {
    if (!fs.existsSync(trackFile)) return res.json({});
    res.json(JSON.parse(fs.readFileSync(trackFile, 'utf8')));
  } catch (e) {
    res.json({});
  }
});

app.get('/api/admin/commits', verificarToken, soloAdmin, (req, res) => {
  try {
    const limit = String(Math.min(parseInt(req.query.limit) || 10, 50));
    const log = spawnSync('git', ['log', `--oneline -${limit}`, '--format=%H|%s|%ai'], { cwd: LAUNCHER_DIR, stdio: 'pipe', encoding: 'utf8' }).stdout.trim();
    const commits = log.split('\n').filter(Boolean).map(line => {
      const [hash, message, date] = line.split('|');
      return { hash, message, date };
    });
    res.json({ ok: true, commits });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

const COMPANY_NAME = process.env.SMTP_FROM_NAME || process.env.COMPANY_NAME || 'SynnoxERP';
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN || 'localhost';
const INSTALL_DIR = process.env.INSTALL_DIR || '/opt/synnoxerp';

const PORT = parseInt(process.env.PORT || '3002', 10);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado. Establece la variable de entorno JWT_SECRET.');
  process.exit(1);
}
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
// Migrate: all roles except admin → operador
db.prepare("UPDATE usuarios SET rol = 'operador' WHERE rol != 'admin'").run();

const adminEmail = process.env.ADMIN_EMAIL || `admin@${COMPANY_DOMAIN}`;
const adminPass = process.env.ADMIN_PASS || 'admin123';
const adminHash = bcrypt.hashSync(adminPass, 10);
const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(adminEmail);
if (!existing) {
  db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run('Admin', adminEmail, adminHash, 'admin');
} else {
  db.prepare('UPDATE usuarios SET password_hash = ?, rol = ? WHERE id = ?').run(adminHash, 'admin', existing.id);
}

// ── User-module permissions (monorepo auth) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS user_modulos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    modulo_id TEXT NOT NULL,
    permisos TEXT DEFAULT '{}',
    UNIQUE(user_id, modulo_id)
  )
`);

// ── Perfiles (profiles with permissions) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS perfiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    descripcion TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS perfil_permisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    perfil_id INTEGER NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
    modulo_id TEXT NOT NULL,
    permiso TEXT NOT NULL,
    UNIQUE(perfil_id, modulo_id, permiso)
  )
`);

// Add perfil_id to usuarios if not exists
try { db.exec("ALTER TABLE usuarios ADD COLUMN perfil_id INTEGER REFERENCES perfiles(id)"); } catch {}
// Add seq (session version) to usuarios if not exists
try { db.exec("ALTER TABLE usuarios ADD COLUMN seq INTEGER NOT NULL DEFAULT 1"); } catch {}
db.prepare("UPDATE usuarios SET seq = 1 WHERE seq IS NULL").run();

// Helper to invalidate a user's session (increments seq)
function invalidarSesionUsuario(userId) {
  db.prepare("UPDATE usuarios SET seq = seq + 1, actualizado = datetime('now') WHERE id = ?").run(userId);
}
// Helper to invalidate all users with a given profile
function invalidarSesionPorPerfil(perfilId) {
  const users = db.prepare("SELECT id FROM usuarios WHERE perfil_id = ?").all(perfilId);
  for (const u of users) invalidarSesionUsuario(u.id);
}

// Seed default profiles
const defaultProfiles = [
  { nombre: 'ADMINISTRADOR', descripcion: 'Acceso total a todos los módulos y funciones' },
  { nombre: 'OPERADOR', descripcion: 'Operaciones básicas de cada módulo' },
  { nombre: 'CONSULTA', descripcion: 'Solo consulta, sin edición' },
];
for (const p of defaultProfiles) {
  db.prepare("INSERT OR IGNORE INTO perfiles (nombre, descripcion) VALUES (?, ?)").run(p.nombre, p.descripcion);
}

// ── Config table (key-value) ──
db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);

// Seed defaults
const defaults = { smtp_host:'', smtp_port:'587', smtp_secure:'false', smtp_user:'', smtp_pass:'', smtp_from:'', smtp_from_name: COMPANY_NAME, smtp_allow_self_signed:'false', mcp_oauth_enabled:'false',
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
try { db.exec("ALTER TABLE modulos_plataforma ADD COLUMN tipo TEXT NOT NULL DEFAULT 'externo'"); } catch {}
// Seed tipo for internal modules
db.prepare("UPDATE modulos_plataforma SET tipo = 'interno' WHERE id IN ('proveedores', 'nomina', 'logistica') AND tipo = 'externo'").run();

// Migrate old module IDs to new names
try { db.prepare("UPDATE modulos_plataforma SET id = 'nomina' WHERE id = 'horix'").run(); } catch {}
try { db.prepare("UPDATE modulos_plataforma SET id = 'proveedores' WHERE id = 'docflow'").run(); } catch {}
try { db.prepare("UPDATE modulos_plataforma SET id = 'logistica' WHERE id = 'logistics'").run(); } catch {}
// Also migrate user_modulos references
try { db.prepare("UPDATE user_modulos SET modulo_id = 'nomina' WHERE modulo_id = 'horix'").run(); } catch {}
try { db.prepare("UPDATE user_modulos SET modulo_id = 'proveedores' WHERE modulo_id = 'docflow'").run(); } catch {}
try { db.prepare("UPDATE user_modulos SET modulo_id = 'logistica' WHERE modulo_id = 'logistics'").run(); } catch {}

// Seed public_url from url if empty
db.prepare("UPDATE modulos_plataforma SET public_url = url WHERE public_url = '' AND url != ''").run();

// ── Permisos granular tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS modulos_permisos_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modulo_id TEXT NOT NULL,
    permiso_id TEXT NOT NULL,
    label TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'action',
    activo INTEGER NOT NULL DEFAULT 1,
    UNIQUE(modulo_id, permiso_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS modulos_permisos_perfil (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    perfil_id INTEGER NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
    modulo_id TEXT NOT NULL,
    permiso_id TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    UNIQUE(perfil_id, modulo_id, permiso_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS modulos_permisos_usuario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    modulo_id TEXT NOT NULL,
    permiso_id TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    UNIQUE(usuario_id, modulo_id, permiso_id)
  )
`);

// Seed default permission configs for known modules
const defaultPermisosConfig = {
  proveedores: [
    ['ver', 'Ver facturas'],
    ['crear', 'Crear facturas'],
    ['editar', 'Editar facturas'],
    ['eliminar', 'Eliminar facturas'],
    ['aprobar', 'Aprobar facturas'],
    ['rechazar', 'Rechazar facturas'],
    ['causar', 'Causar facturas'],
    ['pagar', 'Pagar facturas'],
    ['configurar', 'Configurar módulo'],
    ['exportar', 'Exportar datos'],
    ['auditar', 'Ver auditoría']
  ],
  nomina: [
    ['centros', 'Gestionar centros'],
    ['usuarios', 'Gestionar usuarios'],
    ['empleados', 'Gestionar empleados'],
    ['nominas', 'Gestionar nóminas'],
    ['registros', 'Registrar horas'],
    ['configuracion', 'Configurar módulo'],
    ['backup', 'Backup y restore'],
    ['reportes', 'Ver reportes'],
    ['siesa', 'Exportación SIESA'],
    ['tipos', 'Gestionar tipos'],
    ['aprobar', 'Aprobar registros'],
    ['editar', 'Editar registros'],
    ['revertir', 'Revertir registros/empleados'],
    ['eliminar_registros', 'Eliminar registros'],
    ['eliminar_empleados', 'Eliminar empleados'],
    ['eliminar_centros', 'Eliminar centros'],
    ['eliminar_nominas', 'Eliminar nóminas'],
    ['ver_todos', 'Ver datos de todos'],
    ['ver_sede', 'Ver datos de sede'],
    ['ver_propios', 'Ver solo propios']
  ],
  logistica: [
    ['ver', 'Ver dashboard/rutas/pedidos'],
    ['crear', 'Crear rutas/pedidos'],
    ['editar', 'Editar rutas/pedidos'],
    ['eliminar', 'Eliminar rutas/pedidos'],
    ['asignar', 'Asignar vehículos/conductores'],
    ['configurar', 'Configurar módulo'],
    ['exportar', 'Exportar datos']
  ]
};

const insPermisoConfig = db.prepare(
  'INSERT OR IGNORE INTO modulos_permisos_config (modulo_id, permiso_id, label, tipo) VALUES (?, ?, ?, ?)'
);
for (const [modId, permisos] of Object.entries(defaultPermisosConfig)) {
  for (const [permId, label] of permisos) {
    insPermisoConfig.run(modId, permId, label, 'action');
  }
}

function getModulos(onlyMcp) {
  let sql = 'SELECT * FROM modulos_plataforma WHERE activo = 1';
  if (onlyMcp) sql += ' AND mcp_enabled = 1';
  return db.prepare(sql + ' ORDER BY orden').all();
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
  var max = parseInt(db.prepare("SELECT value FROM config WHERE key = 'rate_limit_max'").get()?.value || '20', 10);
  var windowMs = parseInt(db.prepare("SELECT value FROM config WHERE key = 'rate_limit_window'").get()?.value || '60', 10) * 1000;
  if (!loginAttempts[ip]) loginAttempts[ip] = [];
  loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return now - t < windowMs; });
  if (loginAttempts[ip].length >= max) {
    return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo en ' + (windowMs/1000) + ' segundos.' });
  }
  req._loginRateLimitKey = ip;
  req._loginRateLimitNow = now;
  next();
}
// Periodic cleanup: purge stale IP entries every 5 minutes
setInterval(function() {
  var cutoff = Date.now() - 360000;
  for (var ip in loginAttempts) {
    if (loginAttempts.hasOwnProperty(ip)) {
      loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return t > cutoff; });
      if (loginAttempts[ip].length === 0) delete loginAttempts[ip];
    }
  }
}, 300000);

function encryptEmail(email) {
  const key = crypto.scryptSync(process.env.JWT_SECRET || 'fallback', 'login-logs', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let enc = cipher.update(email, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decryptEmail(data) {
  const parts = data.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const key = crypto.scryptSync(process.env.JWT_SECRET || 'fallback', 'login-logs', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let dec = decipher.update(encrypted, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function logLoginAttempt(ip, email, exitoso) {
  const encEmail = email ? encryptEmail((email || '').toLowerCase().trim()) : '';
  db.prepare("INSERT INTO login_logs (ip, email, exitoso) VALUES (?, ?, ?)").run(ip || '', encEmail, exitoso ? 1 : 0);
}

const { buildPayload, getUserWithPermissions, parseCookies } = require('./../framework/auth');

app.use('/api', apiLimiter);

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Campos requeridos' });
  try {
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(email.toLowerCase().trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      if (req._loginRateLimitKey) loginAttempts[req._loginRateLimitKey].push(req._loginRateLimitNow);
      logLoginAttempt(req.ip, email, false);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    logLoginAttempt(req.ip, email, true);
    const userWithPerms = getUserWithPermissions(db, user.id);
    if (!userWithPerms) return res.status(500).json({ error: 'Error al cargar permisos' });
    const payload = buildPayload(userWithPerms);
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    db.prepare("UPDATE usuarios SET actualizado = datetime('now') WHERE id = ?").run(user.id);
    res.cookie('launcher_jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    console.log(`[LOGIN] Cookie set for ${email}`);
    res.json({ jwt: token, usuario: payload, modulos: payload.modulos });
  } catch (e) { console.error('[LOGIN]', e.stack || e.message); res.status(500).json({ error: 'Error interno' }); }
});

// ── Cookie test endpoint ──
app.get('/api/cookie-test', (req, res) => {
  const raw = req.headers['cookie'] || '';
  const hasLauncherJwt = raw.includes('launcher_jwt=');
  res.json({ hasCookie: !!raw, hasLauncherJwt: hasLauncherJwt, preview: raw.slice(0,100) });
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
    const fromName = mail.getConfig().smtp_from_name || COMPANY_NAME;
const info = await mail.sendMail({ to: req.usuario.email, subject: `Prueba SMTP - ${fromName}`, html: '<p>Si recibes este correo, la configuración SMTP funciona correctamente.</p>' });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Internal endpoint for session version check (modules call this) ──
app.get('/api/internal/usuario-seq/:id', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';
  if (!isLocal) return res.status(403).json({ error: 'Acceso denegado: solo localhost' });
  const user = db.prepare('SELECT id, seq FROM usuarios WHERE id = ? AND activo = 1').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ seq: user.seq });
});

// ── Internal endpoint for module SMTP inheritance (localhost only) ──
app.get('/api/smtp/internal', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';
  if (!isLocal) return res.status(403).json({ error: 'Acceso denegado: solo localhost' });
  const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'smtp_%' ORDER BY key").all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ config: cfg });
});

// ── Shell/Theme config for framework ──
app.get('/api/shell/config', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'grad_%' OR key IN ('app_name','logo_url','smtp_from_name') ORDER BY key").all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json(cfg);
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
  // Validate host: only alphanumeric, dots, hyphens, underscores
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return res.json({ ok: false, error: 'Host inválido' });
  // Validate user: only alphanumeric, hyphens, underscores
  if (user && !/^[a-zA-Z0-9_-]+$/.test(user)) return res.json({ ok: false, error: 'Usuario inválido' });
  try {
    const out = spawnSync('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', (user || 'root') + '@' + host, 'pm2', '--version'], { stdio: 'pipe', timeout: 15000, encoding: 'utf8' }).stdout.trim();
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
  for (const row of rows) {
    if (row.email && row.email.includes(':')) {
      try { row.email = decryptEmail(row.email); } catch { row.email = '—'; }
    }
  }
  res.json({ logs: rows });
});

// ── Password recovery ──
function getDominioYLauncherPort() {
  const configPath = path.join(INSTALL_DIR, 'config.env');
  let dominio = COMPANY_DOMAIN;
  let launcherPort = String(PORT);
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const dm = raw.match(/^DOMAIN=(.+)$/m);
      if (dm) dominio = dm[1].trim();
      const lp = raw.match(/^LAUNCHER_PORT=(.+)$/m);
      if (lp) launcherPort = lp[1].trim();
    }
  } catch {}
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
  const mode = (() => { try { const r = fs.readFileSync(path.join(INSTALL_DIR, 'config.env'), 'utf8'); const m = r.match(/^MODE=(.+)$/m); return m?.[1]?.trim() || 'test'; } catch { return 'test'; } })();
  // In prod, launcher is behind nginx on 9443 (or 443 if configured); use HTTPS
  const launcherPort = mode === 'prod' ? '9443' : String(PORT);
  const protocol = mode === 'prod' ? 'https' : 'http';
  const resetUrl = `${protocol}://${dominio}:${launcherPort}/reset?token=${token}`;
  if (mail.isConfigured()) {
    mail.sendResetEmail(user.email, resetUrl, user.nombre).catch(e => console.error('[MAIL] sendResetEmail error:', e.message));
    res.json({ ok: true, message: 'Si el email existe, recibirás un enlace de recuperación' });
  } else {
    console.log('[FORGOT] SMTP no configurado — token para', user.email, ':', resetUrl);
    res.json({ ok: true, message: 'SMTP no configurado. Contacta al administrador para restablecer tu contraseña.' });
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
  const userModulos = req.usuario.modulos || [];
  const allModulos = getModulos(false);
  const filtered = (req.usuario.rol === 'admin') ? allModulos : allModulos.filter(m => userModulos.includes(m.id));
  res.json(filtered.map(m => ({ id: m.id, nombre: m.nombre, url: m.public_url || m.url, icon: m.icon, descripcion: m.descripcion })));
});

app.get('/api/auth/me', verificarToken, (req, res) => {
  const userWithPerms = getUserWithPermissions(db, req.usuario.id);
  if (!userWithPerms) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { modulos, modulos_permisos, permisos, perfil_nombre, ...rest } = userWithPerms;
  res.json({ ...rest, modulos, modulos_permisos, permisos, perfil_nombre });
});

app.get('/api/admin/usuarios', verificarToken, soloAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.creado, u.actualizado, u.perfil_id,
           p.nombre as perfil_nombre
    FROM usuarios u
    LEFT JOIN perfiles p ON u.perfil_id = p.id
    ORDER BY u.id
  `).all());
});

app.post('/api/admin/usuarios', verificarToken, soloAdmin, (req, res) => {
  const { nombre, email, password, rol, perfil_id } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Campos requeridos' });
  const userRol = (rol === 'admin' || rol === 'operador') ? rol : 'operador';
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol, perfil_id) VALUES (?, ?, ?, ?, ?)').run(nombre, email.toLowerCase().trim(), hash, userRol, perfil_id || null);
    res.json({ id: result.lastInsertRowid, nombre, email: email.toLowerCase().trim(), rol: userRol, activo: 1, perfil_id: perfil_id || null });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El email ya existe' });
    console.error('[Create user]', e); res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, email, password, activo, rol, perfil_id } = req.body;
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
  if (perfil_id !== undefined) { updates.push('perfil_id = ?'); params.push(perfil_id || null); }
  if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });
  updates.push("actualizado = datetime('now')"); params.push(id);
  try {
    const changedRol = rol !== undefined && rol !== user.rol;
    const changedPerfil = perfil_id !== undefined && perfil_id !== user.perfil_id;
    db.prepare(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (changedRol || changedPerfil) invalidarSesionUsuario(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.delete('/api/admin/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id === req.usuario.id) return res.status(400).json({ error: 'ID inválido o no puedes desactivarte' });
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("UPDATE usuarios SET activo = 0, actualizado = datetime('now') WHERE id = ?").run(id);
  invalidarSesionUsuario(id);
  res.json({ ok: true });
});

app.delete('/api/admin/usuarios/:id/permanent', verificarToken, soloAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id === req.usuario.id) return res.status(400).json({ error: 'ID inválido o no puedes eliminarte' });
  const result = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

// ── User-Module assignments ──
app.get('/api/admin/usuarios/:id/modulos', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare('SELECT modulo_id FROM user_modulos WHERE user_id = ?').all(parseInt(req.params.id));
  res.json(rows.map(r => r.modulo_id));
});

app.put('/api/admin/usuarios/:id/modulos', verificarToken, soloAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { modulos } = req.body; // array of module IDs
  if (!Array.isArray(modulos)) return res.status(400).json({ error: 'modulos debe ser un array' });
  const del = db.prepare('DELETE FROM user_modulos WHERE user_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO user_modulos (user_id, modulo_id) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    del.run(userId);
    for (const m of modulos) ins.run(userId, m);
  });
  transaction();
  invalidarSesionUsuario(userId);
  res.json({ ok: true, modulos });
});

// ── API: Perfiles ──
app.get('/api/admin/perfiles', verificarToken, soloAdmin, (req, res) => {
  const perfiles = db.prepare('SELECT * FROM perfiles ORDER BY nombre').all();
  for (const p of perfiles) {
    p.permisos = db.prepare('SELECT modulo_id, permiso FROM perfil_permisos WHERE perfil_id = ?').all(p.id);
    p.permisos_funcionales = db.prepare('SELECT modulo_id, permiso_id FROM modulos_permisos_perfil WHERE perfil_id = ? AND activo = 1').all(p.id);
    p.usuarios_count = db.prepare('SELECT COUNT(*) as c FROM usuarios WHERE perfil_id = ?').get(p.id).c;
  }
  res.json(perfiles);
});

app.get('/api/admin/perfiles/:id', verificarToken, soloAdmin, (req, res) => {
  const perfil = db.prepare('SELECT * FROM perfiles WHERE id = ?').get(req.params.id);
  if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });
  perfil.permisos = db.prepare('SELECT modulo_id, permiso FROM perfil_permisos WHERE perfil_id = ?').all(perfil.id);
  perfil.permisos_funcionales = db.prepare('SELECT modulo_id, permiso_id FROM modulos_permisos_perfil WHERE perfil_id = ? AND activo = 1').all(perfil.id);
  res.json(perfil);
});

app.post('/api/admin/perfiles', verificarToken, soloAdmin, (req, res) => {
  const { nombre, descripcion, permisos, permisos_funcionales } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = db.prepare('INSERT INTO perfiles (nombre, descripcion) VALUES (?, ?)').run(nombre, descripcion || '');
    const perfilId = result.lastInsertRowid;
    if (Array.isArray(permisos)) {
      const ins = db.prepare('INSERT INTO perfil_permisos (perfil_id, modulo_id, permiso) VALUES (?, ?, ?)');
      for (const p of permisos) ins.run(perfilId, p.modulo_id, p.permiso);
    }
    if (Array.isArray(permisos_funcionales)) {
      const ins = db.prepare('INSERT INTO modulos_permisos_perfil (perfil_id, modulo_id, permiso_id) VALUES (?, ?, ?)');
      for (const p of permisos_funcionales) ins.run(perfilId, p.modulo_id, p.permiso_id);
    }
    res.json({ ok: true, id: perfilId });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un perfil con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/perfiles/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, permisos, permisos_funcionales } = req.body;
  const perfil = db.prepare('SELECT id FROM perfiles WHERE id = ?').get(id);
  if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });
  try {
    if (nombre) db.prepare('UPDATE perfiles SET nombre = ?, descripcion = ? WHERE id = ?').run(nombre, descripcion || '', id);
    if (Array.isArray(permisos)) {
      db.prepare('DELETE FROM perfil_permisos WHERE perfil_id = ?').run(id);
      const ins = db.prepare('INSERT INTO perfil_permisos (perfil_id, modulo_id, permiso) VALUES (?, ?, ?)');
      for (const p of permisos) ins.run(id, p.modulo_id, p.permiso);
    }
    if (Array.isArray(permisos_funcionales)) {
      db.prepare('DELETE FROM modulos_permisos_perfil WHERE perfil_id = ?').run(id);
      const ins = db.prepare('INSERT INTO modulos_permisos_perfil (perfil_id, modulo_id, permiso_id) VALUES (?, ?, ?)');
      for (const p of permisos_funcionales) ins.run(id, p.modulo_id, p.permiso_id);
    }
    if (Array.isArray(permisos) || Array.isArray(permisos_funcionales)) invalidarSesionPorPerfil(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/perfiles/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const usersWithProfile = db.prepare('SELECT COUNT(*) as c FROM usuarios WHERE perfil_id = ?').get(id).c;
  if (usersWithProfile > 0) return res.status(400).json({ error: `${usersWithProfile} usuario(s) tienen este perfil. Reasigna primero.` });
  db.prepare('DELETE FROM perfiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/admin/perfiles/:id/usuarios', verificarToken, soloAdmin, (req, res) => {
  const users = db.prepare('SELECT id, nombre, email, rol, activo FROM usuarios WHERE perfil_id = ?').all(req.params.id);
  res.json(users);
});

// ── Granular permissions: config ──
app.get('/api/admin/permisos-config', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM modulos_permisos_config WHERE activo = 1 ORDER BY modulo_id, id').all();
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.modulo_id]) grouped[r.modulo_id] = [];
    grouped[r.modulo_id].push({ id: r.permiso_id, label: r.label, tipo: r.tipo });
  }
  res.json(grouped);
});

app.get('/api/admin/modulos/:id/permisos-config', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM modulos_permisos_config WHERE modulo_id = ? AND activo = 1 ORDER BY id').all(req.params.id);
  res.json(rows.map(r => ({ id: r.permiso_id, label: r.label, tipo: r.tipo })));
});

app.put('/api/admin/modulos/:id/permisos-config', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const { permisos } = req.body; // [{id, label, tipo}]
  if (!Array.isArray(permisos)) return res.status(400).json({ error: 'permisos debe ser un array' });
  db.prepare('DELETE FROM modulos_permisos_config WHERE modulo_id = ?').run(id);
  const ins = db.prepare('INSERT INTO modulos_permisos_config (modulo_id, permiso_id, label, tipo) VALUES (?, ?, ?, ?)');
  for (const p of permisos) ins.run(id, p.id, p.label || p.id, p.tipo || 'action');
  res.json({ ok: true });
});

// ── Granular permissions: user-level exceptions ──
app.get('/api/admin/usuarios/:id/permisos-funcionales', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare('SELECT modulo_id, permiso_id FROM modulos_permisos_usuario WHERE usuario_id = ? AND activo = 1').all(req.params.id);
  res.json(rows.map(r => ({ modulo_id: r.modulo_id, permiso_id: r.permiso_id })));
});

app.put('/api/admin/usuarios/:id/permisos-funcionales', verificarToken, soloAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { permisos } = req.body; // [{modulo_id, permiso_id}]
  if (!Array.isArray(permisos)) return res.status(400).json({ error: 'permisos debe ser un array' });
  const del = db.prepare('DELETE FROM modulos_permisos_usuario WHERE usuario_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO modulos_permisos_usuario (usuario_id, modulo_id, permiso_id) VALUES (?, ?, ?)');
  const transaction = db.transaction(() => {
    del.run(userId);
    for (const p of permisos) ins.run(userId, p.modulo_id, p.permiso_id);
  });
  transaction();
  invalidarSesionUsuario(userId);
  res.json({ ok: true });
});

// ── API: Módulos ──
app.get('/api/admin/modulos', verificarToken, soloAdmin, (req, res) => {
  res.json(getModulos(false));
});

app.post('/api/admin/modulos', verificarToken, soloAdmin, (req, res) => {
  const { id, nombre, url, public_url, icon, descripcion, mcp_enabled, activo, proxy_prefix, tipo } = req.body;
  if (!id || !nombre) return res.status(400).json({ error: 'ID y nombre requeridos' });
  db.prepare('INSERT OR REPLACE INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, proxy_prefix, tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, nombre, descripcion || '', url || '', public_url || url || '', icon || '📦', mcp_enabled !== false ? 1 : 0, activo !== false ? 1 : 0, proxy_prefix || '', tipo === 'interno' ? 'interno' : 'externo');
  res.json({ ok: true });
});

app.put('/api/admin/modulos/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, url, public_url, icon, descripcion, mcp_enabled, activo, proxy_prefix, tipo } = req.body;
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
  if (tipo !== undefined) { u.push('tipo = ?'); p.push(tipo === 'interno' ? 'interno' : 'externo'); }
  if (!u.length) return res.status(400).json({ error: 'Sin cambios' });
  p.push(id);
  db.prepare(`UPDATE modulos_plataforma SET ${u.join(', ')} WHERE id = ?`).run(...p);
  res.json({ ok: true });
});

app.delete('/api/admin/modulos/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM modulos_plataforma WHERE id = ?').run(id);
  db.prepare('DELETE FROM user_modulos WHERE modulo_id = ?').run(id);
  db.prepare('DELETE FROM perfil_permisos WHERE modulo_id = ?').run(id);
  res.json({ ok: true });
});

// ── Scaffold module from framework template ──
app.post('/api/admin/modulos/scaffold', verificarToken, soloAdmin, async (req, res) => {
  const { id, nombre, port, description, tipo } = req.body;
  if (!id || !nombre || !port) return res.status(400).json({ error: 'Se requiere: id, nombre, port' });
  if (!/^\w+$/.test(id)) return res.status(400).json({ error: 'ID solo letras, números y guión bajo' });
  const listenPort = parseInt(port);
  if (isNaN(listenPort) || listenPort < 1024 || listenPort > 65535) return res.status(400).json({ error: 'Puerto inválido (1024-65535)' });
  const isInternal = tipo === 'interno';

  const installDir = path.join(__dirname, '..');
  const modulesDir = path.join(installDir, 'modules');
  const modDir = path.join(modulesDir, id);
  const publicDir = path.join(modDir, 'public');
  const backendDir = path.join(modDir, 'backend');
  const mcpDir = path.join(backendDir, 'mcp');
  const frameworkDir = path.join(installDir, 'framework');

  try {
    fs.mkdirSync(publicDir, { recursive: true });
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(mcpDir, { recursive: true });

    for (const file of ['base.css', 'components.css', 'framework.js', 'theme.js']) {
      const src = path.join(frameworkDir, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(publicDir, file));
    }

    const pkg = {
      name: id, version: '1.0.0', type: 'module',
      description: description || '',
      main: 'backend/server.js',
      dependencies: { express: '^4.21.0', cors: '^2.8.5', jsonwebtoken: '^9.0.0', dotenv: '^16.0.0' }
    };
    fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify(pkg, null, 2));
    fs.writeFileSync(path.join(modDir, '.env'), `PORT=${listenPort}\n# !!! IMPORTANTE: Cambia JWT_SECRET antes de usar en producción\nJWT_SECRET=change-me-${id}\nMODULE_ID=${id}\n`);

    const serverJs = isInternal ? (
`import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { createMiddleware } from './mcp/index.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || ${listenPort};
const MODULE_ID = process.env.MODULE_ID || '${id}';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('ERROR: JWT_SECRET no configurado en módulo ' + MODULE_ID); process.exit(1); }

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use('/api', apiLimiter);

function verificarToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try { req.usuario = jwt.verify(auth.split(' ')[1], JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token inv\u00e1lido o expirado' }); }
}

function requireModulo(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
  const modulos = req.usuario.modulos || [];
  if (req.usuario.rol === 'admin' || modulos.includes(MODULE_ID)) return next();
  res.status(403).json({ error: 'No tienes acceso a ' + MODULE_ID });
}

app.get('/api/health', apiLimiter, (req, res) => res.json({ status: 'ok' }));
app.get('/health', apiLimiter, (req, res) => res.json({ status: 'ok', module: MODULE_ID }));

app.use('/mcp', mcpLimiter);
app.use('/mcp', createMiddleware());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', apiLimiter, (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => console.log('${nombre} escuchando en puerto', PORT));
export default app;
`
    ) : (
`import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { createMiddleware } from './mcp/index.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || ${listenPort};
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('ERROR: JWT_SECRET no configurado en módulo ' + MODULE_ID); process.exit(1); }

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use('/api', apiLimiter);

function verificarToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try { req.usuario = jwt.verify(auth.split(' ')[1], JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token inv\u00e1lido o expirado' }); }
}

app.get('/api/health', apiLimiter, (req, res) => res.json({ status: 'ok' }));
app.get('/health', apiLimiter, (req, res) => res.json({ status: 'ok', module: '${id}' }));

app.use('/mcp', mcpLimiter);
app.use('/mcp', createMiddleware());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', apiLimiter, (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => console.log('${nombre} escuchando en puerto', PORT));
export default app;
`
    );
    fs.writeFileSync(path.join(backendDir, 'server.js'), serverJs);

    fs.writeFileSync(path.join(mcpDir, 'index.js'), `export function createMiddleware() {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { method, params, id } = req.body;
    let response;
    switch (method) {
      case 'initialize':
        response = { jsonrpc: '2.0', id, result: { protocolVersion: '0.1.0', capabilities: { tools: {} }, serverInfo: { name: '${id}', version: '1.0.0' } } };
        break;
      case 'ping':
        response = { jsonrpc: '2.0', id, result: {} };
        break;
      case 'tools/list':
        response = { jsonrpc: '2.0', id, result: { tools: [] } };
        break;
      case 'tools/call':
        response = { jsonrpc: '2.0', id, error: { code: -32601, message: 'Tool not implemented' } };
        break;
      default:
        response = { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    }
    res.json(response);
  };
}
`);

    if (isInternal) {
      // Internal module: no login screen, reads token from launcher cookie/localStorage
      let html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
      html += '<title>' + nombre + '</title>';
      html += '<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="components.css">';
      html += '</head><body>';
      html += '<div id="app-screen" style="display:block;"><div class="app-layout">';
      html += '<aside class="sidebar" id="sidebar"><div class="sidebar-brand">' + nombre + '</div>';
      html += '<nav id="sidebar-nav"><div class="nav-item active" data-page="dashboard" onclick="navigate(\'dashboard\')"><span class="icon">📊</span> Dashboard</div></nav>';
      html += '<div class="sidebar-footer"><div class="sidebar-user" onclick="document.getElementById(\'modal-logout\').classList.add(\'show\')">';
      html += '<div class="avatar" id="user-avatar">U</div><div><div id="user-name"></div><div id="user-role" style="font-size:11px;color:var(--muted)"></div></div></div></div>';
      html += '</aside><main class="main-content"><div class="page active" id="page-dashboard"><div class="page-header"><h3>Dashboard</h3><p>Bienvenido</p></div><div id="dash-content"></div></div></main></div></div>';
      html += '<div class="modal-overlay" id="modal-logout"><div class="modal"><div class="modal-title">Cerrar sesi\u00f3n</div><p>\u00bfEst\u00e1s seguro?</p><div class="modal-actions"><button class="btn btn-sm" onclick="document.getElementById(\'modal-logout\').classList.remove(\'show\')">Cancelar</button><button class="btn btn-danger btn-sm" onclick="logout()">Salir</button></div></div></div>';
      html += '<div id="toast-container"></div>';
      html += '<script src="framework.js"></script><script src="theme.js"></script><script src="app.js"></script>';
      html += '</body></html>';
      fs.writeFileSync(path.join(publicDir, 'index.html'), html);
    } else {
      let html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
      html += '<title>' + nombre + '</title>';
      html += '<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="components.css">';
      html += '</head><body>';
      html += '<div id="login-screen" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg)">';
      html += '<div class="login-card"><h1>' + nombre + '</h1><p>Ingresa tus credenciales</p>';
      html += '<div id="login-error" style="color:var(--danger);margin-bottom:12px;display:none;font-size:14px;"></div>';
      html += '<label>Email</label><input type="email" id="login-email" placeholder="admin@correo.com">';
      html += '<label>Contrase\u00f1a</label><input type="password" id="login-pass" placeholder="••••••••">';
      html += '<button class="btn btn-primary" id="login-btn" style="width:100%;margin-top:12px;" onclick="login()">Ingresar</button>';
      html += '</div></div>';
      html += '<div id="app-screen" style="display:none;"><div class="app-layout">';
      html += '<aside class="sidebar" id="sidebar"><div class="sidebar-brand">' + nombre + '</div>';
      html += '<nav id="sidebar-nav"><div class="nav-item active" data-page="dashboard" onclick="navigate(\'dashboard\')"><span class="icon">📊</span> Dashboard</div></nav>';
      html += '<div class="sidebar-footer"><div class="sidebar-user" onclick="document.getElementById(\'modal-logout\').classList.add(\'show\')">';
      html += '<div class="avatar" id="user-avatar">U</div><div><div id="user-name"></div><div id="user-role" style="font-size:11px;color:var(--muted)"></div></div></div></div>';
      html += '</aside><main class="main-content"><div class="page active" id="page-dashboard"><div class="page-header"><h3>Dashboard</h3><p>Bienvenido</p></div><div id="dash-content"></div></div></main></div></div>';
      html += '<div class="modal-overlay" id="modal-logout"><div class="modal"><div class="modal-title">Cerrar sesi\u00f3n</div><p>\u00bfEst\u00e1s seguro?</p><div class="modal-actions"><button class="btn btn-sm" onclick="document.getElementById(\'modal-logout\').classList.remove(\'show\')">Cancelar</button><button class="btn btn-danger btn-sm" onclick="logout()">Salir</button></div></div></div>';
      html += '<div id="toast-container"></div>';
      html += '<script src="framework.js"></script><script src="theme.js"></script><script src="app.js"></script>';
      html += '</body></html>';
      fs.writeFileSync(path.join(publicDir, 'index.html'), html);
    }

    // Shared app.js for internal modules: reads JWT from launcher cookie
    const appJs = isInternal ? (
`const BASE = location.pathname.match(/^\\/(\\w+)\\//) ? '/' + RegExp.$1 : '';
const API = BASE + '/api';
const MODULE_ID = '${id}';

function getToken() {
  const c = document.cookie.split('; ').find(r => r.startsWith('launcher_jwt='));
  return c ? c.split('=')[1] : localStorage.getItem('launcher_jwt');
}

function logout() {
  window.location.href = (BASE || '');
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Sesi\u00f3n expirada'); }
  return await res.json();
}

async function init() {
  const t = getToken();
  if (!t) return logout();
  try {
    const data = await api('/auth/me');
    document.getElementById('user-name').textContent = data.nombre || data.email;
    document.getElementById('user-role').textContent = data.rol || '';
  } catch { logout(); }
}
init();
`
    ) : (
`const BASE = location.pathname.match(/^\\/(\\w+)\\//) ? '/' + RegExp.$1 : '';
const API = BASE + '/api';
let TOKEN = localStorage.getItem('${id}_token');
let USER = null;

function logout() {
  TOKEN = null;
  localStorage.removeItem('${id}_token');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401 && !path.includes('/auth/login')) { logout(); throw new Error('Sesi\u00f3n expirada'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    TOKEN = data.jwt || data.token; USER = data.usuario;
    localStorage.setItem('${id}_token', TOKEN);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('user-name').textContent = USER.nombre;
    document.getElementById('user-role').textContent = USER.email;
  } catch (e) { document.getElementById('login-error').textContent = e.message; document.getElementById('login-error').style.display = 'block'; }
}

async function init() {
  if (TOKEN) {
    try { const data = await api('/auth/verificar'); USER = data.usuario; document.getElementById('login-screen').style.display = 'none'; document.getElementById('app-screen').style.display = 'block'; }
    catch { logout(); }
  }
}
init();
`
    );
    fs.writeFileSync(path.join(publicDir, 'app.js'), appJs + `\nfunction navigate(page) { document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); const el = document.getElementById('page-' + page); if (el) el.classList.add('active'); const nav = document.querySelector('[data-page="' + page + '"]'); if (nav) nav.classList.add('active'); }\n`);

    const npmResult = execSync('npm install', { cwd: modDir, timeout: 60000, encoding: 'utf8' });

    const prefix = '/' + id + '/';
    db.prepare('INSERT OR REPLACE INTO modulos_plataforma (id, nombre, descripcion, url, icon, mcp_enabled, activo, proxy_prefix, tipo) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)').run(id, nombre, description || '', 'http://localhost:' + listenPort, '📦', prefix, isInternal ? 'interno' : 'externo');

    res.json({ ok: true, mensaje: 'M\u00f3dulo ' + (isInternal ? 'interno' : 'externo') + ' creado en ' + modDir, npm: npmResult.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const configPath = path.join(INSTALL_DIR, 'config.env');
  let dominio = COMPANY_DOMAIN;
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

  return `# Auto-generated by synnoxerp
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
  const configPath = path.join(INSTALL_DIR, 'config.env');
  let dominio = COMPANY_DOMAIN;
  let mcpPort = '9443';
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const dm = raw.match(/^DOMAIN=(.+)$/m);
      if (dm) dominio = dm[1].trim();
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
  const configPath = '/etc/nginx/sites-available/synnoxerp';
  let actual = '';
  try { actual = fs.readFileSync(configPath, 'utf8'); } catch {}
  res.json({ config, actual, matches: config === actual });
});

app.post('/api/admin/nginx/generate', verificarToken, soloAdmin, (req, res) => {
  const config = generarNginx();
  const configPath = '/etc/nginx/sites-available/synnoxerp';
  try {
    fs.writeFileSync(configPath, config, 'utf8');
    try {
      fs.symlinkSync('/etc/nginx/sites-available/synnoxerp', '/etc/nginx/sites-enabled/synnoxerp');
    } catch {}
    try {
      fs.unlinkSync('/etc/nginx/sites-enabled/default');
    } catch {}
const { execSync, spawnSync, execFileSync } = require('child_process');
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
    return { sessionId, body: rpcResult(id, { protocolVersion: '2025-03-26', serverInfo: { name: 'synnoxerp', version: '1.0.0' }, capabilities: { tools: {} } }) };
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

app.use('/mcp', mcpLimiter);

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
  res.json({ status: 'ok', server: 'synnoxerp', version: '1.0.0' });
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
  const configPath = path.join(INSTALL_DIR, 'config.env');
  let dominio = COMPANY_DOMAIN;
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
  // Validate args to prevent command injection
  if (typeof args !== 'string' || /[;&|`$]/.test(args)) throw new Error('Invalid args');
  const argsArr = args.split(/\s+/);
  // 1) Try local pm2
  try { return execFileSync('pm2', argsArr, { stdio: 'pipe' }); } catch {}
  // 2) Try local sudo pm2
  try { return execFileSync('sudo', ['pm2', ...argsArr], { stdio: 'pipe' }); } catch {}
  // 3) Try remote via SSH if configured
  const sshHost = db.prepare("SELECT value FROM config WHERE key = 'ssh_host'").get()?.value;
  const sshUser = db.prepare("SELECT value FROM config WHERE key = 'ssh_user'").get()?.value || 'root';
  if (sshHost) {
    return execFileSync('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', sshUser + '@' + sshHost, 'sudo', 'pm2', ...argsArr], { stdio: 'pipe', timeout: 10000, encoding: 'utf8' });
  }
  throw new Error('PM2 no disponible localmente ni vía SSH');
}
const UPDATER_LOG = path.join(__dirname, 'logs', 'updater.log');
if (!fs.existsSync(path.join(__dirname, 'logs'))) fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
function logUpdater(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(UPDATER_LOG, line + '\n'); } catch {}
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
    execFileSync('git', ['fetch', 'origin'], { cwd: LAUNCHER_DIR, stdio: 'pipe' });
    execFileSync('git', ['reset', '--hard', 'origin/' + branch], { cwd: LAUNCHER_DIR, stdio: 'pipe' });
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
        try { pm2Exec('restart horix-erp'); } catch { logUpdater('PM2 no disponible — reinicio manual requerido'); }
      }, 1500);
    });
  } catch (err) { logUpdater('ERROR: ' + err.message); res.json({ ok: false, error: err.message }); }
});

app.post('/api/admin/updater/restart', verificarToken, soloAdmin, async (req, res) => {
  try {
    logUpdater('Reiniciando servicio...');
    try {
      pm2Exec('restart horix-erp');
    } catch {
      logUpdater('PM2 no disponible — reinicio manual requerido');
      res.json({ ok: false, message: 'PM2 no disponible. Debes reiniciar el servidor manualmente.' });
      return;
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
    if (!/^\w+$/.test(modId)) return res.status(400).json({ ok: false, error: 'ID de módulo inválido' });
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
    if (!/^\w+$/.test(modId)) return res.status(400).json({ ok: false, error: 'ID de módulo inválido' });
    const modDir = modId === 'wordpress' ? 'wordpress-mcp' : modId;
    const logDir = sanitizePath(modDir, path.resolve(__dirname, '..'));
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
      const ins = db.prepare('INSERT INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, orden, proxy_prefix, tipo) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const m of data.modulos) {
        ins.run(m.id, m.nombre, m.descripcion || '', m.url || '', m.public_url || '', m.icon || '📦', m.mcp_enabled != null ? m.mcp_enabled : 1, m.activo != null ? m.activo : 1, m.orden || 0, m.proxy_prefix || '', m.tipo === 'interno' ? 'interno' : 'externo');
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

if (require.main === module) {
  app.use(express.static(path.join(__dirname, 'shell')));
  app.get('*', (req, res) => {
    const htmlPath = path.join(__dirname, 'shell', 'index.html');
    if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
    res.status(404).json({ error: 'Not found: ' + req.path });
  });

  // Global error handler — prevent crashes
  app.use((err, req, res, next) => {
    console.error('[Launcher Error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor' });
  });

  app.listen(PORT, () => console.log('Launcher on port ' + PORT));
}

module.exports = app;
