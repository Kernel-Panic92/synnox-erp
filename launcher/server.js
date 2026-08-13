require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const mail = require('./mail');
const rateLimit = require('express-rate-limit');
const { verificarToken, soloAdmin, parseCookies, firmarToken } = require('./middleware/auth');
const { encryptEmail, decryptEmail } = require('./services/crypto');
const { createLoginRateLimit, getLoginAttempts } = require('./services/rateLimit');
const { debeEnviarEmail } = require('../framework/email-check');
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const dcrLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados registros de clientes — intenta más tarde' } });
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// ── INTERNAL_API_TOKEN enforcement ──
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
if (!INTERNAL_API_TOKEN) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] INTERNAL_API_TOKEN no configurado en producción');
    process.exit(1);
  } else {
    console.warn('[WARN] INTERNAL_API_TOKEN no configurado — notificaciones internas rechazadas');
  }
}

function validarTokenInterno(req) {
  if (!INTERNAL_API_TOKEN) return false;
  const token = req.headers['x-internal-token'];
  if (!token) return false;
  try {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(INTERNAL_API_TOKEN, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function sanitizePath(input, base) {
  const resolved = path.resolve(base, input);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.resolve(base))) {
    throw new Error('Path fuera del directorio permitido');
  }
  return normalized;
}

// Used by client to detect server restarts (soft reload)
const APP_VER = require('../package.json').version;

app.use('/api', apiLimiter);

app.get('/api/version', async (req, res) => {
  let commit = '';
  try { const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: LAUNCHER_DIR, timeout: 5000 }); commit = stdout.trim(); } catch {}
  res.json({ v: SERVER_START, version: APP_VER, commit });
});

