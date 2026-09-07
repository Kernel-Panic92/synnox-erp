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
    const { desde, hasta } = req.query;
    const opFiltro = [];
    const cliFiltro = [];
    const params = [];
    let pi = 1;
    if (desde) { opFiltro.push(`o.creado_en >= $${pi}::date`); cliFiltro.push(`creado_en >= $${pi}::date`); params.push(desde); pi++; }
    if (hasta) { opFiltro.push(`o.creado_en < $${pi}::date + INTERVAL '1 day'`); cliFiltro.push(`creado_en < $${pi}::date + INTERVAL '1 day'`); params.push(hasta); pi++; }
    const opWhere = opFiltro.length ? `WHERE ${opFiltro.join(' AND ')}` : '';
    const cliWhere = cliFiltro.length ? `WHERE ${cliFiltro.join(' AND ')} AND activo = TRUE` : 'WHERE activo = TRUE';
    const opWhereVendedor = opFiltro.length ? `WHERE ${opFiltro.join(' AND ')} AND o.vendedor_id IS NOT NULL` : 'WHERE o.vendedor_id IS NOT NULL';

    const tendDesde = desde || `TO_CHAR(NOW() - INTERVAL '5 months','YYYY-MM-01')`;
    const tendHasta = hasta || `TO_CHAR(NOW(),'YYYY-MM-01')`;

    const [funnelEtapas, rankingVendedores, tendenciaMensual, distribucionCiudades] = await Promise.all([
      pool.query(`SELECT etapa, COUNT(*) as cantidad, COALESCE(SUM(monto_esperado),0) as monto FROM crm.oportunidades o ${opWhere} GROUP BY etapa ORDER BY CASE etapa WHEN 'lead' THEN 1 WHEN 'calificado' THEN 2 WHEN 'propuesta' THEN 3 WHEN 'negociacion' THEN 4 WHEN 'ganada' THEN 5 WHEN 'perdida' THEN 6 END`, params),
      pool.query(`SELECT o.vendedor_id, COUNT(*) FILTER (WHERE o.etapa NOT IN ('ganada','perdida')) as ops_abiertas, COUNT(*) FILTER (WHERE o.etapa='ganada') as ops_ganadas, COALESCE(SUM(o.monto_esperado) FILTER (WHERE o.etapa='ganada'),0) as monto_ganado FROM crm.oportunidades o ${opWhereVendedor} GROUP BY o.vendedor_id HAVING COUNT(*) > 0 ORDER BY monto_ganado DESC, ops_abiertas DESC LIMIT 10`, params),
      pool.query(`SELECT TO_CHAR(mes,'YYYY-MM') as mes, COUNT(o.id) as cantidad, COALESCE(SUM(o.monto_esperado),0) as monto
        FROM generate_series(${tendDesde}::date, ${tendHasta}::date, INTERVAL '1 month') mes
        LEFT JOIN crm.oportunidades o ON DATE_TRUNC('month', o.creado_en) = DATE_TRUNC('month', mes)
        GROUP BY mes ORDER BY mes`),
      pool.query(`SELECT COALESCE(ciudad,'Sin ciudad') as ciudad, COUNT(*) as cantidad FROM crm.clientes ${cliWhere} GROUP BY ciudad ORDER BY cantidad DESC LIMIT 8`, params)
    ]);

    res.json({
      ok: true,
      funnel: funnelEtapas.rows,
      ranking_vendedores: rankingVendedores.rows,
      tendencia_mensual: tendenciaMensual.rows,
      distribucion_ciudades: distribucionCiudades.rows,
      desde: desde || null,
      hasta: hasta || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/analytics — Indicadores gerenciales avanzados
app.get('/api/dashboard/analytics', protect, async (req, res) => {
  try {
    const pool = (await import('./config/db.js')).default;
    const { desde, hasta } = req.query;
    const conds = [];
    const params = [];
    let pi = 1;
    if (desde) { conds.push(`o.creado_en >= $${pi}::date`); params.push(desde); pi++; }
    if (hasta) { conds.push(`o.creado_en < $${pi}::date + INTERVAL '1 day'`); params.push(hasta); pi++; }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const addCond = (sql) => conds.length ? `${conds.join(' AND ')} AND ${sql}` : `WHERE ${sql}`;

    const [acv, lossReason, repeatPurchase, velocity, pipelineTotal] = await Promise.all([
      // ACV: monto promedio por negocio ganado
      pool.query(`SELECT COUNT(*) as n, COALESCE(AVG(monto_esperado),0) as acv, COALESCE(SUM(monto_esperado),0) as total FROM crm.oportunidades o ${addCond(`o.etapa='ganada'`)}`, params),
      // Pérdida por causal (% de cada motivo dentro de PERDIDA)
      pool.query(`SELECT COALESCE(NULLIF(motivo_perdida,''),'sin_motivo') as motivo, COUNT(*) as total, 100.0*COUNT(*)/NULLIF(SUM(COUNT(*)) OVER (),0) as pct FROM crm.oportunidades o ${addCond(`o.etapa='perdida'`)} GROUP BY motivo ORDER BY total DESC`, params),
      // Repeat purchase: ganadas de clientes con >1 oportunidad ganada vs clientes nuevos
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE o.cliente_id IS NOT NULL AND (SELECT COUNT(*) FROM crm.oportunidades o2 WHERE o2.cliente_id=o.cliente_id AND o2.etapa='ganada' AND o2.id < o.id)=0) as nuevos,
        COUNT(*) FILTER (WHERE o.cliente_id IS NOT NULL AND (SELECT COUNT(*) FROM crm.oportunidades o2 WHERE o2.cliente_id=o.cliente_id AND o2.etapa='ganada' AND o2.id < o.id)>0) as recurrentes
        FROM crm.oportunidades o ${addCond(`o.etapa='ganada' AND o.cliente_id IS NOT NULL`)}`, params),
      // Stage velocity: días promedio entre cambios de etapa del historial
      pool.query(`SELECT h.etapa_nueva, ROUND(AVG(EXTRACT(EPOCH FROM (h.fecha - lag.fecha))/86400.0),1) as dias_promedio, COUNT(*) as muestras
        FROM crm.oportunidad_historial h
        JOIN LATERAL (SELECT MAX(fecha) as fecha FROM crm.oportunidad_historial h2 WHERE h2.oportunidad_id=h.oportunidad_id AND h2.fecha < h.fecha) lag ON true
        WHERE lag.fecha IS NOT NULL
        GROUP BY h.etapa_nueva ORDER BY MIN(h.fecha)`),
      // Pipeline abierto total (para cobertura vs meta)
      pool.query(`SELECT COALESCE(SUM(monto_esperado),0) as pipeline_abierto FROM crm.oportunidades o ${addCond(`o.etapa NOT IN ('ganada','perdida')`)}`, params)
    ]);

    res.json({
      ok: true,
      acv: { n: parseInt(acv.rows[0].n), promedio: parseFloat(acv.rows[0].acv), total: parseFloat(acv.rows[0].total) },
      loss_reason: lossReason.rows,
      repeat_purchase: {
        nuevos: parseInt(repeatPurchase.rows[0].nuevos) || 0,
        recurrentes: parseInt(repeatPurchase.rows[0].recurrentes) || 0
      },
      stage_velocity: velocity.rows,
      pipeline_abierto: parseFloat(pipelineTotal.rows[0].pipeline_abierto),
      desde: desde || null,
      hasta: hasta || null
    });
  } catch (err) {
    console.error('[CRM] Error dashboard analytics:', err);
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
