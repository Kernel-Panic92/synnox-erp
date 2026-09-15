// FASE 1 permisos — asignación masiva CRM (idempotente, auditable).
// Uso: node scripts/asignar-perfiles-crm.js [--apply]
// Sin --apply solo reporta (dry-run). En prod: correr explícito tras backup.
// Regla: admin → Gerencia (ambas capas) · operador → Comercial 3/6 (ambas capas).
// Solo asigna interno donde el usuario NO tenga ya perfil de ventas (respeta Aprobador/manual).
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const APPLY = process.argv.includes('--apply');
const { Client } = pg;

const ldb = new Database(path.join(__dirname, '..', 'launcher', 'launcher.db'));
const admins = ldb.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'admin' AND activo = 1").all();
const operadors = ldb.prepare("SELECT id, nombre FROM usuarios WHERE rol != 'admin' AND activo = 1").all();

// Capa launcher: user_modulos (admins entran por bypass, pero se registra igual)
let modulosIns = 0;
const chkMod = ldb.prepare('SELECT 1 FROM user_modulos WHERE user_id = ? AND modulo_id = ?');
const insMod = ldb.prepare("INSERT INTO user_modulos (user_id, modulo_id, permisos) VALUES (?, 'crm', '{}')");
for (const u of [...admins, ...operadors]) {
  if (APPLY && !chkMod.get(u.id, 'crm')) { insMod.run(u.id); modulosIns++; }
}
if (!APPLY) {
  const falta = [...admins, ...operadors].filter(u => !chkMod.get(u.id, 'crm')).length;
  console.log(`[dry-run] user_modulos crm: faltan ${falta} de ${admins.length + operadors.length}`);
} else {
  console.log(`[apply] user_modulos crm: ${modulosIns} insertados`);
  const bump = ldb.prepare('UPDATE usuarios SET seq = seq + 1 WHERE rol != ?');
  if (modulosIns > 0) console.log('[apply] operadores afectados:', bump.run('admin').changes, '(seq+1 invalida JWT)');
}
ldb.close();

// Capa interna PG: Gerencia para admins, Comercial donde no haya perfil
const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'synnox_erp',
  user: process.env.DB_USER || 'synnox',
  password: process.env.DB_PASSWORD,
});
await client.connect();
const ger = await client.query(`SELECT id FROM crm.perfiles_venta WHERE nombre = 'CRM - Gerencia'`);
const com = await client.query(`SELECT id FROM crm.perfiles_venta WHERE nombre = 'CRM - Comercial'`);
if (!ger.rows[0] || !com.rows[0]) {
  console.error('Faltan perfiles Gerencia/Comercial — corre migración 039 primero');
  process.exit(1);
}
const conPerfil = new Set((await client.query('SELECT DISTINCT usuario_id FROM crm.usuario_perfil_venta')).rows.map(r => r.usuario_id));
let gIns = 0, cIns = 0;
for (const u of admins) {
  const has = (await client.query('SELECT 1 FROM crm.usuario_perfil_venta WHERE usuario_id = $1 AND perfil_venta_id = $2', [u.id, ger.rows[0].id])).rowCount;
  if (!has && APPLY) { await client.query('INSERT INTO crm.usuario_perfil_venta (usuario_id, perfil_venta_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.id, ger.rows[0].id]); gIns++; }
  if (!has) console.log(`${APPLY ? '[apply]' : '[dry-run]'} admin ${u.id} (${u.nombre}) → Gerencia`);
}
for (const u of operadors) {
  if (conPerfil.has(u.id)) { console.log(`[skip] operador ${u.id} (${u.nombre}) ya tiene perfil ventas`); continue; }
  if (APPLY) { await client.query('INSERT INTO crm.usuario_perfil_venta (usuario_id, perfil_venta_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.id, com.rows[0].id]); cIns++; }
  console.log(`${APPLY ? '[apply]' : '[dry-run]'} operador ${u.id} (${u.nombre}) → Comercial`);
}
console.log(`${APPLY ? '[apply]' : '[dry-run]'} interno: Gerencia=${gIns} Comercial=${cIns}`);
await client.end();