// Track submodule visits from modules
const trackDirPath = path.join(__dirname, 'logs');
const trackFilePath = path.join(trackDirPath, 'track.json');
app.post('/api/track', (req, res) => {
  const { submodule } = req.body;
  if (!submodule) return res.status(400).json({ error: 'submodule required' });
  try {
    if (!fs.existsSync(trackDirPath)) fs.mkdirSync(trackDirPath, { recursive: true });
    let track = {};
    try { track = JSON.parse(fs.readFileSync(trackFilePath, 'utf8')); } catch {}
    track[submodule] = (track[submodule] || 0) + 1;
    fs.writeFile(trackFilePath, JSON.stringify(track, null, 2), () => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/track', (req, res) => {
  try {
    if (!fs.existsSync(trackFilePath)) return res.json({});
    res.json(JSON.parse(fs.readFileSync(trackFilePath, 'utf8')));
  } catch (e) {
    res.json({});
  }
});

app.get('/api/admin/commits', verificarToken, soloAdmin, async (req, res) => {
  try {
    const limit = String(Math.min(parseInt(req.query.limit) || 10, 50));
    const { stdout } = await execFileAsync('git', ['log', `--oneline -${limit}`, '--format=%H|%s|%ai'], { cwd: LAUNCHER_DIR, timeout: 5000 });
    const log = stdout.trim();
    const commits = log.split('\n').filter(Boolean).map(line => {
      const [hash, message, date] = line.split('|');
      return { hash, message, date };
    });
    res.json({ ok: true, commits });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

const COMPANY_NAME = process.env.SMTP_FROM_NAME || process.env.COMPANY_NAME || 'SynnoxERP';
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN || 'localhost';
const INSTALL_DIR = process.env.INSTALL_DIR || path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '3002', 10);
const JWT_SECRET = process.env.JWT_SECRET;

// Base URL for emails and external links
// In production (COMPANY_DOMAIN set), uses HTTPS on standard port (no port needed)
// In development (COMPANY_DOMAIN=localhost), uses HTTP on PORT
function getBaseUrl() {
  if (COMPANY_DOMAIN !== 'localhost') return `https://${COMPANY_DOMAIN}`;
  return `http://localhost:${PORT}`;
}
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET no está configurado. Establece la variable de entorno JWT_SECRET.');
  process.exit(1);
}
const SERVER_START = Date.now();


const db = new Database(path.join(__dirname, 'launcher.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
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
// Add sede column if not exists
try { db.exec("ALTER TABLE usuarios ADD COLUMN sede TEXT NOT NULL DEFAULT 'Principal'"); } catch {}

const adminEmail = process.env.ADMIN_EMAIL || `admin@${COMPANY_DOMAIN}`;
const adminPass = process.env.ADMIN_PASS || 'admin123';
const adminHash = bcrypt.hashSync(adminPass, 10);
const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(adminEmail);
if (!existing) {
  db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)').run('Admin', adminEmail, adminHash, 'admin');
} else {
  db.prepare("UPDATE usuarios SET rol = 'admin' WHERE id = ?").run(existing.id);
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

// ── Centros de operación (catálogo global; JWT usuarios.sede = nombre del centro)
db.exec(`
  CREATE TABLE IF NOT EXISTS centros_operacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    codigo TEXT DEFAULT '',
    descripcion TEXT DEFAULT '',
    direccion TEXT DEFAULT '',
    ciudad TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    email TEXT DEFAULT '',
    responsable_id INTEGER,
    latitud REAL,
    longitud REAL,
    activo INTEGER NOT NULL DEFAULT 1,
    creado TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// Migrar tabla legacy sedes → centros_operacion (si existía)
try {
  const hasSedes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sedes'").get();
  if (hasSedes) {
    db.exec(`INSERT OR IGNORE INTO centros_operacion (id, nombre, activo, creado) SELECT id, nombre, activo, creado FROM sedes`);
    db.exec('DROP TABLE sedes');
  }
} catch {}
// Migraciones incrementales para columnas nuevas
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN codigo TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN descripcion TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN direccion TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN ciudad TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN telefono TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN email TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN responsable_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN latitud REAL"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN longitud REAL"); } catch {}
try { db.exec("ALTER TABLE centros_operacion ADD COLUMN actualizado TEXT NOT NULL DEFAULT (datetime('now'))"); } catch {}
db.prepare("INSERT OR IGNORE INTO centros_operacion (nombre) VALUES ('Principal')").run();

// ── Auditoría de centros de operación ──
db.exec(`
  CREATE TABLE IF NOT EXISTS centros_historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centro_id INTEGER NOT NULL,
    accion TEXT NOT NULL,
    usuario_id INTEGER,
    usuario_nombre TEXT DEFAULT '',
    antes TEXT DEFAULT '',
    despues TEXT DEFAULT '',
    creado TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Config table (key-value) ──
db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);

// Seed defaults
const defaults = { smtp_host:'', smtp_port:'587', smtp_secure:'false', smtp_user:'', smtp_pass:'', smtp_from:'', smtp_from_name: COMPANY_NAME, smtp_allow_self_signed:'false', mcp_oauth_enabled:'true',
  google_client_id:'', google_client_secret:'', google_enabled:'false',
  github_client_id:'', github_client_secret:'', github_enabled:'false',
  microsoft_client_id:'', microsoft_client_secret:'', microsoft_tenant_id:'common', microsoft_enabled:'false',
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

// ── OAuth 2.0 tables (MCP + third-party login) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret TEXT NOT NULL,
    client_name TEXT DEFAULT 'MCP Client',
    redirect_uris TEXT DEFAULT '[]',
    grant_types TEXT DEFAULT '["authorization_code","refresh_token"]',
    response_types TEXT DEFAULT '["code"]',
    token_endpoint_auth_method TEXT DEFAULT 'none',
    created_at INTEGER NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    redirect_uri TEXT,
    code_challenge TEXT DEFAULT '',
    code_challenge_method TEXT DEFAULT '',
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    user_id INTEGER
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_id TEXT PRIMARY KEY,
    refresh_token TEXT UNIQUE,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    user_id INTEGER,
    expires_at INTEGER NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_codes(client_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_tokens(client_id)");
try { db.exec("ALTER TABLE oauth_codes ADD COLUMN user_id INTEGER"); } catch {}

// ── Third-party OAuth accounts (Google, GitHub, Microsoft login) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    nombre TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, provider_user_id)
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_oauth_accounts_email ON oauth_accounts(email)");
db.exec("CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id)");
try { db.exec("ALTER TABLE oauth_accounts ADD COLUMN expires_at INTEGER"); } catch {}

// ── User Blacklist ──
db.exec(`
  CREATE TABLE IF NOT EXISTS user_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    reason TEXT DEFAULT '',
    blocked_by INTEGER REFERENCES usuarios(id),
    blocked_at INTEGER NOT NULL,
    expires_at INTEGER,
    UNIQUE(user_id)
  )
`);

function isUserBlacklisted(userId) {
  const row = db.prepare('SELECT * FROM user_blacklist WHERE user_id = ?').get(userId);
  if (!row) return false;
  if (row.expires_at && row.expires_at < Date.now()) {
    db.prepare('DELETE FROM user_blacklist WHERE id = ?').run(row.id);
    return false;
  }
  return true;
}

// ── MCP Tool Logging ──
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_tool_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    module_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    arguments TEXT,
    success INTEGER DEFAULT 1,
    error_message TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_mcp_logs_tool ON mcp_tool_logs(module_id, tool_name)");
db.exec("CREATE INDEX IF NOT EXISTS idx_mcp_logs_time ON mcp_tool_logs(created_at)");

function mcpLogTool(sessionId, moduleId, toolName, args, success, errorMsg, durationMs) {
  try {
    db.prepare(`INSERT INTO mcp_tool_logs
      (session_id, module_id, tool_name, arguments, success, error_message, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sessionId || null, moduleId, toolName,
      args ? JSON.stringify(args).slice(0, 2000) : null,
      success ? 1 : 0, errorMsg || null, durationMs || null, Date.now()
    );
  } catch {}
}

// Cleanup old logs (>30 days) every hour
setInterval(() => {
  try { db.prepare('DELETE FROM mcp_tool_logs WHERE created_at < ?').run(Date.now() - 30 * 86400000); } catch {}
}, 3600000);

// ── MCP Tool Config (per-tool enable/disable) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_tool_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    UNIQUE(module_id, tool_name)
  )
`);

function isToolEnabled(moduleId, toolName) {
  const row = db.prepare('SELECT enabled FROM mcp_tool_config WHERE module_id = ? AND tool_name = ?').get(moduleId, toolName);
  return row ? row.enabled === 1 : true; // default: enabled
}

// ── OAuth DB helpers ──
function oauthSaveClient(c) {
  db.prepare(`INSERT OR REPLACE INTO oauth_clients
    (client_id, client_secret, client_name, redirect_uris, grant_types,
     response_types, token_endpoint_auth_method, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    c.client_id, c.client_secret, c.client_name || 'MCP Client',
    JSON.stringify(c.redirect_uris || []), JSON.stringify(c.grant_types || ['authorization_code', 'refresh_token']),
    JSON.stringify(c.response_types || ['code']), c.token_endpoint_auth_method || 'none',
    c.created_at || Date.now()
  );
}
function oauthGetClient(clientId) {
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
  if (!row) return null;
  return { ...row, redirect_uris: JSON.parse(row.redirect_uris), grant_types: JSON.parse(row.grant_types) };
}
function oauthSaveCode(code) {
  db.prepare(`INSERT OR REPLACE INTO oauth_codes
    (code, client_id, redirect_uri, code_challenge, code_challenge_method, expires_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    code.code, code.client_id, code.redirect_uri,
    code.code_challenge || '', code.code_challenge_method || '',
    code.expires_at, code.user_id || null
  );
}
function oauthGetCode(code) {
  return db.prepare('SELECT * FROM oauth_codes WHERE code = ? AND used = 0 AND expires_at > ?').get(code, Date.now());
}
function oauthUseCode(code) {
  db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ?').run(code);
}
function oauthSaveToken(t) {
  db.prepare(`INSERT INTO oauth_tokens
    (token_id, refresh_token, client_id, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    t.token_id, t.refresh_token, t.client_id,
    t.user_id || null, t.expires_at, Date.now()
  );
}
function oauthGetToken(tokenId) {
  return db.prepare('SELECT * FROM oauth_tokens WHERE token_id = ? AND revoked = 0 AND expires_at > ?').get(tokenId, Date.now());
}
function oauthRevokeToken(tokenId) {
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token_id = ?').run(tokenId);
}
function oauthCleanupExpired() {
  db.prepare('DELETE FROM oauth_codes WHERE expires_at < ? OR used = 1').run(Date.now());
  db.prepare('DELETE FROM oauth_tokens WHERE revoked = 1 AND created_at < ?').run(Date.now() - 86400000);
  // NOTE: Do NOT delete from oauth_accounts — expires_at there is the provider token expiry, not account expiry
}

// Cleanup every 10 min
setInterval(oauthCleanupExpired, 600000);

// ── Telemetry Tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento TEXT NOT NULL,
    pagina TEXT DEFAULT '',
    usuario_id INTEGER DEFAULT NULL,
    usuario_nombre TEXT DEFAULT '',
    datos TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_telemetria_evento ON telemetria(evento)");
db.exec("CREATE INDEX IF NOT EXISTS idx_telemetria_creado ON telemetria(creado)");
db.exec("DELETE FROM telemetria WHERE id NOT IN (SELECT id FROM telemetria ORDER BY id DESC LIMIT 5000)");

db.exec(`
  CREATE TABLE IF NOT EXISTS errores_frontend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mensaje TEXT NOT NULL,
    stack TEXT DEFAULT '',
    pagina TEXT DEFAULT '',
    linea INTEGER DEFAULT 0,
    columna INTEGER DEFAULT 0,
    usuario_id INTEGER DEFAULT NULL,
    usuario_nombre TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_errores_creado ON errores_frontend(creado)");
db.exec("DELETE FROM errores_frontend WHERE id NOT IN (SELECT id FROM errores_frontend ORDER BY id DESC LIMIT 2000)");

db.exec(`
  CREATE TABLE IF NOT EXISTS sesiones_activas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    usuario_nombre TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    ultimo_heartbeat TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones_activas(usuario_id)");
// Purge stale sessions (>2 min without heartbeat)
db.prepare("DELETE FROM sesiones_activas WHERE datetime(ultimo_heartbeat, '+2 minutes') < datetime('now')").run();

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
try { db.exec("ALTER TABLE modulos_plataforma ADD COLUMN dashboard_endpoint TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE modulos_plataforma ADD COLUMN db_type TEXT NOT NULL DEFAULT 'postgresql'"); } catch {}
try { db.exec("ALTER TABLE modulos_plataforma ADD COLUMN db_schema TEXT NOT NULL DEFAULT ''"); } catch {}
// Seed tipo for internal modules
db.prepare("UPDATE modulos_plataforma SET tipo = 'interno' WHERE id IN ('proveedores', 'nomina', 'logistica') AND tipo = 'externo'").run();
// Seed db_type and db_schema for existing modules
db.prepare("UPDATE modulos_plataforma SET db_type = 'sqlite', db_schema = 'nomina' WHERE id = 'nomina'").run();
db.prepare("UPDATE modulos_plataforma SET db_type = 'postgresql', db_schema = 'logistics' WHERE id = 'logistica'").run();
db.prepare("UPDATE modulos_plataforma SET db_type = 'postgresql', db_schema = 'projects' WHERE id = 'proyectos'").run();
db.prepare("UPDATE modulos_plataforma SET db_type = 'postgresql', db_schema = 'public' WHERE id = 'proveedores'").run();
// Seed dashboard_endpoint for existing modules
db.prepare("UPDATE modulos_plataforma SET dashboard_endpoint = '/proveedores/api/dashboard' WHERE id = 'proveedores' AND dashboard_endpoint = ''").run();
db.prepare("UPDATE modulos_plataforma SET dashboard_endpoint = '/nomina/api/dashboard/resumen' WHERE id = 'nomina' AND dashboard_endpoint = ''").run();
db.prepare("UPDATE modulos_plataforma SET dashboard_endpoint = '/logistica/api/dashboard/resumen' WHERE id = 'logistica' AND dashboard_endpoint = ''").run();
db.prepare("UPDATE modulos_plataforma SET dashboard_endpoint = '/proyectos/api/dashboard' WHERE id = 'proyectos' AND dashboard_endpoint = ''").run();

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

// Seed modules if not present
const modules = [
  { id: 'proveedores', nombre: 'Proveedores', descripcion: 'Gestión documental de facturas electrónicas', url: `http://localhost:${PORT}`, icon: '📄', orden: 1, proxy_prefix: '/proveedores/', tipo: 'interno', dashboard_endpoint: '/proveedores/api/dashboard' },
  { id: 'nomina', nombre: 'Nómina', descripcion: 'Sistema de control de novedades y horas extra', url: `http://localhost:${PORT}`, icon: '👥', orden: 2, proxy_prefix: '/nomina/', tipo: 'interno', dashboard_endpoint: '/nomina/api/dashboard/resumen' },
  { id: 'logistica', nombre: 'Logística', descripcion: 'Optimización de rutas y pedidos', url: `http://localhost:${PORT}`, icon: '🚚', orden: 3, proxy_prefix: '/logistica/', tipo: 'interno', dashboard_endpoint: '/logistica/api/dashboard/resumen' },
  { id: 'proyectos', nombre: 'Proyectos', descripcion: 'Gestión de proyectos y tareas', url: `http://localhost:${PORT}`, icon: '📋', orden: 4, proxy_prefix: '/proyectos/', tipo: 'interno', dashboard_endpoint: '/proyectos/api/dashboard' },
];
const insModule = db.prepare(`INSERT OR IGNORE INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, orden, proxy_prefix, tipo, dashboard_endpoint)
    VALUES (?, ?, ?, ?, '', ?, 1, 1, ?, ?, ?, ?)`);
for (const m of modules) {
  insModule.run(m.id, m.nombre, m.descripcion, m.url, m.icon, m.orden, m.proxy_prefix, m.tipo, m.dashboard_endpoint);
}
// Update URLs to match current PORT
db.prepare(`UPDATE modulos_plataforma SET url = ? WHERE tipo = 'interno'`).run(`http://localhost:${PORT}`);

// Initialize centros cache at startup for other modules
globalThis.__centrosCache = db.prepare('SELECT id, nombre, codigo, descripcion, direccion, ciudad, telefono, email, responsable_id, latitud, longitud, activo FROM centros_operacion WHERE activo = 1 ORDER BY nombre').all();

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

db.exec(`
  CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    modulo TEXT NOT NULL,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    url TEXT,
    leida INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificaciones(usuario_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_notif_leida ON notificaciones(usuario_id, leida)");
db.exec("CREATE INDEX IF NOT EXISTS idx_notif_fecha ON notificaciones(usuario_id, created_at DESC)");
try { db.exec("ALTER TABLE notificaciones ADD COLUMN idempotency_key TEXT"); } catch {}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_idempotency ON notificaciones(idempotency_key) WHERE idempotency_key IS NOT NULL");

// ── Configuración de notificaciones por email ──
db.exec(`
  CREATE TABLE IF NOT EXISTS email_notif_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modulo TEXT NOT NULL,
    evento TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    habilitado INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(modulo, evento)
  )
`);

const emailNotifDefaults = [
  { modulo: 'proyectos', eventos: [
    ['tarea_asignada', 'Tarea asignada a usuario'],
    ['tarea_aprobada', 'Tarea aprobada por revisor'],
    ['tarea_rechazada', 'Tarea rechazada por revisor'],
    ['tarea_en_revision', 'Tarea enviada a revisión'],
    ['tarea_revision', 'Tarea pendiente de revisión (notifica a revisor)'],
    ['cambio_estado', 'Tarea o proyecto movido de estado'],
    ['proyecto_asignado', 'Proyecto asignado a usuario'],
    ['proyecto_aprobado', 'Proyecto aprobado'],
    ['proyecto_rechazado', 'Proyecto rechazado'],
    ['nuevo_comentario', 'Nuevo comentario en tarea'],
    ['alerta_vencimiento', 'Alerta de vencimiento de tarea'],
    ['recordatorio_vencimiento', 'Recordatorios automáticos de vencimiento (7, 3, 1 día)'],
    ['resumen_semanal', 'Resumen semanal de actividades']
  ]},
  { modulo: 'nomina', eventos: [
    ['hora_extra_registrada', 'Hora extra registrada (alerta a gerentes)'],
    ['hora_extra_aprobada', 'Hora extra aprobada'],
    ['hora_extra_rechazada', 'Hora extra rechazada']
  ]},
  { modulo: 'proveedores', eventos: [
    ['factura_nueva', 'Factura nueva recibida'],
    ['factura_recibida', 'Factura descargada de correo'],
    ['factura_asignada', 'Factura asignada a revisor'],
    ['factura_en_revision', 'Factura en revisión'],
    ['factura_aprobada', 'Factura aprobada'],
    ['factura_rechazada', 'Factura rechazada'],
    ['factura_causada', 'Factura causada'],
    ['factura_pagada', 'Factura pagada'],
    ['escalacion', 'Escalación de factura vencida']
  ]},
  { modulo: 'logistica', eventos: [
    ['pedido_nuevo', 'Nuevo pedido creado']
  ]},
  { modulo: 'launcher', eventos: [
    ['password_reset', 'Correo de restablecimiento de contraseña'],
    ['usuario_creado', 'Correo de bienvenida de usuario']
  ]}
];

const upsertNotifConfig = db.prepare(`INSERT OR IGNORE INTO email_notif_config (modulo, evento, descripcion) VALUES (?, ?, ?)`);
for (const mod of emailNotifDefaults) {
  for (const [evento, desc] of mod.eventos) {
    upsertNotifConfig.run(mod.modulo, evento, desc);
  }
}

// ── Limpieza de notificaciones >30 días ──
function limpiarNotificaciones() {
  try {
    const r = db.prepare("DELETE FROM notificaciones WHERE created_at < datetime('now', '-30 days')").run();
    if (r.changes) console.log(`[notif-cleanup] Eliminadas ${r.changes} notificaciones >30 días`);
  } catch (e) { console.error('[notif-cleanup] Error:', e.message); }
}
limpiarNotificaciones();
setInterval(limpiarNotificaciones, 24 * 60 * 60 * 1000);

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
  ],
  proyectos: [
    ['ver', 'Ver proyectos y tareas'],
    ['ver_propios', 'Ver solo tareas asignadas (sin esto ve todas)'],
    ['crear', 'Crear proyectos'],
    ['editar', 'Editar proyectos'],
    ['eliminar', 'Eliminar proyectos'],
    ['crear_tarea', 'Crear tareas'],
    ['editar_tarea', 'Editar y asignar tareas'],
    ['eliminar_tarea', 'Eliminar tareas'],
    ['comentar', 'Añadir comentarios'],
    ['configurar', 'Configurar módulo'],
    ['ver_reportes', 'Ver reportes y métricas']
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

// ── Forgot-password cooldown (1 min per email) ──
var forgotCooldowns = {};

function logLoginAttempt(ip, email, exitoso) {
  const encEmail = email ? encryptEmail((email || '').toLowerCase().trim()) : '';
  db.prepare("INSERT INTO login_logs (ip, email, exitoso) VALUES (?, ?, ?)").run(ip || '', encEmail, exitoso ? 1 : 0);
}

const { buildPayload, getUserWithPermissions, verifySessionValid } = require('./../framework/auth');
const loginRateLimit = createLoginRateLimit(db);
const loginAttempts = getLoginAttempts();

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Campos requeridos' });
  try {
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      if (req._loginRateLimitKey) loginAttempts[req._loginRateLimitKey].push(req._loginRateLimitNow);
      logLoginAttempt(req.ip, email, false);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    // Check blacklist
    if (isUserBlacklisted(user.id)) {
      const entry = db.prepare('SELECT reason FROM user_blacklist WHERE user_id = ?').get(user.id);
      return res.status(403).json({ error: 'Tu cuenta ha sido bloqueada', reason: entry?.reason || '' });
    }
    logLoginAttempt(req.ip, email, true);
    const userWithPerms = getUserWithPermissions(db, user.id);
    if (!userWithPerms) return res.status(500).json({ error: 'Error al cargar permisos' });
    const payload = buildPayload(userWithPerms);
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    db.prepare("UPDATE usuarios SET actualizado = datetime('now') WHERE id = ?").run(user.id);
    const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('launcher_jwt', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 1000
    });
    console.log(`[LOGIN] Cookie set for ${email} (secure: ${isSecure})`);
    res.json({ jwt: token, usuario: payload, modulos: payload.modulos });
  } catch (e) { console.error('[LOGIN]', e.stack || e.message); res.status(500).json({ error: 'Error interno' }); }
});

// ── Logout (clear httpOnly cookie) ──
app.post('/api/auth/logout', verificarToken, (req, res) => {
  if (req.usuario && req.usuario.id) {
    db.prepare("UPDATE oauth_accounts SET access_token = NULL, expires_at = NULL WHERE user_id = ?").run(req.usuario.id);
  }
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.get('/logout', (req, res) => {
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`);
  res.redirect('/');
});

// ── Session heartbeat ──
app.post('/api/heartbeat', verificarToken, (req, res) => {
  try {
    const userId = req.usuario.id;
    const nombre = req.usuario.nombre || '';
    const ip = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    // Upsert session
    const existing = db.prepare('SELECT id FROM sesiones_activas WHERE usuario_id = ?').get(userId);
    if (existing) {
      db.prepare("UPDATE sesiones_activas SET ultimo_heartbeat = datetime('now','localtime'), ip = ?, user_agent = ? WHERE usuario_id = ?").run(ip, userAgent, userId);
    } else {
      db.prepare('INSERT INTO sesiones_activas (usuario_id, usuario_nombre, ip, user_agent) VALUES (?, ?, ?, ?)').run(userId, nombre, ip, userAgent);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ── Refresh token (sliding session) ──
app.post('/api/auth/refresh', verificarToken, (req, res) => {
  const userWithPerms = getUserWithPermissions(db, req.usuario.id);
  if (!userWithPerms) return res.status(401).json({ error: 'Usuario no encontrado' });
  const payload = buildPayload(userWithPerms);
  const token = firmarToken(payload, res, req);
  res.json({ jwt: token });
});

// ── Third-party OAuth login (Google, GitHub, Microsoft) ──
function getOAuthConfig(provider) {
  const row = (key) => db.prepare("SELECT value FROM config WHERE key = ?").get(key)?.value || '';
  return {
    clientId: row(`${provider}_client_id`),
    clientSecret: row(`${provider}_client_secret`),
    enabled: row(`${provider}_enabled`) === 'true',
    tenantId: provider === 'microsoft' ? row('microsoft_tenant_id') || 'common' : null
  };
}

function getOAuthBaseUrl() {
  const isProd = process.env.NODE_ENV === 'production' || COMPANY_DOMAIN !== 'localhost';
  return isProd ? `https://${COMPANY_DOMAIN}` : `http://localhost:${PORT}`;
}

function oauthFindOrCreateUser(profile) {
  let isNew = false;
  let user = null;
  const expiresAt = profile.expiresIn ? Date.now() + (profile.expiresIn * 1000) : null;

  // 1. FIRST: Check if there's an existing OAuth link
  const existingLink = db.prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?').get(profile.provider, profile.id);
  if (existingLink) {
    user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(existingLink.user_id);
    if (user) {
      // Update tokens on existing link
      db.prepare("UPDATE oauth_accounts SET access_token = ?, nombre = ?, email = ?, expires_at = ?, updated_at = ? WHERE id = ?").run(profile.accessToken || null, profile.name || null, profile.email, expiresAt, Date.now(), existingLink.id);
    }
  }

  // 2. SECOND: If no link found, search by email
  if (!user) {
    user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(profile.email);
  }

  // 3. THIRD: If still no user, create new one
  if (!user) {
    isNew = true;
    const hash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
    const result = db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'operador')").run(profile.name || profile.email, profile.email, hash);
    user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(result.lastInsertRowid);
  }

  // 4. Link or update oauth_account (if not already linked above)
  if (!existingLink) {
    db.prepare("INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, nombre, access_token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(user.id, profile.provider, profile.id, profile.email, profile.name || null, profile.accessToken || null, expiresAt, Date.now(), Date.now());
  }

  // Check if user has modules assigned
  const hasModules = db.prepare('SELECT COUNT(*) as c FROM user_modulos WHERE user_id = ?').get(user.id).c > 0;
  return { user, isNew, hasModules };
}

function oauthIssueJwt(user, req, res) {
  const userWithPerms = getUserWithPermissions(db, user.id);
  if (!userWithPerms) return null;
  const payload = buildPayload(userWithPerms);
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('launcher_jwt', token, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 1000 });
  return token;
}

// ── Google OAuth ──
app.get('/auth/google', (req, res) => {
  const cfg = getOAuthConfig('google');
  if (!cfg.enabled || !cfg.clientId) return res.status(404).json({ error: 'Google OAuth not configured' });
  const state = crypto.randomBytes(32).toString('hex');
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('oauth_state', state, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: 600000 });
  const redirectUri = encodeURIComponent(getOAuthBaseUrl() + '/auth/google/callback');
  const scope = encodeURIComponent('openid email profile');
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${cfg.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&state=${state}`);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const cookies = parseCookies(req);
  console.log('[OAuth Google] Callback received:', { hasCode: !!code, hasError: !!error, hasState: !!state, cookieState: !!cookies.oauth_state, stateMatch: state === cookies.oauth_state });
  if (error || !code) return res.redirect('/?error=oauth_denied');
  if (!state || state !== cookies.oauth_state) { console.error('[OAuth Google] State mismatch:', { state, cookieState: cookies.oauth_state }); return res.redirect('/?error=invalid_state'); }
  res.clearCookie('oauth_state', { path: '/' });
  const cfg = getOAuthConfig('google');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: getOAuthBaseUrl() + '/auth/google/callback', grant_type: 'authorization_code' })
    });
    const tokenData = await tokenRes.json();
    console.log('[OAuth Google] Token response:', { ok: tokenRes.ok, hasAccessToken: !!tokenData.access_token, error: tokenData.error });
    if (!tokenData.access_token) return res.redirect('/?error=token_exchange_failed');
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + tokenData.access_token } });
    const profile = await userInfoRes.json();
    console.log('[OAuth Google] Profile:', { email: profile.email, name: profile.name, id: profile.id });
    if (!profile.email) return res.redirect('/?error=no_email');
    const user = oauthFindOrCreateUser({ provider: 'google', id: profile.id, email: profile.email, name: profile.name, accessToken: tokenData.access_token, expiresIn: tokenData.expires_in });
    if (isUserBlacklisted(user.user.id)) return res.redirect('/?error=blacklisted');
    const token = oauthIssueJwt(user.user, req, res);
    console.log('[OAuth Google] JWT issued:', !!token, 'hasModules:', user.hasModules, 'isNew:', user.isNew);
    if (!token) return res.redirect('/?error=auth_failed');
    res.redirect((user.isNew || !user.hasModules) ? '/?new_user=1' : '/');
  } catch (e) { console.error('[OAuth Google] Error:', e.message, e.stack); res.redirect('/?error=oauth_error'); }
});

// ── GitHub OAuth ──
app.get('/auth/github', (req, res) => {
  const cfg = getOAuthConfig('github');
  if (!cfg.enabled || !cfg.clientId) return res.status(404).json({ error: 'GitHub OAuth not configured' });
  const state = crypto.randomBytes(32).toString('hex');
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('oauth_state', state, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: 600000 });
  const redirectUri = encodeURIComponent(getOAuthBaseUrl() + '/auth/github/callback');
  const scope = encodeURIComponent('read:user user:email');
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${cfg.clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const cookies = parseCookies(req);
  if (error || !code) return res.redirect('/?error=oauth_denied');
  if (!state || state !== cookies.oauth_state) { console.warn('[OAuth GitHub] State mismatch — session:', cookies.oauth_state ? 'present' : 'missing', 'query:', state ? 'present' : 'missing'); return res.redirect('/?error=invalid_state'); }
  res.clearCookie('oauth_state', { path: '/' });
  const cfg = getOAuthConfig('github');
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) { console.error('[OAuth GitHub] Token exchange failed:', tokenData); return res.redirect('/?error=token_exchange_failed'); }
    const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + tokenData.access_token, Accept: 'application/json' } });
    const ghUser = await userRes.json();
    // Get primary email
    let email = ghUser.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers: { Authorization: 'Bearer ' + tokenData.access_token, Accept: 'application/json' } });
      const emails = await emailsRes.json();
      const primary = emails.find(e => e.primary) || emails[0];
      email = primary?.email;
    }
    if (!email) return res.redirect('/?error=no_email');
    const user = oauthFindOrCreateUser({ provider: 'github', id: String(ghUser.id), email, name: ghUser.name || ghUser.login, accessToken: tokenData.access_token, expiresIn: tokenData.expires_in });
    if (isUserBlacklisted(user.user.id)) return res.redirect('/?error=blacklisted');
    const token = oauthIssueJwt(user.user, req, res);
    if (!token) return res.redirect('/?error=auth_failed');
    res.redirect((user.isNew || !user.hasModules) ? '/?new_user=1' : '/');
  } catch (e) { console.error('[OAuth GitHub]', e.stack || e.message); res.redirect('/?error=oauth_error'); }
});

// ── Microsoft OAuth ──
app.get('/auth/microsoft', (req, res) => {
  const cfg = getOAuthConfig('microsoft');
  if (!cfg.enabled || !cfg.clientId) return res.status(404).json({ error: 'Microsoft OAuth not configured' });
  const state = crypto.randomBytes(32).toString('hex');
  const isSecure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('oauth_state', state, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: 600000 });
  const redirectUri = encodeURIComponent(getOAuthBaseUrl() + '/auth/microsoft/callback');
  const scope = encodeURIComponent('openid email profile User.Read');
  res.redirect(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize?client_id=${cfg.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`);
});

app.get('/auth/microsoft/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const cookies = parseCookies(req);
  if (error || !code) return res.redirect('/?error=oauth_denied');
  if (!state || state !== cookies.oauth_state) { console.warn('[OAuth Microsoft] State mismatch — session:', cookies.oauth_state ? 'present' : 'missing', 'query:', state ? 'present' : 'missing'); return res.redirect('/?error=invalid_state'); }
  res.clearCookie('oauth_state', { path: '/' });
  const cfg = getOAuthConfig('microsoft');
  try {
    const tokenRes = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: getOAuthBaseUrl() + '/auth/microsoft/callback', grant_type: 'authorization_code' }).toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) { console.error('[OAuth Microsoft] Token exchange failed:', tokenData); return res.redirect('/?error=token_exchange_failed'); }
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + tokenData.access_token } });
    const msUser = await userRes.json();
    const email = msUser.mail || msUser.userPrincipalName;
    if (!email) return res.redirect('/?error=no_email');
    const user = oauthFindOrCreateUser({ provider: 'microsoft', id: msUser.id, email, name: msUser.displayName, accessToken: tokenData.access_token, expiresIn: tokenData.expires_in });
    if (isUserBlacklisted(user.user.id)) return res.redirect('/?error=blacklisted');
    const token = oauthIssueJwt(user.user, req, res);
    if (!token) return res.redirect('/?error=auth_failed');
    res.redirect((user.isNew || !user.hasModules) ? '/?new_user=1' : '/');
  } catch (e) { console.error('[OAuth Microsoft]', e.stack || e.message); res.redirect('/?error=oauth_error'); }
});

// ── Public: list enabled OAuth providers (for login screen) ──
app.get('/api/auth/oauth-providers', (req, res) => {
  const providers = ['google', 'github', 'microsoft'];
  const enabled = providers.filter(p => getOAuthConfig(p).enabled && getOAuthConfig(p).clientId);
  res.json({ providers: enabled.map(p => ({ id: p, name: p.charAt(0).toUpperCase() + p.slice(1) })) });
});

// ── Admin: manage OAuth providers ──
app.get('/api/admin/oauth-providers', verificarToken, soloAdmin, (req, res) => {
  const providers = ['google', 'github', 'microsoft'];
  const result = {};
  for (const p of providers) {
    result[p] = {
      enabled: db.prepare("SELECT value FROM config WHERE key = ?").get(`${p}_enabled`)?.value === 'true',
      client_id: db.prepare("SELECT value FROM config WHERE key = ?").get(`${p}_client_id`)?.value || '',
      client_secret: db.prepare("SELECT value FROM config WHERE key = ?").get(`${p}_client_secret`)?.value || '',
      tenant_id: p === 'microsoft' ? db.prepare("SELECT value FROM config WHERE key = ?").get('microsoft_tenant_id')?.value || 'common' : undefined
    };
  }
  res.json({ providers: result });
});

app.put('/api/admin/oauth-providers', verificarToken, soloAdmin, (req, res) => {
  const allowed = ['google_enabled','google_client_id','google_client_secret',
    'github_enabled','github_client_id','github_client_secret',
    'microsoft_enabled','microsoft_client_id','microsoft_client_secret','microsoft_tenant_id'];
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) upsert.run(k, String(v ?? ''));
  }
  res.json({ ok: true });
});

// ── Cookie test endpoint ──
app.get('/api/cookie-test', (req, res) => {
  const raw = req.headers['cookie'] || '';
  const hasLauncherJwt = raw.includes('launcher_jwt=');
  res.json({ hasCookie: !!raw, hasLauncherJwt: hasLauncherJwt, preview: raw.slice(0,100), protocol: req.protocol });
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
  res.json({ config: cfg, baseUrl: getBaseUrl() });
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
  const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'rate_limit_%' ORDER BY key").all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ config: cfg });
});

app.put('/api/admin/config', verificarToken, soloAdmin, (req, res) => {
  const allowed = ['rate_limit_max','rate_limit_window','ssh_host','ssh_user'];
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) upsert.run(k, String(v ?? ''));
  }
  res.json({ ok: true });
});

