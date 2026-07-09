const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const AdmZip     = require('adm-zip');
const escapeHtml = require('escape-html');

const ExcelJS   = require('exceljs');
require('dotenv').config();
const upload     = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const { db, uid } = require('./src/db');
require('./src/db/migrations')(db);
const { parseCookies, createAuth } = require('./src/middleware/auth');
const { encryptSmtp } = require('./src/utils/crypto');
const { getConfig, getAdminEmail } = require('./src/utils/config');
const { permisosPorRol, rolTienePermiso } = require('./src/utils/permisos');
const { restoreData } = require('./src/utils/restore')({ db, encryptSmtp });

const APP_NAME     = process.env.APP_NAME || 'Nómina';
const BASE_URL     = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const enviarCorreo = require('./src/utils/email')({ getConfig, nodemailer, escapeHtml, BASE_URL, APP_NAME });
const PORT         = parseInt(process.env.PORT || '3000', 10);
const CORS_ORIGIN  = process.env.CORS_ORIGIN || '';
const BACKUP_TOKEN = process.env.BACKUP_TOKEN || '';
const app = express();
app.use((req, res, next) => { console.log(`[nomina] ${req.method} ${req.path}`); next(); });
app.set('trust proxy', 1);

// CORS — restringir en producción
if (CORS_ORIGIN) {
  const origins = CORS_ORIGIN.split(',').map(s => s.trim());
  app.use(cors({ origin: origins, credentials: true }));
} else {
  if (process.env.NODE_ENV === 'production') console.warn('⚠ CORS_ORIGIN no configurado — todas las orígenes permitidas');
  app.use(cors());
}
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));

// CSP con nonce — reemplaza la directiva que helmet hubiera puesto
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64url');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + res.locals.nonce + "' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "script-src-attr 'unsafe-inline'",
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

// HTTPS redirect en producción (confía en proxy como nginx/caddy)
const ENFORCE_HTTPS = process.env.ENFORCE_HTTPS === 'true';
app.use((req, res, next) => {
  if (ENFORCE_HTTPS && req.protocol !== 'https') {
    const host = BASE_URL.replace(/^https?:\/\//, '');
    return res.redirect(301, 'https://' + host + req.originalUrl);
  }
  next();
});

app.use(express.json());

// Favicon — evitar 404 en telemetría
app.get('/favicon.ico', (req, res) => res.status(204).end());

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const htmlCache = new Map();
function getHtmlCached(relPath) {
  const abs = path.resolve(PUBLIC_DIR, relPath.replace(/^\/+/, ''));
  const rel = path.relative(PUBLIC_DIR, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (htmlCache.size > 20) htmlCache.delete(htmlCache.keys().next().value);
  if (!fs.existsSync(abs)) return null;
  const st = fs.statSync(abs);
  const cached = htmlCache.get(abs);
  if (cached && cached.mtime === st.mtimeMs) return cached.html;
  const html = fs.readFileSync(abs, 'utf8');
  htmlCache.set(abs, { html, mtime: st.mtimeMs });
  return html;
}
// Interceptar .html (y /) para inyectar nonce CSP — debe ir antes del static
app.get(['/', '/index.html', '/*.html'], (req, res) => {
  const relPath = req.path === '/' ? 'index.html' : req.path;
  const html = getHtmlCached(relPath);
  if (!html) return res.status(404).send('Not found');
  res.type('html')
    .set('Cache-Control', 'no-cache, must-revalidate')
    .set('Pragma', 'no-cache')
    .send(html.replace(/__NONCE__/g, res.locals.nonce));
});
app.use(express.static('public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
    }
  }
}));

// Global Rate Limiting — 1000 req / 15 min por IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' }
});
app.use('/api', globalLimiter);

const APP_VER = require('./package.json').version;
app.get('/api/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({ version: pkg.version, name: pkg.name });
});



// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
// Seeds (tipos, permisos, roles, centros)
const boot = (async () => {
  await require('./src/db/seeds')({ db, uid, encryptSmtp, BASE_URL, APP_NAME });
})().catch(e => console.error('[nomina] Error en seeds:', e.message));

const { soloAdmin, adminRrhh, adminRrhhOp, podeAprobar, podeEditar, todosRoles, soloAdminOBkp, autenticar, requierePermiso, requireModule } = createAuth({
  BACKUP_TOKEN,
  enviarCorreo,
  getConfig
});

// ─── Auth global: verify JWT + check module access for all /api routes ──────
app.use('/api', autenticar([]));
app.use('/api', requireModule('nomina'));

app.use('/api/auth', require('./src/routes/auth')({
  db, crypto, middlewares: { todosRoles, soloAdmin }
}));

app.use('/api', require('./src/routes/misc')({ db, fs, path, __dirname, permisosPorRol, middlewares: { todosRoles } }));
app.use('/api/admin', require('./src/routes/auditoria')({ db, middlewares: { soloAdmin } }));

