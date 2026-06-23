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
    checks.push({ name: 'Node.js', ok: true, value: v });
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
      // May fail if no apt or already installed
      log('Nota: ' + e.message, 'warn');
    }

    // Step 2: Setup PostgreSQL
    const dbPass = config.dbPass || require('crypto').randomBytes(16).toString('hex');
    installState.step = 'Configurando PostgreSQL...';
    log('Creando usuario y databases...', 'step');
    try {
      execSync(`su - postgres -c "psql -tc \\"SELECT 1 FROM pg_roles WHERE rolname='${config.dbUser}'\\" | grep -q 1 || psql -c \\"CREATE USER ${config.dbUser} WITH PASSWORD '${dbPass}'\\"" 2>/dev/null || true`, { stdio: 'ignore' });
      for (const db of ['horix_launcher', 'horix_logistics', 'horix_docflow']) {
        execSync(`su - postgres -c "psql -tc \\"SELECT 1 FROM pg_database WHERE datname='${db}'\\" | grep -q 1 || createdb -O ${config.dbUser} ${db}" 2>/dev/null || true`, { stdio: 'ignore' });
      }
      log('PostgreSQL listo', 'ok');
    } catch (e) {
      log('Error PostgreSQL: ' + e.message, 'error');
    }

    // Step 3: Generate JWT_SECRET
    const jwtSecret = require('crypto').randomBytes(32).toString('hex');

    // Step 4: Create .env files
    installState.step = 'Generando .env...';
    const envs = {
      'launcher': { PORT: 3002, MODULE_ID: 'launcher', JWT_SECRET: jwtSecret, DB_USER: config.dbUser, DB_PASSWORD: dbPass, DB_HOST: config.dbHost || 'localhost', DB_PORT: 5432, DB_NAME: 'horix_launcher', NODE_ENV: 'production' },
      'modules/logistics': { PORT: 3004, MODULE_ID: 'logistics', JWT_SECRET: jwtSecret, DB_USER: config.dbUser, DB_PASSWORD: dbPass, DB_HOST: config.dbHost || 'localhost', DB_PORT: 5432, DB_NAME: 'horix_logistics', NODE_ENV: 'production', OSRM_URL: 'https://router.project-osrm.org' },
      'modules/docflow': { PORT: 3100, MODULE_ID: 'docflow', JWT_SECRET: jwtSecret, DB_USER: config.dbUser, DB_PASSWORD: dbPass, DB_HOST: config.dbHost || 'localhost', DB_PORT: 5432, DB_NAME: 'horix_docflow', NODE_ENV: 'production' },
    };
    for (const [dir, vars] of Object.entries(envs)) {
      const p = path.join(INSTALL_DIR, dir, '.env');
      const mkdir = path.dirname(p);
      if (!fs.existsSync(mkdir)) fs.mkdirSync(mkdir, { recursive: true });
      const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      fs.writeFileSync(p, content);
      log(`.env creado: ${dir}`, 'ok');
    }

    // Step 5: npm install
    installState.step = 'Instalando dependencias npm...';
    for (const dir of ['launcher', 'modules/logistics', 'modules/docflow']) {
      const pkg = path.join(INSTALL_DIR, dir, 'package.json');
      if (fs.existsSync(pkg)) {
        log(`npm install: ${dir}`, 'step');
        try {
          await runCmd('npm', ['install', '--omit=dev'], { cwd: path.join(INSTALL_DIR, dir) });
          log(`npm: ${dir}`, 'ok');
        } catch (e) {
          log(`npm: ${dir} — ${e.message}`, 'warn');
        }
      }
    }

    // Step 6: Migrations
    installState.step = 'Ejecutando migraciones...';
    try {
      await runCmd('psql', ['-U', config.dbUser, '-h', config.dbHost || 'localhost', '-d', 'horix_logistics', '-c', 'CREATE SCHEMA IF NOT EXISTS logistics;']);
      const migDir = path.join(INSTALL_DIR, 'modules/logistics/backend/migrations');
      if (fs.existsSync(migDir)) {
        const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
        for (const f of files) {
          try { await runCmd('psql', ['-U', config.dbUser, '-h', config.dbHost || 'localhost', '-d', 'horix_logistics', '-f', path.join(migDir, f)]); } catch {}
        }
        log('Logistics: migraciones ok', 'ok');
      }
    } catch (e) { log('Migraciones logistics: ' + e.message, 'warn'); }

    try {
      await runCmd('node', ['src/db/migrate.js'], { cwd: path.join(INSTALL_DIR, 'modules/docflow'), env: { ...process.env, PGPASSWORD: dbPass, DB_USER: config.dbUser, DB_PASSWORD: dbPass, DB_NAME: 'horix_docflow' } });
      log('DocFlow: migraciones ok', 'ok');
    } catch (e) { log('DocFlow migrate: ' + e.message, 'warn'); }

    // Step 7: Seeds
    if (config.runSeeds !== false) {
      installState.step = 'Sembrando datos demo...';
      try {
        const pwd = config.dbPass || dbPass;
        await runCmd('node', ['backend/db/seed.js'], { cwd: path.join(INSTALL_DIR, 'modules/logistics'), env: { ...process.env, PGPASSWORD: pwd, DB_USER: config.dbUser, DB_PASSWORD: pwd, DB_NAME: 'horix_logistics' } });
        log('Logistics: admin seed', 'ok');
      } catch (e) { log('Seed logistics: ' + e.message, 'warn'); }

      try {
        const pwd = config.dbPass || dbPass;
        await runCmd('node', ['src/db/seed.js'], { cwd: path.join(INSTALL_DIR, 'modules/docflow'), env: { ...process.env, PGPASSWORD: pwd, DB_USER: config.dbUser, DB_PASSWORD: pwd, DB_NAME: 'horix_docflow' } });
        log('DocFlow: admin seed', 'ok');
      } catch (e) { log('Seed docflow: ' + e.message, 'warn'); }

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

    // Step 8: PM2
    installState.step = 'Configurando PM2...';
    try {
      for (const name of ['horix-erp', 'logistics', 'docflow', 'horix-launcher']) {
        try { execSync(`pm2 delete ${name} 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      }
      await runCmd('pm2', ['start', 'server.js', '--name', 'horix-erp', '--', '--port', '3002'], { cwd: path.join(INSTALL_DIR, 'launcher') });
      log('horix-erp → :3002', 'ok');

      if (config.modules?.includes('logistics')) {
        await runCmd('pm2', ['start', 'backend/server.js', '--name', 'logistics', '--', '--port', '3004'], { cwd: path.join(INSTALL_DIR, 'modules/logistics') });
        log('logistics → :3004', 'ok');
      }
      if (config.modules?.includes('docflow')) {
        await runCmd('pm2', ['start', 'src/server.js', '--name', 'docflow', '--', '--port', '3100'], { cwd: path.join(INSTALL_DIR, 'modules/docflow') });
        log('docflow → :3100', 'ok');
      }

      execSync('pm2 save 2>/dev/null || true', { stdio: 'ignore' });
      execSync('pm2 startup 2>/dev/null || true', { stdio: 'ignore' });
    } catch (e) { log('PM2: ' + e.message, 'warn'); }

    // Step 9: Nginx
    installState.step = 'Configurando Nginx...';
    try {
      const domain = config.domain || 'localhost';
      const sslDir = '/etc/ssl/horix-platform';
      if (!fs.existsSync(sslDir)) { execSync(`mkdir -p ${sslDir}`, { stdio: 'ignore' }); }
      if (!fs.existsSync(`${sslDir}/cert.pem`)) {
        execSync(`openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout ${sslDir}/key.pem -out ${sslDir}/cert.pem -subj "/CN=${domain}/O=HorixERP/C=CO" 2>/dev/null`, { stdio: 'ignore' });
      }

      let nginxConf = `
server {
    listen 443 ssl http2;
    server_name ${domain};
    ssl_certificate ${sslDir}/cert.pem;
    ssl_certificate_key ${sslDir}/key.pem;
    location / { proxy_pass http://127.0.0.1:3002; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }`;
      if (config.modules?.includes('logistics')) {
        nginxConf += `
    location /logistics/ { proxy_pass http://127.0.0.1:3004/; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }`;
      }
      if (config.modules?.includes('docflow')) {
        nginxConf += `
    location /docflow/ { proxy_pass http://127.0.0.1:3100/; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }`;
      }
      nginxConf += `
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
    await new Promise(r => setTimeout(r, 2000));
    try {
      const token = execSync(`curl -s -X POST http://localhost:3002/api/auth/login -H "Content-Type: application/json" -d '{"email":"${config.adminEmail || 'admin@horix.com'}","password":"${config.adminPass || 'admin123'}"}' 2>/dev/null | grep -o '"jwt":"[^"]*"' | cut -d'"' -f4`).toString().trim();
      if (token) {
        const mods = [
          { id: 'logistics', nombre: 'Logística', url: 'http://localhost:3004', prefix: '/logistics/', tipo: 'interno' },
          { id: 'docflow', nombre: 'DocFlow', url: 'http://localhost:3100', prefix: '/docflow/', tipo: 'interno' },
        ];
        for (const m of mods) {
          if (config.modules?.includes(m.id)) {
            execSync(`curl -s -X POST http://localhost:3002/api/admin/modulos -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '${JSON.stringify({ ...m, mcp_enabled: true })}' 2>/dev/null || true`, { stdio: 'ignore' });
          }
        }
        log('Módulos registrados en el launcher', 'ok');
      }
    } catch (e) { log('Registro automático de módulos falló — puedes registrarlos manualmente desde Admin', 'warn'); }

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
    res.end(JSON.stringify({ running: installState.running, step: installState.step, logs: installState.logs.slice(-50) }));
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