app.post('/api/admin/config/test-ssh', verificarToken, soloAdmin, async (req, res) => {
  const { host, user } = req.body;
  if (!host) return res.json({ ok: false, error: 'Host requerido' });
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return res.json({ ok: false, error: 'Host inválido' });
  if (user && !/^[a-zA-Z0-9_-]+$/.test(user)) return res.json({ ok: false, error: 'Usuario inválido' });
  try {
    const { stdout } = await execFileAsync('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', (user || 'root') + '@' + host, 'pm2', '--version'], { timeout: 15000 });
    res.json({ ok: true, version: stdout.trim(), message: 'Conexión SSH exitosa' });
  } catch (e) {
    res.json({ ok: false, error: 'No se pudo conectar vía SSH: ' + (e.message || 'error') });
  }
});

// Admin GET: returns allowed config keys (rate_limit + ssh)
app.get('/api/admin/config', verificarToken, soloAdmin, (req, res) => {
  const allowed = ['rate_limit_max','rate_limit_window','ssh_host','ssh_user'];
  const placeholders = allowed.map(function() { return '?'; }).join(',');
  const rows = db.prepare("SELECT key, value FROM config WHERE key IN (" + placeholders + ")").all(...allowed);
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ config: cfg });
});

// ── Login logs ──
app.get('/api/admin/login-logs', verificarToken, soloAdmin, (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit) || 50);
  let where = '1=1';
  const params = [];
  if (req.query.exitoso !== undefined && req.query.exitoso !== '') { where += ' AND exitoso = ?'; params.push(parseInt(req.query.exitoso)); }
  if (req.query.desde) { where += ' AND fecha >= ?'; params.push(req.query.desde); }
  if (req.query.hasta) { where += ' AND fecha <= ?'; params.push(req.query.hasta + ' 23:59:59'); }
  const rows = db.prepare(`SELECT id, fecha, ip, email, exitoso FROM login_logs WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  for (const row of rows) {
    if (row.email && row.email.includes(':')) {
      try { row.email = decryptEmail(row.email); } catch { row.email = '—'; }
    }
  }
  res.json({ logs: rows });
});

// ── Telemetry: public write endpoints ──
// ── Sessions: admin endpoints ──
app.get('/api/admin/sesiones', verificarToken, soloAdmin, (req, res) => {
  try {
    // Purge stale first
    db.prepare("DELETE FROM sesiones_activas WHERE datetime(ultimo_heartbeat, '+2 minutes') < datetime('now')").run();
    const sesiones = db.prepare("SELECT * FROM sesiones_activas ORDER BY ultimo_heartbeat DESC").all();
    res.json({ sesiones });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/sesiones/:id/kill', verificarToken, soloAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const sesion = db.prepare("SELECT * FROM sesiones_activas WHERE id = ?").get(id);
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
    // Invalidate all JWTs for this user by setting session invalidation
    db.prepare("INSERT OR REPLACE INTO usuario_sesion_invalidada (usuario_id, invalidado_en) VALUES (?, datetime('now'))").run(sesion.usuario_id);
    db.prepare("DELETE FROM sesiones_activas WHERE id = ?").run(id);
    res.json({ ok: true, message: `Sesión de ${sesion.usuario_nombre} cerrada` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Password recovery ──
app.post('/api/auth/forgot', loginRateLimit, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  const emailNorm = email.toLowerCase().trim();
  const lastSent = forgotCooldowns[emailNorm];
  if (lastSent && (Date.now() - lastSent) < 60000) return res.status(429).json({ error: 'Espera un minuto antes de solicitar otro restablecimiento' });
  const user = db.prepare('SELECT id, email, nombre FROM usuarios WHERE email = ? AND activo = 1').get(emailNorm);
  // Always return same message to avoid email enumeration
  if (!user) return res.json({ ok: true, message: 'Si el email existe, recibirás un enlace de recuperación' });
  db.prepare('DELETE FROM reset_tokens WHERE email = ?').run(user.email);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').split('.')[0];
  db.prepare('INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)').run(user.email, token, expiresAt);
  const resetUrl = `${getBaseUrl()}/reset?token=${token}`;
  if (mail.isConfigured()) {
    if (await debeEnviarEmail('launcher', 'password_reset')) {
      mail.sendResetEmail(user.email, resetUrl, user.nombre).catch(e => console.error('[MAIL] sendResetEmail error:', e.message));
    }
    forgotCooldowns[emailNorm] = Date.now();
    res.json({ ok: true, message: 'Si el email existe, recibirás un enlace de recuperación' });
  } else {
    console.log('[FORGOT] SMTP no configurado — token para', user.email, ':', resetUrl);
    res.json({ ok: true, message: 'SMTP no configurado. Contacta al administrador para restablecer tu contraseña.' });
  }
});

app.get('/api/auth/reset', loginRateLimit, (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  const row = db.prepare('SELECT * FROM reset_tokens WHERE token = ? AND usado = 0 AND expires_at > datetime("now")').get(token);
  if (!row) return res.status(400).json({ error: 'Token inválido o expirado' });
  res.json({ ok: true, email: row.email });
});

app.post('/api/auth/reset', loginRateLimit, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const row = db.prepare('SELECT * FROM reset_tokens WHERE token = ? AND usado = 0 AND expires_at > datetime("now")').get(token);
  if (!row) return res.status(400).json({ error: 'Token inválido o expirado' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE usuarios SET password_hash = ?, actualizado = datetime('now') WHERE email = ?").run(hash, row.email);
  db.prepare('UPDATE reset_tokens SET usado = 1 WHERE id = ?').run(row.id);
  const user = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(row.email);
  if (user) invalidarSesionUsuario(user.id);
  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});

app.get('/api/modulos', verificarToken, (req, res) => {
  const userModulos = req.usuario.modulos || [];
  const allModulos = getModulos(false);
  const filtered = (req.usuario.rol === 'admin') ? allModulos : allModulos.filter(m => userModulos.includes(m.id));
  res.json(filtered.map(m => ({ id: m.id, nombre: m.nombre, url: m.public_url || m.url, icon: m.icon, descripcion: m.descripcion, proxy_prefix: m.proxy_prefix, dashboard_endpoint: m.dashboard_endpoint })));
});

app.get('/api/auth/me', verificarToken, (req, res) => {
  const userWithPerms = getUserWithPermissions(db, req.usuario.id);
  if (!userWithPerms) return res.status(404).json({ error: 'Usuario no encontrado' });
  // Verify seq (session version) — reject stale JWTs
  if (userWithPerms.seq !== req.usuario.seq) {
    return res.status(401).json({ error: 'Sesión invalidada. Inicia sesión nuevamente.' });
  }
  const { modulos, modulos_permisos, permisos, perfil_nombre, ...rest } = userWithPerms;
  res.json({ ...rest, modulos, modulos_permisos, permisos, perfil_nombre });
});

app.get('/api/admin/usuarios', verificarToken, soloAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.creado, u.actualizado, u.perfil_id, u.sede,
           p.nombre as perfil_nombre
    FROM usuarios u
    LEFT JOIN perfiles p ON u.perfil_id = p.id
    ORDER BY u.id
  `).all());
});

