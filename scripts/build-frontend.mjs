import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Module configurations: each module has an ordered list of JS files to bundle
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
    outdir: 'dist',
    outfile: 'dist/bundle.js',
  },
  logistica: {
    dir: path.join(ROOT, 'modules/logistica/public'),
    files: [
      'app.js',
    ],
    outdir: 'dist',
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
    outdir: 'dist',
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
    outdir: 'dist',
    outfile: 'dist/bundle.js',
  },
};

async function buildModule(name, config) {
  const { dir, files, outfile } = config;
  
  // Create entry point that imports all files in order
  const entryContent = files.map(f => `import './${f}';`).join('\n');
  const entryPath = path.join(dir, '_entry.js');
  
  try {
    fs.writeFileSync(entryPath, entryContent);
    
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      minify: true,
      sourcemap: false,
      target: ['es2020'],
      outfile: path.join(dir, outfile),
      logLevel: 'warning',
      // Don't try to resolve node_modules — these are browser scripts
      external: [],
      platform: 'browser',
    });
    
    const outPath = path.join(dir, outfile);
    const size = fs.statSync(outPath).size;
    console.log(`  ✅ ${name}: ${(size / 1024).toFixed(1)}KB bundled`);
    
    return { name, success: true, size };
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    return { name, success: false, error: e.message };
  } finally {
    // Clean up entry point
    try { fs.unlinkSync(entryPath); } catch {}
  }
}

async function main() {
  console.log('🔨 Building frontend bundles...\n');
  
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
  
  // Check if any failed
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
