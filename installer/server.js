const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');

const PORT = 3001;
const INSTALL_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');

let installState = { running: false, logs: [], step: '', adminPass: '' };
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

function isValidPgIdentifier(s) {
  return typeof s === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
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
  log('=== Iniciando instalación ===', 'start');

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
      // Drop PostgreSQL database
      const dbName = isValidPgIdentifier(config.dbName) ? config.dbName : 'mi_erp';
      const dbUserClean = isValidPgIdentifier(config.dbUser) ? config.dbUser : 'postgres';
      try { execSync(`su - postgres -c "psql -c \\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid();\\"" 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      try { execSync(`su - postgres -c "dropdb ${dbName}" 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      try { execSync(`su - postgres -c "createdb -O ${dbUserClean} ${dbName}" 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
      // Delete SQLite databases
      for (const f of ['launcher/launcher.db', 'modules/nomina/horas_extra.db']) {
        try { fs.unlinkSync(path.join(INSTALL_DIR, f)); log(`Eliminado: ${f}`, 'ok'); } catch {}
      }
      // Delete .env files
      for (const dir of ['launcher', 'modules/logistica', 'modules/proveedores', 'modules/nomina']) {
        try { fs.unlinkSync(path.join(INSTALL_DIR, dir, '.env')); } catch {}
      }
      // Stop PM2 processes
      for (const name of ['synnoxerp', 'horix-erp', 'logistics', 'docflow', 'horix']) {
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
    const dbName = isValidPgIdentifier(config.dbName) ? config.dbName : 'mi_erp';
    const dbUserClean = isValidPgIdentifier(config.dbUser) ? config.dbUser : 'postgres';
    const rawPass = config.dbPass || require('crypto').randomBytes(16).toString('hex');
    const dbPass = rawPass.replace(/['"`$\\]/g, '').replace(/'/g, "''");
    config.dbUser = dbUserClean;
    config.dbName = dbName;
    installState.dbPass = dbPass;
    const pgEnv = { ...process.env, PGPASSWORD: rawPass };
    installState.step = 'Configurando PostgreSQL...';
    log('Creando usuario y databases...', 'step');
    try {
      execSync(`su - postgres -c "psql -tc \\"SELECT 1 FROM pg_roles WHERE rolname='${dbUserClean}'\\" | grep -q 1 || psql -c \\"CREATE USER ${dbUserClean} WITH PASSWORD '${dbPass}'\\"" 2>/dev/null || true`, { stdio: 'ignore', env: pgEnv });
      execSync(`su - postgres -c "psql -tc \\"SELECT 1 FROM pg_database WHERE datname='${dbName}'\\" | grep -q 1 || createdb -O ${dbUserClean} ${dbName}" 2>/dev/null || true`, { stdio: 'ignore', env: pgEnv });
      execSync(`su - postgres -c "psql -c \\"ALTER USER ${dbUserClean} WITH PASSWORD '${dbPass}';\\"" 2>/dev/null || true`, { stdio: 'ignore' });
      log('PostgreSQL listo', 'ok');
    } catch (e) {
      log('Error PostgreSQL: ' + e.message, 'warn');
    }

    // Step 3: Generate secrets
    const jwtSecret = require('crypto').randomBytes(32).toString('hex');
    const companyName = config.companyName || 'Mi Empresa';
    const companyDomain = config.domain || 'localhost';
    const adminEmail = config.adminEmail || `admin@${companyDomain === 'localhost' ? 'miempresa.com' : companyDomain}`;
    const adminPass = config.adminPass || require('crypto').randomBytes(4).toString('hex') + 'Admin1!';
    installState.adminPass = adminPass;

    // Step 4: Create .env at root with ALL config
    installState.step = 'Generando .env...';
    const envVars = {
      PORT: config.serverPort || 3002,
      JWT_SECRET: jwtSecret,
      COMPANY_NAME: companyName,
      COMPANY_DOMAIN: companyDomain,
      PGHOST: config.dbHost || 'localhost',
      PGPORT: config.dbPort || 5432,
      PGUSER: config.dbUser || 'postgres',
      PGPASSWORD: dbPass,
      PGDATABASE: dbName,
      NODE_ENV: 'production',
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASS: adminPass,
      SMTP_HOST: config.smtpHost || '',
      SMTP_PORT: String(config.smtpPort || 587),
      SMTP_SECURE: config.smtpSecure || 'false',
      SMTP_USER: config.smtpUser || '',
      SMTP_PASS: config.smtpPass || '',
      SMTP_FROM: config.smtpFrom || adminEmail,
      SMTP_FROM_NAME: config.smtpFromName || companyName,
      INSTALL_DIR: config.installDir || '/opt/synnoxerp',
      LAUNCHER_URL: `http://localhost:${config.serverPort || 3002}`,
      OSRM_URL: 'https://router.project-osrm.org',
    };
    const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(path.join(INSTALL_DIR, '.env'), envContent);

    // Also write launcher .env (needed for SQLite launcher)
    const launcherEnvDir = path.join(INSTALL_DIR, 'launcher');
    if (!fs.existsSync(launcherEnvDir)) fs.mkdirSync(launcherEnvDir, { recursive: true });
    fs.writeFileSync(path.join(launcherEnvDir, '.env'), `JWT_SECRET=${jwtSecret}\nADMIN_EMAIL=${adminEmail}\nADMIN_PASS=${adminPass}\nPORT=${config.serverPort || 3002}\nCOMPANY_NAME=${companyName}\nSMTP_FROM_NAME=${config.smtpFromName || companyName}\n`);
    log('.env creado en raíz y launcher/', 'ok');

    // Step 5: npm install (single root)
    installState.step = 'Instalando dependencias npm...';
    try {
      await runCmd('npm', ['install', '--omit=dev'], { cwd: INSTALL_DIR });
      log('npm install completado', 'ok');
    } catch (e) { log('npm: ' + e.message, 'warn'); }

    // Rebuild native addons
    try { await runCmd('npm', ['rebuild'], { cwd: INSTALL_DIR }); } catch {}

    // Step 6: Migraciones (todas en la misma DB)
    installState.step = 'Ejecutando migraciones...';
    const dbEnv = { ...process.env, PGPASSWORD: dbPass, PGHOST: config.dbHost || 'localhost', PGUSER: config.dbUser, PGDATABASE: dbName, DB_USER: config.dbUser, DB_PASSWORD: dbPass, DB_NAME: dbName };
    try {
      await runCmd('psql', ['-U', config.dbUser, '-h', config.dbHost || 'localhost', '-d', dbName, '-c', 'CREATE SCHEMA IF NOT EXISTS logistics;'], { env: pgEnv });
      const migDir = path.join(INSTALL_DIR, 'modules/logistica/backend/migrations');
      if (fs.existsSync(migDir)) {
        const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
        for (const f of files) {
          try { await runCmd('psql', ['-U', config.dbUser, '-h', config.dbHost || 'localhost', '-d', dbName, '-f', path.join(migDir, f)], { env: pgEnv }); } catch {}
        }
        log('Logistica: migraciones ok', 'ok');
      }
    } catch (e) { log('Migraciones logistica: ' + e.message, 'warn'); }

    try {
      await runCmd('node', ['src/db/migrate.js'], { cwd: path.join(INSTALL_DIR, 'modules/proveedores'), env: dbEnv });
      log('Proveedores: migraciones ok', 'ok');
    } catch (e) { log('Proveedores migrate: ' + e.message, 'warn'); }

    // Step 7: Demo seeds
    if (config.runSeeds !== false) {
      installState.step = 'Sembrando datos demo...';
      if (config.modules.includes('logistica') && fs.existsSync(path.join(INSTALL_DIR, 'modules/logistica/backend/db/seed-demo.js'))) {
        try {
          await runCmd('node', ['backend/db/seed-demo.js'], { cwd: path.join(INSTALL_DIR, 'modules/logistica'), env: dbEnv });
          log('Logística: datos demo', 'ok');
        } catch (e) { log('Seed-demo logistica: ' + e.message, 'warn'); }
      }
      if (config.modules.includes('proveedores') && fs.existsSync(path.join(INSTALL_DIR, 'modules/proveedores/src/db/seed-demo.js'))) {
        try {
          await runCmd('node', ['src/db/seed-demo.js'], { cwd: path.join(INSTALL_DIR, 'modules/proveedores'), env: dbEnv });
          log('Proveedores: datos demo', 'ok');
        } catch (e) { log('Seed-demo proveedores: ' + e.message, 'warn'); }
      }
    }

    // Step 9 — Nginx config

    // Step 8: PM2 (single process)
    installState.step = 'Configurando PM2...';
    try {
      for (const name of ['horix-erp', 'logistics', 'docflow', 'horix', 'synnoxerp']) {
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
      const domain = (config.domain || 'localhost').replace(/[^a-zA-Z0-9._-]/g, '');
      const appName = (config.companyName || 'mi-empresa').toLowerCase().replace(/[^a-z0-9]/g, '-');
      const sslDir = `/etc/ssl/${appName}`;
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
      const appName = (config.companyName || 'mi-empresa').toLowerCase().replace(/[^a-z0-9]/g, '-');
      fs.writeFileSync(`/etc/nginx/sites-available/${appName}`, nginxConf);
      try { execSync(`ln -sf /etc/nginx/sites-available/${appName} /etc/nginx/sites-enabled/`, { stdio: 'ignore' }); } catch {}
      try { execSync('nginx -t 2>/dev/null && systemctl reload nginx || true', { stdio: 'ignore' }); } catch {}
      log('Nginx configurado', 'ok');
    } catch (e) { log('Nginx: ' + e.message, 'warn'); }

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
    res.end(JSON.stringify({ running: installState.running, step: installState.step, logs: installState.logs.slice(-50), dbPass: installState.dbPass || null, adminPass: installState.adminPass || null }));
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
  console.log(`║     SynnoxERP — Instalador Web               ║`);
  console.log(`║                                               ║`);
  console.log(`║  Abre en tu navegador:                       ║`);
  console.log(`║    http://${addr}:${PORT}                        ║`);
  console.log(`║    http://localhost:${PORT}                    ║`);
  console.log(`╚═════════════════════════════════════════════════╝`);
});
