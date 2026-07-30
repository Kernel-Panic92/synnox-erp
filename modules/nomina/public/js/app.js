// app.js - Main initialization and global state

const PAGINAS_VALIDAS = ['dashboard','historial','empleados','nomina','registro','reportes','centros','configuracion','tipos','siesa'];
function paginaSegura(hash) {
  return PAGINAS_VALIDAS.includes(hash) ? hash : 'dashboard';
}

// Theme Management
function aplicarTema() {
  const saved = localStorage.getItem('synnox_theme') || 'light';
  const icon = document.getElementById('theme-icon');
  const text = document.getElementById('theme-text');
  if (saved === 'light') {
    document.body.classList.add('light');
    if (icon) icon.textContent = '☀️';
    if (text) text.textContent = 'Modo oscuro';
  } else {
    document.body.classList.remove('light');
    if (icon) icon.textContent = '🌙';
    if (text) text.textContent = 'Modo claro';
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('synnox_theme', isLight ? 'light' : 'dark');
  const icon=document.getElementById('theme-icon');if(icon)icon.textContent=isLight?'☀️':'🌙';
  const text=document.getElementById('theme-text');if(text)text.textContent=isLight?'Modo oscuro':'Modo claro';
  
  // Re-render dashboard charts with new theme
  if (typeof renderDashboard === 'function') {
    renderDashboard();
  }
  // NOTE: renderDashboard is now async but toggleTheme is sync;
  // fire-and-forget is acceptable here since the chart load is cached
}

// Permission Controls
function applyPermControls() {
  document.querySelectorAll('[data-perm]').forEach(el => {
    const p = el.dataset.perm;
    el.style.display = hasPerm(p) ? '' : 'none';
  });
  
  // Map page names to permission keys
  const pagePermMap = {
    registro: 'registros',
    empleados: 'empleados',
    usuarios: 'usuarios',
    centros: 'centros',
    nomina: 'nominas',
    nominas: 'nominas',
    configuracion: 'configuracion',
    siesa: 'siesa',
    tipos: 'tipos',
  };
  
  // Show/hide nav items based on permissions
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const page = item.dataset.page;
    if (!page) return;
    const perm = pagePermMap[page];
    if (perm) {
      item.style.display = hasPerm(perm) ? '' : 'none';
    }
  });
  
  // Config page admin-only
  const navCfg = document.querySelector('.nav-item[data-page="configuracion"]');
  if (navCfg) navCfg.style.display = hasPerm('configuracion') ? '' : 'none';
}

// Navigation
async function navigate(page) {
  // Destroy charts when leaving dashboard (stops Chart.js RAF loops)
  const oldPage = window._currentPage;
  if (oldPage === 'dashboard' && oldPage !== page && typeof destruirCharts === 'function') {
    destruirCharts();
  }
  
  // Save last page
  localStorage.setItem('he_last_page', page);
  
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  
  // Show selected page
  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');
  
  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (activeNav) activeNav.classList.add('active');
  
  // Update URL
  history.pushState(null, '', '#' + page);
  
  // Track current page for telemetry
  window._currentPage = page;
  
  // Load page-specific data
  switch (page) {
    case 'dashboard':
      if (typeof initGridSize === 'function') initGridSize();
      if (typeof reloadDashboardData === 'function') await reloadDashboardData();
      break;
    case 'historial':
      if (typeof populateRegistroSelects === 'function') populateRegistroSelects();
      if (typeof restaurarFiltrosHistorial === 'function') restaurarFiltrosHistorial();
      if (typeof renderHistorial === 'function') await renderHistorial();
      break;
    case 'empleados':
      if (typeof renderEmpleados === 'function') renderEmpleados();
      break;
    case 'nomina':
      if (typeof renderNomina === 'function') renderNomina();
      break;
    case 'registro':
      if (typeof populateRegistroSelects === 'function') populateRegistroSelects();
      break;
    case 'reportes':
      if (typeof restaurarRangoReporte === 'function') restaurarRangoReporte();
      if (typeof renderReporte === 'function') renderReporte();
      break;
    case 'centros':
      if (typeof renderCentros === 'function') renderCentros();
      break;
    case 'tipos':
      if (typeof renderTipos === 'function') renderTipos();
      break;
    case 'configuracion':
      if (typeof rConfig === 'function') rConfig();
      break;
    case 'siesa':
      if (typeof cargarSiesa === 'function') cargarSiesa();
      break;
  }
  
  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

// ── Sidebar (framework-compatible) ──
function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.querySelector('.sidebar-overlay')?.classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-overlay')?.classList.remove('show');
}
function toggleSidebarCollapse() {
  const s = document.getElementById('sidebar');
  if (!s) return;
  s.classList.toggle('collapsed');
  localStorage.setItem('sidebar_collapsed', s.classList.contains('collapsed'));
}

