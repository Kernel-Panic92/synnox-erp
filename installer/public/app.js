let currentStep = 0;
let installDbPass = '';
let installAdminPass = '';
const totalSteps = 9;

const config = {
  companyName: 'Mi Empresa',
  domain: 'localhost',
  nginxPort: 443,
  adminEmail: '',
  adminPass: '',
  smtpFrom: '',
  dbHost: 'localhost',
  dbPort: 5432,
  dbName: 'mi_erp',
  dbUser: 'postgres',
  dbPass: '',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: 'false',
  smtpFromName: '',
  serverPort: 3002,
  installDir: '/opt/synnoxerp',
  repoUrl: 'https://github.com/synnoxerp/synnox-erp.git',
  modules: ['proveedores', 'logistica', 'proyectos'],
  clean: false,
  runSeeds: true,
};

function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

function updateSteps() {
  document.querySelectorAll('.step-ind').forEach((el, i) => {
    el.classList.toggle('active', i === currentStep);
    el.classList.toggle('done', i < currentStep);
  });
  document.querySelectorAll('.page').forEach((el, i) => {
    el.classList.toggle('active', i === currentStep);
  });
  scrollToTop();
}

function nextStep() {
  if (currentStep === 0 && !validateReqs()) return;
  if (currentStep < totalSteps - 1) { currentStep++; updateSteps(); }
}

function prevStep() {
  if (currentStep > 0) { currentStep--; updateSteps(); }
}

// ─── Step 0: Requirements ─────────────────────────────────
async function loadRequirements() {
  const container = document.getElementById('requirements');
  container.innerHTML = '<div style="color:var(--muted);font-size:13px;">🔍 Verificando requisitos...</div>';
  try {
    const r = await fetch('/api/requirements');
    const checks = await r.json();
    container.innerHTML = checks.map(c => `
      <div class="req-item ${c.ok ? 'ok' : 'fail'}">
        <span class="req-ico">${c.ok ? '✅' : '❌'}</span>
        <span class="req-name">${c.name}</span>
        <span class="req-val">${c.value}</span>
      </div>
    `).join('');
    const allOk = checks.every(c => c.ok);
    document.getElementById('next-0').disabled = false;
    if (!allOk) {
      container.innerHTML += '<div style="color:var(--warning);font-size:13px;width:100%;">Algunos requisitos faltan. El instalador intentará instalarlos automáticamente.</div>';
    }
  } catch {
    container.innerHTML = '<div style="color:var(--danger);font-size:13px;">Error al verificar requisitos. Asegúrate de que el servidor del instalador esté corriendo.</div>';
  }
}

function validateReqs() { return true; }

// ─── Step 3: Modules toggle ────────────────────────────────
document.addEventListener('click', e => {
  const opt = e.target.closest('.mod-option');
  if (!opt) return;
  const isChecked = opt.classList.toggle('checked');
  opt.querySelector('input').checked = isChecked;
});

function toggleClean() {
  const cb = document.getElementById('clean-install');
  document.getElementById('clean-confirm').style.display = cb.checked ? 'block' : 'none';
  document.getElementById('clean-confirm-input').value = '';
}

function checkCleanConfirm() {
  const val = document.getElementById('clean-confirm-input').value;
  const btn = document.querySelector('#step-6 .btn-primary');
  const clean = document.getElementById('clean-install').checked;
  if (clean) {
    btn.disabled = val !== 'CONFIRMAR';
  } else {
    btn.disabled = false;
  }
}

