// app.js - Main initialization and global state for Horix

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
  const navCfg = document.getElementById('nav-configuracion');
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
      if (typeof reloadDashboardData === 'function') await reloadDashboardData();
      if (typeof initDashDnd === 'function') initDashDnd();
      if (typeof initWidgetResizeObservers === 'function') initWidgetResizeObservers();
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
    cerrarSidebar();
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
  }
}

function cerrarSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

// App Initialization
async function iniciarApp() {
  // Update user info in UI
  if (sesion?.usuario) {
    document.getElementById('ui-nombre').textContent = sesion.usuario.nombre;
    document.getElementById('ui-email').textContent = sesion.usuario.email;
    document.getElementById('ui-rol-badge').textContent = rolLabel(sesion.usuario.rol);
    document.getElementById('ui-rol-badge').className = 'role-badge role-' + sesion.usuario.rol;
    const sedeEl = document.getElementById('ui-sede');
    if (sedeEl) sedeEl.textContent = sesion.usuario.sede;
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
      if (versionEl) versionEl.textContent = 'v' + data.version + (data.rama ? ' [' + data.rama + ']' : '');
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
    } else {
      throw new Error('Not authenticated');
    }
  } catch (e) {
    console.error('Session check failed:', e);
    window.location.href = '/';
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