// Sidebar Home link
function injectSidebarHome() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer || footer.querySelector('.sidebar-home')) return;
  const homeLink = document.createElement('a');
  homeLink.href = '/';
  homeLink.className = 'sidebar-home';
  homeLink.innerHTML = '<span class="icon">🏠</span> <span>Home</span>';
  const logoutBtn = footer.querySelector('.btn-logout');
  if (logoutBtn) {
    footer.insertBefore(homeLink, logoutBtn);
    const sep = document.createElement('div');
    sep.className = 'sidebar-separator';
    footer.insertBefore(sep, logoutBtn);
  } else {
    footer.prepend(homeLink);
  }
}

// App Initialization
async function iniciarApp() {
  // Update user info in UI (framework standard IDs)
  if (sesion?.usuario) {
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = sesion.usuario.nombre;
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = sesion.usuario.perfil_nombre || rolLabel(sesion.usuario.rol);
    const badgeEl = document.getElementById('user-badge');
    if (badgeEl) badgeEl.textContent = sesion.usuario.rol;
    // Footer user info
    const footerName = document.getElementById('sidebar-user-name');
    if (footerName) footerName.textContent = sesion.usuario.nombre;
    const footerRole = document.getElementById('sidebar-user-role');
    if (footerRole) footerRole.textContent = sesion.usuario.perfil_nombre || rolLabel(sesion.usuario.rol);
  }
  
  // Load all data
  await loadAll();
  
  // Populate selects
  if (typeof poblarSelectsCentros === 'function') poblarSelectsCentros();
  if (typeof poblarSelectAprobadores === 'function') poblarSelectAprobadores();
  if (typeof poblarSelectsNominas === 'function') poblarSelectsNominas();
  if (typeof poblarSelectTipos === 'function') {
    poblarSelectTipos('reg-tipo');
    poblarSelectTipos('fil-tipo');
    poblarSelectTipos('rpt-tipo');
  }
  
  // Check URL params — resaltar después de que cargue dashboard
  const params = new URLSearchParams(location.search);
  const registroId = params.get('registro');
  if (registroId && typeof resaltarRegistro === 'function') {
    setTimeout(() => resaltarRegistro(registroId), 800);
  }
  
  // Apply permission controls
  applyPermControls();
  
  // Ocultar filtro de sede si el rol no ve todos los registros
  const sedeFilter = document.querySelector('.sede-filter-admin');
  if (sedeFilter) {
    if (hasPerm('ver_todos')) {
      sedeFilter.classList.remove('hidden-operador');
    } else {
      sedeFilter.classList.add('hidden-operador');
    }
  }
  
  // Fetch version
  try {
    const res = await GET('/api/version');
    if (res.ok) {
      const data = await res.json();
      const versionEl = document.getElementById('app-version');
      if (versionEl) versionEl.textContent = 'v' + data.version;
    }
  } catch (e) {
    console.error('Error fetching version:', e);
  }
  
  // Restore sidebar state
  const sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebarCollapsed) {
    sidebar.classList.add('collapsed');
  }
  
  // Navigate to dashboard or from URL hash or last page
  const savedPage = localStorage.getItem('he_last_page');
  const hash = paginaSegura(location.hash.slice(1) || savedPage || 'dashboard');
  navigate(hash);
}

async function loadAll() {
  try {
    const [empl, nom, reg, ctr, tip, usr] = await Promise.all([
      GET('/api/empleados'),
      GET('/api/nominas'),
      GET('/api/registros'),
      GET('/api/centros'),
      GET('/api/tipos'),
      GET('/api/usuarios')
    ]);
    
    if (empl.ok) { empleados = await empl.json(); rebuildEmpMap(); }
    if (nom.ok) nominas = await nom.json();
    if (reg.ok) registros = await reg.json();
    if (ctr.ok) centros = await ctr.json();
    if (tip.ok) tipos = await tip.json();
    if (usr.ok) usuarios = await usr.json();
  } catch (e) {
    console.error('Error loading data:', e);
    showToast('Error cargando datos', 'error');
  }
}

// Populate approver dropdown
function poblarSelectAprobadores() {
  const sel = document.getElementById('reg-aprobador');
  if (!sel) return;
  let html = '<option value="">Seleccionar...</option>';
  const gerencias = usuarios.filter(u => u.rol === 'gerencia');
  for (let i = 0; i < gerencias.length; i++) {
    html += `<option value="${esc(gerencias[i].nombre)}">${esc(gerencias[i].nombre)}</option>`;
  }
  sel.innerHTML = html;
}