// ─── Step 6: Review ────────────────────────────────────────
function buildSummary() {
  const emailDomain = config.adminEmail.split('@')[1] || 'miempresa.com';
  document.getElementById('summary').innerHTML = `
    <div class="summary-item"><div class="s-label">Empresa</div><div class="s-val">${esc(config.companyName)}</div></div>
    <div class="summary-item"><div class="s-label">Dominio</div><div class="s-val">${esc(config.domain)}</div></div>
    <div class="summary-item"><div class="s-label">Admin email</div><div class="s-val">${esc(config.adminEmail)}</div></div>
    <div class="summary-item"><div class="s-label">Puerto servidor</div><div class="s-val">${config.serverPort}</div></div>
    <div class="summary-item"><div class="s-label">Base de datos</div><div class="s-val">${esc(config.dbHost)}:${config.dbPort}/${esc(config.dbName)}</div></div>
    <div class="summary-item"><div class="s-label">Usuario DB</div><div class="s-val">${esc(config.dbUser)}</div></div>
    <div class="summary-item"><div class="s-label">SMTP</div><div class="s-val">${config.smtpHost || 'No configurado (opcional)'}</div></div>
    <div class="summary-item"><div class="s-label">Instalar en</div><div class="s-val">${esc(config.installDir)}</div></div>
    <div class="summary-item"><div class="s-label">Módulos</div><div class="s-val">${getSelectedMods().join(', ') || 'Ninguno'}</div></div>
    <div class="summary-item"><div class="s-label">Datos demo</div><div class="s-val">${config.runSeeds ? '✅ Sí' : '❌ No'}</div></div>
  `;
}

function getSelectedMods() {
  return [...document.querySelectorAll('.mod-option.checked')].map(el => el.dataset.mod);
}

// ─── Collect values before advancing ───────────────────────
const origNext = nextStep;
nextStep = function() {
  if (currentStep === 1) {
    config.companyName = document.getElementById('company-name').value.trim() || 'Mi Empresa';
    config.domain = document.getElementById('domain').value.trim() || 'localhost';
    config.nginxPort = parseInt(document.getElementById('nginx-port').value) || 443;
    config.adminEmail = document.getElementById('admin-email').value.trim();
    config.adminPass = document.getElementById('admin-pass').value.trim();
    config.smtpFrom = document.getElementById('smtp-from').value.trim();
    if (!config.adminEmail) config.adminEmail = 'admin@' + (config.domain === 'localhost' ? 'miempresa.com' : config.domain);
  }
  if (currentStep === 2) {
    config.dbHost = document.getElementById('db-host').value.trim() || 'localhost';
    config.dbPort = parseInt(document.getElementById('db-port').value) || 5432;
    config.dbName = document.getElementById('db-name').value.trim() || 'mi_erp';
    config.dbUser = document.getElementById('db-user').value.trim() || 'postgres';
    config.dbPass = document.getElementById('db-pass').value.trim();
  }
  if (currentStep === 3) {
    config.smtpHost = document.getElementById('smtp-host').value.trim();
    config.smtpPort = parseInt(document.getElementById('smtp-port').value) || 587;
    config.smtpUser = document.getElementById('smtp-user').value.trim();
    config.smtpPass = document.getElementById('smtp-pass').value;
    config.smtpSecure = document.getElementById('smtp-secure').value;
    config.smtpFromName = document.getElementById('smtp-from-name').value.trim() || config.companyName;
  }
  if (currentStep === 4) {
    config.serverPort = parseInt(document.getElementById('server-port').value) || 3002;
    config.installDir = document.getElementById('install-dir').value.trim() || '/opt/synnoxerp';
    config.repoUrl = document.getElementById('repo-url').value.trim() || 'https://github.com/synnoxerp/synnox-erp.git';
    config.runSeeds = document.getElementById('seed-demo').checked;
  }
  if (currentStep === 5) {
    config.modules = getSelectedMods();
    config.clean = document.getElementById('clean-install').checked;
    config.runSeeds = document.getElementById('seed-demo').checked;
  }
  if (currentStep === 6) {
    buildSummary();
  }
  origNext();
};