// ── Public user list (for internal module communication) ──
app.get('/api/usuarios/public', (req, res) => {
  const rows = db.prepare('SELECT id, nombre, email, rol FROM usuarios WHERE activo = 1').all();
  res.json(rows);
});

// ── Diagnóstico de auth por usuario (solo admin, solo lectura) ──
app.get('/api/admin/diagnostico/auth/:userId', verificarToken, soloAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ error: 'ID inválido' });

  const user = db.prepare('SELECT id, nombre, email, rol, activo, seq, perfil_id, sede, actualizado FROM usuarios WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const modulos = db.prepare('SELECT modulo_id FROM user_modulos WHERE user_id = ?').all(userId).map(r => r.modulo_id);

  let perfil = null;
  let perfilPermisos = [];
  if (user.perfil_id) {
    perfil = db.prepare('SELECT id, nombre, descripcion FROM perfiles WHERE id = ?').get(user.perfil_id);
    perfilPermisos = db.prepare('SELECT modulo_id, permiso FROM perfil_permisos WHERE perfil_id = ?').all(user.perfil_id);
  }

  const modulosPermisos = db.prepare('SELECT modulo_id, permiso_id FROM modulos_permisos_perfil WHERE perfil_id = ? AND activo = 1').all(user.perfil_id || 0);
  const userPermisos = db.prepare('SELECT modulo_id, permiso_id FROM modulos_permisos_usuario WHERE usuario_id = ? AND activo = 1').all(userId);

  // Simulate JWT payload
  const payload = buildPayload(getUserWithPermissions(db, userId));

  res.json({
    usuario: user,
    modulos_asignados: modulos,
    perfil,
    perfil_permisos: perfilPermisos,
    modulos_permisos_perfil: modulosPermisos,
    modulos_permisos_usuario: userPermisos,
    jwt_payload_simulado: payload
  });
});

// ── Test auth flow simulation (solo admin) ──
app.get('/api/admin/diagnostico/test-auth/:userId', verificarToken, soloAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID inválido' });

    const steps = [];

    // Step 1: Build payload
    const userWithPerms = getUserWithPermissions(db, userId);
    if (!userWithPerms) return res.json({ ok: false, step: 'buildPayload', error: 'Usuario no encontrado' });
    const payload = buildPayload(userWithPerms);
    steps.push({ step: 'buildPayload', ok: true, modulos: payload.modulos, seq: payload.seq });

    // Step 2: Sign JWT
    let token;
    try {
      token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
      steps.push({ step: 'signJWT', ok: true, tokenLength: token.length });
    } catch (e) {
      return res.json({ ok: false, step: 'signJWT', error: e.message });
    }

    // Step 3: Verify JWT (same as module does)
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      steps.push({ step: 'verifyJWT', ok: true, email: decoded.email, modulos: decoded.modulos });
    } catch (e) {
      return res.json({ ok: false, step: 'verifyJWT', error: e.message });
    }

    // Step 4: Check session validity
    try {
      const sessionValid = verifySessionValid(payload);
      steps.push({ step: 'verifySession', ok: sessionValid, payloadSeq: payload.seq, dbSeq: userWithPerms.seq });
    } catch (e) {
      steps.push({ step: 'verifySession', ok: false, error: e.message });
    }

    // Step 5: Check module access
    const hasNomina = payload.modulos.includes('nomina');
    const isAdmin = payload.rol === 'admin';
    steps.push({ step: 'requireModule', ok: hasNomina || isAdmin, modulos: payload.modulos, rol: payload.rol });

    res.json({ ok: true, steps, payload });
  } catch (e) {
    console.error('[test-auth] Error:', e);
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

app.post('/api/admin/usuarios', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, email, password, rol, perfil_id, sede } = req.body;
  if (!nombre || !email) return res.status(400).json({ error: 'Nombre y email son requeridos' });
  const userRol = (rol === 'admin' || rol === 'operador' || rol === 'gerente') ? rol : 'operador';
  try {
    let hash;
    let welcomeSent = false;
    if (password) {
      hash = bcrypt.hashSync(password, 10);
    } else {
      const tempPass = Math.random().toString(36).slice(-10) + 'A1!';
      hash = bcrypt.hashSync(tempPass, 10);
    }
    const result = db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol, perfil_id, sede) VALUES (?, ?, ?, ?, ?, ?)').run(nombre, email.toLowerCase().trim(), hash, userRol, perfil_id || null, sede || 'Principal');
    const userId = result.lastInsertRowid;

    if (!password && mail.isConfigured()) {
      try {
        if (await debeEnviarEmail('launcher', 'usuario_creado')) {
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 7 * 24 * 3600000).toISOString().replace('T', ' ').split('.')[0];
          db.prepare('INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)').run(email.toLowerCase().trim(), token, expiresAt);
          const setupUrl = `${getBaseUrl()}/reset?token=${token}`;
          await mail.sendWelcomeEmail(email.toLowerCase().trim(), setupUrl, nombre, userRol);
          welcomeSent = true;
        }
      } catch (e) {
        console.error('[MAIL] sendWelcomeEmail error:', e.message);
      }
    }

    res.json({ id: userId, nombre, email: email.toLowerCase().trim(), rol: userRol, activo: 1, perfil_id: perfil_id || null, welcome_sent: welcomeSent });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El email ya existe' });
    console.error('[Create user]', e); res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, email, password, activo, rol, perfil_id, sede } = req.body;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  const updates = []; const params = [];
  if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email.toLowerCase().trim()); }
  if (password) { updates.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }
  if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
  if (rol && (rol === 'admin' || rol === 'operador' || rol === 'gerente')) { updates.push('rol = ?'); params.push(rol); }
  if (perfil_id !== undefined) { updates.push('perfil_id = ?'); params.push(perfil_id || null); }
  if (sede !== undefined) { updates.push('sede = ?'); params.push(sede || 'Principal'); }
  if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });
  updates.push("actualizado = datetime('now')"); params.push(id);
  try {
    const changedRol = rol !== undefined && rol !== user.rol;
    const changedPerfil = perfil_id !== undefined && perfil_id !== user.perfil_id;
    db.prepare(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const changedNombre = nombre !== undefined && nombre !== user.nombre;
    const changedEmail = email !== undefined && email.toLowerCase().trim() !== user.email;
    if (changedRol || changedPerfil || changedNombre || changedEmail) invalidarSesionUsuario(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.post('/api/admin/usuarios/:id/reset-password', verificarToken, soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  try {
    db.prepare('DELETE FROM reset_tokens WHERE email = ?').run(user.email);
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').split('.')[0];
    db.prepare('INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)').run(user.email, token, expiresAt);
    const resetUrl = `${getBaseUrl()}/reset?token=${token}`;
    if (mail.isConfigured()) {
      if (await debeEnviarEmail('launcher', 'password_reset')) {
        mail.sendResetEmail(user.email, resetUrl, user.nombre).catch(e => console.error('[MAIL] sendResetEmail error:', e.message));
      }
      res.json({ ok: true, message: 'Email de recuperación enviado a ' + user.email });
    } else {
      console.log('[RESET] SMTP no configurado — token para', user.email, ':', resetUrl);
      res.json({ ok: true, message: 'SMTP no configurado. Token generado: ' + resetUrl });
    }
  } catch (e) { console.error('[RESET]', e.message); res.status(500).json({ error: 'Error interno' }); }
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

// ── Import users from CSV (nómina backup format) ──
app.post('/api/admin/usuarios/import-csv', verificarToken, soloAdmin, (req, res) => {
  const { csv, modulos } = req.body;
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'CSV requerido' });

  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: 'CSV vacío o sin datos' });

  const modulosAsignar = Array.isArray(modulos) ? modulos : [];

  function parseCsvLine(line) {
    const cols = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    return cols.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const idx = h => headers.indexOf(h);

  const required = ['email', 'nombre'];
  const missing = required.filter(r => idx(r) === -1);
  if (missing.length) return res.status(400).json({ error: `Columnas faltantes: ${missing.join(', ')}` });

  const roleMap = { admin: 'admin', rrhh: 'operador', gerente: 'gerente', gerencia: 'gerente', operador: 'operador', consulta: 'operador' };
  let created = 0, skipped = 0, errors = 0;
  const details = [];
  const insModulo = db.prepare('INSERT OR IGNORE INTO user_modulos (user_id, modulo_id) VALUES (?, ?)');

  const importTransaction = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const email = (cols[idx('email')] || '').toLowerCase().trim();
      const nombre = (cols[idx('nombre')] || '').trim();
      if (!email || !nombre) { errors++; details.push(`Fila ${i + 1}: email o nombre vacío`); continue; }

      const exists = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
      if (exists) { skipped++; continue; }

      const rawRol = (cols[idx('rol')] || 'operador').toLowerCase().trim();
      const rol = roleMap[rawRol] || 'operador';
      const sede = (cols[idx('sede')] || '').trim() || 'Principal';
      const activoRaw = cols[idx('activo')];
      const activo = activoRaw != null ? (parseInt(activoRaw) || 0) : 1;
      const hash = (cols[idx('password')] || '').trim() || bcrypt.hashSync(Math.random().toString(36).slice(-10) + 'A1!', 10);

      const centroValido = db.prepare('SELECT id FROM centros_operacion WHERE nombre = ? AND activo = 1').get(sede);
      const finalSede = centroValido ? sede : 'Principal';

      try {
        const result = db.prepare('INSERT INTO usuarios (nombre, email, password_hash, rol, sede, activo) VALUES (?, ?, ?, ?, ?, ?)')
          .run(nombre, email, hash, rol, finalSede, activo ? 1 : 0);
        const userId = result.lastInsertRowid;
        for (const m of modulosAsignar) insModulo.run(userId, m);
        created++;
      } catch (e) {
        if (e.message.includes('UNIQUE')) { skipped++; }
        else { errors++; details.push(`Fila ${i + 1}: ${e.message}`); }
      }
    }
  });

  importTransaction();
  res.json({ ok: true, created, skipped, errors, details: details.slice(0, 20) });
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
  res.json({ ok: true, modulos, sesionInvalidada: true });
});