// Initialize on page load
(async () => {
  aplicarTema();

  try {
    const res = await GET('/api/auth/me');
    if (res.ok) {
      const userData = await res.json();
      sesion = { usuario: userData, csrfToken: '' };
      document.getElementById('app').style.display = 'flex';
      document.getElementById('app-screen').classList.add('show');
      await iniciarApp();
      try { initNotifications(60000); } catch {}
    } else if (res.status === 403) {
      document.body.innerHTML = '<div class="error-splash"><div class="error-splash-card"><div class="error-splash-icon">🔒</div><div class="error-splash-title">Acceso denegado</div><div class="error-splash-msg">No tienes permisos para acceder al módulo de Nómina. Contacta al administrador.</div><a href="/" class="error-splash-btn error-splash-btn-primary">🏠 Volver al Launcher</a></div></div>';
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Not authenticated');
    }
  } catch (e) {
    console.error('Session check failed:', e);
    const isSessionInvalid = e.message?.includes('Sesión invalidada') || e.message?.includes('Sesión expirada');
    const icon = isSessionInvalid ? '🔑' : '⚠️';
    const title = isSessionInvalid ? 'Sesión expirada' : 'Error al cargar Nómina';
    const msg = isSessionInvalid
      ? 'Tu sesión fue actualizada. Vuelve al Launcher e inicia sesión nuevamente.'
      : (e.message || 'No se pudo conectar con el servidor. Verifica tu sesión e intenta de nuevo.');
    document.body.innerHTML = `<div class="error-splash"><div class="error-splash-card"><div class="error-splash-icon">${icon}</div><div class="error-splash-title">${title}</div><div class="error-splash-msg">${msg}</div><a href="/" class="error-splash-btn error-splash-btn-primary">🏠 Volver al Launcher</a></div></div>`;
  }
})();

// Global event listeners
document.addEventListener('click', (e) => {
    // Close dropdowns when clicking outside
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  }
  // Close report dropdowns
  ['rpt-emp-wrap', 'rpt-nom-wrap'].forEach(wrapId => {
    const wrap = document.getElementById(wrapId);
    if (wrap && !wrap.contains(e.target)) {
      const dd = wrap.querySelector('[id$="-dropdown"]');
      if (dd) dd.style.display = 'none';
    }
  });
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const hash = paginaSegura(location.hash.slice(1) || 'dashboard');
  navigate(hash);
});

// ── Notifications ──
let _notifPollTimer = null;

function cargarNotificaciones() {
  return fetch('/api/notificaciones/no-leidas', { headers: { 'x-csrf-token': sesion?.csrfToken || '' } })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) { const b = document.getElementById('notif-count'); if (b) b.textContent = d.count > 0 ? (d.count > 99 ? '99+' : d.count) : ''; } })
    .catch(() => {});
}

function toggleNotifDropdown() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  dd.classList.toggle('show');
  if (dd.classList.contains('show')) {
    fetch('/api/notificaciones', { headers: { 'x-csrf-token': sesion?.csrfToken || '' } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const notifs = d.notificaciones || [];
        const list = dd.querySelector('.notif-list');
        if (!notifs.length) { list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>'; return; }
        const icons = { registro_creado: '📝', registro_aprobado: '✅', registro_rechazado: '❌', tarea_asignada: '📋' };
        list.innerHTML = notifs.map(n => {
          const timeAgo = timeSinceNotif(new Date(n.created_at));
          return `<div class="notif-item${n.leida ? '' : ' unread'}" onclick="marcarNotifLeida(${n.id}, '${n.url || ''}')">
            <div class="notif-icon">${icons[n.tipo] || '🔔'}</div>
            <div class="notif-content"><div class="notif-title">${esc(n.titulo)}</div>
            <div class="notif-msg">${esc(n.mensaje)}</div>
            <div class="notif-time">${timeAgo}</div></div></div>`;
        }).join('');
      }).catch(() => {});
  }
}

function marcarNotifLeida(id, url) {
  fetch('/api/notificaciones/' + id + '/leer', { method: 'PUT', headers: { 'x-csrf-token': sesion?.csrfToken || '' } })
    .then(() => { cargarNotificaciones(); if (url) window.location.href = url; document.getElementById('notif-dropdown')?.classList.remove('show'); })
    .catch(() => {});
}

function marcarTodasLeidas() {
  fetch('/api/notificaciones/leer-todas', { method: 'PUT', headers: { 'x-csrf-token': sesion?.csrfToken || '' } })
    .then(() => { cargarNotificaciones(); document.getElementById('notif-dropdown')?.classList.remove('show'); })
    .catch(() => {});
}

function timeSinceNotif(date) {
  const s = Math.floor((new Date() - date) / 1000);
  if (s < 60) return 'Ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h';
  return Math.floor(h / 24) + ' d';
}

function initNotifications(pollMs) {
  cargarNotificaciones();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(cargarNotificaciones, pollMs || 60000);
  document.addEventListener('click', e => {
    const dd = document.getElementById('notif-dropdown');
    const bell = document.querySelector('.notif-bell');
    if (dd && !dd.contains(e.target) && !bell?.contains(e.target)) dd.classList.remove('show');
  });
}
