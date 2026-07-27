import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { verifyToken, verifySession, requireModule, requirePermiso } from '../../../framework/auth.mjs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3101;
const MODULE_ID = process.env.MODULE_ID || 'proyectos';

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes' } });

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/api', apiLimiter);

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) console.log(`[proyectos] ${req.method} ${req.path} — auth: ${!!req.headers.authorization}`);
  next();
});

import proyectosRoutes from './routes/proyectos.js';
import tareasRoutes from './routes/tareas.js';
import comentariosRoutes from './routes/comentarios.js';
import usuariosRoutes from './routes/usuarios.js';
import evidenciasRoutes from './routes/evidencias.js';
import aprobacionRoutes from './routes/aprobacion.js';
import alertasRoutes from './routes/alertas.js';

const protect = [verifyToken, verifySession, requireModule(MODULE_ID)];

app.use('/api/tareas', protect, evidenciasRoutes);
app.use('/api', protect, aprobacionRoutes);
app.use('/api', protect, alertasRoutes);
app.use('/api/proyectos', protect, proyectosRoutes);
app.use('/api/tareas', protect, tareasRoutes);
app.use('/api/tareas', protect, comentariosRoutes);
app.use('/api/usuarios', protect, usuariosRoutes);

// Public endpoint for centros (read from launcher via globalThis shared store)
app.get('/api/centros', (req, res) => {
  res.json(globalThis.__centrosCache || []);
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json({
    id: req.user.id,
    nombre: req.user.nombre,
    email: req.user.email,
    rol: req.user.rol,
    perfil_nombre: req.user.perfil_nombre || null,
    modulos_permisos: req.user.modulos_permisos || {}
  });
});

app.get('/api/dashboard', verifyToken, async (req, res) => {
  try {
    const pool = (await import('./config/db.js')).default;
    const estados = await pool.query(
      `SELECT estado, COUNT(*) FROM projects.tareas GROUP BY estado`
    );
    const porAsignado = await pool.query(
      `SELECT t.asignado_a, COUNT(*) AS total
       FROM projects.tareas t WHERE t.estado != 'completada'
       GROUP BY t.asignado_a ORDER BY total DESC`
    );
    const recientes = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre
       FROM projects.tareas t LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       ORDER BY t.updated_at DESC LIMIT 10`
    );
    const aprobacion = await pool.query(
      `SELECT COUNT(*) AS pendientes FROM projects.tareas WHERE estado_aprobacion = 'pendiente' AND estado = 'revision'`
    );
    res.json({
      exitosa: true,
      estados: estados.rows,
      porAsignado: porAsignado.rows,
      recientes: recientes.rows,
      aprobacion: aprobacion.rows[0]
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
    res.json({ version: rootPkg.version || '1.0.0', nombre: 'SynnoxERP Proyectos' });
  } catch {
    res.json({ version: '1.0.0', nombre: 'SynnoxERP Proyectos' });
  }
});

import { createMiddleware } from './mcp/index.js';
app.use('/mcp', createMiddleware());

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use((err, req, res, next) => {
  console.error('Error:', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProd ? 'Error interno del servidor' : (err.message || 'Error interno del servidor') });
});

export default app;
