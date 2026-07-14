import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pool from './config/db.js';
import { verifyToken, verifySession, requireModule, requirePermiso } from '../../../framework/auth.mjs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3004;
const MODULE_ID = process.env.MODULE_ID || 'logistica';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
import sedesRoutes from './routes/sedes.js';
import rutasPdfRoutes from './routes/rutas-pdf.js';

app.use('/api/health', healthRoutes);
app.get('/api/rutas/diagnostico', verifyToken, async (req, res) => {
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

const protect = [verifyToken, verifySession, requireModule(MODULE_ID)];
app.use('/api/vehiculos', protect, vehiculosRoutes);
app.use('/api/pedidos', protect, pedidosRoutes);
app.use('/api/rutas', protect, rutasRoutes);
app.use('/api/importadores', protect, importadoresRoutes);
app.use('/api/configuracion', [verifyToken, requireModule(MODULE_ID), requirePermiso('configurar', MODULE_ID)], configRoutes);
app.use('/api/backup', protect, backupRoutes);
app.use('/api/auditoria', protect, auditoriaRoutes);
app.use('/api/clientes', protect, clientesRoutes);
app.use('/api/sedes', protect, sedesRoutes);
app.use('/api/rutas-pdf', protect, rutasPdfRoutes);

// GET /api/auth/me — verify JWT and return user info (auto-create if new)
app.get('/api/auth/me', verifyToken, async (req, res) => {
  console.log(`[logistica] /me llamado — user: ${req.user?.email}, rol: ${req.user?.rol}, modulos: ${JSON.stringify(req.user?.modulos)}`);
  try {
    const result = await pool.query('SELECT id, nombre, email, rol, activo FROM logistics.usuarios WHERE email=$1', [req.user.email]);
    const user = result.rows[0];
    if (!user) {
      const rolesValidos = ['admin', 'operador', 'visor'];
      const rol = rolesValidos.includes(req.user.rol) ? req.user.rol : 'operador';
      const r = await pool.query(
        `INSERT INTO logistics.usuarios (nombre, email, password_hash, rol, activo)
         VALUES ($1, $2, '', $3, true)
         ON CONFLICT (email) DO UPDATE SET nombre = $1, rol = $3
         RETURNING id, nombre, email, rol, activo`,
        [req.user.nombre || req.user.email, req.user.email, rol]
      );
      return res.json(r.rows[0]);
    }
    const rolesValidos = ['admin', 'operador', 'visor'];
    const updateRol = rolesValidos.includes(req.user.rol) ? req.user.rol : 'operador';
    if (user.nombre !== (req.user.nombre || req.user.email) || user.rol !== updateRol) {
      await pool.query('UPDATE logistics.usuarios SET nombre = $1, rol = $2 WHERE id = $3', [req.user.nombre || req.user.email, updateRol, user.id]);
      user.nombre = req.user.nombre || req.user.email;
      user.rol = updateRol;
    }
    res.json({ ...user, perfil_nombre: req.user.perfil_nombre || null });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    res.json({ version: pkg.version || '1.0.0', nombre: pkg.name, branch: 'main' });
  } catch {
    res.json({ version: '1.0.0', nombre: 'SynnoxERP Logistics', branch: 'main' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', module: MODULE_ID }));

import { createMiddleware } from './mcp/index.js';
app.use('/mcp', createMiddleware());

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

export default app;
