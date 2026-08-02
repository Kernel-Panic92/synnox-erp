let jwtToken = localStorage.getItem('platform_jwt');
let user = null;
const INSTALL_DIR = window.INSTALL_DIR || '';
let _serverStatsTimer = null;
let _serverStatsInFlight = false;
let _notifPollTimer = null;
let _lastNotifCount = 0;
let _notifInFlight = false;
let _versionCheckTimer = null;
let _visibilityListenerInstalled = false;
let _clickOutsideListenerInstalled = false;
let _widgetAbort = null;

function fetchAuth(url, opts = {}) {
  const { timeout = 15000, ...rest } = opts;
  return fetch(url, {
    signal: rest.signal || AbortSignal.timeout(timeout),
    ...rest,
    headers: { 'Authorization': 'Bearer ' + jwtToken, ...(rest.headers || {}) }
  });
}

function esc(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(s||'')); return d.innerHTML; }

// Widget cache helpers
function cacheGet(key, ttlMs) {
  try {
    const c = JSON.parse(localStorage.getItem('w_' + key) || 'null');
    if (c && Date.now() - c.ts < ttlMs) return c.data;
  } catch {}
  return null;
}
function cacheSet(key, data) {
  try { localStorage.setItem('w_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}
function cleanExpiredWidgetCache() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('w_'));
  for (const key of keys) {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      if (c && c.ts && (Date.now() - c.ts > 300000)) localStorage.removeItem(key); // 5 min
    } catch { localStorage.removeItem(key); }
  }
}

function confirmModal(msg, title = 'Confirmar', type = 'delete') {
  const types = {
    delete:  { icon: '🗑️', bg: 'rgba(239,68,68,0.1)',  btn: 'btn-danger' },
    update:  { icon: '🔄', bg: 'rgba(37,99,235,0.1)',   btn: 'btn-primary' },
    restart: { icon: '♻️', bg: 'rgba(234,179,8,0.1)',   btn: 'btn-primary' },
    info:    { icon: 'ℹ️', bg: 'rgba(148,163,184,0.1)', btn: 'btn-secondary' },
  };
  const t = types[type] || types.delete;
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = `
      <div data-confirm="1" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:32px;width:340px;text-align:center;flex-shrink:0">
        <div style="width:64px;height:64px;margin:0 auto 16px;background:${t.bg};border-radius:50%;display:flex;align-items:center;justify-content:center">
          <span style="font-size:28px">${t.icon}</span>
        </div>
        <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text)">${esc(title)}</h3>
        <p style="font-size:14px;color:var(--muted);margin-bottom:24px;line-height:1.5">${esc(msg)}</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn btn-sm" style="background:var(--surface2);color:var(--text);min-width:100px" onclick="this.closest('[data-confirm]').parentElement.remove();window._confirmResolve(false)">Cancelar</button>
          <button class="btn btn-sm ${t.btn}" style="min-width:100px" onclick="this.closest('[data-confirm]').parentElement.remove();window._confirmResolve(true)">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    window._confirmResolve = resolve;
  });
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.style.cssText = 'padding:12px 18px;border-radius:10px;font-size:14px;font-weight:500;max-width:380px;animation:toast-in .25s ease;box-shadow:0 4px 20px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;pointer-events:auto';
  const colors = { success: '#38a169', error: '#e05353', warning: '#d69e2e', info: '#5b9bf7' };
  const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
  el.style.background = (type === 'success' ? 'rgba(56,161,105,0.12)' : type === 'error' ? 'rgba(224,83,83,0.12)' : type === 'warning' ? 'rgba(214,158,46,0.12)' : 'rgba(91,155,247,0.12)');
  el.style.border = '1px solid ' + (colors[type] || colors.info) + '44';
  el.style.color = colors[type] || colors.info;
  el.innerHTML = '<span>' + (icons[type] || icons.info) + '</span> ' + msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ─── Theme toggle (universal: synnox_theme en localStorage) ────
(function initTheme() {
  let theme = localStorage.getItem('synnox_theme');
  if (!theme) { theme = 'dark'; localStorage.setItem('synnox_theme', 'dark'); }
  const root = document.documentElement;
  if (theme === 'dark') {
    root.style.setProperty('--bg', '#12141a');
    root.style.setProperty('--surface', '#1a1d28');
    root.style.setProperty('--surface2', '#222738');
    root.style.setProperty('--border', '#2e3548');
    root.style.setProperty('--text', '#e8ecf4');
    root.style.setProperty('--muted', '#8892a8');
  }
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
})();
function toggleTheme() {
  const root = document.documentElement;
  const isDark = localStorage.getItem('synnox_theme') !== 'light';
  if (isDark) {
    root.style.setProperty('--bg', '#f0f2f7');
    root.style.setProperty('--surface', '#ffffff');
    root.style.setProperty('--surface2', '#e8eaf0');
    root.style.setProperty('--border', '#d0d4e4');
    root.style.setProperty('--text', '#1a1d2e');
    root.style.setProperty('--muted', '#5a6180');
    localStorage.setItem('synnox_theme', 'light');
    document.getElementById('theme-btn').textContent = '🌙';
  } else {
    root.style.setProperty('--bg', '#12141a');
    root.style.setProperty('--surface', '#1a1d28');
    root.style.setProperty('--surface2', '#222738');
    root.style.setProperty('--border', '#2e3548');
    root.style.setProperty('--text', '#e8ecf4');
    root.style.setProperty('--muted', '#8892a8');
    localStorage.setItem('synnox_theme', 'dark');
    document.getElementById('theme-btn').textContent = '☀️';
  }
}

function show(id) {
  ['loading-screen', 'post-login-screen', 'login-screen', 'launcher-screen', 'admin-screen', 'admin-form-overlay', 'modulo-form-overlay'].forEach(s => {
    const el = document.getElementById(s);
    if (s === id) {
      el.style.display = (s === 'login-screen' || s === 'admin-screen' || s === 'post-login-screen') ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

function updatePostLoginStatus(text, pct) {
  const status = document.getElementById('post-login-status');
  const progress = document.getElementById('post-login-progress');
  if (status) status.textContent = text;
  if (progress) progress.style.width = pct + '%';
}

function showModuleLoading(icon, nombre) {
  const overlay = document.getElementById('module-loading-overlay');
  if (!overlay) return;
  document.getElementById('module-loading-icon').textContent = icon;
  document.getElementById('module-loading-name').textContent = 'Cargando ' + nombre + '...';
  overlay.style.display = 'flex';
}

async function login() {
  const email = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');

  if (!email || !password) {
    showError(errEl, 'Ingresa usuario y contrase\u00f1a');
    return;
  }

  errEl.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Ingresando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Credenciales inv\u00e1lidas');
    }

    const data = await res.json();
    jwtToken = data.jwt;
    user = data.usuario;

    localStorage.setItem('platform_jwt', jwtToken);
    show('post-login-screen');
    updatePostLoginStatus('Cargando módulos...', 30);
    await showLauncher();
  } catch (e) {
    showError(errEl, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

let launcherVersion = '';

let modulosCache = [];

async function loadModulosDinamicos(sig) {
  // Try sessionStorage cache first (TTL 5 min)
  try {
    const cached = sessionStorage.getItem('synnox_modulos_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.data && parsed.ts && (Date.now() - parsed.ts) < 300000) {
        modulosCache = parsed.data;
        return modulosCache;
      }
    }
  } catch {}
  // Fetch fresh data
  try {
    const res = await fetch('/api/modulos', { headers: { 'Authorization': 'Bearer ' + jwtToken }, signal: sig || AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('Error al cargar módulos');
    modulosCache = res.json ? await res.json() : [];
    // Cache in sessionStorage for instant reload
    try { sessionStorage.setItem('synnox_modulos_cache', JSON.stringify({ data: modulosCache, ts: Date.now() })); } catch {}
  } catch (e) {
    if (e.name !== 'AbortError') modulosCache = [];
  }
}

const SUBMODULOS = [
  { id: 'facturas', mod: 'proveedores', nombre: 'Facturas', icon: '📄', ruta: '/proveedores/#facturas' },
  { id: 'pendientes', mod: 'proveedores', nombre: 'Pendientes', icon: '⏰', ruta: '/proveedores/#pendientes' },
  { id: 'porpagar', mod: 'proveedores', nombre: 'Por Pagar', icon: '💳', ruta: '/proveedores/#porpagar' },
  { id: 'rutas', mod: 'logistica', nombre: 'Rutas', icon: '🛣️', ruta: '/logistica/#rutas' },
  { id: 'pedidos', mod: 'logistica', nombre: 'Pedidos', icon: '📦', ruta: '/logistica/#pedidos' },
  { id: 'clientes', mod: 'logistica', nombre: 'Clientes', icon: '👥', ruta: '/logistica/#clientes' },
  { id: 'registros', mod: 'nomina', nombre: 'Registros', icon: '📝', ruta: '/nomina/#registros' },
  { id: 'empleados', mod: 'nomina', nombre: 'Empleados', icon: '👤', ruta: '/nomina/#empleados' },
  { id: 'nominas', mod: 'nomina', nombre: 'Nóminas', icon: '💰', ruta: '/nomina/#nominas' },
  { id: 'kanban', mod: 'proyectos', nombre: 'Tablero', icon: '📋', ruta: '/proyectos/' },
];

function renderModulos(grid, mods) {
  if (!mods) mods = modulosCache;
  grid.innerHTML = '';
  const modulosDisponibles = (user?.rol === 'admin'
    ? mods
    : mods.filter(m => user?.modulos?.includes(m.id))
  ).map(m => ({
    id: m.id,
    nombre: m.nombre,
    icon: m.icon || '📦',
    desc: m.descripcion || '',
    ruta: m.proxy_prefix || (m.url ? new URL(m.url).pathname : '/' + m.id + '/'),
  }));
  const usage = JSON.parse(localStorage.getItem('submodule_usage') || '{}');
  modulosDisponibles.sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  for (const mod of modulosDisponibles) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = window.location.origin + mod.ruta;
    card.rel = 'noopener';
    card.onclick = (e) => {
      trackModuleVisit(mod.id);
      const hash = window.location.hash?.replace('#', '');
      if (hash) trackModuleVisit(hash);
      showModuleLoading(mod.icon, mod.nombre);
    };
    const count = usage[mod.id] || 0;
    card.innerHTML = `
      <div class="card-icon">${mod.icon}</div>
      <div class="card-title">${mod.nombre}${count > 0 ? ` <span style="font-size:11px;color:var(--muted);font-weight:400;">(${count})</span>` : ''}</div>
      <div class="card-desc">${mod.desc}</div>
    `;
    grid.appendChild(card);
  }
  if (user?.rol === 'admin') {
    const adminCard = document.createElement('div');
    adminCard.className = 'card';
    adminCard.onclick = showAdmin;
    adminCard.innerHTML = `
      <div class="card-icon">&#9881;</div>
      <div class="card-title">Admin</div>
      <div class="card-desc">Gestionar usuarios</div>
    `;
    grid.appendChild(adminCard);
  }
}

async function showLauncher() {
  // Cancel any pending admin fetches
  if (_widgetAbort) _widgetAbort.abort();
  _widgetAbort = new AbortController();
  const sig = _widgetAbort.signal;

  // Refresh user data from DB (so sidebar shows latest name/role)
  try {
    const res = await fetch('/api/auth/me', { signal: AbortSignal.timeout(5000), headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (res.ok) { const data = await res.json(); user = data; }
  } catch {}

  updatePostLoginStatus('Cargando perfil...', 60);
  document.getElementById('launcher-user').innerHTML = esc(user?.nombre || '') + (launcherVersion ? ' <span style="font-size:11px;color:var(--muted);font-weight:400;">v' + launcherVersion + '</span>' : '');
  document.getElementById('launcher-role').textContent = user?.perfil_nombre || user?.rol || '';

  updatePostLoginStatus('Cargando módulos...', 75);
  const grid = document.getElementById('module-grid');
  renderModulos(grid);
  loadModulosDinamicos(sig).then(() => renderModulos(grid));

  // Prefetch module HTML in background
  Promise.allSettled([
    fetch('/proveedores/', { mode: 'no-cors' }).catch(() => {}),
    fetch('/nomina/', { mode: 'no-cors' }).catch(() => {}),
    fetch('/logistica/', { mode: 'no-cors' }).catch(() => {}),
    fetch('/proyectos/', { mode: 'no-cors' }).catch(() => {}),
  ]);

  updatePostLoginStatus('Preparando dashboard...', 90);
  // Launcher = module selector only. Heavy widgets removed.
  // Only load lightweight widgets: QuickActions + Notifications
  const _deferredWidgets = async () => {
    if (user?.rol === 'admin') {
      await cargarQuickActions(sig);
      await cargarNotificacionesWidget(sig);
    } else {
      if (user?.rol === 'gerente') {
        await cargarQuickActions(sig);
        await cargarNotificacionesWidget(sig);
      } else {
        await cargarQuickActions(sig);
      }
    }
  };
  initNotifPolling();
  initVersionCheck();
  updatePostLoginStatus('Listo ✓', 100);
  show('launcher-screen');
  // Load widgets AFTER launcher is visible — defer by 2s to let module navigation complete
  setTimeout(_deferredWidgets, 2000);
}

function trackModuleVisit(moduleId) {
  // Save to localStorage immediately for instant UI update
  const usage = JSON.parse(localStorage.getItem('submodule_usage') || '{}');
  usage[moduleId] = (usage[moduleId] || 0) + 1;
  localStorage.setItem('submodule_usage', JSON.stringify(usage));
  // Also send to server for persistence
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submodule: moduleId })
  }).catch(() => {});
}

async function getTopSubmodules(limit = 6) {
  // Merge localStorage and server data
  const localUsage = JSON.parse(localStorage.getItem('submodule_usage') || '{}');
  let serverUsage = {};
  try {
    const res = await fetch('/api/track');
    serverUsage = await res.json();
  } catch {}
  // Merge: max of local and server counts
  const merged = {};
  for (const [k, v] of Object.entries(localUsage)) merged[k] = Math.max(merged[k] || 0, v);
  for (const [k, v] of Object.entries(serverUsage)) merged[k] = Math.max(merged[k] || 0, v);
  return Object.entries(merged)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

async function cargarQuickActions() {
  const w = document.getElementById('quick-actions-widget');
  const usage = JSON.parse(localStorage.getItem('submodule_usage') || '{}');
  const hasUsage = Object.keys(usage).length > 0;

  if (!hasUsage) {
    w.style.display = 'block';
    w.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
        <span style="font-size:18px;">💡</span>
        <span style="font-size:13px;color:var(--muted);">Los accesos frecuentes aparecerán aquí automáticamente</span>
      </div>`;
    return;
  }

  const top = await getTopSubmodules(6);
  const visible = top.map(t => SUBMODULOS.find(s => s.id === t.id)).filter(Boolean);

  if (!visible.length) { w.style.display = 'none'; return; }

  w.style.display = 'block';
  w.innerHTML = `
    <h2 style="margin-bottom:12px;">⚡ Accesos frecuentes</h2>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${visible.map(s => `
        <a href="${window.location.origin + s.ruta}" onclick="trackModuleVisit('${s.id}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);text-decoration:none;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <span>${s.icon}</span> ${s.nombre}
        </a>
      `).join('')}
    </div>`;
}

