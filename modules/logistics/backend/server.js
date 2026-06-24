import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pool from './config/db.js';
import { verifyToken, requireModule } from '../../../framework/auth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3004;
const MODULE_ID = process.env.MODULE_ID || 'logistics';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

import vehiculosRoutes from './routes/vehiculos.js';
import pedidosRoutes from './routes/pedidos.js';
import rutasRoutes from './routes/rutas.js';
import importadoresRoutes from './routes/importadores.js';
import healthRoutes from './routes/health.js';
import usuariosRoutes from './routes/usuarios.js';
import configRoutes from './routes/configuracion.js';
import backupRoutes from './routes/backup.js';
import auditoriaRoutes from './routes/auditoria.js';
import actualizadorRoutes from './routes/actualizador.js';
import clientesRoutes from './routes/clientes.js';
import sedesRoutes from './routes/sedes.js';
import authRoutes from './routes/auth.js';

app.use('/api/health', healthRoutes);
app.get('/api/rutas/diagnostico', async (req, res) => {
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

const protect = [verifyToken, requireModule(MODULE_ID)];
app.use('/api/vehiculos', protect, vehiculosRoutes);
app.use('/api/pedidos', protect, pedidosRoutes);
app.use('/api/rutas', protect, rutasRoutes);
app.use('/api/importadores', protect, importadoresRoutes);
app.use('/api/usuarios', protect, usuariosRoutes);
app.use('/api/configuracion', protect, configRoutes);
app.use('/api/backup', protect, backupRoutes);
app.use('/api/auditoria', protect, auditoriaRoutes);
app.use('/api/actualizador', protect, actualizadorRoutes);
app.use('/api/clientes', protect, clientesRoutes);
app.use('/api/sedes', protect, sedesRoutes);

// Auth routes: cambiar-password, forgot, reset (no login/verificar)
app.use('/api/auth', verifyToken, authRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    res.json({ version: pkg.version || '1.0.0', nombre: pkg.name, branch: 'main' });
  } catch {
    res.json({ version: '1.0.0', nombre: 'Horix Logistics', branch: 'main' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', module: MODULE_ID }));

import { createMiddleware } from './mcp/index.js';
app.use('/mcp', createMiddleware());

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/mcp')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

async function start() {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Conectado a PostgreSQL');
    app.listen(PORT, () => {
      console.log(`🚀 ${MODULE_ID} escuchando en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error iniciando servidor:', err);
    process.exit(1);
  }
}

start();

export default app;
