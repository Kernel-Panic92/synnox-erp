require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3002', 10);
const app = express();

// ── Shared middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health / Version ──────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    res.json({ version: pkg.version, name: pkg.name });
  } catch { res.json({ version: '1.0.0', name: 'SynnoxERP' }); }
});

// ── Module: Launcher (dashboard, auth, admin) ───────────────────
app.use('/', require('./launcher/server'));
app.use(express.static(path.join(__dirname, 'launcher', 'shell')));

// ── Module: DocFlow (facturas) ──────────────────────────────────
app.use('/docflow', require('./modules/docflow/src/server'));
app.use('/docflow', express.static(path.join(__dirname, 'modules', 'docflow', 'public')));

// ── Module: Horix (novedades) ───────────────────────────────────
app.use('/horix', require('./modules/horix/server'));
app.use('/horix', express.static(path.join(__dirname, 'modules', 'horix', 'public')));

// ── Catch-all: serve launcher SPA ──────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  const spaPath = path.join(__dirname, 'launcher', 'shell', 'index.html');
  if (fs.existsSync(spaPath)) return res.sendFile(spaPath);
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err?.message || err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Start (sync modules first, then async) ──────────────────────
async function start() {
  // Module: Logistics (ESM → import dinámico)
  try {
    const logisticsMod = await import('./modules/logistics/backend/server.js');
    app.use('/logistics', logisticsMod.default);
    app.use('/logistics', express.static(path.join(__dirname, 'modules', 'logistics', 'public')));
    console.log('   Logistics: montado en /logistics/');
  } catch (e) {
    console.error('[logistics] Error:', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SynnoxERP corriendo en puerto ${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   DocFlow:   http://localhost:${PORT}/docflow/`);
    console.log(`   Logistics: http://localhost:${PORT}/logistics/`);
    console.log(`   Horix:     http://localhost:${PORT}/horix/`);
  });
}

start().catch(err => {
  console.error('❌ Error al iniciar:', err);
  process.exit(1);
});
