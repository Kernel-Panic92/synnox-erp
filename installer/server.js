const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = 3001;
const INSTALL_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');

let installState = { running: false, logs: [], step: '' };
const sseClients = [];

function sendSSE(data) {
  sseClients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function log(msg, type = 'info') {
  const entry = { ts: new Date().toISOString(), msg, type };
  installState.logs.push(entry);
  sendSSE(entry);
  console.log(`[${type}] ${msg}`);
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: INSTALL_DIR, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    proc.stdout.on('data', d => {
      const text = d.toString();
      out += text;
      text.split('\n').filter(Boolean).forEach(line => log(line, 'cmd'));
    });
    proc.stderr.on('data', d => {
      const text = d.toString();
      text.split('\n').filter(Boolean).forEach(line => log(line, 'cmd'));
    });
    proc.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`Exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

function checkRequirements() {
  const checks = [];
  try {
    const v = execSync('node -v').toString().trim();
    const num = parseFloat(v.replace('v', ''));
    checks.push({ name: 'Node.js', ok: num >= 20, value: v + (num < 20 ? ' (se requiere >=20)' : '') });
  } catch { checks.push({ name: 'Node.js', ok: false, value: 'No instalado' }); }

  try {
    execSync('which psql 2>/dev/null || where psql 2>/dev/null || pg_isready -q 2>/dev/null', { stdio: 'ignore' });
    checks.push({ name: 'PostgreSQL', ok: true, value: 'Disponible' });
  } catch { 
    try {
      execSync('apt list --installed 2>/dev/null | grep postgresql', { stdio: 'pipe' });
      checks.push({ name: 'PostgreSQL', ok: true, value: 'Instalado' });
    } catch {
      checks.push({ name: 'PostgreSQL', ok: false, value: 'No instalado' });
    }
  }

  try {
    execSync('git --version', { stdio: 'pipe' });
    const v = execSync('git --version').toString().trim();
    checks.push({ name: 'Git', ok: true, value: v });
  } catch { checks.push({ name: 'Git', ok: false, value: 'No instalado' }); }

  try {
    execSync('pm2 -v', { stdio: 'pipe' });
    const v = execSync('pm2 -v').toString().trim();
    checks.push({ name: 'PM2', ok: true, value: v });
  } catch { checks.push({ name: 'PM2', ok: false, value: 'No instalado' }); }

  try {
    execSync('nginx -v 2>&1', { stdio: 'pipe' });
    checks.push({ name: 'Nginx', ok: true, value: 'Disponible' });
  } catch { checks.push({ name: 'Nginx', ok: false, value: 'No instalado' }); }

  return checks;
}

async function runInstall(config) {
  installState.running = true;
  installState.logs = [];
  installState.step = 'Preparando instalación...';
  log('=== Iniciando instalación de Horix ERP ===', 'start');

  try {
    // Step 1: Install system deps
    installState.step = 'Instalando dependencias del sistema...';
    log('Instalando PostgreSQL, Nginx, Git...', 'step');
    try {
      await runCmd('apt-get', ['update', '-qq']);
      await runCmd('apt-get', ['install', '-y', '-qq', 'postgresql', 'postgresql-client', 'nginx', 'git', 'openssl']);
      log('Dependencias del sistema instaladas', 'ok');
    } catch (e) {
      log('Nota: ' + e.message, 'warn');
    }

    // Clean install: wipe existing data
    if (config.clean) {
      installState.step = '🧹 Limpiando instalación anterior...';
      log('Eliminando datos existentes...', 'step');
      // Drop PostgreSQL databases
      for (const db of ['horix_launcher', 'horix_logistics', 'horix_docflow', 'horix_erp']) {
        try { execSync(`su - postgres -c "psql -c \\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db}' AND pid <> pg_backend_pid();\\"" 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
        try { execSync(`su - postgres -c "dropdb ${db}" 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
        try { execSync(`su - postgres -c "createdb -O ${config.dbUser} ${db}" 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      }
      // Delete SQLite databases
      for (const f of ['launcher/launcher.db', 'modules/nomina/horas_extra.db']) {
        try { fs.unlinkSync(path.join(INSTALL_DIR, f)); log(`Eliminado: ${f}`, 'ok'); } catch {}
      }
      // Delete .env files
      for (const dir of ['launcher', 'modules/logistica', 'modules/proveedores', 'modules/nomina']) {
        try { fs.unlinkSync(path.join(INSTALL_DIR, dir, '.env')); } catch {}
      }
      // Stop PM2 processes
      for (const name of ['horix-erp', 'horix-launcher', 'logistics', 'docflow', 'horix']) {
        try { execSync(`pm2 delete ${name} 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      }
      log('Instalación anterior eliminada', 'ok');
    }

    // Ensure Node.js >= 20
    const nodeV = execSync('node -v').toString().trim();
    const nodeNum = parseFloat(nodeV.replace('v', ''));
    if (nodeNum < 20) {
      installState.step = 'Actualizando Node.js a v20...';
      log('Node.js ' + nodeV + ' — actualizando a v20...', 'step');
      try {
        await runCmd('curl', ['-fsSL', 'https://deb.nodesource.com/setup_20.x', '-o', '/tmp/nodesetup.sh']);
        await runCmd('bash', ['/tmp/nodesetup.sh']);
        await runCmd('apt-get', ['install', '-y', '-qq', 'nodejs']);
        const newV = execSync('node -v').toString().trim();
        log('Node.js actualizado: ' + newV, 'ok');
      } catch (e) {
        log('Error actualizando Node.js: ' + e.message + ' — instala Node 20 manualmente', 'warn');
      }
    }

    // Step 2: Setup PostgreSQL
    const dbPass = config.dbPass || require('crypto').randomBytes(16).toString('hex');
    installState.dbPass = dbPass;
    const pgEnv = { ...process.env, PGPASSWORD: dbPass };
    installState.step = 'Configurando PostgreSQL...';
    log('Creando usuario y databases...', 'step');
    try {
      execSync(`su - postgres -c "psql -tc \\"SELECT 1 FROM pg_roles WHERE rolname='${config.dbUser}'\\" | grep -q 1 || psql -c \\"CREATE USER ${config.dbUser} WITH PASSWORD '${dbPass}'\\"" 2>/dev/null || true`, { stdio: 'ignore', env: pgEnv });
      for (const db of ['horix_launcher', 'horix_logistics', 'horix_docflow', 'horix_erp']) {
        execSync(`su - postgres -c "psql -tc \\"SELECT 1 FROM pg_database WHERE datname='${db}'\\" | grep -q 1 || createdb -O ${config.dbUser} ${db}" 2>/dev/null || true`, { stdio: 'ignore', env: pgEnv });
      }
      // Ensure password matches .env (idempotent)
      execSync(`su - postgres -c "psql -c \\"ALTER USER ${config.dbUser} WITH PASSWORD '${dbPass}';\\"" 2>/dev/null || true`, { stdio: 'ignore' });
      log('PostgreSQL listo', 'ok');
    } catch (e) {
      log('Error PostgreSQL: ' + e.message, 'warn');
    }

    // Step 3: Generate JWT_SECRET
    const jwtSecret = require('crypto').randomBytes(32).toString('hex');

    // Step 4: Create single .env at root
    installState.step = 'Generando .env...';
    const envVars = {
      PORT: 3002,
      JWT_SECRET: jwtSecret,
      PGHOST: config.dbHost || 'localhost',
      PGPORT: 5432,
      PGUSER: config.dbUser,
      PGPASSWORD: dbPass,
      PGDATABASE: 'horix_erp',
      NODE_ENV: 'production',
      ADMIN_EMAIL: config.adminEmail || 'admin@horix.com',
      ADMIN_PASS: config.adminPass || 'admin123',
      OSRM_URL: 'https://router.project-osrm.org',
    };
    const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(path.join(INSTALL_DIR, '.env'), envContent);
    log('.env creado en raíz', 'ok');

    // Step 5: npm install (single root)
    installState.step = 'Instalando dependencias npm...';
    try {
      await runCmd('npm', ['install', '--omit=dev'], { cwd: INSTALL_DIR });
      log('npm install completado', 'ok');
    } catch (e) { log('npm: ' + e.message, 'warn'); }

    // Rebuild native addons
    try { await runCmd('npm', ['rebuild'], { cwd: INSTALL_DIR }); } catch {}

    // Step 6: Migrations
    installState.step = 'Ejecutando migraciones...';
    try {
      await runCmd('psql', ['-U', config.dbUser, '-h', config.dbHost || 'localhost', '-d', 'horix_logistics', '-c', 'CREATE SCHEMA IF NOT EXISTS logistics;'], { env: pgEnv });
      const migDir = path.join(INSTALL_DIR, 'modules/logistics/backend/migrations');
      if (fs.existsSync(migDir)) {
        const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
        for (const f of files) {
          try { await runCmd('psql', ['-U', config.dbUser, '-h', config.dbHost || 'localhost', '-d', 'horix_logistics', '-f', path.join(migDir, f)], { env: pgEnv }); } catch {}
        }
        log('Logistics: migraciones ok', 'ok');
      }
    } catch (e) { log('Migraciones logistics: ' + e.message, 'warn'); }

    try {
      await runCmd('node', ['src/db/migrate.js'], { cwd: path.join(INSTALL_DIR, 'modules/docflow'), env: { ...process.env, PGPASSWORD: dbPass, DB_USER: config.dbUser, DB_PASSWORD: dbPass, DB_NAME: 'horix_docflow' } });
      log('DocFlow: migraciones ok', 'ok');
    } catch (e) { log('DocFlow migrate: ' + e.message, 'warn'); }

    // Step 7: Demo seeds (admin users are auto-created from launcher JWT)
    if (config.runSeeds !== false) {
      installState.step = 'Sembrando datos demo...';
      // Demo seeds
      if (fs.existsSync(path.join(INSTALL_DIR, 'modules/logistics/backend/db/seed-demo.js'))) {
        try {
          const pwd = config.dbPass || dbPass;
          await runCmd('node', ['backend/db/seed-demo.js'], { cwd: path.join(INSTALL_DIR, 'modules/logistics'), env: { ...process.env, PGPASSWORD: pwd, DB_USER: config.dbUser, DB_PASSWORD: pwd, DB_NAME: 'horix_logistics' } });
          log('Logistics: datos demo', 'ok');
        } catch (e) { log('Seed-demo logistics: ' + e.message, 'warn'); }
      }
      if (fs.existsSync(path.join(INSTALL_DIR, 'modules/docflow/src/db/seed-demo.js'))) {
        try {
          const pwd = config.dbPass || dbPass;
          await runCmd('node', ['src/db/seed-demo.js'], { cwd: path.join(INSTALL_DIR, 'modules/docflow'), env: { ...process.env, PGPASSWORD: pwd, DB_USER: config.dbUser, DB_PASSWORD: pwd, DB_NAME: 'horix_docflow' } });
          log('DocFlow: datos demo', 'ok');
        } catch (e) { log('Seed-demo docflow: ' + e.message, 'warn'); }
      }
    }

    // Step 9 — Nginx config

    // Step 8: PM2 (single process)
    installState.step = 'Configurando PM2...';
    try {
      for (const name of ['horix-erp', 'logistics', 'docflow', 'horix', 'horix-launcher', 'synnoxerp']) {
        try { execSync(`pm2 delete ${name} 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      }
      await runCmd('pm2', ['start', 'server.js', '--name', 'synnoxerp'], { cwd: INSTALL_DIR });
      log('synnoxerp → :3002', 'ok');
      execSync('pm2 save 2>/dev/null || true', { stdio: 'ignore' });
      execSync('pm2 startup 2>/dev/null || true', { stdio: 'ignore' });
    } catch (e) { log('PM2: ' + e.message, 'warn'); }

    // Step 9: Nginx (single upstream → servidor unificado)
    installState.step = 'Configurando Nginx...';
    try {
      const domain = config.domain || 'localhost';
      const sslDir = '/etc/ssl/horix-platform';
      if (!fs.existsSync(sslDir)) { execSync(`mkdir -p ${sslDir}`, { stdio: 'ignore' }); }
      if (!fs.existsSync(`${sslDir}/cert.pem`)) {
        execSync(`openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout ${sslDir}/key.pem -out ${sslDir}/cert.pem -subj "/CN=${domain}/O=SynnoxERP/C=CO" 2>/dev/null`, { stdio: 'ignore' });
      }

      const nginxConf = `
server {
    listen 443 ssl http2;
    server_name ${domain};
    ssl_certificate ${sslDir}/cert.pem;
    ssl_certificate_key ${sslDir}/key.pem;
    location / { proxy_pass http://127.0.0.1:3002; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
}
server { listen 80; server_name ${domain}; return 301 https://\$host\$request_uri; }
`;
      fs.writeFileSync('/etc/nginx/sites-available/horix-platform', nginxConf);
      try { execSync('ln -sf /etc/nginx/sites-available/horix-platform /etc/nginx/sites-enabled/', { stdio: 'ignore' }); } catch {}
      try { execSync('nginx -t 2>/dev/null && systemctl reload nginx || true', { stdio: 'ignore' }); } catch {}
      log('Nginx configurado', 'ok');
    } catch (e) { log('Nginx: ' + e.message, 'warn'); }

    // Step 10: Register modules via API
    installState.step = 'Registrando módulos en el launcher...';
    let token = '';
    let retryDelay = 2000;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, retryDelay));
      try {
        const loginResp = execSync(`curl -s -w "\\n%{http_code}" -X POST http://localhost:3002/api/auth/login -H "Content-Type: application/json" -d '{"email":"${config.adminEmail || 'admin@horix.com'}","password":"${config.adminPass || 'admin123'}"}' 2>&1 || true`).toString().trim();
        const lines = loginResp.split('\n');
        const httpCode = lines.pop().trim();
        const body = lines.join('\n').trim();
        if (httpCode === '429') { retryDelay = 5000; if (i === 0 || i % 3 === 0) log('Rate limit — esperando...', 'warn'); continue; }
        token = (body.match(/"jwt":"([^"]*)"/) || [])[1] || '';
        if (token) break;
        if (i === 0) log('Esperando al launcher...', 'step');
        if (i >= 4 && i % 5 === 0) log(`Login: HTTP ${httpCode} — reintentando...`, 'warn');
      } catch {}
    }
    if (token) {
      const mods = [
        { id: 'logistica', nombre: 'Logística', icon: '🚚', url: 'http://localhost:3002/logistica', proxy_prefix: '/logistica/', tipo: 'interno' },
        { id: 'proveedores', nombre: 'Proveedores', icon: '📄', url: 'http://localhost:3002/proveedores', proxy_prefix: '/proveedores/', tipo: 'interno' },
        { id: 'nomina', nombre: 'Nómina', icon: '💰', url: 'http://localhost:3002/nomina', proxy_prefix: '/nomina/', tipo: 'interno' },
      ];
      for (const m of mods) {
        if (config.modules?.includes(m.id)) {
          execSync(`curl -s -X POST http://localhost:3002/api/admin/modulos -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '${JSON.stringify({ ...m, mcp_enabled: true })}' 2>/dev/null || true`, { stdio: 'ignore' });
        }
      }
      log('Módulos registrados en el launcher', 'ok');
    } else {
      log('No se pudo obtener token — registra los módulos manualmente desde Admin → Módulos', 'warn');
    }

    installState.step = 'Instalación completada';
    log('=== Instalación completada exitosamente ===', 'complete');
    installState.running = false;

  } catch (err) {
    log(`FATAL: ${err.message}`, 'error');
    installState.running = false;
  }
}

