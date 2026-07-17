require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cookieParser = require('cookie-parser');
const fs      = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const MODULE_ID = process.env.MODULE_ID || 'proveedores';

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos de autenticación' } });

// ─── Middlewares globales ─────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.CORS_ORIGIN || false
    : true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { authMiddleware, verificarSesionValida, requireModule } = require('./middleware/auth');

// ─── Rutas API ────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter);
// Auth global: verify JWT + check module access for all /api routes
app.use('/api', authMiddleware);
app.use('/api', apiLimiter);
app.use('/api', requireModule('proveedores'));
app.use('/api', verificarSesionValida);

app.use('/api/areas',       require('./routes/areas'));
app.use('/api/categorias',  require('./routes/categorias'));
app.use('/api/facturas',    require('./routes/facturas'));
app.use('/api/proveedores', require('./routes/proveedores'));
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/backup',         require('./routes/backup'));
app.use('/api/sync',           require('./routes/sync'));
app.use('/api/configuracion',  require('./routes/configuracion'));
app.use('/api/audit',          require('./routes/audit'));
app.use('/api/centros',        require('./routes/centros'));
// Auth routes (cambiar-password, forgot, reset — protected by authMiddleware internally)
app.use('/api/auth',        require('./routes/auth'));

// ─── MCP ──────────────────────────────────────────────────────────────────────
const mcp = require('./mcp');
app.use('/mcp', mcp.createMiddleware());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: process.env.COMPANY_NAME || 'SynnoxERP',
    version: '1.0.0',
    env: process.env.NODE_ENV,
    ts: new Date().toISOString(),
  });
});

// ─── Archivos estáticos (frontend) ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

app.get('/app.js', (req, res) => {
  const file = path.join(__dirname, '../public/app.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(file);
});

// ─── Endpoint de versión ───────────────────────────────────────────────────────
const GIT_DIR = path.join(__dirname, '..', '.git');

function readBranch() {
  try {
    const head = fs.readFileSync(path.join(GIT_DIR, 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : head;
  } catch { return ''; }
}

function readRepoUrl() {
  try {
    const cfg = fs.readFileSync(path.join(GIT_DIR, 'config'), 'utf8');
    const m = cfg.match(/\[remote\s+"origin"\].*?\n\s*url\s*=\s*(.+?)\s*[\r\n]/s);
    if (!m) return '';
    return m[1].replace(/\.git$/, '').replace(/^git@/, 'https://').replace(/:(\w)/, '/$1');
  } catch { return ''; }
}

app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const year = new Date().getFullYear().toString();
    const author = pkg.author || '';
    const displayAuthor = author.includes(year) ? author : `© ${year} - ${author}`;
    const branch = readBranch();
    const repo = readRepoUrl();

    res.json({
      version: pkg.version || '1.0.0',
      name: pkg.name,
      author: displayAuthor,
      year,
      branch: branch || 'main',
      repo
    });
  } catch (e) {
    console.error('[version]', e.message);
    res.json({ version: '1.0.0', name: 'synnoxerp-proveedores', author: '', year: new Date().getFullYear().toString(), branch: 'main', repo: '' });
  }
});

// ─── Error handler global ─────────────────────────────────────────────────────
// Maneja todos los errores no capturados - oculta detalles en producción
app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[Error]', isProd ? err.message : err.stack);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Archivo demasiado grande (máximo ${process.env.MAX_FILE_MB || 10}MB)` });
  }
  
  if (err.name === 'MulterError' || (err.message && (err.message.startsWith('Tipo de archivo') || err.message.startsWith('Solo se permiten')))) {
    return res.status(400).json({ error: err.message });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  
  res.status(500).json({ error: isProd ? 'Error interno del servidor' : err.message });
});

const PORT = parseInt(process.env.PORT || '3100');

// ─── Migraciones (siempre, incluso al ser importado) ──────────────────────────
require('./db/migrate')().catch(err => console.error('[proveedores] Migración fallida:', err.message));

// ─── Arranque standalone ─────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║   Proveedores  —  puerto ${PORT.toString().padEnd(5)}       ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`  API:   http://localhost:${PORT}/api`);
    console.log(`  App:   http://localhost:${PORT}`);
    console.log(`  Env:   ${process.env.NODE_ENV || 'development'}\n`);

    if (process.env.NODE_ENV !== 'test') {
      const { iniciarServicioImap } = require('./services/imap.service');
      // IMAP auto-poll cada N minutos (configurable via IMAP_POLL_MINUTES, default 15)
      if (process.env.IMAP_IN_PROCESS !== 'false') {
        process.env.IMAP_POLL_MINUTES = process.env.IMAP_POLL_MINUTES || '15';
        iniciarServicioImap();
      }
    }
  });
  })().catch(err => {
    console.error('\n  ERROR al iniciar:', err.message);
    process.exit(1);
  });
}

module.exports = app;
