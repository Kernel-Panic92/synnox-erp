require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const PORT = parseInt(process.env.PORT || '3002', 10);
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false, trustProxy: true, message: { error: 'Demasiadas solicitudes' } });

app.use('/api', globalLimiter);

app.get('/api/health', publicLimiter, (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    res.json({ version: pkg.version, name: pkg.name });
  } catch { res.json({ version: '1.0.0', name: 'SynnoxERP' }); }
});

// ── Mount modules ──
app.use('/', require('./launcher/server'));
app.use(express.static(path.join(__dirname, 'launcher', 'shell')));
app.use('/media', express.static(path.join(__dirname, 'media')));

app.use('/proveedores', require('./modules/proveedores/src/server'));
app.use('/proveedores', express.static(path.join(__dirname, 'modules', 'proveedores', 'public')));

app.use('/nomina', require('./modules/nomina/server'));
app.use('/nomina', express.static(path.join(__dirname, 'modules', 'nomina', 'public')));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err?.message || err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

async function start() {
  try {
    const mod = await import('./modules/logistica/backend/server.js');
    app.use('/logistica', mod.default);
    console.log('   Logística: montado en /logistica/');
  } catch (e) { console.error('[logistica] Error:', e.message); }
  // Static files always served regardless of module load success
  app.use('/logistica', express.static(path.join(__dirname, 'modules', 'logistica', 'public')));

  app.get('*', publicLimiter, (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const spaPath = path.join(__dirname, 'launcher', 'shell', 'index.html');
    if (fs.existsSync(spaPath)) return res.sendFile(spaPath);
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SynnoxERP corriendo en puerto ${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   Proveedores: http://localhost:${PORT}/proveedores/`);
    console.log(`   Logística: http://localhost:${PORT}/logistica/`);
    console.log(`   Nómina:    http://localhost:${PORT}/nomina/`);
  });
}

start().catch(err => {
  console.error('❌ Error al iniciar:', err);
  process.exit(1);
});
