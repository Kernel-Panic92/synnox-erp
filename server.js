require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const PORT = parseInt(process.env.PORT || '3002', 10);
const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

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

  try {
    const modProy = await import('./modules/proyectos/backend/server.js');
    app.use('/proyectos', modProy.default);
    console.log('   Proyectos: montado en /proyectos/');
  } catch (e) { console.error('[proyectos] Error:', e.message); }
  app.use('/proyectos', express.static(path.join(__dirname, 'modules', 'proyectos', 'public')));

  try {
    const modCrm = await import('./modules/crm/backend/server.js');
    app.use('/crm', modCrm.default);
    console.log('   CRM: montado en /crm/');
  } catch (e) { console.error('[crm] Error:', e.message); }
  app.use('/crm', express.static(path.join(__dirname, 'modules', 'crm', 'public')));

  // SPA catch-all — MUST be after all module mounts
  app.get('*', publicLimiter, (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    // Don't catch module paths — let their static middleware serve files
    if (req.path.startsWith('/nomina') || req.path.startsWith('/proveedores') || req.path.startsWith('/logistica') || req.path.startsWith('/proyectos') || req.path.startsWith('/crm')) {
      return res.status(404).json({ error: 'Not found' });
    }
    const spaPath = path.join(__dirname, 'launcher', 'shell', 'index.html');
    if (fs.existsSync(spaPath)) return res.sendFile(spaPath);
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`✅ SynnoxERP corriendo en puerto ${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   Proveedores: http://localhost:${PORT}/proveedores/`);
    console.log(`   Logística: http://localhost:${PORT}/logistica/`);
    console.log(`   Nómina:    http://localhost:${PORT}/nomina/`);
    console.log(`   Proyectos: http://localhost:${PORT}/proyectos/`);
    console.log(`   CRM:       http://localhost:${PORT}/crm/`);

    // Warmup: pre-load databases and modules to avoid cold start on first request
    console.log('🔥 Calentando servicios...');
    const Database = require('better-sqlite3');
    try {
      const warmupDb = new Database('./launcher/launcher.db', { readonly: true });
      warmupDb.prepare('SELECT COUNT(*) FROM usuarios').get();
      warmupDb.prepare('SELECT COUNT(*) FROM modulos_plataforma').get();
      warmupDb.close();
      console.log('   ✅ SQLite launcher.db');
    } catch (e) { console.warn('   ⚠️ SQLite:', e.message); }

    try {
      const nominaDb = new Database('./modules/nomina/horas_extra.db', { readonly: true });
      nominaDb.prepare('SELECT COUNT(*) FROM usuarios').get();
      nominaDb.prepare('SELECT COUNT(*) FROM empleados').get();
      nominaDb.close();
      console.log('   ✅ SQLite horas_extra.db');
    } catch (e) { console.warn('   ⚠️ SQLite nómina:', e.message); }

    try {
      await import('./modules/logistica/backend/server.js');
      console.log('   ✅ Módulo Logística');
    } catch (e) { console.warn('   ⚠️ Logística:', e.message); }

    try {
      await import('./modules/proyectos/backend/server.js');
      console.log('   ✅ Módulo Proyectos');
    } catch (e) { console.warn('   ⚠️ Proyectos:', e.message); }

    console.log('🔥 Warmup completado');
  });
}

start().catch(err => {
  console.error('❌ Error al iniciar:', err);
  process.exit(1);
});
