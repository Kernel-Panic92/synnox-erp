#!/usr/bin/env node
// backup-sqlite.js — Hot backup de bases SQLite via better-sqlite3
// Uso: NODE_PATH=<install>/launcher/node_modules node backup-sqlite.js <install_dir> <stage_dir>
// Copia cada DB encontrada a <stage_dir>/sqlite/ y escribe <stage_dir>/sqlite/info.json
// con conteos de filas por tabla (usado por el manifest y el restore drill).

const path = require('path');
const fs = require('fs');

const INSTALL_DIR = process.argv[2];
const STAGE_DIR = process.argv[3];

if (!INSTALL_DIR || !STAGE_DIR) {
  console.error('Uso: backup-sqlite.js <install_dir> <stage_dir>');
  process.exit(1);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('No se pudo cargar better-sqlite3. Ejecutar con NODE_PATH=<install>/launcher/node_modules');
  process.exit(1);
}

const CANDIDATOS = [
  { nombre: 'launcher.db', rutas: [path.join(INSTALL_DIR, 'launcher', 'launcher.db')] },
  {
    nombre: 'horas_extra.db',
    rutas: [
      path.join(INSTALL_DIR, 'horas_extra.db'),
      path.join(INSTALL_DIR, 'modules', 'nomina', 'horas_extra.db'),
      path.join(INSTALL_DIR, 'launcher', 'horas_extra.db'),
    ],
  },
];

async function main() {
  const outDir = path.join(STAGE_DIR, 'sqlite');
  fs.mkdirSync(outDir, { recursive: true });
  const info = [];

  for (const { nombre, rutas } of CANDIDATOS) {
    const src = rutas.find((r) => fs.existsSync(r));
    if (!src) {
      console.log(`[sqlite] ${nombre}: no encontrada, omitiendo`);
      continue;
    }
    const dest = path.join(outDir, nombre);
    try {
      const db = new Database(src, { readonly: true });
      await db.backup(dest);
      db.close();

      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(dest + ext); } catch {}
      }

      const copy = new Database(dest, { readonly: true });
      const tablas = copy
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => r.name);
      const counts = {};
      let total = 0;
      for (const t of tablas) {
        try {
          const n = copy.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
          counts[t] = n;
          total += n;
        } catch {
          counts[t] = -1;
        }
      }
      copy.close();

      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(dest + ext); } catch {}
      }

      info.push({ nombre, origen: src, bytes: fs.statSync(dest).size, tablas: tablas.length, filas: total, counts });
      console.log(`[sqlite] ${nombre}: ${tablas.length} tablas, ${total} filas`);
    } catch (e) {
      console.error(`[sqlite] ${nombre} ERROR: ${e.message}`);
      info.push({ nombre, origen: src, error: e.message });
    }
  }

  fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify(info, null, 2));
  if (info.length === 0) {
    console.error('[sqlite] Ninguna base SQLite encontrada');
    process.exit(1);
  }
  if (info.some((i) => i.error)) process.exit(1);
}

main().catch((e) => {
  console.error(`[sqlite] Error fatal: ${e.message}`);
  process.exit(1);
});