// ─── Step 7: Install ──────────────────────────────────────
function startInstall() {
  currentStep = 7;
  updateSteps();
  document.getElementById('install-logs').innerHTML = '';
  document.getElementById('retry-btn').style.display = 'none';

  const logsContainer = document.getElementById('install-logs');

  // Connect to SSE
  const evtSource = new EventSource('/api/install/logs');
  evtSource.onmessage = e => {
    const data = JSON.parse(e.data);
    const div = document.createElement('div');
    div.className = 'log-entry';
    const ts = data.ts ? data.ts.slice(11, 19) : '';
    div.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg log-${data.type}">${esc(data.msg)}</span>`;
    logsContainer.appendChild(div);
    logsContainer.scrollTop = logsContainer.scrollHeight;

    if (data.type === 'complete') {
      evtSource.close();
      setTimeout(() => showComplete(), 1000);
    }
    if (data.type === 'error') {
      document.getElementById('retry-btn').style.display = 'inline-block';
    }
  };

  // Poll status for step title and dbPass
  installDbPass = '';
  const statusInt = setInterval(async () => {
    try {
      const r = await fetch('/api/install/status');
      const s = await r.json();
      document.getElementById('install-status').textContent = s.step || 'Instalando...';
      if (s.dbPass) installDbPass = s.dbPass;
      if (s.adminPass) installAdminPass = s.adminPass;
      if (!s.running) { clearInterval(statusInt); }
    } catch {}
  }, 1000);

  // Start install
  fetch('/api/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).catch(() => {});
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Step 8: Complete ──────────────────────────────────────
function showComplete() {
  currentStep = 8;
  updateSteps();
  const isLocal = config.domain === 'localhost';
  const baseUrl = isLocal ? `http://localhost:${config.serverPort}` : `https://${config.domain}`;
  const adminPass = installAdminPass || config.adminPass || '(la que configuraste)';

  document.getElementById('complete-desc').textContent = `${config.companyName} está listo para usar. Guarda estas credenciales.`;
  document.getElementById('complete-info').innerHTML = `
    <div class="comp-item"><div class="comp-label">🏢 Empresa</div><div class="comp-val">${esc(config.companyName)}</div></div>
    <div class="comp-item"><div class="comp-label">🌐 Plataforma</div><div class="comp-val"><a href="${baseUrl}">${baseUrl}</a></div></div>
    ${config.modules.includes('proveedores') ? `<div class="comp-item"><div class="comp-label">📄 Proveedores</div><div class="comp-val"><a href="${baseUrl}/proveedores/">${baseUrl}/proveedores/</a></div></div>` : ''}
    ${config.modules.includes('logistica') ? `<div class="comp-item"><div class="comp-label">🚚 Logística</div><div class="comp-val"><a href="${baseUrl}/logistica/">${baseUrl}/logistica/</a></div></div>` : ''}
    ${config.modules.includes('nomina') ? `<div class="comp-item"><div class="comp-label">💰 Nómina</div><div class="comp-val"><a href="${baseUrl}/nomina/">${baseUrl}/nomina/</a></div></div>` : ''}
    ${config.modules.includes('proyectos') ? `<div class="comp-item"><div class="comp-label">📋 Proyectos</div><div class="comp-val"><a href="${baseUrl}/proyectos/">${baseUrl}/proyectos/</a></div></div>` : ''}
    <div class="comp-item"><div class="comp-label">👤 Admin email</div><div class="comp-val">${esc(config.adminEmail)}</div></div>
    <div class="comp-item"><div class="comp-label">🔑 Contraseña</div><div class="comp-val">${adminPass}</div></div>
    ${installDbPass ? `<div class="comp-item"><div class="comp-label">🗄️ DB Password</div><div class="comp-val" style="font-family:monospace;font-size:12px;">${installDbPass}</div></div>` : ''}
    <div class="comp-item"><div class="comp-label">📁 Instalado en</div><div class="comp-val">${esc(config.installDir)}</div></div>
    <div class="comp-item"><div class="comp-label">🔧 PM2</div><div class="comp-val">pm2 status</div></div>
  `;
}

function openLogin() {
  const url = config.domain === 'localhost' ? `http://localhost:${config.serverPort}` : `https://${config.domain}`;
  window.open(url, '_blank');
}

// ─── Init ──────────────────────────────────────────────────
updateSteps();
loadRequirements();

// Auto-detect server IP for domain field
fetch('/api/ip').then(r => r.json()).then(d => {
  if (d.ip && d.ip !== 'localhost') document.getElementById('domain').value = d.ip;
}).catch(() => {});

// Generate random admin password on load
const generatedPass = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[b % 57]).join('');
document.getElementById('admin-pass').placeholder = generatedPass;

// Suggest DB user from hostname or default
fetch('/api/install/status').then(r => r.json()).catch(() => {});

// Generate random DB password
const generatedDbPass = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
document.getElementById('db-pass').placeholder = generatedDbPass;
