let currentStep = 0;
const totalSteps = 7;

const config = {
  dbHost: 'localhost',
  dbPort: 5432,
  dbUser: 'horix',
  dbPass: '',
  adminEmail: 'admin@horix.com',
  adminPass: 'admin123',
  domain: 'localhost',
  modules: ['logistics', 'docflow'],
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
    document.getElementById('next-0').disabled = !allOk;
    if (!allOk) {
      container.innerHTML += '<div style="color:var(--warning);font-size:13px;width:100%;">Algunos requisitos faltan. El instalador intentará instalarlos automáticamente.</div>';
      document.getElementById('next-0').disabled = false;
    }
  } catch {
    container.innerHTML = '<div style="color:var(--danger);font-size:13px;">Error al verificar requisitos. Asegúrate de que el servidor del instalador esté corriendo.</div>';
  }
}

function validateReqs() { return true; }

// ─── Step 1: DB ────────────────────────────────────────────
// Values collected in nextStep()

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
  const btn = document.querySelector('#step-4 .btn-primary');
  const clean = document.getElementById('clean-install').checked;
  if (clean) {
    btn.disabled = val !== 'CONFIRMAR';
  } else {
    btn.disabled = false;
  }
}

// ─── Step 4: Review ────────────────────────────────────────
function buildSummary() {
  document.getElementById('summary').innerHTML = `
    <div class="summary-item"><div class="s-label">Base de datos</div><div class="s-val">${document.getElementById('db-host').value}:${document.getElementById('db-port').value}</div></div>
    <div class="summary-item"><div class="s-label">Usuario DB</div><div class="s-val">${document.getElementById('db-user').value}</div></div>
    <div class="summary-item"><div class="s-label">Admin email</div><div class="s-val">${document.getElementById('admin-email').value}</div></div>
    <div class="summary-item"><div class="s-label">Dominio</div><div class="s-val">${document.getElementById('domain').value}</div></div>
    <div class="summary-item"><div class="s-label">Módulos</div><div class="s-val">${getSelectedMods().join(', ') || 'Ninguno'}</div></div>
  `;
}

function getSelectedMods() {
  return [...document.querySelectorAll('.mod-option.checked')].map(el => el.dataset.mod);
}

// ─── Collect values before advancing ───────────────────────
const origNext = nextStep;
nextStep = function() {
  if (currentStep === 1) {
    config.dbHost = document.getElementById('db-host').value;
    config.dbPort = parseInt(document.getElementById('db-port').value);
    config.dbUser = document.getElementById('db-user').value;
    config.dbPass = document.getElementById('db-pass').value;
  }
  if (currentStep === 2) {
    config.adminEmail = document.getElementById('admin-email').value;
    config.adminPass = document.getElementById('admin-pass').value;
    config.domain = document.getElementById('domain').value;
  }
  if (currentStep === 3) {
    config.modules = getSelectedMods();
  config.clean = document.getElementById('clean-install').checked;
  }
  if (currentStep === 4) {
    buildSummary();
  }
  origNext();
};

// ─── Step 5: Install ──────────────────────────────────────
function startInstall() {
  currentStep = 5;
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
    div.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg log-${data.type}">${escapeHtml(data.msg)}</span>`;
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

  // Poll status for step title
  const statusInt = setInterval(async () => {
    try {
      const r = await fetch('/api/install/status');
      const s = await r.json();
      document.getElementById('install-status').textContent = s.step || 'Instalando...';
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

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Step 6: Complete ──────────────────────────────────────
function showComplete() {
  currentStep = 6;
  updateSteps();
  const isLocal = config.domain === 'localhost';
  document.getElementById('complete-info').innerHTML = `
    <div class="comp-item"><div class="comp-label">🌐 Plataforma</div><div class="comp-val"><a href="${isLocal ? 'http://localhost:3002' : 'https://'+config.domain}">${isLocal ? 'http://localhost:3002' : 'https://'+config.domain}</a></div></div>
    ${config.modules.includes('logistics') ? `<div class="comp-item"><div class="comp-label">🚚 Logística</div><div class="comp-val"><a href="${isLocal ? 'http://localhost:3004' : 'https://'+config.domain+'/logistics/'}">${isLocal ? 'http://localhost:3004' : 'https://'+config.domain+'/logistics/'}</a></div></div>` : ''}
    ${config.modules.includes('docflow') ? `<div class="comp-item"><div class="comp-label">📄 DocFlow</div><div class="comp-val"><a href="${isLocal ? 'http://localhost:3100' : 'https://'+config.domain+'/docflow/'}">${isLocal ? 'http://localhost:3100' : 'https://'+config.domain+'/docflow/'}</a></div></div>` : ''}
    ${config.modules.includes('horix') ? `<div class="comp-item"><div class="comp-label">🏭 Horix ERP</div><div class="comp-val"><a href="${isLocal ? 'http://localhost:3000' : 'https://'+config.domain+'/horix/'}">${isLocal ? 'http://localhost:3000' : 'https://'+config.domain+'/horix/'}</a></div></div>` : ''}
    <div class="comp-item"><div class="comp-label">👤 Admin email</div><div class="comp-val">${config.adminEmail}</div></div>
    <div class="comp-item"><div class="comp-label">🔑 Contraseña</div><div class="comp-val">${config.adminPass}</div></div>
    <div class="comp-item"><div class="comp-label">🔧 PM2</div><div class="comp-val">pm2 status (3 procesos)</div></div>
  `;
}

function openLogin() {
  const url = config.domain === 'localhost' ? 'http://localhost:3002' : `https://${config.domain}`;
  window.open(url, '_blank');
}

// ─── Init ──────────────────────────────────────────────────
updateSteps();
loadRequirements();

// Auto-detect server IP for domain field
fetch('/api/ip').then(r => r.json()).then(d => {
  if (d.ip && d.ip !== 'localhost') document.getElementById('domain').value = d.ip;
}).catch(() => {});
