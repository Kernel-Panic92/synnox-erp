let jwtToken = localStorage.getItem('platform_jwt');
let user = null;

function esc(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(s||'')); return d.innerHTML; }

function confirmModal(msg, title = 'Confirmar') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = `
      <div data-confirm="1" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:32px;width:340px;text-align:center;flex-shrink:0">
        <div style="width:64px;height:64px;margin:0 auto 16px;background:rgba(239,68,68,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center">
          <span style="font-size:28px">🗑️</span>
        </div>
        <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text)">${esc(title)}</h3>
        <p style="font-size:14px;color:var(--muted);margin-bottom:24px;line-height:1.5">${esc(msg)}</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn btn-sm" style="background:var(--surface2);color:var(--text);min-width:100px" onclick="this.closest('[data-confirm]').parentElement.remove();window._confirmResolve(false)">Cancelar</button>
          <button class="btn btn-sm btn-danger" style="min-width:100px" onclick="this.closest('[data-confirm]').parentElement.remove();window._confirmResolve(true)">Confirmar</button>
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
  const theme = localStorage.getItem('synnox_theme') || 'light';
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
  const isDark = root.style.getPropertyValue('--bg') === '#12141a' || root.style.getPropertyValue('--bg') === '';
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
  ['login-screen', 'launcher-screen', 'admin-screen', 'admin-form-overlay', 'modulo-form-overlay'].forEach(s => {
    const el = document.getElementById(s);
    if (s === id) {
      el.style.display = (s === 'login-screen') ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
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
    await showLauncher();
  } catch (e) {
    showError(errEl, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

let launcherVersion = '';

const MODULOS_FIJOS = [
  { id: 'proveedores', nombre: 'Proveedores', icon: '📄', desc: 'Facturas y proveedores', ruta: '/proveedores/' },
  { id: 'logistica', nombre: 'Logística', icon: '🚚', desc: 'Planeación de rutas', ruta: '/logistica/' },
  { id: 'nomina', nombre: 'Nómina', icon: '💰', desc: 'Horas extra y novedades', ruta: '/nomina/' },
  { id: 'proyectos', nombre: 'Proyectos', icon: '📋', desc: 'Gestión de proyectos y tareas', ruta: '/proyectos/' },
];

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

async function showLauncher() {
  document.getElementById('launcher-user').innerHTML = esc(user?.nombre || '') + (launcherVersion ? ' <span style="font-size:11px;color:var(--muted);font-weight:400;">v' + launcherVersion + '</span>' : '');
  document.getElementById('launcher-role').textContent = user?.perfil_nombre || user?.rol || '';

  const grid = document.getElementById('module-grid');
  grid.innerHTML = '';

  const modulosDisponibles = user?.rol === 'admin'
    ? MODULOS_FIJOS
    : MODULOS_FIJOS.filter(m => user?.modulos?.includes(m.id));

  // Sort by usage frequency (most visited first)
  const usage = JSON.parse(localStorage.getItem('module_usage') || '{}');
  modulosDisponibles.sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));

  for (const mod of modulosDisponibles) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = window.location.origin + mod.ruta;
    card.target = '_blank';
    card.rel = 'noopener';
    card.onclick = () => {
      trackModuleVisit(mod.id);
      // Also track submodule if hash is present
      const hash = window.location.hash?.replace('#', '');
      if (hash) trackModuleVisit(hash);
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

  if (user?.rol === 'admin') {
    cargarServerStats();
    cargarCommits();
    cargarQuickActions();
    cargarModuleSummary();
    cargarPendingTasks();
    cargarAlerts();
    cargarUpcoming();
    cargarWeather();
    cargarActivity();
  }
  show('launcher-screen');
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
        <a href="${window.location.origin + s.ruta}" target="_blank" onclick="trackModuleVisit('${s.id}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);text-decoration:none;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
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
  } catch { w.style.display = 'none'; }
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
        ${tasks.map(t => `<a href="${t.link}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(247,151,79,0.08);border:1px solid rgba(247,151,79,0.2);border-radius:8px;font-size:13px;color:var(--text);text-decoration:none;">
          <span style="font-size:16px;">${t.icon}</span> ${t.text}
        </a>`).join('')}
      </div>`;
  } catch { w.style.display = 'none'; }
}