async function cargarModuleSummary() {
  const w = document.getElementById('module-summary-widget');
  if (!w) return;
  try {
    const [prov, logi, nomi, proy] = await Promise.allSettled([
      fetch('/proveedores/api/dashboard', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
      fetch('/logistica/api/dashboard/resumen', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
      fetch('/nomina/api/dashboard/resumen', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
      fetch('/proyectos/api/dashboard', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
    ]);
    const cards = [];
    if (prov.status === 'fulfilled' && prov.value) {
      const p = prov.value;
      cards.push({ icon: '📄', title: 'Proveedores', stats: [
        { label: 'Facturas', value: p.totalFacturas || 0 },
        { label: 'Pendientes', value: p.pendientes || 0 },
        { label: 'Por pagar', value: p.porPagar || 0 },
      ]});
    }
    if (logi.status === 'fulfilled' && logi.value) {
      const l = logi.value;
      cards.push({ icon: '🚚', title: 'Logística', stats: [
        { label: 'Pedidos hoy', value: l.pedidosHoy || 0 },
        { label: 'En ruta', value: l.enRuta || 0 },
        { label: 'Entregados', value: l.entregados || 0 },
      ]});
    }
    if (nomi.status === 'fulfilled' && nomi.value) {
      const n = nomi.value;
      cards.push({ icon: '📝', title: 'Nómina', stats: [
        { label: 'Registros', value: n.totalRegistros || 0 },
        { label: 'Pendientes', value: n.pendientes || 0 },
        { label: 'Aprobados', value: n.aprobados || 0 },
      ]});
    }
    if (proy.status === 'fulfilled' && proy.value) {
      const pr = proy.value;
      const estados = pr.estados || [];
      const pendientes = estados.find(e => e.estado === 'pendiente')?.count || 0;
      const enProgreso = estados.find(e => e.estado === 'en_progreso')?.count || 0;
      const completadas = estados.find(e => e.estado === 'completada')?.count || 0;
      cards.push({ icon: '📋', title: 'Proyectos', stats: [
        { label: 'Pendientes', value: pendientes },
        { label: 'En progreso', value: enProgreso },
        { label: 'Completadas', value: completadas },
      ]});
    }
    if (!cards.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">📊 Resumen del día</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${cards.map(c => `<div style="padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:10px;">${c.icon} ${c.title}</div>
          ${c.stats.map(s => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:var(--muted);">${s.label}</span><strong>${s.value}</strong></div>`).join('')}
        </div>`).join('')}
      </div>`;
  } catch { w.innerHTML = '<div class="widget-skeleton"><div style="padding:8px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar</div></div>'; }
}

async function cargarPendingTasks() {
  const w = document.getElementById('pending-tasks-widget');
  if (!w) return;
  try {
    const tasks = [];
    const [prov, nomi] = await Promise.allSettled([
      fetch('/proveedores/api/facturas?estado=pendiente', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
      fetch('/nomina/api/registros?estado=pendiente', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
    ]);
    if (prov.status === 'fulfilled' && prov.value?.rows) {
      const pending = prov.value.rows.length || prov.value.length || 0;
      if (pending > 0) tasks.push({ icon: '📄', text: `${pending} factura(s) pendiente(s) por revisar`, link: '/proveedores/#pendientes' });
    }
    if (nomi.status === 'fulfilled' && nomi.value) {
      const n = Array.isArray(nomi.value) ? nomi.value : nomi.value.rows || [];
      const pending = n.filter(r => r.estado === 'pendiente').length;
      if (pending > 0) tasks.push({ icon: '📝', text: `${pending} registro(s) de nómina pendiente(s)`, link: '/nomina/#registros' });
    }
    if (!tasks.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">📋 Tareas pendientes</h2>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${tasks.map(t => `<a href="${t.link}" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(247,151,79,0.08);border:1px solid rgba(247,151,79,0.2);border-radius:8px;font-size:13px;color:var(--text);text-decoration:none;">
          <span style="font-size:16px;">${t.icon}</span> ${t.text}
        </a>`).join('')}
      </div>`;
  } catch { w.innerHTML = '<div class="widget-skeleton"><div style="padding:8px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar</div></div>'; }
}

async function cargarAlerts() {
  const w = document.getElementById('alerts-widget');
  if (!w) return;
  try {
    const alerts = [];
    const [diskRes, healthRes] = await Promise.allSettled([
      fetch('/api/admin/server/stats', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
      fetch('/api/admin/health', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null)
    ]);
    const disk = diskRes.status === 'fulfilled' ? diskRes.value : null;
    const health = healthRes.status === 'fulfilled' ? healthRes.value : null;
    if (disk?.disk) {
      const pct = parseInt(disk.disk.usePct);
      if (pct > 90) alerts.push({ level: 'danger', icon: '🔴', text: `Disco al ${pct}% — espacio crítico` });
      else if (pct > 80) alerts.push({ level: 'warning', icon: '🟡', text: `Disco al ${pct}% — considerar limpiar` });
    }
    if (Array.isArray(health)) {
      for (const m of health) {
        if (m.estado !== 'online') alerts.push({ level: 'danger', icon: '🔴', text: `Módulo ${m.nombre}: ${m.estado}${m.error ? ' — ' + m.error : ''}` });
      }
    }
    if (!alerts.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">⚠️ Alertas</h2>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${alerts.map(a => `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${a.level === 'danger' ? 'rgba(231,76,60,0.08)' : 'rgba(247,151,79,0.08)'};border:1px solid ${a.level === 'danger' ? 'rgba(231,76,60,0.2)' : 'rgba(247,151,79,0.2)'};border-radius:8px;font-size:13px;">
          <span>${a.icon}</span> ${a.text}
        </div>`).join('')}
      </div>`;
  } catch { w.innerHTML = '<div class="widget-skeleton"><div style="padding:8px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar</div></div>'; }
}

async function cargarUpcoming() {
  const w = document.getElementById('upcoming-widget');
  if (!w) return;
  try {
    const res = await fetch('/proveedores/api/facturas?proximas=true', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) { w.style.display = 'none'; return; }
    const data = await res.json();
    const items = data.rows || data || [];
    if (!items.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">📅 Próximos vencimientos</h2>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${items.slice(0, 5).map(f => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px;">
          <span>${f.proveedor || f.numero || '—'}</span>
          <span style="color:var(--muted);">${f.fechaVencimiento || f.fecha_vencimiento || '—'}</span>
        </div>`).join('')}
      </div>`;
  } catch { w.innerHTML = '<div class="widget-skeleton"><div style="padding:8px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar</div></div>'; }
}

function cargarWeather() {
  const w = document.getElementById('weather-widget');
  if (!w) return;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude: lat, longitude: lng } = pos.coords;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=America/Bogota`);
        const data = await res.json();
        const c = data.current;
        const weatherIcons = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 51: '🌦️', 61: '🌧️', 71: '❄️', 95: '⛈️' };
        const icon = weatherIcons[c.weather_code] || '🌤️';
        w.style.display = 'block';
        w.innerHTML = `
          <h2 style="margin-bottom:12px;">🌤️ Clima</h2>
          <div style="padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:32px;">${icon}</span>
              <div>
                <div style="font-size:24px;font-weight:700;">${c.temperature_2m}°C</div>
                <div style="font-size:12px;color:var(--muted);">Humedad: ${c.relative_humidity_2m}% · Viento: ${c.wind_speed_10m} km/h</div>
              </div>
            </div>
          </div>`;
      } catch { w.style.display = 'none'; }
    }, () => { w.style.display = 'none'; }, { timeout: 5000 });
  } else { w.style.display = 'none'; }
}

async function cargarActivity(sig) {
  const w = document.getElementById('activity-widget');
  if (!w) return;
  try {
    const cached = cacheGet('activity', 60000);
    let logs = cached;
    if (!logs) {
      const res = await fetchAuth('/api/admin/login-logs', { signal: sig || AbortSignal.timeout(15000) });
      if (!res.ok) { w.style.display = 'none'; return; }
      const data = await res.json();
      logs = data.logs || data.rows || data || [];
      if (logs.length) cacheSet('activity', logs);
    }
    if (!logs.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">👤 Actividad reciente</h2>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${logs.slice(0, 8).map(l => {
          const d = new Date(l.fecha || l.timestamp || l.creado);
          const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
          const icon = l.exitoso ? '🔑' : '🚫';
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;">
            <span>${icon}</span>
            <span style="flex:1;color:var(--text);">${esc(l.email || l.usuario || '—')}</span>
            <span style="color:var(--muted);">${hora}</span>
          </div>`;
        }).join('')}
      </div>`;
  } catch { w.innerHTML = '<div class="widget-skeleton"><div style="padding:8px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar</div></div>'; }
}

async function cargarCommits(sig) {
  const w = document.getElementById('commits-widget');
  if (!w) return;
  try {
    const cached = cacheGet('commits', 120000);
    let data = cached;
    if (!data) {
      const res = await fetchAuth('/api/admin/commits?limit=8', { signal: sig || AbortSignal.timeout(15000) });
      if (!res.ok) { w.style.display = 'none'; return; }
      data = await res.json();
      if (data.ok) cacheSet('commits', data);
    }
    if (!data.ok || !data.commits?.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">📝 Últimos cambios</h2>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${data.commits.map(c => {
          const d = new Date(c.date);
          const fecha = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
          const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px;">
            <code style="color:var(--accent);font-size:11px;white-space:nowrap;">${c.hash.slice(0, 7)}</code>
            <span style="flex:1;color:var(--text);">${esc(c.message)}</span>
            <span style="color:var(--muted);font-size:11px;white-space:nowrap;">${fecha} ${hora}</span>
          </div>`;
        }).join('')}
      </div>`;
  } catch { w.innerHTML = '<div class="widget-skeleton"><div style="padding:8px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar</div></div>'; }
}

async function cargarServerStats(sig) {
  const w = document.getElementById('server-stats-widget');
  if (!w || _serverStatsInFlight) return;
  if (document.visibilityState !== 'visible') { _serverStatsTimer = setTimeout(() => { if (document.getElementById('launcher-screen').style.display !== 'none') cargarServerStats(); }, 30000); return; }
  _serverStatsInFlight = true;
  clearTimeout(_serverStatsTimer);
  try {
    const cached = cacheGet('serverStats', 60000);
    let s = cached;
    if (!s) {
      const res = await fetchAuth('/api/admin/server/stats', { signal: sig || AbortSignal.timeout(15000) });
      if (!res.ok) { w.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar stats</div>'; _serverStatsTimer = setTimeout(() => { if (document.getElementById('launcher-screen').style.display !== 'none') cargarServerStats(); }, 30000); return; }
      s = await res.json();
      cacheSet('serverStats', s);
    }
    const memPct = s.memory ? ((s.memory.used / s.memory.total) * 100).toFixed(1) : '—';
    const memUsed = s.memory ? (s.memory.used / 1073741824).toFixed(1) : '—';
    const memTotal = s.memory ? (s.memory.total / 1073741824).toFixed(1) : '—';
    const loadPct = s.cpuLoad ? (s.cpuLoad[0] / s.cpus * 100).toFixed(1) : '—';
    const uptime = s.uptime ? Math.floor(s.uptime / 86400) + 'd ' + Math.floor((s.uptime % 86400) / 3600) + 'h' : '—';
    const diskPct = s.disk ? parseInt(s.disk.usePct) : 0;
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">🖥️ Servidor</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        <div class="card" style="cursor:default;padding:16px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">CPU</div>
          <div style="font-size:20px;font-weight:700;margin:4px 0;">${s.cpus} núcleos</div>
          <div style="font-size:12px;color:var(--muted);">Carga: ${loadPct}%</div>
          <div style="margin-top:8px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(loadPct, 100)}%;background:${loadPct > 80 ? 'var(--danger)' : loadPct > 50 ? 'var(--warning)' : 'var(--success)'};border-radius:2px;"></div>
          </div>
        </div>
        <div class="card" style="cursor:default;padding:16px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Memoria</div>
          <div style="font-size:20px;font-weight:700;margin:4px 0;">${memUsed} / ${memTotal} GB</div>
          <div style="font-size:12px;color:var(--muted);">Uso: ${memPct}%</div>
          <div style="margin-top:8px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(memPct, 100)}%;background:${memPct > 80 ? 'var(--danger)' : memPct > 50 ? 'var(--warning)' : 'var(--success)'};border-radius:2px;"></div>
          </div>
        </div>
        ${s.disk ? '<div class="card" style="cursor:default;padding:16px;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Disco</div><div style="font-size:20px;font-weight:700;margin:4px 0;">' + s.disk.used + ' / ' + s.disk.size + '</div><div style="font-size:12px;color:var(--muted);">Uso: ' + s.disk.usePct + '</div><div style="margin-top:8px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="height:100%;width:' + diskPct + '%;background:' + (diskPct > 80 ? 'var(--danger)' : diskPct > 50 ? 'var(--warning)' : 'var(--success)') + ';border-radius:2px;"></div></div></div>' : ''}
        <div class="card" style="cursor:default;padding:16px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Sistema</div>
          <div style="font-size:16px;font-weight:700;margin:4px 0;">${s.hostname || '—'}</div>
          <div style="font-size:12px;color:var(--muted);">${s.platform || '—'} · Node ${s.node || '—'}</div>
          <div style="font-size:12px;color:var(--muted);">Uptime: ${uptime}</div>
        </div>
      </div>`;
    _serverStatsTimer = setTimeout(() => { if (document.getElementById('launcher-screen').style.display !== 'none') cargarServerStats(); }, 30000);
  } catch { w.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">⚠️ Error al cargar stats</div>'; _serverStatsTimer = setTimeout(() => { if (document.getElementById('launcher-screen').style.display !== 'none') cargarServerStats(); }, 30000); }
  finally { _serverStatsInFlight = false; }
}

function logout() {
  // Clear session state (non-blocking)
  localStorage.removeItem('platform_jwt');
  // Clear widget caches (security — don't show previous user's data)
  cleanExpiredWidgetCache();
  Object.keys(localStorage).filter(k => k.startsWith('w_')).forEach(k => localStorage.removeItem(k));
  invalidateUsersCache();
  jwtToken = null;
  user = null;
  _ver = null;
  modulosCache = [];
  try { sessionStorage.removeItem('synnox_modulos_cache'); } catch {}
  if (_notifPollTimer) { clearInterval(_notifPollTimer); _notifPollTimer = null; }
  if (_versionCheckTimer) { clearInterval(_versionCheckTimer); _versionCheckTimer = null; }
  if (_serverStatsTimer) { clearTimeout(_serverStatsTimer); _serverStatsTimer = null; }
  // NOTE: synnox_theme is NOT cleared — it's a UI preference, not session data
  // Show login immediately — don't wait for server
  show('login-screen');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  // Fire-and-forget logout to server
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

// ── Widget: Estado de módulos ──
async function cargarModuleStatus(sig) {
  const w = document.getElementById('module-status-widget');
  if (!w) return;
  try {
    const cached = cacheGet('moduleStatus', 30000);
    let mods = cached;
    if (!mods) {
      const res = await fetchAuth('/api/admin/health', { signal: sig || AbortSignal.timeout(15000) });
      if (!res.ok) { w.style.display = 'none'; return; }
      mods = await res.json();
      cacheSet('moduleStatus', mods);
    }
    if (!Array.isArray(mods) || !mods.length) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">📊 Estado de Módulos</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">
        ${mods.map(m => {
          const online = m.estado === 'online';
          return `<div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${online ? 'var(--success)' : 'var(--danger)'};"></span>
              <strong style="font-size:13px;">${esc(m.nombre)}</strong>
            </div>
            <div style="font-size:11px;color:var(--muted);">${online ? 'Online' : 'Offline'}${m.error ? ' — ' + esc(m.error) : ''}</div>
          </div>`;
        }).join('')}
      </div>`;
  } catch { w.style.display = 'none'; }
}

// ── Widget: Notificaciones recientes ──
async function cargarNotificacionesWidget(sig) {
  const w = document.getElementById('notif-widget');
  if (!w) return;
  try {
    const res = await fetch('/api/notificaciones', { headers: { 'Authorization': 'Bearer ' + jwtToken }, signal: sig || AbortSignal.timeout(15000) });
    if (!res.ok) { w.style.display = 'none'; return; }
    const { notificaciones } = await res.json();
    if (!notificaciones?.length) { w.style.display = 'none'; return; }
    const icons = { tarea_asignada: '📋', tarea_vencida: '⏰', proyecto_aprobado: '✅', proyecto_rechazado: '❌', comentario: '💬', factura_nueva: '📄', factura_vencida: '⚠️', ruta_asignada: '🛣️', backup: '💾', sistema: '⚙️' };
    w.style.display = 'block';
    w.innerHTML = `
      <h2 style="margin-bottom:12px;">🔔 Notificaciones</h2>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${notificaciones.slice(0, 5).map(n => {
          const timeAgo = timeSinceNotif(new Date(n.created_at));
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;${n.leida ? '' : 'border-left:3px solid var(--accent);'}">
            <span style="font-size:18px;">${icons[n.tipo] || '🔔'}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">${esc(n.titulo)}</div>
              <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(n.mensaje)}</div>
            </div>
            <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${timeAgo}</span>
          </div>`;
        }).join('')}
      </div>`;
  } catch (e) { if (e.name !== 'AbortError') w.style.display = 'none'; }
}

// ── Admin ──
async function showAdmin() {
  // Cancel pending launcher widget fetches
  if (_widgetAbort) _widgetAbort.abort();
  // Refresh user data from DB
  try {
    const res = await fetch('/api/auth/me', { signal: AbortSignal.timeout(5000), headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (res.ok) { const data = await res.json(); user = data; }
  } catch {}
  const userNameEl = document.getElementById('admin-sidebar-user');
  const userRoleEl = document.getElementById('admin-sidebar-role');
  const versionEl = document.getElementById('admin-sidebar-version');
  if (userNameEl) userNameEl.textContent = user?.nombre || '';
  if (userRoleEl) userRoleEl.textContent = user?.rol || '';
  if (versionEl) versionEl.textContent = launcherVersion ? 'v' + launcherVersion : '';
  show('admin-screen');
  showAdminTab('usuarios');
}

let _usersCache = null;
let _usersCacheTime = 0;
const USERS_CACHE_TTL = 120000; // 2 minutos

function getUsersCache() {
  // Memory cache first
  if (_usersCache && (Date.now() - _usersCacheTime) < USERS_CACHE_TTL) return _usersCache;
  // sessionStorage fallback
  try {
    const raw = sessionStorage.getItem('synnox_users_cache');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.data && parsed.ts && (Date.now() - parsed.ts) < USERS_CACHE_TTL) {
        _usersCache = parsed.data;
        _usersCacheTime = parsed.ts;
        return parsed.data;
      }
    }
  } catch (e) { sessionStorage.removeItem('synnox_users_cache'); }
  return null;
}

function setUsersCache(data) {
  _usersCache = data;
  _usersCacheTime = Date.now();
  try { sessionStorage.setItem('synnox_users_cache', JSON.stringify({ data, ts: _usersCacheTime })); } catch {}
}

function invalidateUsersCache() {
  _usersCache = null;
  _usersCacheTime = 0;
  try { sessionStorage.removeItem('synnox_users_cache'); } catch {}
}

async function loadUsers(force) {
  const tbody = document.querySelector('#users-table tbody');
  if (!force) {
    const cached = getUsersCache();
    if (cached) { renderUsersTable(cached); return; }
  }
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px;">Cargando...</td></tr>';
  try {
    const res = await fetchAuth('/api/admin/usuarios');
    if (!res.ok) throw new Error('Error al cargar usuarios');
    const users = await res.json();
    setUsersCache(users);
    renderUsersTable(users);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderUsersTable(users) {
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${esc(u.nombre)}</td>
        <td>${esc(u.email)}</td>
        <td><span class="badge badge-${u.rol}">${u.rol}</span></td>
        <td>${u.perfil_nombre ? `<span style="color:var(--accent);">${esc(u.perfil_nombre)}</span>` : '—'}</td>
        <td style="font-size:12px;color:var(--muted);">${esc(u.sede || 'Principal')}</td>
        <td>${u.activo ? '<span style="color:var(--success);">Activo</span>' : '<span class="badge badge-inactivo">Inactivo</span>'}</td>
        <td class="actions" style="white-space:nowrap;">
          <button class="btn-icon" onclick="editUser(${u.id})" title="Editar">✏️</button>
          <button class="btn-icon" onclick="resetPasswordUser(${u.id}, this)" title="Reset password">🔑</button>
          <button class="btn-icon" onclick="diagnosticarAuth(${u.id})" title="Diagnóstico auth">🔍</button>
          ${u.activo ? `<button class="btn-icon btn-icon-danger" onclick="deleteUser(${u.id})" title="Desactivar">🗑️</button>` : ''}
          ${!u.activo ? `<button class="btn-icon" onclick="reactivateUser(${u.id})" title="Reactivar">♻️</button>` : ''}
          ${!u.activo ? `<button class="btn-icon btn-icon-danger" onclick="deleteUserPermanent(${u.id})" title="Eliminar permanentemente">❌</button>` : ''}
        </td>
      </tr>
    `).join('');
  initTableFilters('users-table', { searchId: 'fil-usuarios-q', statusId: 'fil-usuarios-rol', statusKey: 'rol', countId: 'usuarios-count', searchCols: [1, 2] });
}

let cachedModulos = [];

function toggleModulosSection() {
  const rol = document.getElementById('form-rol').value;
  const hideModules = rol === 'admin' || rol === 'gerente';
  document.getElementById('form-modulos-section').style.display = hideModules ? 'none' : 'block';
}

async function renderModulosCheckboxes(selectedModulos = []) {
  const container = document.getElementById('form-modulos-list');
  if (!cachedModulos.length) {
    try {
      const res = await fetch('/api/admin/modulos', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
      cachedModulos = await res.json();
    } catch { container.innerHTML = '<span style="color:var(--danger);font-size:13px;">Error al cargar módulos</span>'; return; }
  }
  container.innerHTML = cachedModulos.map(m => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
      <input type="checkbox" value="${m.id}" ${selectedModulos.includes(m.id) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;margin:0;">
      <span style="font-size:13px;">${esc(m.icon)} ${esc(m.nombre)}</span>
    </div>
  `).join('');
}

function getSelectedModulos() {
  return [...document.querySelectorAll('#form-modulos-list input[type="checkbox"]:checked')].map(cb => cb.value);
}

function showUserForm(data) {
  document.getElementById('form-user-id').value = data?.id || '';
  document.getElementById('form-nombre').value = data?.nombre || '';
  document.getElementById('form-email').value = data?.email || '';
  document.getElementById('form-password').value = '';
  document.getElementById('form-rol').value = data?.rol || 'operador';
  document.getElementById('form-title').textContent = data?.id ? 'Editar usuario' : 'Nuevo usuario';
  document.getElementById('form-submit-btn').textContent = data?.id ? 'Guardar cambios' : 'Crear usuario';
  document.getElementById('form-error').classList.remove('show');
  document.getElementById('admin-form-overlay').style.display = 'block';
  // Load centros de operación for dropdown
  loadCentrosForUserForm(data?.sede || 'Principal');
  // Load profiles for dropdown
  fetch('/api/admin/perfiles', { headers: { 'Authorization': 'Bearer ' + jwtToken } })
    .then(r => r.json()).then(perfiles => {
      const sel = document.getElementById('form-perfil');
      sel.innerHTML = '<option value="">Sin perfil</option>' + perfiles.map(p => `<option value="${p.id}" ${data?.perfil_id == p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
    }).catch(() => {});
  // Load modules for user
  toggleModulosSection();
  if (data?.id) {
    fetch('/api/admin/usuarios/' + data.id + '/modulos', { headers: { 'Authorization': 'Bearer ' + jwtToken } })
      .then(r => r.json()).then(mods => renderModulosCheckboxes(mods)).catch(() => renderModulosCheckboxes([]));
  } else {
    renderModulosCheckboxes([]);
  }
}

function closeForm() {
  document.getElementById('admin-form-overlay').style.display = 'none';
}

async function saveUser() {
  const id = document.getElementById('form-user-id').value;
  const nombre = document.getElementById('form-nombre').value.trim();
  const email = document.getElementById('form-email').value.trim();
  const password = document.getElementById('form-password').value;
  const rol = document.getElementById('form-rol').value;
  const errEl = document.getElementById('form-error');

  if (!nombre || !email || !rol) {
    showError(errEl, 'Completa los campos requeridos');
    return;
  }

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/usuarios/${id}` : '/api/admin/usuarios';
    const perfilId = document.getElementById('form-perfil').value || null;
    const sede = document.getElementById('form-sede-select').value || 'Principal';
    const body = { nombre, email, rol, perfil_id: perfilId ? parseInt(perfilId) : null, sede };
    if (password) body.password = password;

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify(body)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al guardar');

    // Save module assignments (if operador)
    const userId = id || result.id;
    if (rol === 'operador' && userId) {
      const selectedModulos = getSelectedModulos();
      const modRes = await fetch('/api/admin/usuarios/' + userId + '/modulos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
        body: JSON.stringify({ modulos: selectedModulos })
      });
      const modData = await modRes.json().catch(() => ({}));
      if (modRes.ok && modData.sesionInvalidada) {
        toast('Módulos actualizados. El usuario debe cerrar sesión y volver a entrar.', 'info');
      }
    }

    closeForm();
    if (!id && !password && result.welcome_sent) {
      toast('Usuario creado. Se envió correo de bienvenida.', 'success');
    } else {
      toast(id ? 'Usuario actualizado' : 'Usuario creado', 'success');
    }
    invalidateUsersCache(); loadUsers(true);
  } catch (e) {
    showError(errEl, e.message);
  }
}

function editUser(id) {
  const row = document.querySelector(`#users-table tbody tr:nth-child(${id})`);
  fetch('/api/admin/usuarios', {
    headers: { 'Authorization': 'Bearer ' + jwtToken }
  }).then(r => r.json()).then(users => {
    const u = users.find(x => x.id === id);
    if (u) showUserForm(u);
  });
}

async function resetPasswordUser(userId, btn) {
  if (!await confirmModal('¿Enviar email de recuperación de contraseña a este usuario?', 'Reset Password', 'info')) return;
  try {
    btn.disabled = true;
    const res = await fetch(`/api/admin/usuarios/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar email');
    toast(data.message || 'Email de recuperación enviado', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function diagnosticarAuth(userId) {
  try {
    const res = await fetch(`/api/admin/diagnostico/auth/${userId}`, {
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) throw new Error('Error al cargar diagnóstico');
    const data = await res.json();
    const u = data.usuario;
    const jwt = data.jwt_payload_simulado;

    const modulosHtml = data.modulos_asignados.length
      ? data.modulos_asignados.map(m => `<span class="badge" style="background:var(--accent);color:#fff;margin:2px;">${esc(m)}</span>`).join(' ')
      : '<span style="color:var(--danger);">Ninguno asignado</span>';

    const jwtModulos = jwt.modulos?.length
      ? jwt.modulos.map(m => `<span class="badge" style="background:var(--success);color:#fff;margin:2px;">${esc(m)}</span>`).join(' ')
      : '<span style="color:var(--danger);">Vacío</span>';

    const html = `
      <div style="font-size:13px;line-height:1.8;">
        <h3 style="margin:0 0 12px;color:var(--text);">👤 Usuario</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:var(--muted);padding:2px 8px;">ID</td><td>${u.id}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Nombre</td><td>${esc(u.nombre)}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Email</td><td>${esc(u.email)}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Rol</td><td><span class="badge badge-${u.rol}">${u.rol}</span></td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Activo</td><td>${u.activo ? '✅ Sí' : '❌ No'}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Seq (sesión)</td><td>${u.seq}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Perfil</td><td>${data.perfil ? esc(data.perfil.nombre) : '—'}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">Sede</td><td>${esc(u.sede || '—')}</td></tr>
        </table>

        <h3 style="margin:16px 0 8px;color:var(--text);">📦 Módulos asignados (user_modulos)</h3>
        <div>${modulosHtml}</div>

        <h3 style="margin:16px 0 8px;color:var(--text);">🔑 JWT payload simulado</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:var(--muted);padding:2px 8px;">modulos</td><td>${jwtModulos}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">seq</td><td>${jwt.seq}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">rol</td><td>${jwt.rol}</td></tr>
          <tr><td style="color:var(--muted);padding:2px 8px;">perfil</td><td>${esc(jwt.perfil_nombre || '—')}</td></tr>
        </table>

        <h3 style="margin:16px 0 8px;color:var(--text);">🛡️ Permisos del perfil</h3>
        <div>${data.perfil_permisos.length
          ? data.perfil_permisos.map(p => `<code style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;margin:2px;display:inline-block;">${esc(p.modulo_id)}.${esc(p.permiso)}</code>`).join(' ')
          : '<span style="color:var(--muted);">Sin permisos de perfil</span>'
        }</div>

        <h3 style="margin:16px 0 8px;color:var(--text);">⚙️ Permisos funcionales (modulos_permisos)</h3>
        <div>${data.modulos_permisos_perfil.length
          ? data.modulos_permisos_perfil.map(p => `<code style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;margin:2px;display:inline-block;">${esc(p.modulo_id)}.${esc(p.permiso_id)}</code>`).join(' ')
          : '<span style="color:var(--muted);">Sin permisos funcionales</span>'
        }</div>

        <h3 style="margin:16px 0 8px;color:var(--text);">👤 Permisos individuales (usuario)</h3>
        <div>${data.modulos_permisos_usuario.length
          ? data.modulos_permisos_usuario.map(p => `<code style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;margin:2px;display:inline-block;">${esc(p.modulo_id)}.${esc(p.permiso_id)}</code>`).join(' ')
          : '<span style="color:var(--muted);">Sin permisos individuales</span>'
        }</div>
      </div>
    `;

    document.getElementById('diag-content').innerHTML = html;
    document.getElementById('diag-modal').style.display = 'block';

    // Also run auth test
    try {
      const testRes = await fetch(`/api/admin/diagnostico/test-auth/${userId}`, {
        headers: { 'Authorization': 'Bearer ' + jwtToken }
      });
      const testData = await testRes.json();
      if (testRes.ok && testData.steps) {
        const stepsHtml = testData.steps.map(s =>
          `<div style="padding:4px 0;">${s.ok ? '✅' : '❌'} <strong>${s.step}</strong>${s.error ? ` — <span style="color:var(--danger);">${esc(s.error)}</span>` : ''}</div>`
        ).join('');
        document.getElementById('diag-test-result').innerHTML = `
          <h3 style="margin:16px 0 8px;color:var(--text);">🧪 Test de Auth (simulación)</h3>
          ${stepsHtml}
          ${!testData.ok ? `<div style="margin-top:8px;padding:8px;background:var(--danger);color:#fff;border-radius:6px;font-size:12px;">FALLÓ en: <strong>${testData.step}</strong> — ${esc(testData.error)}</div>` : ''}
        `;
      } else {
        document.getElementById('diag-test-result').innerHTML = `<div style="margin-top:12px;padding:8px;background:var(--surface2);border-radius:6px;font-size:12px;color:var(--muted);">Test no disponible (${testRes.status}: ${esc(testData.error || 'Error desconocido')}${testData.stack ? `<br><code style="font-size:10px;color:var(--danger);">${esc(testData.stack.split('\n').slice(0,3).join('\n'))}</code>` : ''})</div>`;
      }
    } catch (e) {
      document.getElementById('diag-test-result').innerHTML = `<div style="margin-top:12px;padding:8px;background:var(--surface2);border-radius:6px;font-size:12px;color:var(--danger);">Error al ejecutar test: ${esc(e.message)}</div>`;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function cerrarDiag() {
  document.getElementById('diag-modal').style.display = 'none';
}

async function deleteUser(id) {
  if (!await confirmModal('¿Desactivar este usuario?')) return;
  try {
    const res = await fetch(`/api/admin/usuarios/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al desactivar');
    }
    invalidateUsersCache(); loadUsers(true);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reactivateUser(id) {
  if (!await confirmModal('¿Reactivar este usuario?')) return;
  try {
    const res = await fetch(`/api/admin/usuarios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ activo: true })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al reactivar');
    }
    toast('Usuario reactivado', 'success');
    invalidateUsersCache(); loadUsers(true);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteUserPermanent(id) {
  if (!await confirmModal('¿Eliminar permanentemente este usuario? Esta acción no se puede deshacer.')) return;
  try {
    const res = await fetch(`/api/admin/usuarios/${id}/permanent`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al eliminar');
    }
    invalidateUsersCache(); loadUsers(true);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Import CSV ──
async function showImportCsvModal() {
  document.getElementById('csv-file-input').value = '';
  const container = document.getElementById('csv-modulos-list');
  try {
    const res = await fetch('/api/admin/modulos', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const mods = await res.json();
    container.innerHTML = mods.filter(m => m.activo).map(m =>
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;">
        <input type="checkbox" value="${esc(m.id)}" checked /> ${esc(m.nombre)}
      </label>`
    ).join('');
  } catch { container.innerHTML = '<span style="color:var(--danger);">Error cargando módulos</span>'; }
  document.getElementById('modal-import-csv').classList.add('show');
}

async function doImportCsv() {
  const file = document.getElementById('csv-file-input').files?.[0];
  if (!file) { toast('Selecciona un archivo CSV', 'error'); return; }
  if (!file.name.endsWith('.csv')) { toast('El archivo debe ser .csv', 'error'); return; }

  const modulos = [...document.querySelectorAll('#csv-modulos-list input[type=checkbox]:checked')].map(cb => cb.value);
  const btn = document.getElementById('btn-import-csv');
  btn.disabled = true; btn.textContent = 'Importando...';

  try {
    const csv = await file.text();
    const res = await fetch('/api/admin/usuarios/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ csv, modulos })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al importar');
    const msg = `Importados: ${data.created} | Omítidos: ${data.skipped} | Errores: ${data.errors}`;
    toast(msg, data.errors > 0 ? 'warning' : 'success');
    if (data.details?.length) console.warn('[CSV Import]', data.details);
    cerrarModal('modal-import-csv');
    invalidateUsersCache(); loadUsers(true);
  } catch (e) {
    toast(e.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Importar';
}

// ── Módulos ──
async function loadModulos() {
  try {
    const res = await fetchAuth('/api/admin/modulos');
    if (!res.ok) throw new Error('Error al cargar módulos');
    const modulos = await res.json();
    const tbody = document.querySelector('#modulos-table tbody');
    tbody.innerHTML = modulos.map(m => `
      <tr>
        <td>${m.id}</td>
        <td>${esc(m.icon)} ${esc(m.nombre)}</td>
        <td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${esc(m.public_url || m.url)}">${esc(m.public_url || m.url)}</td>
        <td style="font-size:11px;color:var(--muted);">${esc(m.proxy_prefix || '—')}</td>
        <td>${m.mcp_enabled ? '<span style="color:var(--success);">Sí</span>' : '<span style="color:var(--muted);">No</span>'}</td>
        <td id="health-${m.id}"><span style="color:var(--muted);">—</span></td>
        <td class="actions">
          <button class="btn btn-sm btn-secondary" onclick="editModulo('${m.id}')">✏️ Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteModulo('${m.id}')">🗑️ Eliminar</button>
        </td>
      </tr>
    `).join('');
    initTableFilters('modulos-table', { searchId: 'fil-modulos-q', countId: 'modulos-count', searchCols: [1, 2] });
  } catch (e) {
    document.querySelector('#modulos-table tbody').innerHTML = '<tr><td colspan="7" style="color:var(--danger);">Error: ' + e.message + '</td></tr>';
  }
}

async function loadHealth() {
  try {
    const res = await fetch('/api/admin/health', {
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) throw new Error('Error');
    const results = await res.json();
    for (const r of results) {
      const el = document.getElementById('health-' + r.id);
      if (el) {
        el.innerHTML = r.estado === 'online'
          ? '<span style="color:var(--success);">✅ Online</span>'
          : '<span style="color:var(--danger);">❌ ' + (r.error || r.status) + '</span>';
      }
    }
  } catch (e) {
    toast('Health check error: ' + e.message, 'error');
  }
}

const EMOJIS = ['⏰','📄','📊','📦','⚡','🔧','🚀','💼','🗂️','📋','🔗','🎯','📈','🛠️','💻','🌐','🔐','📁','📝','🔄','🤖','💡','⭐','🔔','🛡️','⚙️','📡','🎛️','🧩','📎'];

function renderEmojiPicker(selected) {
  const container = document.getElementById('modulo-form-icon-picker');
  container.innerHTML = EMOJIS.map(e => `
    <span onclick="selectEmoji(this)" style="font-size:24px;cursor:pointer;padding:4px 8px;border-radius:6px;border:2px solid transparent;${e === selected ? 'border-color:var(--accent);background:var(--surface2);' : ''}transition:all 0.15s;">${e}</span>
  `).join('');
}

function selectEmoji(el) {
  document.querySelectorAll('#modulo-form-icon-picker span').forEach(s => { s.style.borderColor = 'transparent'; s.style.background = 'transparent'; });
  el.style.borderColor = 'var(--accent)';
  el.style.background = 'var(--surface2)';
  document.getElementById('modulo-form-icon').value = el.textContent;
}

function showModuloForm(data) {
  document.getElementById('modulo-form-id').value = data?.id || '';
  document.getElementById('modulo-form-id-input').value = data?.id || '';
  document.getElementById('modulo-form-id-input').disabled = !!data?.id;
  document.getElementById('modulo-form-nombre').value = data?.nombre || '';
  document.getElementById('modulo-form-url').value = data?.url || '';
  document.getElementById('modulo-form-public-url').value = data?.public_url || '';
  document.getElementById('modulo-form-proxy-prefix').value = data?.proxy_prefix || '';
  document.getElementById('modulo-form-desc').value = data?.descripcion || '';
  document.getElementById('modulo-form-mcp').checked = data ? !!data.mcp_enabled : true;
  document.getElementById('modulo-form-tipo').checked = data ? data.tipo === 'interno' : false;
  renderEmojiPicker(data?.icon || '📦');
  document.getElementById('modulo-form-icon').value = data?.icon || '📦';
  document.getElementById('modulo-form-title').textContent = data?.id ? 'Editar módulo' : 'Nuevo módulo';
  document.getElementById('modulo-form-submit-btn').textContent = data?.id ? 'Guardar cambios' : 'Crear módulo';
  document.getElementById('modulo-form-error').classList.remove('show');
  document.getElementById('modulo-form-overlay').style.display = 'block';
}

function closeModuloForm() {
  document.getElementById('modulo-form-overlay').style.display = 'none';
}

async function saveModulo() {
  const id = document.getElementById('modulo-form-id').value || document.getElementById('modulo-form-id-input').value.trim();
  const nombre = document.getElementById('modulo-form-nombre').value.trim();
  const url = document.getElementById('modulo-form-url').value.trim();
  const public_url = document.getElementById('modulo-form-public-url').value.trim();
  const icon = document.getElementById('modulo-form-icon').value.trim() || '📦';
  const desc = document.getElementById('modulo-form-desc').value.trim();
  const mcp_enabled = document.getElementById('modulo-form-mcp').checked;
  const tipo = document.getElementById('modulo-form-tipo').checked ? 'interno' : 'externo';
  const proxy_prefix = document.getElementById('modulo-form-proxy-prefix').value.trim();
  const errEl = document.getElementById('modulo-form-error');
  if (!id || !nombre) { showError(errEl, 'ID y nombre requeridos'); return; }
  try {
    const method = document.getElementById('modulo-form-id').value ? 'PUT' : 'POST';
    const res = await fetch(method === 'PUT' ? `/api/admin/modulos/${id}` : '/api/admin/modulos', {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ id, nombre, url, public_url, icon, descripcion: desc, mcp_enabled, proxy_prefix, tipo })
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Error'); }
    closeModuloForm();
    loadModulos();
  } catch (e) { showError(errEl, e.message); }
}

function editModulo(id) {
  fetch('/api/admin/modulos', {
    headers: { 'Authorization': 'Bearer ' + jwtToken }
  }).then(r => r.json()).then(modulos => {
    const m = modulos.find(x => x.id === id);
    if (m) showModuloForm(m);
  });
}

async function deleteModulo(id) {
  if (!await confirmModal(`¿Eliminar módulo ${id}?`)) return;
  try {
    const res = await fetch(`/api/admin/modulos/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) throw new Error('Error');
    loadModulos();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Scaffold module ──
function showScaffoldModal() {
  document.getElementById('scaffold-id').value = '';
  document.getElementById('scaffold-nombre').value = '';
  document.getElementById('scaffold-port').value = '';
  document.getElementById('scaffold-desc').value = '';
  document.getElementById('scaffold-result').textContent = '';
  document.getElementById('modal-scaffold').classList.add('show');
}

async function ejecutarScaffold() {
  const id = document.getElementById('scaffold-id').value.trim();
  const nombre = document.getElementById('scaffold-nombre').value.trim();
  const port = document.getElementById('scaffold-port').value.trim();
  const desc = document.getElementById('scaffold-desc').value.trim();
  const tipo = document.getElementById('scaffold-tipo').value;
  const resultEl = document.getElementById('scaffold-result');
  const btn = document.getElementById('scaffold-btn');
  if (!id || !nombre || !port) { resultEl.textContent = '❌ ID, nombre y puerto requeridos'; return; }
  btn.disabled = true; btn.textContent = 'Creando...';
  try {
    const res = await fetch('/api/admin/modulos/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ id, nombre, port: parseInt(port), description: desc, tipo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    resultEl.textContent = '✅ ' + data.mensaje;
    if (data.npm) resultEl.textContent += '\n📦 npm: ' + data.npm;
    resultEl.textContent += '\n▶️ Inicia con: pm2 start ' + INSTALL_DIR + '/modules/' + id + '/backend/server.js --name ' + id;
    cerrarModal('modal-scaffold');
    setTimeout(() => loadModulos(), 500);
  } catch (e) {
    resultEl.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '⚡ Crear módulo';
  }
}

function cerrarModal(id) { document.getElementById(id).classList.remove('show'); }

// ── MCP URL display ──
async function loadMcpUrl() {
  const el = document.getElementById('mcp-url-display');
  const altEl = document.getElementById('mcp-url-alt');
  if (!el) return;
  try {
    const res = await fetch('/api/admin/mcp/url', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) throw new Error('Error');
    const data = await res.json();
    el.textContent = data.url || data.url_directa;
    if (altEl && data.url_gateway) {
      altEl.innerHTML = 'Alternativa: <code style="background:var(--surface);padding:4px 6px;border-radius:4px;font-size:12px;">' + data.url_gateway + '</code> (vía nginx)';
    }
  } catch {
    el.textContent = 'No disponible';
  }
}
function copiarMcpUrl() {
  const el = document.getElementById('mcp-url-display');
  if (!el || !el.textContent) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = document.querySelector('#mcp-url-box .btn');
    if (btn) { btn.textContent = '✅ Copiado'; setTimeout(() => btn.textContent = '📋 Copiar', 2000); }
  }).catch(() => {
    const range = document.createRange(); range.selectNode(el);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    document.execCommand('copy'); window.getSelection().removeAllRanges();
  });
}

// ── Password recovery ──
function showForgotPassword() {
  document.getElementById('forgot-step-email').style.display = 'block';
  document.getElementById('forgot-step-done').style.display = 'none';
  document.getElementById('forgot-error').classList.remove('show');
  document.getElementById('forgot-email').value = '';
  document.getElementById('forgot-modal').style.display = 'block';
}
function closeForgot() {
  document.getElementById('forgot-modal').style.display = 'none';
}
async function sendResetToken() {
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('forgot-error');
  const btn = document.querySelector('#forgot-step-email .btn');
  if (!email) { showError(errEl, 'Ingresa tu correo electrónico'); return; }
  errEl.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const res = await fetch('/api/auth/forgot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email}) });
    const data = await res.json();
    if (!data.ok) { showError(errEl, data.error || 'Error'); btn.disabled = false; btn.textContent = 'Enviar enlace'; return; }
    // If the server returned a resetUrl, SMTP is not configured — show it directly
    if (data.resetUrl) {
      const link = window.location.origin + data.resetUrl;
      document.getElementById('forgot-link').textContent = link;
      document.getElementById('forgot-step-email').style.display = 'none';
      document.getElementById('forgot-step-done').style.display = 'block';
    } else {
      // SMTP is configured — show confirmation message
      document.getElementById('forgot-step-email').style.display = 'none';
      document.getElementById('forgot-step-done').style.display = 'block';
      document.getElementById('forgot-link').textContent = '';
      document.querySelector('#forgot-step-done .box-info')?.remove();
      const info = document.createElement('div');
      info.className = 'box-info';
      info.style.cssText = 'background:var(--surface2);border-radius:9px;padding:14px;margin-bottom:16px;font-size:13px;';
      info.innerHTML = '📧 Si el correo existe en el sistema, recibirás un enlace de recuperación. Revisa tu bandeja de entrada.';
      document.getElementById('forgot-link').parentElement.before(info);
    }
  } catch(e) { showError(errEl, 'Error de conexión'); }
  finally { btn.disabled = false; btn.textContent = 'Enviar enlace'; }
}
function closeReset() {
  document.getElementById('reset-modal').style.display = 'none';
  show('login-screen');
}
async function submitReset() {
  const pwd = document.getElementById('reset-password').value;
  const pwd2 = document.getElementById('reset-password2').value;
  const errEl = document.getElementById('reset-error');
  if (!pwd || pwd.length < 6) { showError(errEl, 'La contraseña debe tener al menos 6 caracteres'); return; }
  if (pwd !== pwd2) { showError(errEl, 'Las contraseñas no coinciden'); return; }
  errEl.classList.remove('show');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) { showError(errEl, 'Token no encontrado en la URL'); return; }
  const btn = document.querySelector('#reset-form .btn');
  btn.disabled = true; btn.textContent = 'Cambiando...';
  try {
    const res = await fetch('/api/auth/reset', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token, password:pwd}) });
    const data = await res.json();
    if (!data.ok) { showError(errEl, data.error || 'Error'); btn.disabled = false; btn.textContent = 'Cambiar contraseña'; return; }
    document.getElementById('reset-form').style.display = 'none';
    document.getElementById('reset-done').style.display = 'block';
  } catch(e) { showError(errEl, 'Error de conexión'); }
  finally { btn.disabled = false; btn.textContent = 'Cambiar contraseña'; }
}

// ── MCP config ──
async function loadMcpConfig() {
  try {
    const res = await fetch('/api/admin/mcp', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) throw new Error('Error');
    const modulos = await res.json();
    let html = '';
    for (const m of modulos) {
      html += `<div class="perm-rol-section" data-modulo-id="${m.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-weight:600;font-size:14px;">${m.icon} ${m.nombre}</div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
            <input type="checkbox" ${m.mcp_enabled ? 'checked' : ''} onchange="toggleMcp('${m.id}', this.checked)" style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;">
            MCP activo
          </label>
        </div>
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;">URL interna</label>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <input type="text" id="mcp-url-${m.id}" value="${m.url}" style="flex:1;" placeholder="http://localhost:3000" onchange="saveMcpField('${m.id}')">
        </div>
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;">API Token <span style="text-transform:none;font-weight:400;">(opcional)</span></label>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <input type="password" id="mcp-token-${m.id}" value="${m.mcp_token}" style="flex:1;" placeholder="Bearer token" onchange="saveMcpField('${m.id}')">
          <button class="btn btn-sm" onclick="toggleToken('${m.id}')" style="white-space:nowrap;">👁</button>
        </div>
        <div id="mcp-test-${m.id}"></div>
        <button class="btn btn-sm" onclick="testMcp('${m.id}')">🔌 Test conexión</button>
      </div>`;
    }
    document.getElementById('mcp-container').innerHTML = html;
  } catch (e) {
    document.getElementById('mcp-container').innerHTML = '<div style="color:var(--danger);">Error: ' + e.message + '</div>';
  }
}

let _mcpTimers = {};
function saveMcpField(id) {
  clearTimeout(_mcpTimers[id]);
  _mcpTimers[id] = setTimeout(async () => {
    const url = document.getElementById('mcp-url-' + id).value.trim();
    const mcp_token = document.getElementById('mcp-token-' + id).value;
    try {
      await fetch('/api/admin/mcp/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
        body: JSON.stringify({ url, mcp_token })
      });
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }, 600);
}

async function toggleMcp(id, enabled) {
  try {
    await fetch('/api/admin/mcp/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ mcp_enabled: enabled })
    });
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

function toggleToken(id) {
  const el = document.getElementById('mcp-token-' + id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

async function testMcp(id) {
  const el = document.getElementById('mcp-test-' + id);
  el.innerHTML = '<span style="color:var(--muted);">Probando...</span>';
  try {
    const res = await fetch('/api/admin/mcp/' + id + '/test', {
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (data.ok) {
      el.innerHTML = '<span style="color:var(--success);">✅ Conectado (status ' + data.status + ')</span>';
    } else {
      el.innerHTML = '<span style="color:var(--danger);">❌ ' + (data.error || 'Error ' + data.status) + '</span>';
    }
  } catch (e) {
    el.innerHTML = '<span style="color:var(--danger);">❌ ' + e.message + '</span>';
  }
}

// ── SMTP ──
async function loadSmtpConfig() {
  const resultEl = document.getElementById('smtp-result');
  resultEl.innerHTML = '<span style="color:var(--muted);">Cargando...</span>';
  try {
    const res = await fetch('/api/admin/smtp', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const data = await res.json();
    for (const [k, v] of Object.entries(data.config)) {
      const el = document.getElementById(k);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v === 'true';
      else el.value = v;
    }
    const badge = document.getElementById('smtp-status-badge');
    if (badge) badge.innerHTML = data.configured ? '<span style="color:var(--success);">✅ Configurado</span>' : '<span style="color:var(--warning);">⚠️ No configurado</span>';
    resultEl.innerHTML = '';
  } catch (e) {
    resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + e.message + '</span>';
  }
}
async function saveSmtpConfig() {
  const resultEl = document.getElementById('smtp-result');
  const keys = ['smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from','smtp_from_name','smtp_allow_self_signed'];
  const body = {};
  for (const k of keys) {
    const el = document.getElementById(k);
    if (!el) continue;
    body[k] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
  }
  resultEl.innerHTML = '<span style="color:var(--muted);">Guardando...</span>';
  try {
    const res = await fetch('/api/admin/smtp', {
      method: 'PUT', headers: { 'Authorization': 'Bearer ' + jwtToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.innerHTML = '<span style="color:var(--success);">✅ Configuración guardada</span>';
      const badge = document.getElementById('smtp-status-badge');
      if (badge) badge.innerHTML = data.configured ? '<span style="color:var(--success);">✅ Configurado</span>' : '<span style="color:var(--warning);">⚠️ No configurado</span>';
    } else {
      resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + (data.error || 'Error') + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + e.message + '</span>';
  }
}
async function testSmtpConfig() {
  const resultEl = document.getElementById('smtp-result');
  resultEl.innerHTML = '<span style="color:var(--muted);">Enviando correo de prueba...</span>';
  try {
    const res = await fetch('/api/admin/smtp/test', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.innerHTML = '<span style="color:var(--success);">✅ Correo de prueba enviado (ID: ' + data.messageId + ')</span>';
    } else {
      resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + (data.error || 'Error') + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + e.message + '</span>';
  }
}

// ── Email Notif Config ──
const MODULO_LABELS = { proyectos: 'Proyectos', nomina: 'Nómina', proveedores: 'Proveedores', logistica: 'Logística', launcher: 'Launcher' };
const MODULO_ICONS = { proyectos: '📋', nomina: '💰', proveedores: '📄', logistica: '🚚', launcher: '🏠' };

async function loadEmailNotifConfig() {
  const container = document.getElementById('email-notif-container');
  const smtpStatus = document.getElementById('email-notif-smtp-status');
  container.innerHTML = '<span style="color:var(--muted);">Cargando...</span>';
  try {
    const [notifRes, smtpRes] = await Promise.all([
      fetch('/api/admin/email-notif', { headers: { 'Authorization': 'Bearer ' + jwtToken } }),
      fetch('/api/admin/smtp', { headers: { 'Authorization': 'Bearer ' + jwtToken } })
    ]);
    const notifData = await notifRes.json();
    const smtpData = await smtpRes.json();
    smtpStatus.innerHTML = smtpData.configured ? '<span style="color:var(--success);">SMTP configurado</span>' : '<span style="color:var(--warning);">SMTP no configurado</span>';
    container.innerHTML = '';
    for (const [modulo, eventos] of Object.entries(notifData.config)) {
      const allOn = eventos.every(e => e.habilitado);
      const someOn = eventos.some(e => e.habilitado);
      const section = document.createElement('div');
      section.className = 'perm-rol-section';
      section.style.marginBottom = '16px';
      section.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div class="perm-rol-titulo" style="margin:0;">${MODULO_ICONS[modulo] || '📦'} ${MODULO_LABELS[modulo] || modulo}</div>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">
            <input type="checkbox" ${allOn ? 'checked' : ''} ${someOn && !allOn ? 'data-indeterminate="true"' : ''} onchange="toggleModuloEmailNotif('${modulo}', this.checked)" style="width:auto;">
            ${allOn ? 'Todos' : someOn ? 'Parcial' : 'Ninguno'}
          </label>
        </div>
        <div style="display:grid;gap:8px;">
          ${eventos.map(e => `
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;padding:6px 8px;border-radius:6px;background:var(--surface2);text-transform:none;letter-spacing:0;font-weight:400;">
              <input type="checkbox" ${e.habilitado ? 'checked' : ''} onchange="toggleEventoEmailNotif(${e.id}, this.checked)" style="width:auto;">
              <span>${esc(e.descripcion)}</span>
              <span style="margin-left:auto;font-size:11px;color:var(--muted);font-family:monospace;">${esc(e.evento)}</span>
            </label>
          `).join('')}
        </div>`;
      container.appendChild(section);
    }
  } catch (e) {
    container.innerHTML = '<span style="color:var(--danger);">Error: ' + e.message + '</span>';
  }
}

async function toggleEventoEmailNotif(id, habilitado) {
  try {
    await fetch('/api/admin/email-notif/' + id, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + jwtToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ habilitado })
    });
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleModuloEmailNotif(modulo, habilitado) {
  try {
    await fetch('/api/admin/email-notif/modulo/' + modulo, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + jwtToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ habilitado })
    });
    loadEmailNotifConfig();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ── Admin tab router ──
function showAdminTab(tab) {
  document.querySelectorAll('#admin-sidebar .nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === tab));
  document.querySelectorAll('#admin-screen .tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  if (tab === 'usuarios') loadUsers();
  else if (tab === 'perfiles') loadPerfiles();
  else if (tab === 'centros') loadCentros();
  else if (tab === 'modulos') loadModulos();
   else if (tab === 'mcp') { loadMcpConfig(); loadMcpUrl(); }
   else if (tab === 'smtp') loadSmtpConfig();
   else if (tab === 'email-notif') loadEmailNotifConfig();
   else if (tab === 'mapas') loadGmapsKeyStatus();
   else if (tab === 'seguridad') { loadRateLimitConfig(); loadSshConfig(); loadLoginLogs(); }
   else if (tab === 'auditoria') loadAuditoria();
   else if (tab === 'actualizar') { loadUpdaterStatus(); loadUpdaterLogs(); }
    else if (tab === 'mcp-modules') { loadMcpModulesStatus(); }
    else if (tab === 'respaldo') { document.getElementById('import-result').style.display = 'none'; }
    else if (tab === 'acerca-de') loadAcercaDe();

}

async function loadAcercaDe() {
  const el = document.getElementById('acerca-de-content');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Cargando...</div>';
  try {
    const res = await fetch('/api/admin/system-info', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const d = await res.json();
    const modHtml = (d.modules || []).map(m => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface2);border-radius:8px;"><span>${m.icono || '📦'}</span><span style="font-weight:600">${esc(m.nombre)}</span><span class="badge ${m.estado === 'online' ? 'badge-success' : 'badge-danger'}" style="margin-left:auto;font-size:11px">${m.estado || 'offline'}</span></div>`).join('');
    el.innerHTML = `
      <div style="max-width:800px;margin:0 auto;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="font-size:48px;margin-bottom:8px;">⚙️</div>
          <div style="font-size:24px;font-weight:800;font-family:var(--font-head);">SynnoxERP</div>
          <div style="color:var(--muted);font-size:14px;margin-top:4px;">Plataforma de orquestación de módulos ERP</div>
          <div style="margin-top:8px;"><span class="badge badge-info" style="font-size:14px;padding:6px 16px;">v${esc(d.app?.version || '?')}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
          <div class="table-wrap" style="padding:20px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:12px;">🖥️ Servidor</div>
            <div style="font-size:13px;color:var(--muted);line-height:2;">
              <div><strong>Plataforma:</strong> ${esc(d.server?.platform || '?')} ${esc(d.server?.arch || '')}</div>
              <div><strong>Hostname:</strong> ${esc(d.server?.hostname || '?')}</div>
              <div><strong>Node.js:</strong> ${esc(d.server?.node || '?')}</div>
              <div><strong>Puerto:</strong> ${esc(d.server?.port || '?')}</div>
              <div><strong>Entorno:</strong> ${esc(d.server?.env || '?')}</div>
            </div>
          </div>
          <div class="table-wrap" style="padding:20px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:12px;">🗄️ Base de Datos</div>
            <div style="font-size:13px;color:var(--muted);line-height:2;">
              <div><strong>PostgreSQL:</strong> ${esc(d.database?.postgresql || 'No disponible')}</div>
              <div><strong>SQLite:</strong> ${esc(d.database?.sqlite || '?')}</div>
              <div><strong>Engine:</strong> PostgreSQL + SQLite (híbrido)</div>
            </div>
          </div>
          <div class="table-wrap" style="padding:20px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:12px;">🏢 Empresa</div>
            <div style="font-size:13px;color:var(--muted);line-height:2;">
              <div><strong>Nombre:</strong> ${esc(d.company?.name || 'No configurado')}</div>
              <div><strong>Dominio:</strong> ${esc(d.company?.domain || 'No configurado')}</div>
            </div>
          </div>
          <div class="table-wrap" style="padding:20px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:12px;">🔀 Git</div>
            <div style="font-size:13px;color:var(--muted);line-height:2;">
              <div><strong>Rama:</strong> ${esc(d.git?.branch || 'No disponible')}</div>
              <div><strong>Commit:</strong> ${esc(d.git?.commit || '?')}</div>
            </div>
          </div>
        </div>
        ${modHtml ? `<div class="table-wrap" style="padding:20px;margin-bottom:20px;"><div style="font-weight:700;font-size:14px;margin-bottom:12px;">📦 Módulos Instalados</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">${modHtml}</div></div>` : ''}
        <div style="text-align:center;padding:20px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);">
          <div>${esc(d.copyright || '')}</div>
          <div style="margin-top:4px;">${esc(d.license || '')}</div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">Error al cargar: ${esc(e.message)}</div>`;
  }
}


// ── Updater ──
async function loadUpdaterStatus() {
  const infoEl = document.getElementById('upd-info');
  const statusEl = document.getElementById('upd-status');
  const checkBtn = document.getElementById('upd-check-btn');
  const updateBtn = document.getElementById('upd-update-btn');
  infoEl.innerHTML = '<span style="color:var(--muted);">Cargando estado...</span>';
  try {
    const res = await fetch('/api/admin/updater/status', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const data = await res.json();
    if (!data.ok) { infoEl.innerHTML = '<span style="color:var(--danger);">Error: ' + data.error + '</span>'; return; }
    infoEl.innerHTML = `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:16px;">
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;font-weight:600;">Rama</div>
        <div style="font-size:20px;font-weight:700;">${esc(data.branch)}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:16px;">
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;font-weight:600;">Commit actual</div>
        <div style="font-size:20px;font-weight:700;font-family:monospace;">${esc(data.currentCommit)}</div>
      </div>`;
    checkBtn.disabled = false;
    checkBtn.textContent = '🔍 Buscar actualizaciones';
    updateBtn.disabled = true;
    updateBtn.style.opacity = '0.5';
  } catch (e) { infoEl.innerHTML = '<span style="color:var(--danger);">Error: ' + e.message + '</span>'; }
}

async function checkUpdate() {
  const statusEl = document.getElementById('upd-status');
  const checkBtn = document.getElementById('upd-check-btn');
  const updateBtn = document.getElementById('upd-update-btn');
  checkBtn.disabled = true;
  checkBtn.textContent = 'Verificando...';
  statusEl.innerHTML = '<span style="color:var(--muted);font-size:13px;">🔍 Buscando actualizaciones...</span>';
  try {
    const res = await fetch('/api/admin/updater/check', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) {
      let errMsg = 'Error HTTP ' + res.status;
      try { const text = await res.text(); if (text) errMsg += ': ' + text.substring(0, 200); } catch {}
      statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + esc(errMsg) + '</span>';
      return;
    }
    let data;
    try { data = await res.json(); } catch {
      statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ Respuesta no válida del servidor</span>';
      return;
    }
    if (!data.ok) { statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + esc(data.error || 'Error') + '</span>'; return; }
    if (data.hasUpdates) {
      statusEl.innerHTML = '<span style="color:var(--warning);font-size:13px;">⬇ Nueva versión disponible: ' + esc(data.remoteCommit) + '</span>';
      updateBtn.disabled = false;
      updateBtn.style.opacity = '1';
    } else {
      statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ Sistema actualizado (' + esc(data.currentCommit) + ')</span>';
      updateBtn.disabled = true;
      updateBtn.style.opacity = '0.5';
    }
  } catch (e) {
    let msg = e.message;
    if (e.name === 'TypeError' && msg.includes('fetch')) msg = 'Error de conexión al servidor';
    statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + esc(msg) + '</span>';
  }
  checkBtn.disabled = false;
  checkBtn.textContent = '🔍 Buscar actualizaciones';
}

let _updatePolling = null;

async function doUpdate() {
  const statusEl = document.getElementById('upd-status');
  const updateBtn = document.getElementById('upd-update-btn');
  const checkBtn = document.getElementById('upd-check-btn');
  if (!await confirmModal('¿Aplicar actualización? Se descargarán los cambios, se instalarán dependencias y deberás reiniciar el servicio.', 'Actualizar', 'update')) return;
  updateBtn.disabled = true;
  updateBtn.textContent = 'Actualizando...';
  checkBtn.disabled = true;
  statusEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);">
      <div class="spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <span id="upd-step-text">Iniciando actualización...</span>
    </div>
    <div id="upd-progress-bar" style="margin-top:8px;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;">
      <div id="upd-progress-fill" style="height:100%;width:0%;background:var(--accent);transition:width 0.3s;"></div>
    </div>`;
  startUpdatePolling();
  try {
    const res = await fetch('/api/admin/updater/update', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' })
    });
    if (!res.ok) {
      let errMsg = 'Error HTTP ' + res.status;
      try { const text = await res.text(); if (text) errMsg += ': ' + text.substring(0, 200); } catch {}
      stopUpdatePolling();
      statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + esc(errMsg) + '</span>';
      resetUpdateButtons();
      return;
    }
    let data;
    try { data = await res.json(); } catch (e) {
      stopUpdatePolling();
      statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ Respuesta del servidor no válida. Verifique los logs.</span>';
      loadUpdaterLogs();
      resetUpdateButtons();
      return;
    }
    if (data.ok) {
      if (data.restarting) {
        statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ ' + esc(data.message) + '</span><div style="font-size:13px;color:var(--muted);margin-top:8px;">Reiniciando servicios... La página se recargará automáticamente.</div>';
        loadUpdaterLogs();
        setTimeout(function(){ location.reload(); }, 5000);
      } else {
        statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ ' + esc(data.message || 'Actualización completada') + '</span>';
        loadUpdaterLogs();
        stopUpdatePolling();
        resetUpdateButtons();
      }
    } else {
      stopUpdatePolling();
      let errorHtml = '<span style="color:var(--danger);font-size:13px;">❌ ' + esc(data.error || 'Error desconocido') + '</span>';
      if (data.step) errorHtml += '<div style="font-size:12px;color:var(--muted);margin-top:4px;">Fallo en paso: ' + esc(data.step) + '</div>';
      statusEl.innerHTML = errorHtml;
      loadUpdaterLogs();
      resetUpdateButtons();
    }
  } catch (e) {
    stopUpdatePolling();
    let msg = e.message;
    if (e.name === 'TypeError' && msg.includes('fetch')) msg = 'Error de conexión — el servidor puede estar reiniciándose';
    statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + esc(msg) + '</span>';
    resetUpdateButtons();
  }
}

function startUpdatePolling() {
  stopUpdatePolling();
  let stepIdx = 0;
  const steps = ['Descargando cambios...', 'Reseteando código...', 'Instalando dependencias...', 'Validando...', 'Reiniciando servicios...'];
  const pcts = [20, 40, 70, 85, 100];
  _updatePolling = setInterval(() => {
    if (stepIdx < steps.length - 1) stepIdx++;
    const stepEl = document.getElementById('upd-step-text');
    const fillEl = document.getElementById('upd-progress-fill');
    if (stepEl) stepEl.textContent = steps[stepIdx];
    if (fillEl) fillEl.style.width = pcts[stepIdx] + '%';
    loadUpdaterLogs();
  }, 3000);
}

function stopUpdatePolling() {
  if (_updatePolling) { clearInterval(_updatePolling); _updatePolling = null; }
}

function resetUpdateButtons() {
  const updateBtn = document.getElementById('upd-update-btn');
  const checkBtn = document.getElementById('upd-check-btn');
  updateBtn.disabled = true;
  updateBtn.style.opacity = '0.5';
  updateBtn.textContent = '⬇ Aplicar actualización';
  checkBtn.disabled = false;
  checkBtn.textContent = '🔍 Buscar actualizaciones';
}

async function loadUpdaterLogs() {
  const logEl = document.getElementById('upd-log');
  try {
    const res = await fetch('/api/admin/updater/logs', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const data = await res.json();
    logEl.textContent = data.log || '(sin registros)';
    logEl.style.display = 'block';
  } catch (e) { logEl.textContent = 'Error: ' + e.message; logEl.style.display = 'block'; }
}

// ── Rate limit config + login logs ──
async function loadRateLimitConfig() {
  try {
    var res = await fetch('/api/admin/config', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) return;
    var data = await res.json(), cfg = data.config || {};
    document.getElementById('rl-max').value = cfg.rate_limit_max || '5';
    document.getElementById('rl-window').value = cfg.rate_limit_window || '60';
  } catch (e) {}
}

async function saveRateLimitConfig() {
  var btn = document.querySelector('#tab-seguridad .btn');
  btn.textContent = 'Guardando...';
  btn.disabled = true;
  try {
    var body = { rate_limit_max: document.getElementById('rl-max').value, rate_limit_window: document.getElementById('rl-window').value };
    var res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    document.getElementById('rl-result').innerHTML = data.ok
      ? '<span style="color:var(--success);">\u2705 Guardado</span>'
      : '<span style="color:var(--danger);">\u274c Error</span>';
  } catch (e) {
    document.getElementById('rl-result').innerHTML = '<span style="color:var(--danger);">\u274c ' + e.message + '</span>';
  } finally {
    btn.textContent = '\uD83D\uDCBE Guardar';
    btn.disabled = false;
  }
}

// ── SSH Config ──
async function loadSshConfig() {
  try {
    var res = await fetch('/api/admin/config', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) return;
    var data = await res.json(), cfg = data.config || {};
    document.getElementById('ssh-host').value = cfg.ssh_host || '';
    document.getElementById('ssh-user').value = cfg.ssh_user || 'root';
  } catch (e) {}
}

async function saveSshConfig() {
  var btn = document.querySelector('#tab-seguridad .perm-rol-section:last-child .btn');
  btn.textContent = 'Guardando...';
  btn.disabled = true;
  try {
    var body = { ssh_host: document.getElementById('ssh-host').value, ssh_user: document.getElementById('ssh-user').value };
    var res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    document.getElementById('ssh-result').innerHTML = data.ok
      ? '<span style="color:var(--success);">\u2705 Guardado</span>'
      : '<span style="color:var(--danger);">\u274c Error</span>';
  } catch (e) {
    document.getElementById('ssh-result').innerHTML = '<span style="color:var(--danger);">\u274c ' + e.message + '</span>';
  } finally {
    btn.textContent = '\uD83D\uDCBE Guardar';
    btn.disabled = false;
  }
}

async function testSshConnection() {
  var resultEl = document.getElementById('ssh-result');
  var host = document.getElementById('ssh-host').value;
  var user = document.getElementById('ssh-user').value || 'root';
  if (!host) { resultEl.innerHTML = '<span style="color:var(--danger);">\u274c Ingresa un host primero</span>'; return; }
  resultEl.innerHTML = '<span style="color:var(--muted);">Probando conexión SSH...</span>';
  try {
    var res = await fetch('/api/admin/config/test-ssh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ host: host, user: user })
    });
    var data = await res.json();
    resultEl.innerHTML = data.ok
      ? '<span style="color:var(--success);">\u2705 ' + esc(data.message) + ' (PM2 ' + esc(data.version) + ')</span>'
      : '<span style="color:var(--danger);">\u274c ' + esc(data.error) + '</span>';
  } catch (e) {
    resultEl.innerHTML = '<span style="color:var(--danger);">\u274c ' + e.message + '</span>';
  }
}

async function loadLoginLogs() {
  try {
    var res = await fetchAuth('/api/admin/login-logs');
    if (!res.ok) return;
    var data = await res.json();
    var tbody = document.querySelector('#login-logs-table tbody');
    tbody.innerHTML = (data.logs || []).map(function(r) {
      var badge = r.exitoso
        ? '<span class="badge badge-admin">Exitoso</span>'
        : '<span class="badge badge-inactivo">Fallido</span>';
      return '<tr><td style="white-space:nowrap;">' + esc(r.fecha) + '</td><td>' + esc(r.ip) + '</td><td>' + esc(r.email) + '</td><td>' + badge + '</td></tr>';
    }).join('');
  } catch (e) {}
}

// ── Auditoría ──
async function loadAuditoria() {
  try {
    const [dashRes, sesionesRes] = await Promise.all([
      fetch('/api/admin/telemetry/dashboard', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
      fetch('/api/admin/sesiones', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null),
    ]);
    if (dashRes) {
      document.getElementById('aud-sesiones').textContent = dashRes.sesionesActivas || 0;
      document.getElementById('aud-logins').textContent = dashRes.loginHoy || 0;
      document.getElementById('aud-fallidos').textContent = dashRes.loginFallidosHoy || 0;
    }
    if (sesionesRes?.sesiones) {
      const tbody = document.querySelector('#sesiones-table tbody');
      tbody.innerHTML = sesionesRes.sesiones.map(s => `
        <tr>
          <td>${esc(s.usuario_nombre)}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(s.ip)}</td>
          <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(s.user_agent)}">${esc((s.user_agent || '').substring(0, 60))}</td>
          <td style="white-space:nowrap;font-size:12px;">${esc(s.ultimo_heartbeat)}</td>
          <td><button class="btn btn-sm btn-danger" onclick="killSession(${s.id}, '${esc(s.usuario_nombre)}')">⛔ Cerrar</button></td>
        </tr>
      `).join('') || '<tr><td colspan="5" style="color:var(--muted);text-align:center;">No hay sesiones activas</td></tr>';
    }
    await loadAuditoriaLogs();
  } catch (e) { toast('Error cargando auditoría: ' + e.message, 'error'); }
}

async function loadAuditoriaLogs() {
  try {
    const desde = document.getElementById('aud-desde')?.value || '';
    const hasta = document.getElementById('aud-hasta')?.value || '';
    const estado = document.getElementById('aud-estado')?.value || '';
    let url = '/api/admin/login-logs?limit=100';
    if (desde) url += '&desde=' + desde;
    if (hasta) url += '&hasta=' + hasta;
    if (estado !== '') url += '&exitoso=' + estado;
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.querySelector('#aud-logs-table tbody');
    tbody.innerHTML = (data.logs || []).map(r => {
      const badge = r.exitoso
        ? '<span class="badge badge-admin">Exitoso</span>'
        : '<span class="badge badge-inactivo">Fallido</span>';
      return `<tr><td style="white-space:nowrap;">${esc(r.fecha)}</td><td>${esc(r.ip)}</td><td>${esc(r.email)}</td><td>${badge}</td></tr>`;
    }).join('');
  } catch (e) {}
}

async function killSession(id, nombre) {
  const ok = await confirmModal(`¿Cerrar sesión de ${nombre}?`, 'Cerrar sesión remota', 'delete');
  if (!ok) return;
  try {
    const res = await fetch(`/api/admin/sesiones/${id}/kill`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (data.ok) { toast('Sesión cerrada', 'success'); loadAuditoria(); }
    else toast(data.error || 'Error', 'error');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ── Session check + refresh ──
(async () => {
  try { const r = await fetch('/api/version', { signal: AbortSignal.timeout(5000) }); const d = await r.json(); launcherVersion = d.version || ''; } catch {}
  if (jwtToken) {
    try {
      // Refresh token silently to extend session
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Authorization': 'Bearer ' + jwtToken } });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.jwt) { jwtToken = refreshData.jwt; localStorage.setItem('platform_jwt', jwtToken); }
      }
      const res = await fetch('/api/auth/me', { signal: AbortSignal.timeout(5000), headers: { 'Authorization': 'Bearer ' + jwtToken } });
      if (res.ok) {
        const data = await res.json();
        user = data;
        show('post-login-screen');
        updatePostLoginStatus('Preparando tu espacio de trabajo...', 50);
        await showLauncher();
        return;
      }
    } catch {}
    // Session invalid — show re-login modal (preserve localStorage cache)
    showSessionExpiredModal();
    return;
  }
  show('login-screen');
  const params = new URLSearchParams(window.location.search);
  if (params.get('token')) {
    document.getElementById('reset-password').value = '';
    document.getElementById('reset-password2').value = '';
    document.getElementById('reset-error').classList.remove('show');
    document.getElementById('reset-form').style.display = 'block';
    document.getElementById('reset-done').style.display = 'none';
    document.getElementById('reset-modal').style.display = 'block';
  }
})();

// ── Safety net: hide loading screen after 8s if stuck ──
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls && ls.style.display !== 'none') {
    ls.style.display = 'none';
    if (!document.getElementById('login-screen').style.display || document.getElementById('login-screen').style.display === 'none') {
      show('login-screen');
    }
  }
}, 8000);

// ── Auto-refresh token (sliding session) ──
async function refreshToken() {
  if (!jwtToken) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.jwt) { jwtToken = data.jwt; localStorage.setItem('platform_jwt', jwtToken); }
      return true;
    }
  } catch {}
  return false;
}

// Refresh every 15 minutes
setInterval(async () => {
  if (!jwtToken) return;
  const ok = await refreshToken();
  if (!ok) {
    // Don't logout — show re-login modal instead (preserves localStorage)
    showSessionExpiredModal();
  }
}, 15 * 60 * 1000);

// Refresh when tab becomes visible again (with debounce guard)
let _refreshInFlight = false;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && jwtToken && !_refreshInFlight) {
    _refreshInFlight = true;
    try {
      const ok = await refreshToken();
      if (!ok) showSessionExpiredModal();
    } finally { _refreshInFlight = false; }
  }
});

function showSessionExpiredModal() {
  // Don't clear localStorage — preserve cache
  const modal = document.getElementById('session-expired-modal');
  if (modal) modal.style.display = 'flex';
}

function hideSessionExpiredModal() {
  const modal = document.getElementById('session-expired-modal');
  if (modal) modal.style.display = 'none';
}

async function reanudarSesion() {
  const email = document.getElementById('reanudar-email')?.value?.trim();
  const pass = document.getElementById('reanudar-pass')?.value;
  const errEl = document.getElementById('reanudar-error');
  if (!email || !pass) { if (errEl) errEl.textContent = 'Ingresa tus credenciales'; return; }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Credenciales inválidas'); }
    const data = await res.json();
    jwtToken = data.jwt;
    user = data.usuario;
    localStorage.setItem('platform_jwt', jwtToken);
    hideSessionExpiredModal();
    await showLauncher();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

// ── Notifications ──

function escNotif(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(s||'')); return d.innerHTML; }

async function cargarNotificaciones() {
  try {
    const res = await fetch('/api/notificaciones/no-leidas', { headers: jwtToken ? { 'Authorization': 'Bearer ' + jwtToken } : {} });
    if (!res.ok) return;
    const { count } = await res.json();
    const badge = document.getElementById('notif-count');
    if (badge) badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';

    // Toast si hay notificaciones nuevas
    if (count > _lastNotifCount && _lastNotifCount > 0) {
      toast('Tienes ' + (count - _lastNotifCount) + ' notificación(es) nueva(s)', 'info');
      // Refrescar dropdown si está abierto
      var dd = document.getElementById('notif-dropdown');
      if (dd && dd.classList.contains('show')) {
        toggleNotifDropdown(); toggleNotifDropdown();
      }
    }
    _lastNotifCount = count;
  } catch {}
}

async function toggleNotifDropdown() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('show');
  dd.classList.toggle('show');
  if (!isOpen) {
    try {
      const res = await fetch('/api/notificaciones', { headers: jwtToken ? { 'Authorization': 'Bearer ' + jwtToken } : {} });
      if (!res.ok) return;
      const data = await res.json();
      const notificaciones = data.notificaciones || [];
      const list = dd.querySelector('.notif-list');
      if (!notificaciones.length) {
        list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
      } else {
        var icons = { tarea_asignada: '📋', tarea_aprobada: '✅', tarea_rechazada: '❌', tarea_en_revision: '📋', tarea_revision: '📋', cambio_estado: '🔄', proyecto_asignado: '📁', proyecto_aprobado: '✅', proyecto_rechazado: '❌', nuevo_comentario: '💬', alerta_vencimiento: '⏰', resumen_semanal: '📊', factura_nueva: '📄', factura_recibida: '📄', factura_asignada: '📄', factura_en_revision: '📄', factura_aprobada: '✅', factura_rechazada: '❌', factura_causada: '📄', factura_pagada: '💰', escalacion: '⚠️', pedido_nuevo: '🚚', hora_extra_registrada: '💰', hora_extra_aprobada: '✅', hora_extra_rechazada: '❌', password_reset: '🔑', usuario_creado: '👤', registro_creado: '💰', registro_aprobado: '✅', registro_rechazado: '❌', tarea_vencida: '⏰', ruta_asignada: '🛣️', backup: '💾', sistema: '⚙️' };
        list.innerHTML = notificaciones.map(function(n) {
          var timeAgo = timeSinceNotif(parseNotifDate(n.created_at));
          return '<div class="notif-item' + (n.leida ? '' : ' unread') + '" data-notif-id="' + n.id + '" data-notif-url="' + escNotif(n.url || '') + '">' +
            '<div class="notif-icon">' + (icons[n.tipo] || '🔔') + '</div>' +
            '<div class="notif-content">' +
              '<div class="notif-title">' + escNotif(n.titulo) + '</div>' +
              '<div class="notif-msg">' + escNotif(n.mensaje) + '</div>' +
              '<div class="notif-time">' + timeAgo + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
        list.querySelectorAll('.notif-item').forEach(function(el) {
          el.addEventListener('click', function() {
            var nid = el.getAttribute('data-notif-id');
            var nurl = el.getAttribute('data-notif-url') || '';
            marcarNotifLeida(nid, nurl);
          });
        });
      }
    } catch {}
  }
}

async function marcarNotifLeida(id, url) {
  try {
    await fetch('/api/notificaciones/' + id + '/leer', { method: 'DELETE', headers: jwtToken ? { 'Authorization': 'Bearer ' + jwtToken } : {} });
  } catch (e) { console.warn('[notif] Error eliminando:', e.message); }
  cargarNotificaciones();
  var dd = document.getElementById('notif-dropdown');
  if (dd) dd.classList.remove('show');
  if (url && url !== 'null' && url !== 'undefined') {
    window.location.href = url;
  }
}

async function marcarTodasLeidas() {
  try {
    await fetch('/api/notificaciones/leer-todas', { method: 'DELETE', headers: jwtToken ? { 'Authorization': 'Bearer ' + jwtToken } : {} });
    cargarNotificaciones();
    toggleNotifDropdown(); toggleNotifDropdown();
  } catch {}
}

function timeSinceNotif(date) {
  if (isNaN(date.getTime())) return '';
  var seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 0) return 'Ahora';
  if (seconds < 60) return 'Ahora';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' min';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' h';
  var days = Math.floor(hours / 24);
  return days + ' d';
}

function parseNotifDate(s) {
  if (!s) return new Date();
  if (s.includes('T')) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

function initNotifPolling() {
  cargarNotificaciones();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(pollNotificaciones, 10000);

  // Listener de visibility — solo instalar una vez
  if (!_visibilityListenerInstalled) {
    _visibilityListenerInstalled = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        pollNotificaciones();
        checkVersion();
      }
    });
  }

  // Click-outside — solo una vez
  if (!_clickOutsideListenerInstalled) {
    _clickOutsideListenerInstalled = true;
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('notif-dropdown');
      var bell = document.querySelector('.notif-bell');
      if (dd && !dd.contains(e.target) && !bell?.contains(e.target)) dd.classList.remove('show');
    });
  }
}

function pollNotificaciones() {
  if (_notifInFlight || document.visibilityState !== 'visible') return;
  _notifInFlight = true;
  cargarNotificaciones().finally(() => { _notifInFlight = false; });
}

// ── Auto-reload on server restart ──
var _ver = null;
var _verBanner = null;
var _versionInFlight = false;
function checkVersion() {
  if (!jwtToken || _versionInFlight) return;
  if (document.visibilityState !== 'visible') return;
  _versionInFlight = true;
  fetch('/api/version', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(function(r){ return r.json(); }).then(function(d){
    if (d.v) {
      if (_ver === null) { _ver = d.v; return; }
      if (d.v !== _ver) {
        if (!_verBanner) {
          _verBanner = document.createElement('div');
          _verBanner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--surface2);border-top:2px solid var(--accent);padding:14px 20px;text-align:center;font-size:14px;animation:slideUp 0.3s ease;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
          _verBanner.innerHTML = '<span style="color:var(--text);">\uD83D\uDD04 Nueva versi\u00f3n disponible</span><button onclick="location.reload()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;">Recargar ahora</button><span onclick="this.parentElement.style.display=\'none\'" style="color:var(--muted);font-size:20px;cursor:pointer;line-height:1;">\u00d7</span>';
          document.body.appendChild(_verBanner);
        }
      }
    }
  }).catch(function(){}).finally(function(){ _versionInFlight = false; });
}
function initVersionCheck() {
  checkVersion();
  if (_versionCheckTimer) clearInterval(_versionCheckTimer);
  _versionCheckTimer = setInterval(checkVersion, 30000);
}

// ── MCP Modules management (generic) ──
async function loadMcpModulesStatus() {
  const listEl = document.getElementById('mcp-modules-list');
  const detailEl = document.getElementById('mcp-module-detail');
  detailEl.style.display = 'none';
  listEl.style.display = 'block';
  listEl.innerHTML = '<span style="color:var(--muted);font-size:13px;">Cargando servicios MCP...</span>';
  try {
    const res = await fetch('/api/admin/mcp-modules/status', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { listEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">Respuesta no JSON (status ' + res.status + '): <pre style="max-height:200px;overflow:auto;background:var(--surface);padding:8px;border-radius:6px;margin-top:8px;">' + esc(text.slice(0, 1000)) + '</pre></span>'; return; }
    if (!data.ok) { listEl.innerHTML = '<span style="color:var(--danger);">Error: ' + data.error + '</span>'; return; }
    if (!data.modules.length) { listEl.innerHTML = '<span style="color:var(--muted);">No hay módulos MCP registrados</span>'; return; }
    let html = '<div style="display:grid;gap:12px;">';
    for (const m of data.modules) {
      const statusIcon = m.status === 'online' ? '🟢' : m.status === 'offline' ? '🔴' : '🟡';
      const pm2Icon = m.pm2 === 'running' ? '🟢' : '🔴';
      html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;cursor:pointer;" onclick="showMcpModuleDetail(\'' + esc(m.id) + '\')">';
      html += '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:200px;">';
      html += '<span style="font-size:24px;">' + statusIcon + '</span>';
      html += '<div><div style="font-weight:600;">' + esc(m.nombre) + '</div>';
      html += '<div style="font-size:12px;color:var(--muted);">' + esc(m.url) + '</div></div></div>';
      html += '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">';
      html += '<span style="font-size:12px;color:var(--muted);">PM2: ' + pm2Icon + '</span>';
      html += '<span style="font-size:12px;color:var(--muted);">HTTP: ' + m.status + '</span>';
      html += '<button class="btn btn-sm" onclick="event.stopPropagation();restartMcpModule(\'' + esc(m.id) + '\')">🔁 Reiniciar</button>';
      html += '<button class="btn btn-sm" onclick="event.stopPropagation();showMcpModuleDetail(\'' + esc(m.id) + '\')">📋 Detalle</button>';
      html += '</div></div>';
    }
    html += '</div>';
    listEl.innerHTML = html;
  } catch (e) { listEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">Error: ' + e.message + '</span>'; }
}

async function showMcpModuleDetail(moduleId) {
  const listEl = document.getElementById('mcp-modules-list');
  const detailEl = document.getElementById('mcp-module-detail');
  const contentEl = document.getElementById('mcp-module-detail-content');
  listEl.style.display = 'none';
  detailEl.style.display = 'block';
  contentEl.innerHTML = '<span style="color:var(--muted);font-size:13px;">Cargando detalle...</span>';
  try {
    const res = await fetch('/api/admin/mcp-modules/' + encodeURIComponent(moduleId) + '/logs', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const data = await res.json();
    contentEl.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;"><div style="font-weight:600;margin-bottom:8px;">' + esc(moduleId) + '</div><button class="btn btn-sm" onclick="restartMcpModule(\'' + esc(moduleId) + '\')">🔁 Reiniciar servicio</button></div><pre style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:16px;font-size:13px;overflow-x:auto;white-space:pre-wrap;max-height:400px;color:var(--text);">' + esc(data.log || '(sin registros)') + '</pre>';
  } catch (e) { contentEl.innerHTML = '<span style="color:var(--danger);">Error: ' + e.message + '</span>'; }
}

function closeMcpModuleDetail() {
  document.getElementById('mcp-module-detail').style.display = 'none';
  document.getElementById('mcp-modules-list').style.display = 'block';
  loadMcpModulesStatus();
}

async function restartMcpModule(moduleId) {
  if (!await confirmModal('¿Reiniciar ' + moduleId + '?', 'Reiniciar', 'restart')) return;
  try {
    const res = await fetch('/api/admin/mcp-modules/' + encodeURIComponent(moduleId) + '/restart', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    const listEl = document.getElementById('mcp-modules-list');
    if (data.ok) {
      listEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ ' + esc(data.message) + '</span>';
    } else {
      listEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + (data.error || data.message || 'Error') + '</span>';
    }
    setTimeout(loadMcpModulesStatus, 2000);
  } catch (e) { listEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + e.message + '</span>'; }
}

// ── Backup general del sistema ──
async function backupGeneral() {
  const msgEl = document.getElementById('backup-general-msg');
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--muted);">Generando backup del sistema...</span>';
  try {
    const res = await fetch('/api/admin/backup/general', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || 'Error al generar backup'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synnoxerp_backup_' + new Date().toISOString().slice(0, 10) + '.zip';
    a.click();
    URL.revokeObjectURL(url);
    if (msgEl) msgEl.innerHTML = '<span style="color:var(--success);">✓ Backup descargado</span>';
  } catch (e) {
    if (msgEl) msgEl.innerHTML = '<span style="color:var(--danger);">✗ ' + e.message + '</span>';
  }
}

async function restaurarGeneral() {
  const input = document.getElementById('restore-general-input');
  const msgEl = document.getElementById('restore-general-msg');
  if (!input?.files?.length) { if (msgEl) msgEl.innerHTML = '<span style="color:var(--warning);">Selecciona un archivo ZIP primero</span>'; return; }
  const ok = confirm('⚠️ Esto sobrescribirá TODOS los datos de Nómina, Logística, Proyectos y Proveedores.\n\n¿Continuar?');
  if (!ok) return;
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--muted);">Restaurando backup general...</span>';
  try {
    const fd = new FormData();
    fd.append('backup', input.files[0]);
    const res = await fetch('/api/admin/backup/restore', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken },
      body: fd
    });
    const data = await res.json();
    if (res.ok) {
      const mods = Object.entries(data.stats || {}).map(([k, v]) => `${k}: ${v} registros`).join(', ');
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--success);">✓ Restauración completada — ${mods}</span>`;
    } else {
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--danger);">✗ ${data.error || 'Error'}</span>`;
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = '<span style="color:var(--danger);">✗ ' + e.message + '</span>';
  }
}

// ── Export / Import ──
async function exportarConfig() {
  try {
    const res = await fetch('/api/admin/export', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || 'Error al exportar'); }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'launcher-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { toast('Error al exportar: ' + e.message, 'error'); }
}

async function importarConfig() {
  const input = document.getElementById('import-file-input');
  const resultEl = document.getElementById('import-result');
  if (!input.files || !input.files[0]) { resultEl.style.display = 'block'; resultEl.innerHTML = '<span style="color:var(--danger);">Selecciona un archivo JSON primero</span>'; return; }
  try {
    const text = await input.files[0].text();
    const data = JSON.parse(text);
    if (!data.version) throw new Error('El archivo no parece un backup válido del launcher');
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    resultEl.style.display = 'block';
    if (result.ok) {
      resultEl.innerHTML = '<span style="color:var(--success);">✓ ' + result.message + '</span>';
    } else {
      resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + (result.error || 'Error') + '</span>';
    }
  } catch (e) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<span style="color:var(--danger);">❌ ' + e.message + '</span>';
  }
}

// ── Perfiles ──
async function loadPerfiles() {
  const tbody = document.querySelector('#perfiles-table tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">Cargando...</td></tr>';
  try {
    const res = await fetchAuth('/api/admin/perfiles');
    const perfiles = await res.json();
    tbody.innerHTML = perfiles.map(p => `
      <tr>
        <td><strong>${esc(p.nombre)}</strong></td>
        <td>${esc(p.descripcion || '—')}</td>
        <td>${p.permisos.length} permiso(s)</td>
        <td>${p.usuarios_count} usuario(s)</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarPerfil(${p.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarPerfil(${p.id},'${esc(p.nombre)}')" ${p.usuarios_count > 0 ? 'disabled title="Reasigna usuarios primero"' : ''}>🗑️</button>
        </td>
      </tr>
    `).join('');
  } catch (e) { tbody.innerHTML = '<tr><td colspan="5">Error al cargar perfiles</td></tr>'; }
}

async function editarPerfil(id) {
  try {
    const [modulos, permisosConfig] = await Promise.all([
      fetch('/api/admin/modulos', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.json()),
      fetch('/api/admin/permisos-config', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.json())
    ]);
    let perfil = { nombre: '', descripcion: '', permisos: [], permisos_funcionales: [] };
    
    if (id) {
      const perfilRes = await fetch('/api/admin/perfiles/' + id, { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.json());
      if (perfilRes.error) throw new Error(perfilRes.error);
      perfil = perfilRes;
    }
    
    const permisosMap = {};
    perfil.permisos.forEach(p => {
      if (!permisosMap[p.modulo_id]) permisosMap[p.modulo_id] = [];
      permisosMap[p.modulo_id].push(p.permiso);
    });
    const funcMap = {};
    (perfil.permisos_funcionales || []).forEach(p => {
      if (!funcMap[p.modulo_id]) funcMap[p.modulo_id] = [];
      funcMap[p.modulo_id].push(p.permiso_id);
    });
    
    const modal = document.getElementById('modal-perfil');
    document.getElementById('perfil-name').value = perfil.nombre;
    document.getElementById('perfil-desc').value = perfil.descripcion || '';
    document.getElementById('perfil-id').value = id || '';
    document.getElementById('perfil-modal-title').textContent = id ? 'Editar Perfil' : 'Nuevo Perfil';
    
    const permisosEl = document.getElementById('perfil-permisos');
    permisosEl.innerHTML = modulos.map(m => {
      const basicPerms = ['Ver','Crear','Editar','Eliminar'];
      const allChecked = basicPerms.every(p => (permisosMap[m.id]||[]).includes(p.toLowerCase()));
      const moduleFuncPerms = permisosConfig[m.id] || [];
      const moduleFuncCount = (funcMap[m.id]||[]).length;
      const totalPerms = basicPerms.length + moduleFuncPerms.length;
      const totalChecked = (permisosMap[m.id]||[]).length + moduleFuncCount;
      return `
      <div style="margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--surface2);border-radius:6px;cursor:pointer;" onclick="toggleModule('${m.id}')">
          <span id="arrow-${m.id}" style="font-size:10px;color:var(--muted);">▶</span>
          <input type="checkbox" class="perfil-perm-all" data-modulo="${m.id}" ${allChecked ? 'checked' : ''} onclick="event.stopPropagation();toggleAllPerms('${m.id}',this.checked)" style="accent-color:var(--accent);width:16px;height:16px;">
          <span style="font-size:14px;">${esc(m.icon || '📦')}</span>
          <span style="font-weight:600;font-size:13px;flex:1;">${esc(m.nombre)}</span>
          <span style="font-size:11px;color:var(--muted);">${totalChecked}/${totalPerms}</span>
        </div>
        <div id="perms-${m.id}" style="display:none;padding:6px 0 6px 36px;">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-weight:600;">ACCESO BÁSICO</div>
          ${basicPerms.map(perm => `
            <div style="display:flex;align-items:center;gap:8px;padding:3px 0;">
              <input type="checkbox" class="perfil-perm" data-modulo="${m.id}" data-type="basic" value="${perm.toLowerCase()}" ${(permisosMap[m.id]||[]).includes(perm.toLowerCase()) ? 'checked' : ''} onchange="updatePermCount('${m.id}')" style="accent-color:var(--accent);width:15px;height:15px;margin:0;vertical-align:middle;">
              <span style="font-size:12px;vertical-align:middle;">${perm}</span>
            </div>
          `).join('')}
          ${moduleFuncPerms.length ? `
          <div style="font-size:11px;color:var(--muted);margin:8px 0 4px 0;font-weight:600;">PERMISOS FUNCIONALES</div>
          ${moduleFuncPerms.map(fp => `
            <div style="display:flex;align-items:center;gap:8px;padding:3px 0;">
              <input type="checkbox" class="perfil-perm-func" data-modulo="${m.id}" value="${fp.id}" label="${esc(fp.label)}" ${(funcMap[m.id]||[]).includes(fp.id) ? 'checked' : ''} onchange="updatePermCount('${m.id}')" style="accent-color:var(--accent);width:15px;height:15px;margin:0;vertical-align:middle;">
              <span style="font-size:12px;vertical-align:middle;">${esc(fp.label)}</span>
            </div>
          `).join('')}` : ''}
        </div>
      </div>`;
    }).join('');
    
    modal.classList.add('show');
  } catch (e) { toast('Error al cargar perfil: ' + e.message, 'error'); }
}

async function guardarPerfil() {
  const id = document.getElementById('perfil-id').value;
  const nombre = document.getElementById('perfil-name').value.trim();
  const descripcion = document.getElementById('perfil-desc').value.trim();
  if (!nombre) { toast('Nombre requerido', 'warning'); return; }
  
  const permisos = [];
  document.querySelectorAll('.perfil-perm:checked').forEach(cb => {
    permisos.push({ modulo_id: cb.dataset.modulo, permiso: cb.value });
  });
  const permisos_funcionales = [];
  document.querySelectorAll('.perfil-perm-func:checked').forEach(cb => {
    permisos_funcionales.push({ modulo_id: cb.dataset.modulo, permiso_id: cb.value });
  });
  
  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/perfiles/${id}` : '/api/admin/perfiles';
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': 'Bearer ' + jwtToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion, permisos, permisos_funcionales })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    cerrarModal('modal-perfil');
    loadPerfiles();
    toast(id ? 'Perfil actualizado' : 'Perfil creado', 'success');
  } catch (e) { toast('Error al guardar: ' + e.message, 'error'); }
}

async function eliminarPerfil(id, nombre) {
  if (!await confirmModal(`¿Eliminar el perfil "${nombre}"?`)) return;
  try {
    const res = await fetch(`/api/admin/perfiles/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    loadPerfiles();
    toast('Perfil eliminado', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function cerrarModal(id) { document.getElementById(id).classList.remove('show'); }

function toggleAllPerms(moduloId, checked) {
  document.querySelectorAll(`.perfil-perm[data-modulo="${moduloId}"], .perfil-perm-func[data-modulo="${moduloId}"]`).forEach(cb => {
    cb.checked = checked;
  });
  updatePermCount(moduloId);
}

function toggleModule(moduloId) {
  const el = document.getElementById('perms-' + moduloId);
  const arrow = document.getElementById('arrow-' + moduloId);
  if (el) {
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
  }
}

function toggleAllModules(checked) {
  document.querySelectorAll('.perfil-perm-all').forEach(cb => {
    toggleAllPerms(cb.dataset.modulo, checked);
    cb.checked = checked;
  });
}

function updatePermCount(moduloId) {
  const allBasic = document.querySelectorAll(`.perfil-perm[data-modulo="${moduloId}"]`);
  const allFunc = document.querySelectorAll(`.perfil-perm-func[data-modulo="${moduloId}"]`);
  const checkedBasic = document.querySelectorAll(`.perfil-perm[data-modulo="${moduloId}"]:checked`);
  const checkedFunc = document.querySelectorAll(`.perfil-perm-func[data-modulo="${moduloId}"]:checked`);
  const totalAll = allBasic.length + allFunc.length;
  const totalChecked = checkedBasic.length + checkedFunc.length;
  const parent = document.querySelector(`.perfil-perm-all[data-modulo="${moduloId}"]`);
  if (parent) parent.checked = totalAll > 0 && totalChecked === totalAll;
  const countEl = parent?.closest('[style]')?.querySelector('[style*="flex:1"]');
  if (countEl) {
    const nextEl = countEl.nextElementSibling;
    if (nextEl) nextEl.textContent = `${totalChecked}/${totalAll}`;
  }
}

// ── Centros de operación ──
async function loadCentros() {
  try {
    const res = await fetchAuth('/api/admin/centros');
    if (!res.ok) throw new Error('Error');
    const centros = await res.json();
    const tbody = document.querySelector('#centros-table tbody');
    tbody.innerHTML = centros.map(s => `
      <tr>
        <td>${s.id}</td>
        <td>${esc(s.nombre)}</td>
        <td>${esc(s.codigo || '—')}</td>
        <td>${esc(s.ciudad || '—')}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.direccion || '')}">${esc(s.direccion || '—')}</td>
        <td>${esc(s.telefono || '—')}</td>
        <td>${esc(s.email || '—')}</td>
        <td>${s.activo ? '<span style="color:var(--success);">Activo</span>' : '<span class="badge badge-inactivo">Inactivo</span>'}</td>
        <td class="actions">
          <button class="btn btn-sm btn-secondary" onclick="editCentro(${s.id})">✏️</button>
          ${s.nombre !== 'Principal' ? `<button class="btn btn-sm btn-danger" onclick="deleteCentro(${s.id},'${esc(s.nombre)}')">🗑️</button>` : ''}
        </td>
      </tr>
    `).join('');
    initTableFilters('centros-table', { searchId: 'fil-centros-q', countId: 'centros-count', searchCols: [1, 3] });
  } catch (e) { toast('Error cargando centros de operación', 'error'); }
}

function showCentroForm(data) {
  document.getElementById('centro-form-id').value = data?.id || '';
  document.getElementById('centro-form-nombre').value = data?.nombre || '';
  document.getElementById('centro-form-codigo').value = data?.codigo || '';
  document.getElementById('centro-form-ciudad').value = data?.ciudad || '';
  document.getElementById('centro-form-descripcion').value = data?.descripcion || '';
  document.getElementById('centro-form-direccion').value = data?.direccion || '';
  document.getElementById('centro-form-telefono').value = data?.telefono || '';
  document.getElementById('centro-form-email').value = data?.email || '';
  document.getElementById('centro-form-lat').value = data?.latitud || '';
  document.getElementById('centro-form-lng').value = data?.longitud || '';
  document.getElementById('centro-form-title').textContent = data?.id ? 'Editar centro de operación' : 'Nuevo centro de operación';
  document.getElementById('centro-form-overlay').style.display = 'block';
  document.getElementById('centro-form-nombre').focus();
  setTimeout(() => {
    initMapaPinCentro();
    configurarAutocompleteCentro();
  }, 150);
}

function closeCentroForm() {
  const container = document.getElementById('mapa-pin-centro');
  if (container && container._leafletMap) {
    container._leafletMap.remove();
    container._leafletMap = null;
  }
  document.getElementById('centro-form-overlay').style.display = 'none';
}

async function editCentro(id) {
  try {
    const res = await fetch(`/api/admin/centros/${id}`, { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) throw new Error('Error');
    const centro = await res.json();
    showCentroForm(centro);
  } catch (e) { toast('Error cargando centro', 'error'); }
}

async function saveCentro() {
  const id = document.getElementById('centro-form-id').value;
  const nombre = document.getElementById('centro-form-nombre').value.trim();
  if (!nombre) { toast('Nombre requerido', 'error'); return; }
  const body = {
    nombre,
    codigo: document.getElementById('centro-form-codigo').value.trim(),
    ciudad: document.getElementById('centro-form-ciudad').value.trim(),
    descripcion: document.getElementById('centro-form-descripcion').value.trim(),
    direccion: document.getElementById('centro-form-direccion').value.trim(),
    telefono: document.getElementById('centro-form-telefono').value.trim(),
    email: document.getElementById('centro-form-email').value.trim(),
    latitud: parseFloat(document.getElementById('centro-form-lat').value) || null,
    longitud: parseFloat(document.getElementById('centro-form-lng').value) || null
  };
  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/centros/${id}` : '/api/admin/centros';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeCentroForm();
    loadCentros();
    toast(id ? 'Centro actualizado' : 'Centro creado', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteCentro(id, nombre) {
  if (!await confirmModal(`¿Eliminar el centro de operación "${nombre}"?`)) return;
  try {
    const res = await fetch(`/api/admin/centros/${id}`, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    loadCentros();
    toast('Centro eliminado', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function loadCentrosForUserForm(selectedCentro) {
  try {
    const res = await fetch('/api/centros', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const centros = await res.json();
    const sel = document.getElementById('form-sede-select');
    if (sel) {
      sel.innerHTML = centros.map(s => `<option value="${esc(s.nombre)}" ${s.nombre === selectedCentro ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
    }
  } catch (e) {}
}

// ── Google Maps Autocomplete for Centro ──
function configurarAutocompleteCentro() {
  if (typeof google === 'undefined' || !window.googleMapsListo) {
    const input = document.getElementById('centro-form-direccion');
    if (input && !input._aviso) {
      input._aviso = true;
      input.placeholder = '🔑 Configura API Key en Ajustes → Mapas';
      input.title = 'Ve a Configuración → Mapas para ingresar tu API key de Google Maps';
    }
    return;
  }
  const input = document.getElementById('centro-form-direccion');
  if (!input || input._autocomplete) return;
  const ac = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'co' },
    fields: ['address_components', 'formatted_address', 'geometry', 'name']
  });
  input._autocomplete = true;
  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place.geometry) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    document.getElementById('centro-form-lat').value = lat;
    document.getElementById('centro-form-lng').value = lng;
    for (const comp of place.address_components || []) {
      if (comp.types.includes('locality') || comp.types.includes('administrative_area_level_2')) {
        document.getElementById('centro-form-ciudad').value = comp.long_name;
        break;
      } else if (comp.types.includes('administrative_area_level_1')) {
        document.getElementById('centro-form-ciudad').value = comp.long_name;
      }
    }
    if (place.formatted_address) input.value = place.formatted_address;
    actualizarMapaPinCentro(lat, lng);
  });
}

// ── Leaflet Map for Centro ──
function initMapaPinCentro() {
  const container = document.getElementById('mapa-pin-centro');
  if (!container || container._leafletMap) return;
  const latVal = parseFloat(document.getElementById('centro-form-lat')?.value);
  const lngVal = parseFloat(document.getElementById('centro-form-lng')?.value);
  const hasCoords = !isNaN(latVal) && !isNaN(lngVal);
  const center = hasCoords ? [latVal, lngVal] : [4.6097, -74.0817];
  const map = L.map(container).setView(center, hasCoords ? 16 : 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  container._leafletMap = map;
  requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
  if (hasCoords) {
    L.marker(center, { draggable: true }).addTo(map).on('dragend', (e) => {
      const pos = e.target.getLatLng();
      document.getElementById('centro-form-lat').value = pos.lat.toFixed(8);
      document.getElementById('centro-form-lng').value = pos.lng.toFixed(8);
    });
  }
  map.on('click', (e) => {
    map.eachLayer((l) => { if (l instanceof L.Marker) map.removeLayer(l); });
    const m = L.marker(e.latlng, { draggable: true }).addTo(map);
    document.getElementById('centro-form-lat').value = e.latlng.lat.toFixed(8);
    document.getElementById('centro-form-lng').value = e.latlng.lng.toFixed(8);
    m.on('dragend', () => {
      const pos = m.getLatLng();
      document.getElementById('centro-form-lat').value = pos.lat.toFixed(8);
      document.getElementById('centro-form-lng').value = pos.lng.toFixed(8);
    });
  });
}

function actualizarMapaPinCentro(lat, lng) {
  const container = document.getElementById('mapa-pin-centro');
  if (!container || !container._leafletMap) return;
  const map = container._leafletMap;
  map.eachLayer((layer) => { if (layer instanceof L.Marker) map.removeLayer(layer); });
  const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
  map.setView([lat, lng], 16);
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    document.getElementById('centro-form-lat').value = pos.lat.toFixed(8);
    document.getElementById('centro-form-lng').value = pos.lng.toFixed(8);
  });
}

// ── Google Maps API Key Config ──
async function guardarGmapsKey() {
  const key = document.getElementById('gmaps-key-input')?.value?.trim();
  if (!key) { toast('Ingresa una API key', 'error'); return; }
  try {
    const res = await fetch('/api/admin/config/gmaps/key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast('API key guardada', 'success');
    document.getElementById('gmaps-key-status').innerHTML = '<span style="color:var(--success)">● Configurada</span>';
  } catch (e) { toast(e.message, 'error'); }
}

async function eliminarGmapsKey() {
  if (!await confirmModal('¿Eliminar la API key de Google Maps?')) return;
  try {
    await fetch('/api/admin/config/gmaps/key', {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    toast('API key eliminada', 'success');
    document.getElementById('gmaps-key-status').innerHTML = '<span style="color:var(--muted)">● No configurada</span>';
    document.getElementById('gmaps-key-input').value = '';
  } catch (e) { toast(e.message, 'error'); }
}

async function loadGmapsKeyStatus() {
  try {
    const res = await fetch('/api/config/gmaps/js-url', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const data = await res.json();
    const el = document.getElementById('gmaps-key-status');
    if (el) {
      el.innerHTML = data.url
        ? '<span style="color:var(--success)">● Configurada</span>'
        : '<span style="color:var(--muted)">● No configurada</span>';
    }
  } catch {}
}

// ── Dynamic Table Filters ──
function initTableFilters(tableId, opts = {}) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const searchCols = opts.searchCols || null;
  const statusKey = opts.statusKey || 'status';

  function applyFilters() {
    const search = (opts.searchId ? document.getElementById(opts.searchId) : document.querySelector('.table-filters .filter-input'))?.value.toLowerCase() || '';
    const status = (opts.statusId ? document.getElementById(opts.statusId) : document.querySelector('.table-filters .filter-select'))?.value || '';
    let visible = 0;
    rows.forEach(row => {
      let matchSearch = true;
      if (search) {
        if (searchCols && searchCols.length) {
          matchSearch = searchCols.some(ci => {
            const cell = row.children[ci];
            return cell && cell.textContent.toLowerCase().includes(search);
          });
        } else {
          matchSearch = row.textContent.toLowerCase().includes(search);
        }
      }
      const matchStatus = !status || row.dataset[statusKey] === status;
      const show = matchSearch && matchStatus;
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    const countEl = opts.countId ? document.getElementById(opts.countId) : document.querySelector('.table-filters .filter-count');
    if (countEl) countEl.textContent = `Mostrando ${visible} de ${rows.length} registros`;
  }

  const searchEl = opts.searchId ? document.getElementById(opts.searchId) : document.querySelector('.table-filters .filter-input');
  const statusEl = opts.statusId ? document.getElementById(opts.statusId) : document.querySelector('.table-filters .filter-select');

  // Cleanup: remove previous listeners to avoid accumulation
  if (searchEl && searchEl._tableFilterHandler) {
    searchEl.removeEventListener('input', searchEl._tableFilterHandler);
  }
  if (statusEl && statusEl._tableFilterHandler) {
    statusEl.removeEventListener('change', statusEl._tableFilterHandler);
  }

  if (searchEl) {
    searchEl._tableFilterHandler = applyFilters;
    searchEl.addEventListener('input', applyFilters);
  }
  if (statusEl) {
    statusEl._tableFilterHandler = applyFilters;
    statusEl.addEventListener('change', applyFilters);
  }
  applyFilters();
  return { applyFilters, rows };
}

function clearTableFilters(containerId) {
  const root = containerId ? document.getElementById(containerId) : document;
  const inputs = root.querySelectorAll('.table-filters .filter-input, .table-filters .filter-select');
  inputs.forEach(el => { el.value = ''; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')); });
}

