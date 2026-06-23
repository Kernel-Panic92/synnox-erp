const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'launcher.db'));

const exists = db.prepare("SELECT id FROM modulos_plataforma WHERE id = 'logistics'").get();
if (exists) {
  console.log('✅ logistics ya está registrado');
} else {
  db.prepare(`INSERT INTO modulos_plataforma (id, nombre, descripcion, url, public_url, icon, mcp_enabled, activo, orden, proxy_prefix, tipo)
    VALUES ('logistics', 'Logistics', 'Optimización de rutas y logística', 'http://localhost:3004', '', '📦', 1, 1, 3, '/logistics/', 'externo')`).run();
  console.log('✅ logistics registrado en modulos_plataforma');
}

console.log('\nMódulos registrados:');
const rows = db.prepare('SELECT id, url, proxy_prefix, activo FROM modulos_plataforma').all();
for (const r of rows) {
  console.log(`  ${r.id}: ${r.url} prefix=${r.proxy_prefix} activo=${r.activo}`);
}
