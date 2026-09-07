import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });
dotenv.config();

const { createProtect } = await import('../../../framework/auth.mjs');
const app = express();
const PORT = process.env.PORT || 3008;
const MODULE_ID = process.env.MODULE_ID || 'crm';

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/api', apiLimiter);

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) console.log(`[crm] ${req.method} ${req.path} — auth: ${!!req.headers.authorization}`);
  next();
});

import clientesRoutes from './routes/clientes.js';
import contactosRoutes from './routes/contactos.js';
import oportunidadesRoutes from './routes/oportunidades.js';
import visitasRoutes from './routes/visitas.js';
import cotizacionesRoutes from './routes/cotizaciones.js';
import descuentosRoutes from './routes/descuentos.js';
import productosRoutes from './routes/productos.js';
import importarRoutes from './routes/importar.js';
import sucursalesRoutes from './routes/sucursales.js';
import eanRoutes from './routes/ean.js';
import inventarioRoutes from './routes/inventario.js';
import leadsRoutes from './routes/leads.js';
import perfilesVentaRoutes from './routes/perfilesVenta.js';
import maestrosRoutes from './routes/maestros.js';
import hubRoutes from './routes/hub.js';
import placesRoutes from './routes/places.js';

const protect = createProtect(MODULE_ID);

app.use('/api/clientes', protect, clientesRoutes);
app.use('/api/contactos', protect, contactosRoutes);
app.use('/api/oportunidades', protect, oportunidadesRoutes);
app.use('/api/visitas', protect, visitasRoutes);
app.use('/api/cotizaciones', protect, cotizacionesRoutes);
app.use('/api/descuentos', protect, descuentosRoutes);
app.use('/api/productos', protect, productosRoutes);
app.use('/api/importar', protect, importarRoutes);
app.use('/api/clientes', protect, sucursalesRoutes);
app.use('/api/sucursales', protect, sucursalesRoutes);
app.use('/api/productos', protect, eanRoutes);
app.use('/api/inventario', protect, inventarioRoutes);
app.use('/api/leads', protect, leadsRoutes);
app.use('/api/perfiles-venta', protect, perfilesVentaRoutes);
app.use('/api/maestros', protect, maestrosRoutes);
app.use('/api/hub', protect, hubRoutes);
app.use('/api/places', protect, placesRoutes);

// Public endpoint for centros
app.get('/api/centros', (req, res) => {
  res.json(globalThis.__centrosCache || []);
});

app.get('/api/auth/me', protect, async (req, res) => {
  try {
    const Database = (await import('better-sqlite3')).default;
    const pathMod = (await import('path')).default;
    const { fileURLToPath } = await import('url');
    const __dirname = pathMod.dirname(fileURLToPath(import.meta.url));
    const dbPath = pathMod.join(__dirname, '..', '..', '..', 'launcher', 'launcher.db');
    const ldb = new Database(dbPath, { readonly: true });
    const row = ldb.prepare(`
      SELECT u.id, u.nombre, u.email, u.rol, u.perfil_id, u.sede,
             p.nombre as perfil_nombre
      FROM usuarios u
      LEFT JOIN perfiles p ON u.perfil_id = p.id
      WHERE u.id = ?
    `).get(req.user.id);
    ldb.close();
    if (!row) return res.status(404).json({ error: 'Usuario no encontrado' });
    const modulos_permisos = req.user.modulos_permisos || {};
    res.json({ ...row, modulos_permisos });
  } catch {
    const { modulos_permisos, ...rest } = req.user;
    res.json({ ...rest, modulos_permisos: modulos_permisos || {} });
  }
});

app.get('/api/dashboard', protect, async (req, res) => {
  try {
    const pool = (await import('./config/db.js')).default;

    const [totalClientes, porTipo, contactosRecientes, clientesRecientes, totalOportunidades, oportunidadesAbiertas, montoPipeline, cotizacionesPendientes, descuentosPendientes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM crm.clientes WHERE activo = TRUE`),
      pool.query(`SELECT tipo, COUNT(*) AS total FROM crm.clientes WHERE activo = TRUE GROUP BY tipo ORDER BY total DESC`),
      pool.query(`SELECT COUNT(*) FROM crm.contactos WHERE activo = TRUE`),
      pool.query(`SELECT id, nombre, tipo, ciudad, creado_en FROM crm.clientes WHERE activo = TRUE ORDER BY creado_en DESC LIMIT 10`),
      pool.query(`SELECT COUNT(*) FROM crm.oportunidades`),
      pool.query(`SELECT COUNT(*) FROM crm.oportunidades WHERE etapa NOT IN ('ganada', 'perdida')`),
      pool.query(`SELECT COALESCE(SUM(monto_esperado), 0) AS total FROM crm.oportunidades WHERE etapa NOT IN ('ganada', 'perdida')`),
      pool.query(`SELECT COUNT(*) FROM crm.cotizaciones WHERE estado IN ('borrador','enviada')`),
      pool.query(`SELECT COUNT(*) FROM crm.descuentos_solicitud WHERE estado = 'pendiente'`)
    ]);

    res.json({
      ok: true,
      clientes_total: parseInt(totalClientes.rows[0].count),
      clientes_por_tipo: porTipo.rows,
      contactos_total: parseInt(contactosRecientes.rows[0].count),
      clientes_recientes: clientesRecientes.rows,
      oportunidades_total: parseInt(totalOportunidades.rows[0].count),
      oportunidades_abiertas: parseInt(oportunidadesAbiertas.rows[0].count),
      monto_pipeline: parseFloat(montoPipeline.rows[0].total),
      cotizaciones_pendientes: parseInt(cotizacionesPendientes.rows[0].count),
      descuentos_pendientes: parseInt(descuentosPendientes.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ status: 'ok', module: MODULE_ID }));

app.get('/api/version', (req, res) => {
  try {
    const rootPkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    res.json({ version: rootPkg.version || '1.0.0', nombre: 'SynnoxERP CRM' });
  } catch {
    res.json({ version: '1.0.0', nombre: 'SynnoxERP CRM' });
  }
});

import { createMiddleware } from './mcp/index.js';
app.use('/mcp', createMiddleware());

import { configureAudit, startAuditRetentionJob } from '../../../framework/audit.js';
import pool from './config/db.js';
configureAudit(pool, {
  maskIp: process.env.AUDIT_MASK_IP === 'true',
  integritySecret: process.env.AUDIT_INTEGRITY_SECRET
});
startAuditRetentionJob(pool);

// Run migrations on startup
async function runMigrations() {
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }
    console.log('[crm] Migraciones ejecutadas');
  } catch (err) {
    console.error('[crm] Error en migraciones:', err.message);
  }

  // Sync centros de operación del launcher (fuente única) al espejo CRM
  try {
    const centros = globalThis.__centrosCache || [];
    if (centros.length) {
      for (const c of centros) {
        await pool.query(`INSERT INTO crm.centros_operacion (codigo, nombre, activo) VALUES ($1,$2,TRUE)
          ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE`, [c.codigo || String(c.id), c.nombre]);
      }
    }
  } catch (e) { console.error('[crm] Error sync centros:', e.message); }
}
runMigrations();

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use((err, req, res, next) => {
  console.error('Error:', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProd ? 'Error interno del servidor' : (err.message || 'Error interno del servidor') });
});

export default app;
