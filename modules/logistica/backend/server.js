import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import pool from './config/db.js';
import { verifyToken, verifySession, requireModule, requirePermiso, createProtect } from '../../../framework/auth.mjs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3004;
const MODULE_ID = process.env.MODULE_ID || 'logistica';

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/api', apiLimiter);

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) console.log(`[logistica] ${req.method} ${req.path} — auth: ${!!req.headers.authorization}`);
  next();
});

import vehiculosRoutes from './routes/vehiculos.js';
import pedidosRoutes from './routes/pedidos.js';
import rutasRoutes from './routes/rutas.js';
import importadoresRoutes from './routes/importadores.js';
import healthRoutes from './routes/health.js';
import configRoutes from './routes/configuracion.js';
import backupRoutes from './routes/backup.js';
import auditoriaRoutes from './routes/auditoria.js';
import clientesRoutes from './routes/clientes.js';
import rutasPdfRoutes from './routes/rutas-pdf.js';
import reportesRoutes from './routes/reportes.js';
import widetechRoutes from './routes/widetech.js';
import widetechSyncRoutes from './routes/widetech-sync.js';
import geocercasRoutes from './routes/geocercas.js';
import devolucionesRoutes from './routes/devoluciones.js';

const protect = createProtect(MODULE_ID);

app.get('/api/dashboard/resumen', protect, async (req, res) => {
  try {
    const pool = (await import('./config/db.js')).default;
    const [pedidosHoy, enRuta, entregados] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM logistics.pedidos_logistica WHERE DATE(created_at) = CURRENT_DATE`),
      pool.query(`SELECT COUNT(*) as count FROM logistics.rutas WHERE estado = 'en_ejecucion'`),
      pool.query(`SELECT COUNT(*) as count FROM logistics.pedidos_logistica WHERE estado = 'entregado'`)
    ]);
    res.json({
      pedidosHoy: parseInt(pedidosHoy.rows[0]?.count || 0),
      enRuta: parseInt(enRuta.rows[0]?.count || 0),
      entregados: parseInt(entregados.rows[0]?.count || 0)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use('/api/health', healthRoutes);
app.get('/api/rutas/diagnostico', protect, async (req, res) => {
  try {
    const pool = (await import('./config/db.js')).default;
    const pedidosPendientesSinRuta = await pool.query(`SELECT id, numero_factura, latitud, longitud FROM logistics.pedidos_logistica WHERE estado='pendiente' AND ruta_id IS NULL`);
    const pedidosConCoords = await pool.query(`SELECT id, numero_factura FROM logistics.pedidos_logistica WHERE estado='pendiente' AND ruta_id IS NULL AND latitud IS NOT NULL AND longitud IS NOT NULL`);
    const vehiculosDisponibles = await pool.query(`SELECT id, placa, estado, ultima_posicion_lat, ultima_posicion_lng FROM logistics.vehiculos WHERE estado='disponible'`);
    res.json({
      pedidos_pendientes_sin_ruta: pedidosPendientesSinRuta.rows,
      pedidos_pendientes_con_coords: pedidosConCoords.rows,
      vehiculos_disponibles: vehiculosDisponibles.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use('/api/vehiculos', protect, vehiculosRoutes);
app.use('/api/pedidos', protect, pedidosRoutes);
app.use('/api/rutas', protect, rutasRoutes);
app.use('/api/importadores', protect, importadoresRoutes);
app.use('/api/configuracion', [verifyToken, requireModule(MODULE_ID), requirePermiso('configurar', MODULE_ID)], configRoutes);
app.use('/api/backup', protect, backupRoutes);
app.use('/api/auditoria', protect, auditoriaRoutes);
app.use('/api/clientes', protect, clientesRoutes);
// Public endpoint for centros (read from launcher via globalThis shared store)
app.get('/api/centros', (req, res) => {
  res.json(globalThis.__centrosCache || []);
});
app.use('/api/rutas-pdf', protect, rutasPdfRoutes);
app.use('/api/reportes', protect, reportesRoutes);
app.use('/api/widetech', [verifyToken, requireModule(MODULE_ID), requirePermiso('configurar', MODULE_ID)], widetechRoutes);
app.use('/api/widetech-sync', protect, widetechSyncRoutes);
app.use('/api/geocercas', protect, geocercasRoutes);
app.use('/api/devoluciones', protect, devolucionesRoutes);

// GET /api/auth/me — verify JWT, session and module access
app.get('/api/auth/me', protect, async (req, res) => {
  try {
    // Read fresh user data from launcher.db
    let freshUser = null;
    try {
      const Database = (await import('better-sqlite3')).default;
      const pathMod = (await import('path')).default;
      const { fileURLToPath } = await import('url');
      const __dirname = pathMod.dirname(fileURLToPath(import.meta.url));
      const dbPath = pathMod.join(__dirname, '..', '..', '..', 'launcher', 'launcher.db');
      const ldb = new Database(dbPath, { readonly: true });
      freshUser = ldb.prepare(`
        SELECT u.id, u.nombre, u.email, u.rol, u.perfil_id,
               p.nombre as perfil_nombre
        FROM usuarios u LEFT JOIN perfiles p ON u.perfil_id = p.id
        WHERE u.id = ?
      `).get(req.user.id);
      ldb.close();
    } catch {}

    const nombre = freshUser?.nombre || req.user.nombre || req.user.email;
    const rol = freshUser?.rol || req.user.rol;
    const perfil_nombre = freshUser?.perfil_nombre || req.user.perfil_nombre || null;

    // Sync to local logistics.usuarios
    const result = await pool.query('SELECT id, nombre, email, rol, activo FROM logistics.usuarios WHERE email=$1', [req.user.email]);
    const user = result.rows[0];
    if (!user) {
      const rolesValidos = ['admin', 'operador', 'visor'];
      const rolInsert = rolesValidos.includes(rol) ? rol : 'operador';
      const r = await pool.query(
        `INSERT INTO logistics.usuarios (nombre, email, password_hash, rol, activo)
         VALUES ($1, $2, '', $3, true)
         ON CONFLICT (email) DO UPDATE SET nombre = $1, rol = $3
         RETURNING id, nombre, email, rol, activo`,
        [nombre, req.user.email, rolInsert]
      );
      return res.json({ ...r.rows[0], perfil_nombre, modulos_permisos: req.user.modulos_permisos || {} });
    }
    const rolesValidos = ['admin', 'operador', 'visor'];
    const updateRol = rolesValidos.includes(rol) ? rol : 'operador';
    if (user.nombre !== nombre || user.rol !== updateRol) {
      await pool.query('UPDATE logistics.usuarios SET nombre = $1, rol = $2 WHERE id = $3', [nombre, updateRol, user.id]);
      user.nombre = nombre;
      user.rol = updateRol;
    }
    res.json({ ...user, perfil_nombre, modulos_permisos: req.user.modulos_permisos || {} });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/version', (req, res) => {
  try {
    const rootPkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    res.json({ version: rootPkg.version || '1.0.0', nombre: 'SynnoxERP Logistics' });
  } catch {
    res.json({ version: '1.0.0', nombre: 'SynnoxERP Logistics' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', module: MODULE_ID }));

import { createMiddleware } from './mcp/index.js';
app.use('/mcp', createMiddleware());

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error('Error:', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProd ? 'Error interno del servidor' : (err.message || 'Error interno del servidor') });
});

export default app;
