import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Module configurations: ordered list of JS files to concatenate + minify
const modules = {
  proyectos: {
    dir: path.join(ROOT, 'modules/proyectos/public'),
    files: [
      'framework.js',
      'theme.js',
      'js/utils/helpers.js',
      'js/modules/dashboard.js',
      'js/modules/proyectos.js',
      'js/modules/tareas.js',
      'js/modules/tablero.js',
      'js/modules/reportes.js',
      'app.js',
    ],
    outfile: 'dist/bundle.js',
  },
  logistica: {
    dir: path.join(ROOT, 'modules/logistica/public'),
    files: [
      'app.js',
    ],
    outfile: 'dist/bundle.js',
  },
  proveedores: {
    dir: path.join(ROOT, 'modules/proveedores/public'),
    files: [
      'js/utils/api.js',
      'js/utils/helpers.js',
      'js/components/modals.js',
      'js/modules/auth.js',
      'js/modules/dashboard.js',
      'js/modules/facturas.js',
      'js/modules/pendientes.js',
      'js/modules/soporte.js',
      'js/modules/categorias.js',
      'js/modules/areas.js',
      'js/modules/audit.js',
      'js/modules/backup.js',
      'js/modules/config.js',
      'app.js',
    ],
    outfile: 'dist/bundle.js',
  },
  nomina: {
    dir: path.join(ROOT, 'modules/nomina/public'),
    files: [
      'js/utils/api.js',
      'js/utils/helpers.js',
      'js/modules/auth.js',
      'js/modules/dashboard.js',
      'js/modules/employees.js',
      'js/modules/records.js',
      'js/modules/nomina.js',
      'js/modules/reports.js',
      'js/modules/tipos.js',
      'js/modules/attachments.js',
      'js/modules/import.js',
      'js/modules/siesa.js',
      'js/modules/backup.js',
      'js/modules/configuracion.js',
      'js/modules/users.js',
      'js/modules/permisos.js',
    ],
    outfile: 'dist/bundle.js',
  },
};

async function buildModule(name, config) {
  const { dir, files, outfile } = config;

  try {
    // 1. Concatenate all files in order (preserves vanilla JS execution order)
    const parts = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠️  ${name}: ${file} not found, skipping`);
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      parts.push(`/* ── ${file} ── */\n${content}`);
    }

    if (parts.length === 0) {
      throw new Error('No files found');
    }

    const concatenated = parts.join('\n;\n');

    // 2. Minify with esbuild (transform API — preserves order, no bundling)
    const result = await esbuild.transform(concatenated, {
      minify: true,
      target: 'es2020',
      loader: 'js',
    });

    // 3. Write output
    const outPath = path.join(dir, outfile);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, result.code);

    const size = Buffer.byteLength(result.code, 'utf8');
    console.log(`  ✅ ${name}: ${(size / 1024).toFixed(1)}KB (${files.length} files → 1 bundle)`);

    return { name, success: true, size };
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    return { name, success: false, error: e.message };
  }
}

async function main() {
  console.log('🔨 Building frontend bundles (concatenate + minify)...\n');

  const results = [];
  for (const [name, config] of Object.entries(modules)) {
    results.push(await buildModule(name, config));
  }

  console.log('\n📊 Summary:');
  for (const r of results) {
    if (r.success) {
      console.log(`  ${r.name}: ${(r.size / 1024).toFixed(1)}KB`);
    } else {
      console.log(`  ${r.name}: FAILED — ${r.error}`);
    }
  }

  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} module(s) failed to build`);
    process.exit(1);
  }

  console.log('\n✅ All modules built successfully');
}

main().catch(e => {
  console.error('Build failed:', e);
  process.exit(1);
});
