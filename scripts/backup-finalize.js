#!/usr/bin/env node
// backup-finalize.js — Genera manifest.json con checksums SHA-256 de todo el staging.
// Uso: node backup-finalize.js <stage_dir> <install_dir>
// Lee: <stage>/sqlite/info.json, <stage>/postgres/counts.tsv
// Escribe: <stage>/manifest.json

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const STAGE = process.argv[2];
const INSTALL_DIR = process.argv[3];

if (!STAGE || !INSTALL_DIR) {
  console.error('Uso: backup-finalize.js <stage_dir> <install_dir>');
  process.exit(1);
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function walk(dir, base = dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(full, base));
    else out.push({ ruta: path.relative(base, full), bytes: fs.statSync(full).size });
  }
  return out;
}

try {
  const archivos = walk(STAGE).map((f) => ({ ...f, sha256: sha256(path.join(STAGE, f.ruta)) }));

  let sqlite = [];
  try {
    sqlite = JSON.parse(fs.readFileSync(path.join(STAGE, 'sqlite', 'info.json'), 'utf8'));
  } catch {}

  const schemas = {};
  try {
    const tsv = fs.readFileSync(path.join(STAGE, 'postgres', 'counts.tsv'), 'utf8');
    for (const line of tsv.split('\n')) {
      const [tabla, n] = line.split('\t');
      if (!tabla) continue;
      const [schema, ...rest] = tabla.split('.');
      if (!schemas[schema]) schemas[schema] = { tablas: 0, filas: 0 };
      schemas[schema].tablas++;
      schemas[schema].filas += parseInt(n, 10) || 0;
    }
  } catch {}

  const manifest = {
    version: 2,
    tipo: 'completo',
    generado: new Date().toISOString(),
    host: require('os').hostname(),
    install_dir: INSTALL_DIR,
    postgres: {
      database: process.env.PGDATABASE || 'synnox_erp',
      dump: 'postgres/synnox_erp.dump',
      globals: 'postgres/globals.sql',
      schemas,
    },
    sqlite,
    total_bytes: archivos.reduce((s, f) => s + f.bytes, 0),
    archivos,
  };

  fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const totalFilas = Object.values(schemas).reduce((s, x) => s + x.filas, 0) + sqlite.reduce((s, x) => s + (x.filas || 0), 0);
  console.log(`[manifest] ${archivos.length} archivos, ${Object.keys(schemas).length} schemas PG, ${totalFilas} filas totales`);
} catch (e) {
  console.error(`[manifest] Error: ${e.message}`);
  process.exit(1);
}