// ─────────────────────────────────────────────
// CONFIGURACIÓN SMTP (solo admin)
// ─────────────────────────────────────────────
app.use('/api/configuracion', require('./src/routes/configuracion')({ db, getConfig, encryptSmtp, enviarCorreo, middlewares: { soloAdmin } }));

// ─────────────────────────────────────────────
// CENTROS DE OPERACIÓN
// ─────────────────────────────────────────────
app.use('/api/centros', require('./src/routes/centros')({ db, uid, middlewares: { todosRoles, adminRrhh, soloAdmin } }));

app.use('/api/tipos', require('./src/routes/tipos')({ db, middlewares: { todosRoles, autenticar, requierePermiso } }));

// ─────────────────────────────────────────────
// PERMISOS CONFIGURABLES
// ─────────────────────────────────────────────
app.use('/api/roles', require('./src/routes/roles')({ db, middlewares: { adminRrhh, soloAdmin } }));
app.use('/api/permisos', require('./src/routes/permisos')({ db, middlewares: { soloAdmin } }));

app.use('/api/empleados', require('./src/routes/empleados')({ db, uid, upload, middlewares: { todosRoles, adminRrhh, soloAdmin } }));

// ─────────────────────────────────────────────
// NÓMINAS
// ─────────────────────────────────────────────
app.use('/api/nominas', require('./src/routes/nominas')({ db, uid, middlewares: { todosRoles, adminRrhh, soloAdmin } }));

// ─────────────────────────────────────────────
// REGISTROS
// ─────────────────────────────────────────────
app.use('/api/registros', require('./src/routes/registros')({
  db, uid, BASE_URL, getConfig, enviarCorreo, rolTienePermiso,
  middlewares: { todosRoles, adminRrhh, adminRrhhOp, podeEditar, podeAprobar, autenticar, requierePermiso }
}));

app.use('/api', require('./src/routes/dashboard')({ db, middlewares: { todosRoles } }));

// ─────────────────────────────────────────────
app.use('/api/backup', require('./src/routes/backup')({ db, AdmZip, fs, path, __dirname, encryptSmtp, getConfig, getAdminEmail, enviarCorreo, restoreData, middlewares: { soloAdminOBkp, soloAdmin } }));
app.use('/api/restore', require('./src/routes/backup').createRestoreRouter({ db, AdmZip, encryptSmtp, restoreData, middlewares: { soloAdmin } }));

app.use('/api', require('./src/routes/adjuntos')({ db, uid, rolTienePermiso, middlewares: { todosRoles, adminRrhhOp, podeEditar, autenticar, requierePermiso } }));
app.use('/api', require('./src/routes/exportar')({ db, ExcelJS, getConfig, enviarCorreo, rolTienePermiso, middlewares: { autenticar, requierePermiso, todosRoles } }));
app.use('/api', require('./src/routes/telemetry')({ db, parseCookies, middlewares: { soloAdmin } }));

// ─────────────────────────────────────────────
// CONSULTA — endpoint REST para chat web/móvil
// ─────────────────────────────────────────────
app.use('/api', require('./src/routes/consulta')({ db }));

// ─────────────────────────────────────────────
// MCP — Model Context Protocol (para LLMs)
// ─────────────────────────────────────────────
const mcp = require('./src/mcp/index');
app.use('/.well-known', mcp.createWellKnown());
app.use('/mcp/oauth', mcp.createOAuthRouter());
app.use('/mcp', mcp.createMiddleware());
// Fallback: Claude ignora registration_endpoint y llama a /register
app.use('/register', express.json(), mcp.createRegistrationFallback());
// Fallback: Claude ignora authorization_endpoint y construye /authorize en la raíz
app.use('/authorize', mcp.createAuthorizeFallback());
// Fallback: Claude ignora token_endpoint y construye /token en la raíz
app.use('/token', express.urlencoded({ extended: false }), mcp.createTokenFallback());
// Test endpoint para verificar que el servidor recibe requests nuevas
app.get('/mcp-test', (req, res) => res.send('MCP OK ' + Date.now()));

const logErrorTelemetry = db.prepare('INSERT INTO telemetria (evento, pagina, usuarioId, datos, creado) VALUES (?,?,?,?,?)');
// Error handler global — siempre responde JSON y registra en telemetría
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err?.message || err);
  try {
    logErrorTelemetry.run('error_backend', req.path || '', req.usuario?.id || '', JSON.stringify({ msg: err?.message }), new Date().toISOString());
  } catch (e2) { console.error('Error logging to telemetry:', e2.message); }
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;

if (require.main === module) {
  boot.then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Servidor corriendo en http://0.0.0.0:${PORT}`);
    });
  }).catch(err => {
    console.error('Error durante la inicialización:', err);
    process.exit(1);
  });
}