async function cargarAlerts() {
  const w = document.getElementById('alerts-widget');
  if (!w) return;
  try {
    const alerts = [];
    const diskRes = await fetch('/api/admin/server/stats', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null);
    if (diskRes?.disk) {
      const pct = parseInt(diskRes.disk.usePct);
      if (pct > 90) alerts.push({ level: 'danger', icon: '🔴', text: `Disco al ${pct}% — espacio crítico` });
      else if (pct > 80) alerts.push({ level: 'warning', icon: '🟡', text: `Disco al ${pct}% — considerar limpiar` });
    }
    const healthRes = await fetch('/api/admin/health', { headers: { 'Authorization': 'Bearer ' + jwtToken } }).then(r => r.ok ? r.json() : null);
    if (healthRes?.modules) {
      for (const [id, status] of Object.entries(healthRes.modules)) {
        if (status !== 'ok') alerts.push({ level: 'danger', icon: '🔴', text: `Módulo ${id}: ${status}` });
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
  } catch { w.style.display = 'none'; }
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
  } catch { w.style.display = 'none'; }
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

async function cargarActivity() {
  const w = document.getElementById('activity-widget');
  if (!w) return;
  try {
    const res = await fetch('/api/admin/login-logs', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) { w.style.display = 'none'; return; }
    const data = await res.json();
    const logs = data.logs || data.rows || data || [];
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
  } catch { w.style.display = 'none'; }
}

async function cargarCommits() {
  const w = document.getElementById('commits-widget');
  if (!w) return;
  try {
    const res = await fetch('/api/admin/commits?limit=8', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) { w.style.display = 'none'; return; }
    const data = await res.json();
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
  } catch { w.style.display = 'none'; }
}

async function cargarServerStats() {
  const w = document.getElementById('server-stats-widget');
  if (!w) return;
  try {
    const res = await fetch('/api/admin/server/stats', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) { w.style.display = 'none'; return; }
    const s = await res.json();
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
    setTimeout(() => { if (document.getElementById('launcher-screen').style.display !== 'none') cargarServerStats(); }, 30000);
  } catch { setTimeout(() => { if (document.getElementById('launcher-screen').style.display !== 'none') cargarServerStats(); }, 30000); }
}

function logout() {
  localStorage.removeItem('platform_jwt');
  document.cookie = 'launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  jwtToken = null;
  user = null;
  show('login-screen');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

// ── Admin ──
function showAdmin() {
  document.getElementById('admin-header-user').innerHTML = esc(user?.nombre || '') + (launcherVersion ? ' <span style="font-size:11px;color:var(--muted);font-weight:400;">v' + launcherVersion + '</span>' : '');
  show('admin-screen');
  showAdminTab('usuarios');
}

async function loadUsers() {
  try {
    const res = await fetch('/api/admin/usuarios', {
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) throw new Error('Error al cargar usuarios');
    const users = await res.json();
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
        <td class="actions">
          <button class="btn btn-sm btn-secondary" onclick="editUser(${u.id})">✏️ Editar</button>
          ${u.activo ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">🗑️ Desactivar</button>` : ''}
          ${!u.activo ? `<button class="btn btn-sm btn-danger" onclick="deleteUserPermanent(${u.id})">🗑️ Eliminar</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

let cachedModulos = [];

function toggleModulosSection() {
  const isAdmin = document.getElementById('form-rol').value === 'admin';
  document.getElementById('form-modulos-section').style.display = isAdmin ? 'none' : 'block';
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
      await fetch('/api/admin/usuarios/' + userId + '/modulos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
        body: JSON.stringify({ modulos: selectedModulos })
      });
    }

    closeForm();
    if (!id && !password && result.welcome_sent) {
      toast('Usuario creado. Se envió correo de bienvenida.', 'success');
    } else {
      toast(id ? 'Usuario actualizado' : 'Usuario creado', 'success');
    }
    loadUsers();
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
    loadUsers();
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
    loadUsers();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Módulos ──
async function loadModulos() {
  try {
    const res = await fetch('/api/admin/modulos', {
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
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

// ── Admin tab router ──
function showAdminTab(tab) {
  document.querySelectorAll('#admin-screen .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('#admin-screen .tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  if (tab === 'usuarios') loadUsers();
  else if (tab === 'perfiles') loadPerfiles();
  else if (tab === 'centros') loadCentros();
  else if (tab === 'modulos') loadModulos();
   else if (tab === 'mcp') { loadMcpConfig(); loadMcpUrl(); }
   else if (tab === 'smtp') loadSmtpConfig();
   else if (tab === 'apariencia') loadGradConfig();
   else if (tab === 'seguridad') { loadRateLimitConfig(); loadSshConfig(); loadLoginLogs(); }
   else if (tab === 'nginx') loadNginx();
   else if (tab === 'actualizar') { loadUpdaterStatus(); loadUpdaterLogs(); }
    else if (tab === 'mcp-modules') { loadMcpModulesStatus(); }
    else if (tab === 'respaldo') { document.getElementById('import-result').style.display = 'none'; }

}

// ── Nginx ──
async function loadNginx() {
  const pre = document.getElementById('nginx-config');
  const statusEl = document.getElementById('nginx-status');
  pre.textContent = 'Cargando...';
  statusEl.innerHTML = '';
  try {
    const res = await fetch('/api/admin/nginx', {
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    if (!res.ok) throw new Error('Error');
    const data = await res.json();
    pre.textContent = data.config;
    if (data.actual) {
      statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ Configuración actual coincide con la generada</span>';
    } else if (data.actual === '') {
      statusEl.innerHTML = '<span style="color:var(--muted);font-size:13px;">No hay archivo nginx en /etc/nginx/sites-available/synnoxerp</span>';
    } else {
      statusEl.innerHTML = '<span style="color:var(--warning);font-size:13px;">⚠ La configuración actual difiere de la generada</span>';
    }
  } catch (e) {
    pre.textContent = 'Error: ' + e.message;
  }
}

async function generarNginx() {
  const btn = document.getElementById('nginx-gen-btn');
  const statusEl = document.getElementById('nginx-status');
  btn.disabled = true;
  btn.textContent = 'Generando...';
  statusEl.innerHTML = '<span style="color:var(--muted);font-size:13px;">Generando y recargando nginx...</span>';
  try {
    const res = await fetch('/api/admin/nginx/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken }
    });
    const data = await res.json();
    if (data.ok) {
      statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ Nginx generado y recargado exitosamente</span>';
    } else {
      statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + (data.error || 'Error') + '</span>';
    }
    loadNginx();
  } catch (e) {
    statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + e.message + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Generar y recargar';
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
    const data = await res.json();
    if (!data.ok) { statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + data.error + '</span>'; return; }
    if (data.hasUpdates) {
      statusEl.innerHTML = '<span style="color:var(--warning);font-size:13px;">⬇ Nueva versión disponible: ' + esc(data.remoteCommit) + '</span>';
      updateBtn.disabled = false;
      updateBtn.style.opacity = '1';
    } else {
      statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ Sistema actualizado (' + esc(data.currentCommit) + ')</span>';
      updateBtn.disabled = true;
      updateBtn.style.opacity = '0.5';
    }
  } catch (e) { statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + e.message + '</span>'; }
  checkBtn.disabled = false;
  checkBtn.textContent = '🔍 Buscar actualizaciones';
}

async function doUpdate() {
  const statusEl = document.getElementById('upd-status');
  const updateBtn = document.getElementById('upd-update-btn');
  const checkBtn = document.getElementById('upd-check-btn');
  if (!await confirmModal('¿Aplicar actualización? Se descargarán los cambios, se instalarán dependencias y deberás reiniciar el servicio.')) return;
  updateBtn.disabled = true;
  updateBtn.textContent = 'Actualizando...';
  checkBtn.disabled = true;
  statusEl.innerHTML = '<span style="color:var(--muted);font-size:13px;">⬇ Actualizando...</span>';
  try {
    const res = await fetch('/api/admin/updater/update', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwtToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' })
    });
    const data = await res.json();
    if (data.ok) {
      if (data.restarting) {
        statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ ' + esc(data.message) + '</span><div style="font-size:13px;color:var(--muted);margin-top:8px;">Reiniciando servicios... La página se recargará automáticamente.</div>';
        loadUpdaterLogs();
        setTimeout(function(){ location.reload(); }, 5000);
      } else {
        statusEl.innerHTML = '<span style="color:var(--success);font-size:13px;">✓ ' + esc(data.message || 'Actualización completada') + '</span>';
        loadUpdaterLogs();
      }
    } else {
      statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + (data.error || 'Error') + '</span>';
    }
  } catch (e) { statusEl.innerHTML = '<span style="color:var(--danger);font-size:13px;">❌ ' + e.message + '</span>'; }
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
    var res = await fetch('/api/admin/login-logs', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
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

// ── Gradient config ──
const GRAD_DEFAULTS = { c1: [230,126,34], c2: [247,148,79], c3: [196,98,16] };
let gradColors = {};

function gradBody(c1, c2) {
  return 'radial-gradient(ellipse at 20% 50%, rgba(' + c1.join(',') + ',0.06) 0%, transparent 60%),' +
         'radial-gradient(ellipse at 80% 20%, rgba(' + c2.join(',') + ',0.05) 0%, transparent 50%),' +
         'var(--bg)';
}

function gradLogin(c1, c2, c3) {
  return 'radial-gradient(ellipse at 20% 30%, rgba(' + c1.join(',') + ',0.10) 0%, transparent 50%),' +
         'radial-gradient(ellipse at 80% 70%, rgba(' + c2.join(',') + ',0.07) 0%, transparent 40%),' +
         'radial-gradient(ellipse at 50% 0%, rgba(' + c3.join(',') + ',0.05) 0%, transparent 30%),' +
         'linear-gradient(160deg, #1a1615 0%, #12100f 100%)';
}

function gradPreview(c1, c2) {
  return 'linear-gradient(135deg, rgba(' + c1.join(',') + ',0.3), rgba(' + c2.join(',') + ',0.2))';
}

function applyGradients(c1, c2, c3) {
  document.body.style.background = gradBody(c1, c2);
  var loginEl = document.getElementById('login-screen');
  if (loginEl) loginEl.style.background = gradLogin(c1, c2, c3);
  var previewEl = document.getElementById('gradient-preview');
  if (previewEl) previewEl.style.background = gradPreview(c1, c2);
}

function updateSliderVals(c1, c2, c3) {
  var names = ['c1','c2','c3'], vals = [c1,c2,c3], chs = ['r','g','b'];
  for (var i = 0; i < 3; i++)
    for (var j = 0; j < 3; j++) {
      var el = document.getElementById('grad-' + names[i] + '-' + chs[j]);
      if (el) el.value = vals[i][j];
      var vel = document.getElementById('grad-' + names[i] + '-' + chs[j] + 'v');
      if (vel) vel.textContent = vals[i][j];
    }
}

function readSliders() {
  return [
    [+document.getElementById('grad-c1-r').value, +document.getElementById('grad-c1-g').value, +document.getElementById('grad-c1-b').value],
    [+document.getElementById('grad-c2-r').value, +document.getElementById('grad-c2-g').value, +document.getElementById('grad-c2-b').value],
    [+document.getElementById('grad-c3-r').value, +document.getElementById('grad-c3-g').value, +document.getElementById('grad-c3-b').value]
  ];
}

function previewGrad() {
  var c = readSliders();
  gradColors = { c1: c[0], c2: c[1], c3: c[2] };
  updateSliderVals(c[0], c[1], c[2]);
  applyGradients(c[0], c[1], c[2]);
  localStorage.setItem('app_grad', JSON.stringify({ c1: c[0], c2: c[1], c3: c[2] }));
}

async function loadGradConfig() {
  var c1, c2, c3;
  try {
    var res = await fetch('/api/config');
    if (res.ok) {
      var data = await res.json(), cfg = data.config || {};
      if (cfg.grad_c1) c1 = cfg.grad_c1.split(',').map(Number);
      if (cfg.grad_c2) c2 = cfg.grad_c2.split(',').map(Number);
      if (cfg.grad_c3) c3 = cfg.grad_c3.split(',').map(Number);
    }
  } catch (e) { console.error('grad fetch fail', e); }
  if (!c1) {
    try {
      var saved = localStorage.getItem('app_grad');
      if (saved) { var p = JSON.parse(saved); if (p.c1) { c1 = p.c1; c2 = p.c2; c3 = p.c3; } }
    } catch (e) {}
  }
  if (!c1) { c1 = GRAD_DEFAULTS.c1; c2 = GRAD_DEFAULTS.c2; c3 = GRAD_DEFAULTS.c3; }
  gradColors = { c1: c1, c2: c2, c3: c3 };
  updateSliderVals(c1, c2, c3);
  applyGradients(c1, c2, c3);
}

async function saveGradConfig() {
  var btn = document.querySelector('#tab-apariencia .btn');
  if (!btn) return;
  btn.textContent = 'Guardando...';
  btn.disabled = true;
  try {
    var c = readSliders(), body = {
      grad_c1: c[0].join(','),
      grad_c2: c[1].join(','),
      grad_c3: c[2].join(',')
    };
    var res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    document.getElementById('grad-result').innerHTML = data.ok
      ? '<span style="color:var(--success);">\u2705 Colores guardados</span>'
      : '<span style="color:var(--danger);">\u274c Error al guardar</span>';
    if (data.ok) localStorage.setItem('app_grad', JSON.stringify({ c1: c[0], c2: c[1], c3: c[2] }));
  } catch (e) {
    document.getElementById('grad-result').innerHTML = '<span style="color:var(--danger);">\u274c ' + e.message + '</span>';
  } finally {
    btn.textContent = '\uD83D\uDCBE Guardar colores';
    btn.disabled = false;
  }
}

function resetGradConfig() {
  var c1 = GRAD_DEFAULTS.c1, c2 = GRAD_DEFAULTS.c2, c3 = GRAD_DEFAULTS.c3;
  gradColors = { c1: c1, c2: c2, c3: c3 };
  updateSliderVals(c1, c2, c3);
  applyGradients(c1, c2, c3);
  document.getElementById('grad-result').innerHTML = '<span style="color:var(--muted);">\u21ba Colores restaurados (sin guardar)</span>';
}

// ── Session check ──
(async () => {
  try { const r = await fetch('/api/version'); const d = await r.json(); launcherVersion = d.version || ''; } catch {}
  await loadGradConfig();
  if (jwtToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + jwtToken }
      });
      if (res.ok) {
        const data = await res.json();
        user = data;
        await showLauncher();
        return;
      }
    } catch {}
    localStorage.removeItem('platform_jwt');
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

// ── Auto-reload on server restart ──
(function() {
  var ver = null;
  var banner = null;
  function checkVersion() {
    fetch('/api/version', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(d){
      if (d.v) {
        if (ver === null) { ver = d.v; return; }
        if (d.v !== ver) {
          if (!banner) {
            banner = document.createElement('div');
            banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--surface2);border-top:2px solid var(--accent);padding:14px 20px;text-align:center;font-size:14px;animation:slideUp 0.3s ease;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
            banner.innerHTML = '<span style="color:var(--text);">\uD83D\uDD04 Nueva versi\u00f3n disponible</span><button onclick="location.reload()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;">Recargar ahora</button><span onclick="this.parentElement.style.display=\'none\'" style="color:var(--muted);font-size:20px;cursor:pointer;line-height:1;">\u00d7</span>';
            document.body.appendChild(banner);
          }
        }
      }
    }).catch(function(){});
  }
  checkVersion();
  setInterval(checkVersion, 15000);
})();

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
  if (!await confirmModal('¿Reiniciar ' + moduleId + '?')) return;
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
  try {
    const res = await fetch('/api/admin/perfiles', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
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
    const res = await fetch('/api/admin/centros', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    if (!res.ok) throw new Error('Error');
    const centros = await res.json();
    const tbody = document.querySelector('#centros-table tbody');
    tbody.innerHTML = centros.map(s => `
      <tr>
        <td>${s.id}</td>
        <td>${esc(s.nombre)}</td>
        <td>${s.activo ? '<span style="color:var(--success);">Activo</span>' : '<span class="badge badge-inactivo">Inactivo</span>'}</td>
        <td class="actions">
          <button class="btn btn-sm btn-secondary" onclick="editCentro(${s.id})">✏️ Editar</button>
          ${s.nombre !== 'Principal' ? `<button class="btn btn-sm btn-danger" onclick="deleteCentro(${s.id},'${esc(s.nombre)}')">🗑️ Eliminar</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (e) { toast('Error cargando centros de operación', 'error'); }
}

function showCentroForm(data) {
  document.getElementById('centro-form-id').value = data?.id || '';
  document.getElementById('centro-form-nombre').value = data?.nombre || '';
  document.getElementById('centro-form-title').textContent = data?.id ? 'Editar centro de operación' : 'Nuevo centro de operación';
  document.getElementById('centro-form-overlay').style.display = 'block';
  document.getElementById('centro-form-nombre').focus();
}

function closeCentroForm() {
  document.getElementById('centro-form-overlay').style.display = 'none';
}

async function editCentro(id) {
  try {
    const res = await fetch('/api/admin/centros', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const centros = await res.json();
    const centro = centros.find(s => s.id === id);
    if (centro) showCentroForm(centro);
  } catch (e) { toast('Error cargando centro', 'error'); }
}

async function saveCentro() {
  const id = document.getElementById('centro-form-id').value;
  const nombre = document.getElementById('centro-form-nombre').value.trim();
  if (!nombre) { toast('Nombre requerido', 'error'); return; }
  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/admin/centros/${id}` : '/api/admin/centros';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
      body: JSON.stringify({ nombre })
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

// Load centros for user form dropdown
async function loadCentrosForUserForm(selectedCentro) {
  try {
    const res = await fetch('/api/admin/centros', { headers: { 'Authorization': 'Bearer ' + jwtToken } });
    const centros = await res.json();
    const sel = document.getElementById('form-sede-select');
    if (sel) {
      sel.innerHTML = centros.filter(s => s.activo).map(s => `<option value="${esc(s.nombre)}" ${s.nombre === selectedCentro ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
    }
  } catch (e) {}
}