// ── API: User OAuth accounts + MCP tokens ──
app.get('/api/admin/usuarios/:id/oauth', verificarToken, soloAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const accounts = db.prepare('SELECT id, provider, email, nombre, created_at FROM oauth_accounts WHERE user_id = ?').all(userId);
  const mcpTokens = db.prepare('SELECT token_id, client_id, expires_at, created_at FROM oauth_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ?').all(userId, Date.now());
  res.json({ accounts, mcpTokens });
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

// ── API: Centros de operación ──

// Cache for centros (in-memory, 30s TTL)
let _centrosCache = null;
let _centrosCacheTs = 0;
const CENTROS_CACHE_TTL = 30000;
function getCentrosCache() {
  const now = Date.now();
  if (_centrosCache && (now - _centrosCacheTs) < CENTROS_CACHE_TTL) return _centrosCache;
  _centrosCache = db.prepare('SELECT id, nombre, codigo, descripcion, direccion, ciudad, telefono, email, responsable_id, latitud, longitud, activo FROM centros_operacion WHERE activo = 1 ORDER BY nombre').all();
  _centrosCacheTs = now;
  globalThis.__centrosCache = _centrosCache;
  return _centrosCache;
}
function invalidateCentrosCache() { _centrosCache = null; _centrosCacheTs = 0; globalThis.__centrosCache = null; }

// Pública: módulos remotos consumen centros activos (con caché)
app.get('/api/centros', publicLimiter, (req, res) => {
  res.json(getCentrosCache());
});

// Admin: todos los centros (incluye inactivos y campos completos)
app.get('/api/admin/centros', verificarToken, soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM centros_operacion ORDER BY nombre').all());
});
// Alias legacy
app.get('/api/admin/sedes', verificarToken, soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM centros_operacion ORDER BY nombre').all());
});

app.get('/api/admin/centros/:id', verificarToken, soloAdmin, (req, res) => {
  const centro = db.prepare('SELECT * FROM centros_operacion WHERE id = ?').get(req.params.id);
  if (!centro) return res.status(404).json({ error: 'Centro no encontrado' });
  res.json(centro);
});

app.post('/api/admin/centros', verificarToken, soloAdmin, (req, res) => {
  const { nombre, codigo, descripcion, direccion, ciudad, telefono, email, responsable_id, latitud, longitud } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = db.prepare(
      `INSERT INTO centros_operacion (nombre, codigo, descripcion, direccion, ciudad, telefono, email, responsable_id, latitud, longitud)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nombre.trim(),
      codigo?.trim() || '',
      descripcion?.trim() || '',
      direccion?.trim() || '',
      ciudad?.trim() || '',
      telefono?.trim() || '',
      email?.trim() || '',
      responsable_id || null,
      latitud || null,
      longitud || null
    );
    const centro = db.prepare('SELECT * FROM centros_operacion WHERE id = ?').get(result.lastInsertRowid);
    // Audit
    db.prepare(
      `INSERT INTO centros_historial (centro_id, accion, usuario_id, usuario_nombre, despues)
       VALUES (?, 'crear', ?, ?, ?)`
    ).run(centro.id, req.user?.id || null, req.user?.nombre || '', JSON.stringify(centro));
    invalidateCentrosCache();
    res.json(centro);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El centro ya existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/centros/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const { nombre, codigo, descripcion, direccion, ciudad, telefono, email, responsable_id, latitud, longitud, activo } = req.body;
  const centro = db.prepare('SELECT * FROM centros_operacion WHERE id = ?').get(id);
  if (!centro) return res.status(404).json({ error: 'Centro no encontrado' });
  const oldNombre = centro.nombre;
  const antes = JSON.stringify(centro);
  const updates = []; const params = [];
  if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre.trim()); }
  if (codigo !== undefined) { updates.push('codigo = ?'); params.push(codigo.trim()); }
  if (descripcion !== undefined) { updates.push('descripcion = ?'); params.push(descripcion.trim()); }
  if (direccion !== undefined) { updates.push('direccion = ?'); params.push(direccion.trim()); }
  if (ciudad !== undefined) { updates.push('ciudad = ?'); params.push(ciudad.trim()); }
  if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono.trim()); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email.trim()); }
  if (responsable_id !== undefined) { updates.push('responsable_id = ?'); params.push(responsable_id || null); }
  if (latitud !== undefined) { updates.push('latitud = ?'); params.push(latitud || null); }
  if (longitud !== undefined) { updates.push('longitud = ?'); params.push(longitud || null); }
  if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });
  updates.push("actualizado = datetime('now')");
  params.push(id);
  try {
    db.prepare(`UPDATE centros_operacion SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (nombre !== undefined && nombre.trim() !== oldNombre) {
      db.prepare('UPDATE usuarios SET sede = ? WHERE sede = ?').run(nombre.trim(), oldNombre);
    }
    const updated = db.prepare('SELECT * FROM centros_operacion WHERE id = ?').get(id);
    // Audit
    db.prepare(
      `INSERT INTO centros_historial (centro_id, accion, usuario_id, usuario_nombre, antes, despues)
       VALUES (?, 'editar', ?, ?, ?, ?)`
    ).run(id, req.user?.id || null, req.user?.nombre || '', antes, JSON.stringify(updated));
    invalidateCentrosCache();
    res.json({ ok: true, centro: updated });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El centro ya existe' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/centros/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const centro = db.prepare('SELECT * FROM centros_operacion WHERE id = ?').get(id);
  if (!centro) return res.status(404).json({ error: 'Centro no encontrado' });
  if (centro.nombre === 'Principal') return res.status(400).json({ error: 'No se puede eliminar el centro Principal' });
  const usersWithCentro = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE sede = ?").get(centro.nombre).c;
  if (usersWithCentro > 0) return res.status(400).json({ error: `${usersWithCentro} usuario(s) tienen este centro. Reasigna primero.` });
  const antes = JSON.stringify(centro);
  db.prepare('DELETE FROM centros_operacion WHERE id = ?').run(id);
  // Audit
  db.prepare(
    `INSERT INTO centros_historial (centro_id, accion, usuario_id, usuario_nombre, antes)
     VALUES (?, 'eliminar', ?, ?, ?)`
  ).run(id, req.user?.id || null, req.user?.nombre || '', antes);
  invalidateCentrosCache();
  res.json({ ok: true });
});

// ── API: Google Maps config ──
// Public endpoint for modules to get the API key
app.get('/api/config/gmaps/key', (req, res) => {
  const row = db.prepare("SELECT value FROM config WHERE key = 'google_maps_key'").get();
  res.json({ key: row?.value || '' });
});

app.get('/api/config/gmaps/js-url', verificarToken, soloAdmin, (req, res) => {
  const row = db.prepare("SELECT value FROM config WHERE key = 'google_maps_key'").get();
  const key = row?.value || '';
  if (!key) return res.json({ url: '' });
  res.json({ url: `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places` });
});

app.put('/api/admin/config/gmaps/key', verificarToken, soloAdmin, (req, res) => {
  const { key } = req.body;
  if (!key || !key.trim()) return res.status(400).json({ error: 'API key requerida' });
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('google_maps_key', ?)").run(key.trim());
  res.json({ ok: true });
});

app.delete('/api/admin/config/gmaps/key', verificarToken, soloAdmin, (req, res) => {
  db.prepare("DELETE FROM config WHERE key = 'google_maps_key'").run();
  res.json({ ok: true });
});

app.get('/api/admin/centros/:id/historial', verificarToken, soloAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM centros_historial WHERE centro_id = ? ORDER BY id DESC LIMIT 100').all(req.params.id);
  res.json(rows);
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
  const { id, nombre, url, public_url, icon, descripcion, mcp_enabled, activo, proxy_prefix, tipo, dashboard_endpoint } = req.body;
  if (!id || !nombre) return res.status(400).json({ error: 'ID y nombre requeridos' });
  db.prepare('INSERT OR REPLACE INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, proxy_prefix, tipo, dashboard_endpoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, nombre, descripcion || '', url || '', public_url || url || '', icon || '📦', mcp_enabled !== false ? 1 : 0, activo !== false ? 1 : 0, proxy_prefix || '', tipo === 'interno' ? 'interno' : 'externo', dashboard_endpoint || '');
  res.json({ ok: true });
});

app.put('/api/admin/modulos/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, url, public_url, icon, descripcion, mcp_enabled, activo, proxy_prefix, tipo, dashboard_endpoint } = req.body;
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
  if (dashboard_endpoint !== undefined) { u.push('dashboard_endpoint = ?'); p.push(dashboard_endpoint); }
  if (!u.length) return res.status(400).json({ error: 'Sin cambios' });
  p.push(id);
  db.prepare(`UPDATE modulos_plataforma SET ${u.join(', ')} WHERE id = ?`).run(...p);
  res.json({ ok: true });
});