// ─── HTTP Server ────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API: check requirements
  if (pathname === '/api/requirements' && method === 'GET') {
    const checks = checkRequirements();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(checks));
    return;
  }

  // API: start install
  if (pathname === '/api/install' && method === 'POST') {
    if (installState.running) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ya hay una instalación en curso' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const config = JSON.parse(body);
      config.dbPass = config.dbPass || require('crypto').randomBytes(16).toString('hex');
      runInstall(config).catch(() => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // API: SSE logs
  if (pathname === '/api/install/logs' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', msg: 'Conectado' })}\n\n`);
    sseClients.push(res);
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  // API: install status
  if (pathname === '/api/install/status' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running: installState.running, step: installState.step, logs: installState.logs.slice(-50), dbPass: installState.dbPass || null }));
    return;
  }

  // API: server IP
  if (pathname === '/api/ip' && method === 'GET') {
    const ip = require('os').networkInterfaces();
    let addr = 'localhost';
    Object.values(ip).forEach(ifaces => {
      ifaces?.forEach(i => { if (!i.internal && i.family === 'IPv4') addr = i.address; });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: addr }));
    return;
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

  if (!fs.existsSync(filePath)) { filePath = path.join(PUBLIC_DIR, 'index.html'); }

  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
  res.end(content);
});

server.listen(PORT, () => {
  const ip = require('os').networkInterfaces();
  let addr = 'localhost';
  Object.values(ip).forEach(ifaces => {
    ifaces?.forEach(i => { if (!i.internal && i.family === 'IPv4') addr = i.address; });
  });
  console.log(`╔═════════════════════════════════════════════════╗`);
  console.log(`║     Horix ERP — Instalador Web                ║`);
  console.log(`║                                               ║`);
  console.log(`║  Abre en tu navegador:                       ║`);
  console.log(`║    http://${addr}:${PORT}                        ║`);
  console.log(`║    http://localhost:${PORT}                    ║`);
  console.log(`╚═════════════════════════════════════════════════╝`);
});