app.delete('/api/admin/modulos/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const builtin = ['proveedores', 'nomina', 'logistica', 'proyectos'];
  if (builtin.includes(id)) return res.status(400).json({ error: 'No se pueden eliminar módulos del sistema' });
  db.prepare('DELETE FROM modulos_plataforma WHERE id = ?').run(id);
  db.prepare('DELETE FROM user_modulos WHERE modulo_id = ?').run(id);
  db.prepare('DELETE FROM perfil_permisos WHERE modulo_id = ?').run(id);
  // Delete module folder from disk
  const modDir = path.join(__dirname, '..', 'modules', id);
  if (fs.existsSync(modDir)) {
    try { fs.rmSync(modDir, { recursive: true, force: true }); } catch(e) { console.error('[delete-module] Error eliminando carpeta:', e.message); }
  }
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
    const moduleJwtSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(modDir, '.env'), `PORT=${listenPort}\nJWT_SECRET=${moduleJwtSecret}\nMODULE_ID=${id}\n`);

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

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', 1);
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
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
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

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const mcpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', 1);
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
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
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
    const dashEndpoint = '/' + id + '/api/dashboard';
    db.prepare('INSERT OR REPLACE INTO modulos_plataforma (id, nombre, descripcion, url, icon, mcp_enabled, activo, proxy_prefix, tipo, dashboard_endpoint) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)').run(id, nombre, description || '', 'http://localhost:' + listenPort, '📦', prefix, isInternal ? 'interno' : 'externo', dashEndpoint);

    res.json({ ok: true, mensaje: 'M\u00f3dulo ' + (isInternal ? 'interno' : 'externo') + ' creado en ' + modDir, npm: npmResult.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Notificaciones ──
app.get('/api/notificaciones', verificarToken, (req, res) => {
  try {
    const userId = req.usuario.id;
    const rows = db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
    res.json({ notificaciones: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notificaciones/no-leidas', verificarToken, (req, res) => {
  try {
    const userId = req.usuario.id;
    const row = db.prepare('SELECT COUNT(*) as count FROM notificaciones WHERE usuario_id = ? AND leida = 0').get(userId);
    res.json({ count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/notificaciones/:id/leer', verificarToken, (req, res) => {
  try {
    db.prepare('DELETE FROM notificaciones WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuario.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/notificaciones/leer-todas', verificarToken, (req, res) => {
  try {
    db.prepare('DELETE FROM notificaciones WHERE usuario_id = ?').run(req.usuario.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/notificaciones/crear', (req, res) => {
  try {
    const isInternal = validarTokenInterno(req);
    if (isInternal) {
      // Internal request — authenticated via X-Internal-Token
    } else {
      // External request — require admin JWT
      const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.launcher_jwt;
      if (!token) return res.status(401).json({ error: 'No autenticado' });
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.rol !== 'admin') return res.status(403).json({ error: 'Solo admin puede crear notificaciones' });
      } catch { return res.status(401).json({ error: 'Token inválido' }); }
    }

    const { usuario_id, modulo, tipo, titulo, mensaje, url, idempotency_key } = req.body;
    if (!usuario_id || !modulo || !tipo || !titulo || !mensaje) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    if (modulo.length > 30 || tipo.length > 50 || titulo.length > 200 || mensaje.length > 500 || (url && url.length > 300)) {
      return res.status(400).json({ error: 'Campos exceden longitud máxima' });
    }
    const usuarioExiste = db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').get(usuario_id);
    if (!usuarioExiste) return res.status(400).json({ error: 'Usuario destino no existe o está inactivo' });

    console.log(`[notif-crear] internal=${isInternal} tipo=${tipo} usuario_id=${usuario_id}`);

    if (idempotency_key) {
      const existente = db.prepare('SELECT id FROM notificaciones WHERE idempotency_key = ?').get(idempotency_key);
      if (existente) return res.json({ ok: true, id: existente.id, duplicada: true });
    }

    const result = db.prepare('INSERT INTO notificaciones (usuario_id, modulo, tipo, titulo, mensaje, url, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(usuario_id, modulo, tipo, titulo, mensaje, url || null, idempotency_key || null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Email Notif Config ──
app.get('/api/admin/email-notif', verificarToken, soloAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM email_notif_config ORDER BY modulo, id').all();
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.modulo]) grouped[r.modulo] = [];
      grouped[r.modulo].push(r);
    }
    res.json({ config: grouped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/email-notif/:id', verificarToken, soloAdmin, (req, res) => {
  try {
    const { habilitado } = req.body;
    if (habilitado === undefined) return res.status(400).json({ error: 'habilitado requerido' });
    const r = db.prepare('UPDATE email_notif_config SET habilitado = ?, updated_at = datetime(\'now\') WHERE id = ?').run(habilitado ? 1 : 0, req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Config no encontrada' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/email-notif/modulo/:modulo', verificarToken, soloAdmin, (req, res) => {
  try {
    const { habilitado } = req.body;
    if (habilitado === undefined) return res.status(400).json({ error: 'habilitado requerido' });
    db.prepare('UPDATE email_notif_config SET habilitado = ?, updated_at = datetime(\'now\') WHERE modulo = ?').run(habilitado ? 1 : 0, req.params.modulo);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/email-notif/check/:modulo/:evento', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';
  if (!isLocal) return res.status(403).json({ error: 'Acceso denegado: solo localhost' });
  try {
    const row = db.prepare('SELECT habilitado FROM email_notif_config WHERE modulo = ? AND evento = ?').get(req.params.modulo, req.params.evento);
    if (!row) return res.json({ habilitado: true });
    res.json({ habilitado: !!row.habilitado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Health check ──
app.get('/api/admin/health', verificarToken, soloAdmin, async (req, res) => {
  const modulos = getModulos(false);
  const launcherHost = `http://127.0.0.1:${PORT}`;
  const results = await Promise.all(modulos.map(async (m) => {
    try {
      const moduleUrl = m.url.replace(/\/+$/, '');
      // If module is on the same server, skip HTTP health check to avoid rate limiting
      if (moduleUrl === launcherHost || moduleUrl === `http://localhost:${PORT}`) {
        return { id: m.id, nombre: m.nombre, estado: 'online', status: 200, local: true };
      }
      // Try HTTP health check first (works for any module with /api/health or /health)
      try {
        const r = await fetch(moduleUrl + '/api/health', {
          method: 'GET',
          signal: AbortSignal.timeout(1500),
        });
        if (r.ok) return { id: m.id, nombre: m.nombre, estado: 'online', status: r.status };
      } catch {}
      try {
        const r = await fetch(moduleUrl + '/health', {
          method: 'GET',
          signal: AbortSignal.timeout(1500),
        });
        if (r.ok) return { id: m.id, nombre: m.nombre, estado: 'online', status: r.status };
      } catch {}
      // Fallback: MCP tools/list for modules with MCP enabled
      if (m.mcp_enabled) {
        const sessionId = await ensureMcpSession(m);
        const headers = { 'Content-Type': 'application/json' };
        if (m.mcp_token) headers['Authorization'] = 'Bearer ' + m.mcp_token;
        if (sessionId) headers['mcp-session-id'] = sessionId;
        const r = await fetch(mcpUrl(m), {
          method: 'POST', headers,
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          signal: AbortSignal.timeout(1500),
        });
        if (r.ok) return { id: m.id, nombre: m.nombre, estado: 'online', status: r.status };
      }
      return { id: m.id, nombre: m.nombre, estado: 'offline', error: 'No responde' };
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
  const port = 443;
  const sslCert = isProd
    ? `/etc/letsencrypt/live/${dominio}/fullchain.pem`
    : '/etc/ssl/synnoxerp/cert.pem';
  const sslKey = isProd
    ? `/etc/letsencrypt/live/${dominio}/privkey.pem`
    : '/etc/ssl/synnoxerp/key.pem';

  const modulos = db.prepare("SELECT * FROM modulos_plataforma WHERE activo = 1 AND proxy_prefix != '' ORDER BY orden").all();

  let locations = '';
  for (const m of modulos) {
    if (!m.url) continue;
    const prefix = m.proxy_prefix.startsWith('/') ? m.proxy_prefix : '/' + m.proxy_prefix;
    const prefixClean = prefix.replace(/\/+$/, '');
    const prefixMatch = prefixClean.replace(/\//g, '\\/');
    locations += `
    location ${prefix} {
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
  const host = req.headers['x-forwarded-host'] || req.headers.host || COMPANY_DOMAIN;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const dynamicHost = host.includes(':') ? host.split(':')[0] : host;
  res.json({
    url: `${proto}://${dynamicHost}/mcp-gateway/mcp`,
    dominio: dynamicHost
  });
});

// ── Session cache for MCP modules ──
const mcpSessions = new Map();

function mcpUrl(mod) {
  const base = mod.url.replace(/\/+$/, '');
  const prefix = mod.proxy_prefix || `/${mod.id}/`;
  return base + prefix + 'mcp';
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
          for (const t of data.result.tools) {
            if (isToolEnabled(m.id, t.name)) {
              allTools.push({ ...t, name: m.id + '_' + t.name });
            }
          }
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
    const toolName = parts.slice(1).join('_');
    if (!isToolEnabled(prefix, toolName)) return rpcError(id, -32601, 'Tool disabled: ' + name);
    const startTime = Date.now();
    try {
      const result = await forwardMcpRequest(mod, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: args } }, 30000);
      const duration = Date.now() - startTime;
      const success = !result.error;
      mcpLogTool(sessionId, prefix, toolName, args, success, result.error?.message || null, duration);
      return result;
    } catch (e) {
      const duration = Date.now() - startTime;
      mcpLogTool(sessionId, prefix, toolName, args, false, e.message, duration);
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

  // OAuth check: if enabled, require valid token (except for initialize)
  const oauthEnabled = db.prepare("SELECT value FROM config WHERE key = 'mcp_oauth_enabled'").get()?.value === 'true';
  if (oauthEnabled && msg?.method !== 'initialize') {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Authentication required' }, id: msg?.id ?? null });
    }
    const token = auth.slice(7);
    const tokenRow = oauthGetToken(token);
    if (!tokenRow) {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid or expired token' }, id: msg?.id ?? null });
    }
  }

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

// ── MCP Admin: Logs ──
app.get('/api/admin/mcp-logs', verificarToken, soloAdmin, (req, res) => {
  const { module_id, tool_name, success, limit: lim, offset: off } = req.query;
  let sql = 'SELECT * FROM mcp_tool_logs WHERE 1=1';
  const params = [];
  if (module_id) { sql += ' AND module_id = ?'; params.push(module_id); }
  if (tool_name) { sql += ' AND tool_name = ?'; params.push(tool_name); }
  if (success !== undefined) { sql += ' AND success = ?'; params.push(success === 'true' ? 1 : 0); }
  sql += ' ORDER BY created_at DESC';
  const limit = Math.min(parseInt(lim) || 50, 200);
  const offset = parseInt(off) || 0;
  sql += ` LIMIT ${limit} OFFSET ${offset}`;
  const rows = db.prepare(sql).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM mcp_tool_logs').get().c;
  res.json({ logs: rows, total });
});

app.get('/api/admin/mcp-logs/stats', verificarToken, soloAdmin, (req, res) => {
  const totalCalls = db.prepare('SELECT COUNT(*) as c FROM mcp_tool_logs').get().c;
  const successCalls = db.prepare('SELECT COUNT(*) as c FROM mcp_tool_logs WHERE success = 1').get().c;
  const errorCalls = totalCalls - successCalls;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCalls = db.prepare('SELECT COUNT(*) as c FROM mcp_tool_logs WHERE created_at >= ?').get(todayStart.getTime()).c;
  const topTools = db.prepare('SELECT module_id, tool_name, COUNT(*) as calls, AVG(duration_ms) as avg_ms FROM mcp_tool_logs GROUP BY module_id, tool_name ORDER BY calls DESC LIMIT 10').all();
  const recentErrors = db.prepare('SELECT module_id, tool_name, error_message, created_at FROM mcp_tool_logs WHERE success = 0 ORDER BY created_at DESC LIMIT 5').all();
  res.json({ totalCalls, successCalls, errorCalls, todayCalls, topTools, recentErrors });
});

// ── MCP Admin: Sessions ──
app.get('/api/admin/mcp-sessions', verificarToken, soloAdmin, (req, res) => {
  const sessions = [];
  for (const [sid, s] of mcpGatewaySessions) {
    sessions.push({ id: sid, createdAt: s.createdAt, age: Date.now() - s.createdAt });
  }
  res.json({ sessions, total: sessions.length });
});

app.delete('/api/admin/mcp-sessions/:id', verificarToken, soloAdmin, (req, res) => {
  if (mcpGatewaySessions.delete(req.params.id)) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// ── MCP Admin: Stats ──
app.get('/api/admin/mcp/stats', verificarToken, soloAdmin, (req, res) => {
  const modulos = getModulos(true);
  const totalTools = db.prepare('SELECT COUNT(DISTINCT module_id || tool_name) as c FROM mcp_tool_logs').get().c;
  const activeSessions = mcpGatewaySessions.size;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCalls = db.prepare('SELECT COUNT(*) as c FROM mcp_tool_logs WHERE created_at >= ?').get(todayStart.getTime()).c;
  const enabledModules = modulos.length;
  res.json({ enabledModules, totalTools, activeSessions, todayCalls });
});

// ── MCP Admin: Tool Config ──
app.get('/api/admin/mcp/:id/tools', verificarToken, soloAdmin, async (req, res) => {
  const mod = db.prepare('SELECT * FROM modulos_plataforma WHERE id = ?').get(req.params.id);
  if (!mod) return res.status(404).json({ error: 'Module not found' });
  if (!mod.url) return res.json({ tools: [], error: 'URL no configurada para este módulo' });
  // Fetch tools from module's MCP endpoint
  let tools = [];
  let fetchError = null;
  try {
    const data = await forwardMcpRequest(mod, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, 8000);
    if (data.result?.tools) tools = data.result.tools;
    else if (data.error) fetchError = data.error.message;
  } catch (e) { fetchError = e.message; }
  // Merge with config
  const config = db.prepare('SELECT tool_name, enabled FROM mcp_tool_config WHERE module_id = ?').all(req.params.id);
  const configMap = {};
  for (const c of config) configMap[c.tool_name] = c.enabled;
  const result = tools.map(t => ({
    name: t.name,
    description: t.description || '',
    enabled: configMap[t.name] !== undefined ? configMap[t.name] === 1 : true
  }));
  res.json({ tools: result, error: fetchError, moduleUrl: mod.url });
});

app.put('/api/admin/mcp/:id/tools', verificarToken, soloAdmin, (req, res) => {
  const { tools } = req.body;
  if (!tools || !Array.isArray(tools)) return res.status(400).json({ error: 'tools array required' });
  const upsert = db.prepare('INSERT OR REPLACE INTO mcp_tool_config (module_id, tool_name, enabled) VALUES (?, ?, ?)');
  const transaction = db.transaction(() => {
    for (const t of tools) {
      upsert.run(req.params.id, t.name, t.enabled ? 1 : 0);
    }
  });
  transaction();
  res.json({ ok: true });
});

app.post('/api/admin/mcp/:id/tools/reset', verificarToken, soloAdmin, (req, res) => {
  db.prepare('DELETE FROM mcp_tool_config WHERE module_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── MCP OAuth Admin ──
app.get('/api/admin/mcp-oauth', verificarToken, soloAdmin, (req, res) => {
  const enabled = db.prepare("SELECT value FROM config WHERE key = 'mcp_oauth_enabled'").get()?.value === 'true';
  const now = Date.now();
  const clients = db.prepare(`
    SELECT c.client_id, c.client_name, c.redirect_uris, c.created_at,
           GROUP_CONCAT(DISTINCT u.nombre) as user_names,
           COUNT(DISTINCT CASE WHEN t.revoked = 0 AND t.expires_at > ? THEN t.token_id END) as active_tokens
    FROM oauth_clients c
    LEFT JOIN oauth_tokens t ON c.client_id = t.client_id
    LEFT JOIN usuarios u ON t.user_id = u.id
    GROUP BY c.client_id
    ORDER BY c.created_at DESC
  `).all(now);
  const tokenCount = db.prepare('SELECT COUNT(*) as c FROM oauth_tokens WHERE revoked = 0 AND expires_at > ?').get(now).c;
  res.json({ enabled, clients, tokenCount });
});

app.put('/api/admin/mcp-oauth', verificarToken, soloAdmin, (req, res) => {
  const { enabled } = req.body;
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('mcp_oauth_enabled', enabled ? 'true' : 'false');
  res.json({ ok: true });
});

app.delete('/api/admin/mcp-oauth/clients/:id', verificarToken, soloAdmin, (req, res) => {
  db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(req.params.id);
  db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(req.params.id);
  db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/mcp-oauth/revoke-all', verificarToken, soloAdmin, (req, res) => {
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE revoked = 0').run();
  res.json({ ok: true });
});

// ── MCP OAuth: Token Management ──
app.get('/api/admin/mcp-oauth/tokens', verificarToken, soloAdmin, (req, res) => {
  const tokens = db.prepare(`
    SELECT t.token_id, t.client_id, t.user_id, t.expires_at, t.revoked, t.created_at,
           c.client_name,
           u.nombre as user_nombre, u.email as user_email
    FROM oauth_tokens t
    LEFT JOIN oauth_clients c ON t.client_id = c.client_id
    LEFT JOIN usuarios u ON t.user_id = u.id
    ORDER BY t.created_at DESC
    LIMIT 100
  `).all();
  const result = tokens.map(t => ({
    token_id: t.token_id.slice(0, 8) + '...',
    token_id_full: t.token_id,
    client_name: t.client_name || 'Desconocido',
    client_id: t.client_id,
    user_nombre: t.user_nombre || null,
    user_email: t.user_email || null,
    expires_at: t.expires_at,
    is_expired: t.expires_at < Date.now(),
    is_revoked: t.revoked === 1,
    created_at: t.created_at
  }));
  res.json({ tokens: result });
});

app.delete('/api/admin/mcp-oauth/tokens/:id', verificarToken, soloAdmin, (req, res) => {
  const token = db.prepare('SELECT * FROM oauth_tokens WHERE token_id = ?').get(req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── OAuth Accounts Management ──
app.get('/api/admin/oauth-accounts', verificarToken, soloAdmin, (req, res) => {
  const accounts = db.prepare(`
    SELECT oa.id, oa.provider, oa.email, oa.nombre, oa.created_at, oa.updated_at,
           u.id as user_id, u.nombre as user_nombre, u.email as user_email, u.rol
    FROM oauth_accounts oa
    LEFT JOIN usuarios u ON oa.user_id = u.id
    ORDER BY oa.created_at DESC
  `).all();
  res.json({ accounts });
});

app.delete('/api/admin/oauth-accounts/:id', verificarToken, soloAdmin, (req, res) => {
  const account = db.prepare('SELECT * FROM oauth_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.prepare('DELETE FROM oauth_accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/admin/oauth-accounts/:id/link', verificarToken, soloAdmin, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const account = db.prepare('SELECT * FROM oauth_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const user = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const previousUserId = account.user_id;
  
  // Link to new user
  db.prepare('UPDATE oauth_accounts SET user_id = ?, updated_at = ? WHERE id = ?').run(user_id, Date.now(), req.params.id);
  
  // Auto-delete orphaned OAuth-created user if conditions are met
  if (previousUserId && previousUserId !== user_id) {
    const prevUser = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(previousUserId);
    if (prevUser) {
      const hasModules = db.prepare('SELECT COUNT(*) as c FROM user_modulos WHERE user_id = ?').get(previousUserId).c > 0;
      const hasProfile = prevUser.perfil_id !== null;
      const isDefaultRole = prevUser.rol === 'operador';
      // Only delete if: default role, no modules, no profile (auto-created by OAuth)
      if (isDefaultRole && !hasModules && !hasProfile) {
        db.prepare('DELETE FROM usuarios WHERE id = ?').run(previousUserId);
      }
    }
  }
  
  res.json({ ok: true });
});

// ── User Blacklist ──
app.get('/api/admin/blacklist', verificarToken, soloAdmin, (req, res) => {
  const entries = db.prepare(`
    SELECT b.id, b.user_id, b.reason, b.blocked_at, b.expires_at,
           u.nombre, u.email, u.rol,
           admin.nombre as blocked_by_name
    FROM user_blacklist b
    LEFT JOIN usuarios u ON b.user_id = u.id
    LEFT JOIN usuarios admin ON b.blocked_by = admin.id
    ORDER BY b.blocked_at DESC
  `).all();
  res.json({ entries });
});

app.put('/api/admin/blacklist', verificarToken, soloAdmin, (req, res) => {
  const { user_id, reason, expires_at } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('INSERT OR REPLACE INTO user_blacklist (user_id, reason, blocked_by, blocked_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(user_id, reason || '', req.usuario.id, Date.now(), expires_at || null);
  res.json({ ok: true });
});

app.delete('/api/admin/blacklist/:id', verificarToken, soloAdmin, (req, res) => {
  const entry = db.prepare('SELECT * FROM user_blacklist WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM user_blacklist WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── OAuth guard middleware ──
function requireOauth(req, res, next) {
  const row = db.prepare("SELECT value FROM config WHERE key = 'mcp_oauth_enabled'").get();
  if (row?.value !== 'true') return res.status(404).json({ error: 'not_found' });
  next();
}

// Validate redirect URI per RFC 6749 Section 3.1.2
function isValidRedirectUri(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
  } catch { return false; }
}

// ── MCP OAuth 2.0 (RFC 7591 DCR + Authorization Code + PKCE) ──

// DCR — Dynamic Client Registration
function handleDcr(req, res) {
  const { redirect_uris, client_name, grant_types, response_types, token_endpoint_auth_method } = req.body || {};
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
  }
  for (const uri of redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'Invalid redirect_uri: ' + uri });
    }
  }
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  const client = {
    client_id: clientId, client_secret: clientSecret,
    client_name: client_name || 'MCP Client',
    redirect_uris, grant_types: grant_types || ['authorization_code', 'refresh_token'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: token_endpoint_auth_method || 'none',
    created_at: Date.now()
  };
  oauthSaveClient(client);
  res.status(201).json({
    client_id: clientId, client_secret: clientSecret,
    client_secret_expires_at: 0, client_name: client.client_name,
    redirect_uris, grant_types: client.grant_types,
    response_types: client.response_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method
  });
}

app.post('/mcp/oauth/register', requireOauth, dcrLimiter, express.json(), handleDcr);
app.post('/register', requireOauth, dcrLimiter, express.json(), handleDcr);

// Authorize endpoint
app.get('/mcp/oauth/authorize', requireOauth, (req, res) => {
  const { state, client_id, redirect_uri, response_type, code_challenge, code_challenge_method } = req.query;
  if (response_type !== 'code') return res.status(400).json({ error: 'invalid_request', error_description: 'response_type must be code' });
  if (!code_challenge) return res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge required (PKCE)' });
  const client = oauthGetClient(client_id);
  if (!client) return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
  const rUri = redirect_uri || client.redirect_uris[0];
  if (!rUri || !client.redirect_uris.includes(rUri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
  }
  if (!isValidRedirectUri(rUri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri protocol' });
  }

  // Check if user is logged in via cookie
  let userId = null;
  const cookies = parseCookies(req);
  const jwtToken = cookies.launcher_jwt;
  if (jwtToken) {
    try {
      const decoded = jwt.verify(jwtToken, JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }

  // If not logged in, redirect to login with return URL
  if (!userId) {
    const returnUrl = encodeURIComponent('/mcp/oauth/authorize?' + new URLSearchParams(req.query).toString());
    return res.redirect(`/?return=${returnUrl}`);
  }

  const code = crypto.randomUUID();
  oauthSaveCode({
    code, client_id, redirect_uri: rUri,
    code_challenge,
    code_challenge_method: code_challenge_method || 'S256',
    expires_at: Date.now() + 600000,
    user_id: userId
  });
  const url = new URL(rUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state || '');
  res.redirect(302, url.toString());
});

// Token endpoint (authorization_code + refresh_token)
app.post('/mcp/oauth/token', requireOauth, express.urlencoded({ extended: false }), (req, res) => {
  const { grant_type } = req.body;
  if (grant_type === 'authorization_code') return handleTokenAuthCode(req, res);
  if (grant_type === 'refresh_token') return handleTokenRefresh(req, res);
  return res.status(400).json({ error: 'unsupported_grant_type' });
});

function handleTokenAuthCode(req, res) {
  const { code, redirect_uri, code_verifier } = req.body;
  let client_id = req.body.client_id;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    client_id = decoded.split(':')[0];
  }
  const stored = oauthGetCode(code);
  if (!stored) return res.status(400).json({ error: 'invalid_grant' });
  oauthUseCode(code);
  // Require PKCE
  if (!stored.code_challenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE required — no code_challenge in authorize' });
  }
  if (!code_verifier) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required' });
  }
  const verifierHash = crypto.createHash('sha256').update(code_verifier).digest();
  const expected = Buffer.from(verifierHash).toString('base64url');
  if (expected !== stored.code_challenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }
  const accessToken = crypto.randomUUID();
  const refreshToken = crypto.randomUUID();
  oauthSaveToken({
    token_id: accessToken, refresh_token: refreshToken,
    client_id: stored.client_id, user_id: stored.user_id || null,
    expires_at: Date.now() + 86400000  // access token expires in 24h; refresh token doesn't check expires_at
  });
  res.json({
    access_token: accessToken, token_type: 'Bearer',
    expires_in: 86400, refresh_token: refreshToken
  });
}

function handleTokenRefresh(req, res) {
  const { refresh_token } = req.body;
  let client_id = req.body.client_id;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    client_id = decoded.split(':')[0];
  }
  if (!refresh_token) return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token required' });
  // Find token row by refresh_token (refresh tokens don't expire — only revocation matters)
  const row = db.prepare('SELECT * FROM oauth_tokens WHERE refresh_token = ? AND revoked = 0').get(refresh_token);
  if (!row) return res.status(400).json({ error: 'invalid_grant' });
  // Revoke old token and issue new pair
  oauthRevokeToken(row.token_id);
  const newAccessToken = crypto.randomUUID();
  const newRefreshToken = crypto.randomUUID();
  oauthSaveToken({
    token_id: newAccessToken, refresh_token: newRefreshToken,
    client_id: row.client_id, user_id: row.user_id,
    expires_at: Date.now() + 86400000  // access token expires in 24h; refresh token doesn't check expires_at
  });
  res.json({
    access_token: newAccessToken, token_type: 'Bearer',
    expires_in: 86400, refresh_token: newRefreshToken
  });
}

// Token validation middleware (used by MCP endpoint when OAuth enabled)
function oauthValidateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'invalid_token', error_description: 'Bearer token required' });
  const token = auth.slice(7);
  const row = oauthGetToken(token);
  if (!row) return res.status(401).json({ error: 'invalid_token', error_description: 'Token expired or revoked' });
  req.oauthClient = { client_id: row.client_id, user_id: row.user_id };
  next();
}

// ── Well-known OAuth metadata (RFC 8414 + RFC 9728) ──
function getMcpBaseUrl(req) {
  const proto = req?.headers['x-forwarded-proto'] || 'https';
  const host = req?.headers['x-forwarded-host'] || COMPANY_DOMAIN;
  return `${proto}://${host}`;
}

app.get('/.well-known/oauth-authorization-server', requireOauth, (req, res) => {
  const base = getMcpBaseUrl(req);
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
  const base = getMcpBaseUrl(req);
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

app.get('/api/admin/updater/status', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: LAUNCHER_DIR, timeout: 5000 });
    const { stdout: commit } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: LAUNCHER_DIR, timeout: 5000 });
    res.json({ ok: true, branch: branch.trim(), currentCommit: commit.trim() });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/admin/updater/check', verificarToken, soloAdmin, async (req, res) => {
  try {
    logUpdater('Verificando actualizaciones...');
    await execFileAsync('git', ['fetch', 'origin', '--prune'], { cwd: LAUNCHER_DIR, timeout: 30000 });
    const { stdout: currentOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: LAUNCHER_DIR, timeout: 5000 });
    const { stdout: remoteOut } = await execFileAsync('git', ['rev-parse', '--short', 'origin/main'], { cwd: LAUNCHER_DIR, timeout: 5000 });
    const currentCommit = currentOut.trim();
    const remoteCommit = remoteOut.trim();
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

  // Send response immediately — update runs in background
  // This prevents 502 if the process crashes during git reset / pnpm install
  res.json({ ok: true, message: 'Actualización en progreso. El servicio se reiniciará automáticamente.', restarting: true });

  res.on('finish', () => {
    setTimeout(async () => {
      try {
        logUpdater('INICIANDO ACTUALIZACION (rama: ' + branch + ')');
        logUpdater('Fetch y reset a origin/' + branch + '...');
        try {
          execFileSync('git', ['fetch', 'origin'], { cwd: LAUNCHER_DIR, stdio: 'pipe' });
        } catch (e) {
          logUpdater('ERROR en git fetch: ' + e.message);
          return;
        }
        try {
          execFileSync('git', ['reset', '--hard', 'origin/' + branch], { cwd: LAUNCHER_DIR, stdio: 'pipe' });
        } catch (e) {
          logUpdater('ERROR en git reset: ' + e.message);
          return;
        }
        logUpdater('Reset hard completado');
        logUpdater('Instalando dependencias...');
        try { execSync('pnpm install --prod --frozen-lockfile', { cwd: LAUNCHER_DIR, stdio: 'pipe' }); logUpdater('Dependencias instaladas'); } catch (e) {
          logUpdater('pnpm install: ' + e.message);
          return;
        }
        const newCommit = execSync('git rev-parse --short HEAD', { cwd: LAUNCHER_DIR }).toString().trim();
        logUpdater('ACTUALIZACION COMPLETADA - Commit: ' + newCommit);
        fs.writeFileSync(path.join(__dirname, '.last-update'), new Date().toISOString());

        // Restart wordpress-mcp (separate process, safe)
        try { pm2Exec('restart wordpress-mcp'); logUpdater('wordpress-mcp reiniciado'); } catch { logUpdater('wordpress-mcp no disponible para reiniciar'); }

        // Restart self
        logUpdater('Reiniciando synnoxerp...');
        try { pm2Exec('restart synnoxerp'); } catch { logUpdater('PM2 no disponible — reinicio manual requerido'); }
      } catch (err) {
        logUpdater('ERROR: ' + err.message);
      }
    }, 1000);
  });
});

app.post('/api/admin/updater/restart', verificarToken, soloAdmin, async (req, res) => {
  try {
    logUpdater('Reiniciando servicio...');
    try {
      pm2Exec('restart synnoxerp');
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

app.get('/api/admin/server/stats', verificarToken, soloAdmin, async (req, res) => {
  try {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    let disk = null;
    try {
      const { stdout } = await execFileAsync('df', ['-h', '/'], { timeout: 3000 });
      const parts = stdout.trim().split('\n').pop().split(/\s+/);
      if (parts.length >= 6) disk = { size: parts[1], used: parts[2], avail: parts[3], usePct: parts[4], mount: parts[5] };
    } catch {}
    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      cpus: cpus.length,
      cpuModel: cpus[0]?.model || '',
      cpuLoad: loadAvg,
      memory: { total: totalMem, free: freeMem, used: totalMem - freeMem },
      disk,
      node: process.version
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── System Info (About) ──
app.get('/api/admin/system-info', verificarToken, soloAdmin, async (req, res) => {
  const osMod = require('os');
  let appInfo = { name: 'synnoxerp', version: '?', description: '' };
  try { const p = require('../package.json'); appInfo = { name: p.name || 'synnoxerp', version: p.version || '?', description: p.description || '' }; } catch {}
  let serverInfo = { node: process.version, platform: osMod.platform(), arch: osMod.arch(), hostname: osMod.hostname(), port: process.env.PORT || 3002, env: process.env.NODE_ENV || 'development' };
  let pgVersion = null;
  try {
    const { Pool } = require('pg');
    const pgPool = new Pool({ host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT) || 5432, database: process.env.DB_NAME || 'synnox_erp', user: process.env.DB_USER || 'synnox', password: process.env.DB_PASSWORD || '', ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 3000 });
    const r = await pgPool.query('SELECT version()');
    pgVersion = r.rows[0]?.version?.split(',')[0] || null;
    await pgPool.end();
  } catch {}
  let sqliteVersion = '?';
  try { sqliteVersion = require('better-sqlite3/package.json').version || '?'; } catch {}
  let gitInfo = null;
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000 });
    const { stdout: commit } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { timeout: 3000 });
    gitInfo = { branch: branch.trim(), commit: commit.trim() };
  } catch {}
  let modulos = [];
  try { modulos = db.prepare('SELECT id, nombre, icono, estado FROM modulos_plataforma ORDER BY orden').all(); } catch {}
  res.json({
    app: appInfo,
    server: serverInfo,
    database: { postgresql: pgVersion, sqlite: 'better-sqlite3 ' + sqliteVersion },
    company: { name: process.env.COMPANY_NAME || '', domain: process.env.COMPANY_DOMAIN || '' },
    git: gitInfo,
    modules: modulos,
    copyright: '© 2026 Edgar Velasquez — Todos los derechos reservados',
    license: 'Propietaria (LICENSE.md)'
  });
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

    // Create backup before destructive import
    const backupDir = path.join(LAUNCHER_DIR, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `pre-import-${Date.now()}.json`);
    const existingModulos = db.prepare('SELECT * FROM modulos_plataforma ORDER BY orden').all();
    const existingConfigRows = db.prepare('SELECT key, value FROM config ORDER BY key').all();
    const existingConfig = {};
    for (const r of existingConfigRows) existingConfig[r.key] = r.value;
    const existingUsuarios = db.prepare('SELECT id, nombre, email, rol, activo, creado, actualizado FROM usuarios ORDER BY id').all();
    fs.writeFileSync(backupFile, JSON.stringify({ version: 1, exported_at: new Date().toISOString(), modulos: existingModulos, config: existingConfig, usuarios: existingUsuarios }, null, 2));

    const importTransaction = db.transaction(() => {
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
    });
    importTransaction();
    res.json({ ok: true, message: `Importados ${stats.modulos} módulos, ${stats.config} configuraciones, ${stats.usuarios} usuarios. Backup: ${path.basename(backupFile)}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Backup Management (new system: scripts/backup_synnox.sh) ──
const multer = require('multer');
const BACKUP_ROOT = path.join(LAUNCHER_DIR, 'backups');
const BACKUP_SCRIPT = path.join(LAUNCHER_DIR, 'scripts', 'backup_synnox.sh');

// GET /api/admin/backup/status — último resultado del backup
app.get('/api/admin/backup/status', verificarToken, soloAdmin, (req, res) => {
  try {
    const statusFile = path.join(BACKUP_ROOT, 'status.json');
    if (!fs.existsSync(statusFile)) return res.json({ ok: false, message: 'No hay backups ejecutados aún' });
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    res.json({ ok: true, status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/backup/progress — progreso del backup en ejecución
app.get('/api/admin/backup/progress', verificarToken, soloAdmin, (req, res) => {
  try {
    const progressFile = path.join(BACKUP_ROOT, 'progress.json');
    if (!fs.existsSync(progressFile)) return res.json({ running: false });
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    const age = (Date.now() - new Date(progress.fecha).getTime()) / 1000;
    // If progress is older than 5 minutes, consider it stale
    if (age > 300) return res.json({ running: false });
    res.json({ running: true, ...progress });
  } catch (err) { res.json({ running: false }); }
});

// GET /api/admin/backup/list — lista archivos de backup en el servidor
app.get('/api/admin/backup/list', verificarToken, soloAdmin, (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_ROOT)) return res.json({ ok: true, backups: [] });
    const files = fs.readdirSync(BACKUP_ROOT)
      .filter(f => f.startsWith('synnoxerp_backup_') && f.endsWith('.tar.gz'))
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_ROOT, f));
        let sha256 = null;
        try { sha256 = fs.readFileSync(path.join(BACKUP_ROOT, f + '.sha256'), 'utf8').split(/\s+/)[0]; } catch {}
        return { nombre: f, bytes: st.size, fecha: st.mtime.toISOString(), sha256 };
      })
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ ok: true, backups: files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/backup/run — ejecuta backup_synnox.sh manualmente
app.post('/api/admin/backup/run', verificarToken, soloAdmin, (req, res) => {
  if (!fs.existsSync(BACKUP_SCRIPT)) return res.status(400).json({ error: 'Script backup_synnox.sh no encontrado' });
  // Run as the current user — script handles missing permissions gracefully (warnings)
  execFile(BACKUP_SCRIPT, { timeout: 600000, env: { ...process.env, SYNNOX_INSTALL_DIR: LAUNCHER_DIR } }, (err, stdout, stderr) => {
    // Read the status.json that the script wrote
    let status = null;
    try { status = JSON.parse(fs.readFileSync(path.join(BACKUP_ROOT, 'status.json'), 'utf8')); } catch {}
    if (err && !status) {
      return res.json({ ok: false, error: err.message, stdout: stdout?.slice(-1000), stderr: stderr?.slice(-1000) });
    }
    res.json({ ok: status?.ok ?? true, status, message: status?.ok ? 'Backup completado' : 'Backup con errores (ver warnings)' });
  });
});

// GET /api/admin/backup/download/:filename — descarga un backup
app.get('/api/admin/backup/download/:filename', verificarToken, soloAdmin, (req, res) => {
  const { filename } = req.params;
  if (!/^synnoxerp_backup_[\w\-]+\.tar\.gz$/.test(filename)) return res.status(400).json({ error: 'Nombre de archivo inválido' });
  const filepath = path.join(BACKUP_ROOT, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.download(filepath, filename);
});

// GET /api/admin/backup/history — historial de backups (últimos 30)
app.get('/api/admin/backup/history', verificarToken, soloAdmin, (req, res) => {
  try {
    const historyFile = path.join(BACKUP_ROOT, 'history.jsonl');
    if (!fs.existsSync(historyFile)) return res.json({ ok: true, history: [] });
    const lines = fs.readFileSync(historyFile, 'utf8').trim().split('\n').filter(Boolean);
    const history = lines.slice(-30).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json({ ok: true, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/backup/restore — restaura desde archivo subido (.tar.gz o .dump)
const uploadRestore = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
app.post('/api/admin/backup/restore', verificarToken, soloAdmin, uploadRestore.single('backup'), async (req, res) => {
  const tmpDir = path.join(os.tmpdir(), `synnox-restore-${Date.now()}`);
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    fs.mkdirSync(tmpDir, { recursive: true });
    let dumpPath;
    const restaurados = [];

    const isTarGz = req.file.originalname.endsWith('.tar.gz');
    const isDump = req.file.originalname.endsWith('.dump');

    if (isTarGz) {
      const tarPath = path.join(tmpDir, 'backup.tar.gz');
      fs.writeFileSync(tarPath, req.file.buffer);
      await new Promise((resolve, reject) => {
        execFile('tar', ['xzf', tarPath, '-C', tmpDir], (err) => {
          if (err) return reject(new Error('No se pudo extraer: ' + err.message));
          resolve();
        });
      });
      dumpPath = path.join(tmpDir, 'postgres', 'synnox_erp.dump');
      if (!fs.existsSync(dumpPath)) {
        return res.status(400).json({ error: 'El archivo no contiene synnox_erp.dump' });
      }

      // 1. Restore SQLite: launcher.db (contains module names, users, config)
      const launcherDbSrc = path.join(tmpDir, 'sqlite', 'launcher.db');
      const launcherDbDest = path.join(__dirname, 'launcher.db');
      if (fs.existsSync(launcherDbSrc)) {
        fs.copyFileSync(launcherDbSrc, launcherDbDest);
        // Clean WAL/SHM
        for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(launcherDbDest + ext); } catch {} }
        restaurados.push('launcher.db (módulos, usuarios, config)');
      }

      // 2. Restore SQLite: horas_extra.db (nómina)
      const horasDbSrc = path.join(tmpDir, 'sqlite', 'horas_extra.db');
      const horasDbCandidates = [
        path.join(LAUNCHER_DIR, 'horas_extra.db'),
        path.join(LAUNCHER_DIR, 'modules', 'nomina', 'horas_extra.db')
      ];
      if (fs.existsSync(horasDbSrc)) {
        const dest = horasDbCandidates.find(p => { try { fs.accessSync(path.dirname(p)); return true; } catch { return false; } }) || horasDbCandidates[0];
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(horasDbSrc, dest);
        for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(dest + ext); } catch {} }
        restaurados.push('horas_extra.db (nómina)');
      }

      // 3. Restore uploads
      const uploadsSrc = path.join(tmpDir, 'uploads.tar.gz');
      if (fs.existsSync(uploadsSrc)) {
        await new Promise((resolve) => {
          execFile('tar', ['xzf', uploadsSrc, '-C', LAUNCHER_DIR], () => resolve());
        });
        restaurados.push('uploads');
      }
    } else if (isDump) {
      dumpPath = path.join(tmpDir, 'synnox_erp.dump');
      fs.writeFileSync(dumpPath, req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Formato no soportado. Use .tar.gz o .dump' });
    }

    // Verify dump integrity
    await new Promise((resolve, reject) => {
      execFile('pg_restore', ['--list', dumpPath], (err, stdout, stderr) => {
        if (err) return reject(new Error('Archivo de dump inválido: ' + (stderr || err.message)));
        resolve();
      });
    });

    // Load .env for DB credentials
    const envPath = path.join(LAUNCHER_DIR, '..', '.env');
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }

    // Run pg_restore with --clean
    await new Promise((resolve) => {
      const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };
      execFile('pg_restore', [
        '-h', process.env.DB_HOST || '127.0.0.1',
        '-U', process.env.DB_USER || 'synnox',
        '-d', process.env.DB_NAME || 'synnox_erp',
        '--no-owner', '--no-privileges', '--clean', '--if-exists',
        dumpPath
      ], { env }, () => resolve());
    });
    restaurados.push('PostgreSQL (logistics, projects, public)');

    // Rotate JWT secret to invalidate all active sessions
    const crypto = require('crypto');
    const newSecret = crypto.randomBytes(48).toString('base64');
    const envFile = path.join(LAUNCHER_DIR, '.env');
    try {
      let envContent = fs.readFileSync(envFile, 'utf8');
      if (envContent.includes('JWT_SECRET=')) {
        envContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${newSecret}`);
      } else {
        envContent += `\nJWT_SECRET=${newSecret}\n`;
      }
      fs.writeFileSync(envFile, envContent);
      process.env.JWT_SECRET = newSecret;
      restaurados.push('JWT secret rotado (sesiones invalidadas)');
    } catch (e) {
      console.error('[Restore] Error rotando JWT_SECRET:', e.message);
    }

    // Cleanup tmp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Restart PM2 to apply SQLite changes (module names, users, etc.)
    let pm2Restarted = false;
    try {
      execFile('pm2', ['restart', 'all'], { timeout: 10000 }, () => {});
      pm2Restarted = true;
      restaurados.push('PM2 reiniciado');
    } catch {}

    res.json({
      ok: true,
      mensaje: `Restauración completada: ${restaurados.join(', ')}`,
      restaurados,
      pm2Restarted
    });
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.use('/media', express.static(path.join(__dirname, '..', 'media')));
  app.use(express.static(path.join(__dirname, 'shell'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  }));
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
