/* ── SynnoxERP Framework - JavaScript core ── */
/* Usage: initFramework({ apiPrefix: '/api', themeKey: 'myapp_theme', tokenKey: 'myapp_token', basePath: '/logistics' }) */

// ── Config ──
let HF = {
  API: '/api',
  TOKEN: null,
  USER: null,
  TOKEN_KEY: 'hf_token',
  THEME_KEY: 'hf_theme',
  themePages: ['dashboard'],
  routeMap: {},
  centros: [],
};

// ── Cache Helpers ──
function cacheGet(key, ttlMs) {
  try {
    const c = JSON.parse(localStorage.getItem('sf_' + key) || 'null');
    if (c && c.ts && Date.now() - c.ts < ttlMs) return c.data;
  } catch {}
  return null;
}

function cacheSet(key, data) {
  try { localStorage.setItem('sf_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function cacheInvalidate(key) {
  localStorage.removeItem('sf_' + key);
}

function cacheCleanAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('sf_'))
    .forEach(k => localStorage.removeItem(k));
}

// ── Debounce ──
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Bulk Selection ──
function updateBulkBar() {
  // Support multiple checkbox class patterns
  const count = document.querySelectorAll('.row-check:checked, [class^="cb-"]:checked').length;
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (!bar) return;
  if (count > 0) {
    bar.classList.add('visible');
    if (countEl) countEl.textContent = count;
  } else {
    bar.classList.remove('visible');
  }
}

function clearSelection() {
  document.querySelectorAll('.row-check:checked, [class^="cb-"]:checked').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.id && cb.id.includes('select-all') || cb.id && cb.id.includes('-all')) cb.checked = false;
  });
  updateBulkBar();
}

function toggleAll(tipoOrSource, checked) {
  let type, checkValue;
  if (typeof tipoOrSource === 'string') {
    type = tipoOrSource;
    checkValue = checked;
  } else if (tipoOrSource && tipoOrSource.getAttribute) {
    const match = tipoOrSource.getAttribute('onchange')?.match(/toggleAll\('(\w+)'/);
    type = match ? match[1] : '';
    checkValue = tipoOrSource.checked;
  }
  if (type) {
    document.querySelectorAll(`.cb-${type}`).forEach(cb => cb.checked = checkValue);
    if (typeof actualizarBtnEliminar === 'function') actualizarBtnEliminar(type);
  }
  updateBulkBar();
}

// ── Canvas Resize Handler ──
let _canvasResizeTimer;
function resizeAllCanvases() {
  document.querySelectorAll('canvas').forEach(canvas => {
    try {
      const parent = canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 0) {
          canvas.style.width = rect.width + 'px';
          if (typeof canvas.width === 'number') canvas.width = rect.width;
        }
      }
      // Chart.js instances
      if (canvas.__chartjs__) {
        const chart = Object.values(canvas.__chartjs__).find(c => c?.resize);
        if (chart) chart.resize();
      }
    } catch {}
  });
}
window.addEventListener('resize', () => {
  clearTimeout(_canvasResizeTimer);
  _canvasResizeTimer = setTimeout(resizeAllCanvases, 250);
});

// ── Skeleton / Empty State Helpers ──
function setSkeleton(elId, rows = 5) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = Array.from({ length: rows }, () =>
    '<div class="skeleton skeleton-row"></div>'
  ).join('');
}

function setEmptyState(container, { icon = '📋', title = 'Sin datos', desc = '', ctaText = '', ctaAction = '' } = {}) {
  if (typeof container === 'string') container = document.getElementById(container);
  if (!container) return;
  const cta = ctaText && ctaAction
    ? `<button class="btn btn-primary btn-sm" onclick="${ctaAction}">${esc(ctaText)}</button>`
    : '';
  container.innerHTML = `
    <div class="empty-state">
      <div class="icon">${icon}</div>
      <div class="empty-state-title">${esc(title)}</div>
      ${desc ? `<div class="empty-state-desc">${esc(desc)}</div>` : ''}
      ${cta}
    </div>`;
}

// ── Init ──
function initFramework(opts = {}) {
  HF.API = (opts.basePath || '') + (opts.apiPrefix || '/api');
  HF.TOKEN_KEY = opts.tokenKey || 'hf_token';
  HF.THEME_KEY = opts.themeKey || 'hf_theme';
  HF.TOKEN = localStorage.getItem(HF.TOKEN_KEY);
  HF.routeMap = opts.routes || {};
  HF.themePages = opts.themePages || ['dashboard'];

  const savedTheme = localStorage.getItem(HF.THEME_KEY);
  if (!savedTheme) { localStorage.setItem(HF.THEME_KEY, 'dark'); }
  if (savedTheme === 'light') document.body.classList.add('light');

  // Create toast container
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div'); tc.id = 'toast-container';
    document.body.appendChild(tc);
  }

  // Modal overlay click to close
  document.getElementById('modal-overlay')?.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });

  // Sidebar overlay click to close
  document.querySelector('.sidebar-overlay')?.addEventListener('click', function() {
    document.getElementById('sidebar')?.classList.remove('open');
    this.classList.remove('show');
  });

  // Restore sidebar collapse state
  const sidebar = document.getElementById('sidebar');
  if (sidebar && localStorage.getItem('sidebar_collapsed') === 'true') {
    sidebar.classList.add('collapsed');
    document.getElementById('app-container')?.classList.add('sidebar-collapsed');
    const toggle = sidebar.querySelector('.sidebar-toggle');
    if (toggle) { toggle.textContent = '❯'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Expandir menú'); }
  }

  // Inject Home link into sidebar footer (if not already present)
  injectSidebarHome();

  // Load module version
  loadVersion();
}

// ── Version ──
async function loadVersion() {
  const el = document.getElementById('app-version');
  if (!el) return;
  try {
    const cached = cacheGet('version', 3600000); // 1 hora
    if (cached) {
      el.textContent = 'v' + cached;
      window._appVer = 'v' + cached;
      return;
    }
    const data = await api('/version');
    const ver = data.version || '1.0.0';
    el.textContent = 'v' + ver;
    window._appVer = 'v' + ver;
    cacheSet('version', ver);
  } catch { el.textContent = 'v—'; window._appVer = 'v—'; }
}

// ── Centros de operación ──
async function loadCentros() {
  if (HF.centros.length) return HF.centros;
  const cached = cacheGet('centros', 300000); // 5 min
  if (cached) {
    HF.centros = cached;
    return HF.centros;
  }
  try {
    const basePath = HF.API.replace(/\/api$/, '');
    const res = await fetch(basePath + '/api/centros');
    if (res.ok) {
      HF.centros = await res.json();
      cacheSet('centros', HF.centros);
    }
  } catch {}
  return HF.centros;
}

// ── Sidebar Home link ──
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

// ── HTTP client ──
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (HF.TOKEN) headers['Authorization'] = 'Bearer ' + HF.TOKEN;
  let res = await fetch(HF.API + path, { ...opts, headers });
  // Auto-refresh token on 401 (sliding session)
  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/verificar') && !path.includes('/auth/refresh')) {
    try {
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer ' + HF.TOKEN } });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.jwt) {
          HF.TOKEN = refreshData.jwt;
          localStorage.setItem(HF.TOKEN_KEY, HF.TOKEN);
          headers['Authorization'] = 'Bearer ' + HF.TOKEN;
          res = await fetch(HF.API + path, { ...opts, headers });
        }
      }
    } catch {}
  }
  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/verificar')) {
    logout(); throw new Error('Sesión expirada');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

// ── Action buttons (accessible, icon-only) — standard for tables ──
// Usage: actionBtn({ icon:'✏️', title:'Editar cliente', ariaLabel:'Editar cliente ACME', onclick:"editarCliente('123')", variant:'secondary' })
// variant: 'secondary' | 'primary' | 'danger' | 'success'  → maps to btn-secondary etc.
// Returns HTML string for a 32x32 icon-only button with title + aria-label (required for a11y)
function actionBtn({ icon, title, ariaLabel, onclick, variant = 'secondary', disabled = false }) {
  const v = ['secondary','primary','danger','success','outline'].includes(variant) ? variant : 'secondary';
  const dis = disabled ? ' disabled aria-disabled="true"' : '';
  const safeOn = (onclick || '').replace(/"/g, '&quot;');
  const t = esc(title || ariaLabel || '');
  const al = esc(ariaLabel || title || '');
  return `<button class="btn btn-sm btn-${v} btn-action" onclick="${safeOn}" title="${t}" aria-label="${al}"${dis}>${icon}</button>`;
}
function actionGroup(buttons) {
  const btns = Array.isArray(buttons) ? buttons.filter(Boolean).join('') : (buttons || '');
  if (!btns) return '';
  return `<div class="tbl-actions">${btns}</div>`;
}

// ── Escaping ──
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Toast ──
function toast(msg, type = 'success', duration = 3500) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, duration);
}

// ── Modal helpers ──
let _lastFocusedElement = null;
let _modalTrapHandler = null;

function trapFocus(container) {
  const focusable = container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Remove previous handler
  if (_modalTrapHandler) container.removeEventListener('keydown', _modalTrapHandler);

  _modalTrapHandler = (e) => {
    if (e.key === 'Escape') {
      // Close the container that has focus trap, not always modal-overlay
      const containerId = container.id;
      if (containerId && containerId !== 'modal-overlay') {
        cerrarModal(containerId);
      } else {
        cerrarModal();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  container.addEventListener('keydown', _modalTrapHandler);
  first?.focus();
}

// Generic modal open - supports both .show and .open classes
function abrirModal(titulo, desc, bodyHtml, accionesHtml) {
  _lastFocusedElement = document.activeElement;
  const titleEl = document.getElementById('modal-title');
  const descEl = document.getElementById('modal-desc');
  const bodyEl = document.getElementById('modal-body');
  const actionsEl = document.getElementById('modal-actions');
  if (titleEl) titleEl.textContent = titulo;
  if (descEl) descEl.textContent = desc || '';
  if (bodyEl) bodyEl.innerHTML = bodyHtml || '';
  if (actionsEl) actionsEl.innerHTML = accionesHtml || '';
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.add('show', 'open');
    overlay.style.display = 'flex';
    trapFocus(overlay);
  }
}

// Generic modal close - supports both .show and .open classes
function cerrarModal(id) {
  const overlay = id ? document.getElementById(id) : document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.remove('show', 'open');
    overlay.style.display = 'none';
  }
  if (_lastFocusedElement && typeof _lastFocusedElement.focus === 'function') {
    _lastFocusedElement.focus();
    _lastFocusedElement = null;
  }
}

// Alias for modules that use cerrarModalById pattern
function cerrarModalById(id) { cerrarModal(id); }

function confirmar({ titulo, mensaje, icono, btnTxt, onConfirm }) {
  abrirModal(titulo || 'Confirmar', mensaje || '¿Estás seguro?',
    `<div style="text-align:center;font-size:44px;margin:12px 0;">${icono || '⚠️'}</div>`,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-danger" onclick="if(typeof window._confirmCb==='function')window._confirmCb();cerrarModal()">${btnTxt || 'Confirmar'}</button>`
  );
  window._confirmCb = onConfirm;
}

// ── Auth ──
function setUser(user) { HF.USER = user; HF.TOKEN = user.token || HF.TOKEN; }

function mostrarLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}
function mostrarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  if (HF.USER) {
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');
    const emailEl = document.getElementById('user-email');
    const badgeEl = document.getElementById('user-badge');
    if (nameEl) nameEl.textContent = HF.USER.nombre || HF.USER.name || '';
    if (roleEl) roleEl.textContent = HF.USER.perfil_nombre || HF.USER.rol || HF.USER.role || '';
    if (emailEl) emailEl.textContent = HF.USER.email || '';
    if (badgeEl) {
      const perfil = HF.USER.perfil_nombre || HF.USER.rol || HF.USER.role || '';
      badgeEl.textContent = perfil;
      badgeEl.className = 'role-badge role-' + (HF.USER.rol || '').toLowerCase();
    }
  }
  navigate(HF.themePages[0] || 'dashboard');
}

function logout() {
  HF.TOKEN = null; HF.USER = null; HF.centros = [];
  localStorage.removeItem(HF.TOKEN_KEY);
  localStorage.removeItem('synnox_theme');
  cacheCleanAll();
  window.location.href = '/logout';
}

function mostrarLogoutConfirm() { document.getElementById('modal-logout').classList.add('show'); }
function cerrarLogoutConfirm() { document.getElementById('modal-logout').classList.remove('show'); }
document.getElementById('modal-logout')?.addEventListener('click', function(e) {
  if (e.target === this) cerrarLogoutConfirm();
});
function confirmarLogout() { cerrarLogoutConfirm(); logout(); }

// ── Theme ──
function toggleTheme() {
  document.body.classList.toggle('light');
  localStorage.setItem(HF.THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark');
}

// ── Sidebar ──
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.querySelector('.sidebar-overlay').classList.remove('show');
}
function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const container = document.getElementById('app-container');
  sidebar.classList.toggle('collapsed');
  if (container) container.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
  const toggle = sidebar.querySelector('.sidebar-toggle');
  if (toggle) {
    const col = sidebar.classList.contains('collapsed');
    toggle.textContent = col ? '❯' : '❮';
    toggle.setAttribute('aria-expanded', String(!col));
    toggle.setAttribute('aria-label', col ? 'Expandir menú' : 'Contraer menú');
  }
}

// ── Navigation ──
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (navEl) navEl.classList.add('active');
  closeSidebar();

  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = navEl?.textContent?.trim() || page;

  if (HF.routeMap[page]) HF.routeMap[page]();
}

// ── Forgot / Reset Password ──
function abrirForgot(elId) {
  const el = document.getElementById(elId || 'modal-forgot');
  if (!el) return;
  ['error','success'].forEach(id => {
    const e = el.querySelector('.forgot-' + id);
    if (e) e.style.display = 'none';
  });
  const form = el.querySelector('.forgot-form');
  if (form) form.style.display = 'block';
  const inp = el.querySelector('.forgot-email');
  if (inp) inp.value = '';
  el.classList.add('show');
}
function cerrarForgot(elId) {
  const el = document.getElementById(elId || 'modal-forgot');
  if (el) el.classList.remove('show');
}

async function enviarReset(email, opts = {}) {
  const errEl = opts.errorEl && document.getElementById(opts.errorEl);
  const btn = opts.btnEl && document.getElementById(opts.btnEl);
  const successEl = opts.successEl && document.getElementById(opts.successEl);
  if (!email) { if (errEl) { errEl.textContent = 'Ingresa tu correo'; errEl.style.display = 'block'; } return; }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    if (opts.formEl) document.getElementById(opts.formEl).style.display = 'none';
    if (successEl) {
      successEl.textContent = '✅ Si el correo existe, recibirás un enlace para restablecer tu contraseña.';
      successEl.style.display = 'block';
    }
    if (opts.onSuccess) opts.onSuccess();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = opts.btnText || 'Enviar Enlace'; }
  }
}

// ── Bulk selection ──
function actualizarBtnEliminar(tipo) {
  const btn = document.getElementById('btn-del-' + tipo);
  if (!btn) return;
  const selected = document.querySelectorAll('.cb-' + tipo + ':checked').length;
  btn.style.display = selected > 0 ? '' : 'none';
  btn.innerHTML = '🗑️ Eliminar (' + selected + ')';
}
async function eliminarSeleccionados(tipo, endpoint) {
  const ids = Array.from(document.querySelectorAll('.cb-' + tipo + ':checked')).map(cb => cb.value);
  if (!ids.length) return;
  const label = { vehiculo: 'vehículos', pedido: 'pedidos', cliente: 'clientes', usuario: 'usuarios' }[tipo] || tipo;
  confirmar({
    titulo: 'Eliminar ' + label,
    mensaje: '¿Eliminar ' + ids.length + ' ' + label + '? Esta acción no se puede deshacer.',
    btnTxt: 'Eliminar todo',
    onConfirm: async () => {
      try {
        await api(endpoint || '/' + tipo + 's/batch', { method: 'DELETE', body: JSON.stringify({ ids: ids.map(Number) }) });
        toast(ids.length + ' ' + label + ' eliminados');
        const page = HF.themePages[0] || 'dashboard';
        if (HF.routeMap[page]) HF.routeMap[page](); else navigate(page);
      } catch (e) { toast(e.message, 'error'); }
    }
  });
}

// ── Loading state ──
function setLoading(elId, loading) {
  const el = typeof elId === 'string' ? document.getElementById(elId) : elId;
  if (!el) return;
  if (loading) {
    el._origText = el.textContent || el.innerHTML;
    el.disabled = true; el.innerHTML = '⏳ Cargando...';
  } else {
    el.disabled = false; el.innerHTML = el._origText || '';
  }
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
  if (searchEl) searchEl.addEventListener('input', applyFilters);
  if (statusEl) statusEl.addEventListener('change', applyFilters);
  applyFilters();
  return { applyFilters, rows };
}

function clearTableFilters(containerId) {
  const root = containerId ? document.getElementById(containerId) : document;
  const inputs = root.querySelectorAll('.table-filters .filter-input, .table-filters .filter-select');
  inputs.forEach(el => { el.value = ''; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')); });
}

// ── Notifications ──
let _notifPollTimer = null;
let _notifLastCount = 0;

function mostrarNotificacionBrowser(titulo, mensaje, url) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: mensaje, icon: '/favicon.ico', tag: 'synnox-' + Date.now(), requireInteraction: false };
  const notif = new Notification(titulo, opts);
  notif.onclick = () => {
    window.focus();
    if (url && url !== 'undefined' && url !== 'null') window.location.href = url;
    notif.close();
  };
  setTimeout(() => notif.close(), 8000);
}

async function cargarNotificaciones() {
  try {
    const notifApi = HF.API.replace(/\/proyectos\/api$/, '/api').replace(/\/logistica\/api$/, '/api').replace(/\/nomina\/api$/, '/api').replace(/\/proveedores\/api$/, '/api');
    const res = await fetch(notifApi + '/notificaciones/no-leidas', { headers: HF.TOKEN ? { 'Authorization': 'Bearer ' + HF.TOKEN } : {} });
    if (!res.ok) return;
    const { count } = await res.json();
    const badge = document.getElementById('notif-count');
    if (badge) badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
    if (count > _notifLastCount && _notifLastCount > 0) {
      try {
        const listRes = await fetch(notifApi + '/notificaciones', { headers: HF.TOKEN ? { 'Authorization': 'Bearer ' + HF.TOKEN } : {} });
        if (listRes.ok) {
          const { notificaciones } = await listRes.json();
          if (notificaciones.length > 0) {
            const n = notificaciones[0];
            mostrarNotificacionBrowser(n.titulo, n.mensaje, n.url);
          }
        }
      } catch {}
    }
    _notifLastCount = count;
  } catch {}
}

async function toggleNotifDropdown() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('show');
  dd.classList.toggle('show');
  if (!isOpen) {
    try {
      const notifApi = HF.API.replace(/\/proyectos\/api$/, '/api').replace(/\/logistica\/api$/, '/api').replace(/\/nomina\/api$/, '/api').replace(/\/proveedores\/api$/, '/api');
      const res = await fetch(notifApi + '/notificaciones', { headers: HF.TOKEN ? { 'Authorization': 'Bearer ' + HF.TOKEN } : {} });
      if (!res.ok) return;
      const { notificaciones } = await res.json();
      const list = dd.querySelector('.notif-list');
      if (!notificaciones.length) {
        list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
      } else {
        list.innerHTML = notificaciones.map(n => {
          const icons = { tarea_asignada: '📋', tarea_vencida: '⏰', proyecto_aprobado: '✅', proyecto_rechazado: '❌', comentario: '💬', factura_nueva: '📄', factura_vencida: '⚠️', ruta_asignada: '🛣️', backup: '💾', sistema: '⚙️', cambio_estado: '🔄', tarea_revision: '📋', proyecto_asignado: '📁', recordatorio_vencimiento: '⏰', tarea_aprobada: '✅', tarea_rechazada: '❌', proyecto_aprobado: '✅', proyecto_rechazado: '❌', nuevo_comentario: '💬', evidencia_subida: '📎', tarea_asignada: '📋' };
          const timeAgo = timeSince(new Date(n.created_at));
          const url = n.url && n.url !== 'undefined' && n.url !== 'null' ? n.url : '';
          return `<div class="notif-item unread" data-url="${esc(url)}" onclick="marcarNotifLeida(${n.id}, this.dataset.url)">
            <div class="notif-icon">${icons[n.tipo] || '🔔'}</div>
            <div class="notif-content">
              <div class="notif-title">${esc(n.titulo)}</div>
              <div class="notif-msg">${esc(n.mensaje)}</div>
              <div class="notif-time">${timeAgo}</div>
            </div>
          </div>`;
        }).join('');
      }
    } catch {}
  }
}

async function marcarNotifLeida(id, url) {
  const dd = document.getElementById('notif-dropdown');
  if (dd) dd.classList.remove('show');
  if (url && url !== 'undefined' && url !== 'null') {
    window.location.href = url;
  }
  try {
    const notifApi = HF.API.replace(/\/proyectos\/api$/, '/api').replace(/\/logistica\/api$/, '/api').replace(/\/nomina\/api$/, '/api').replace(/\/proveedores\/api$/, '/api');
    await fetch(notifApi + '/notificaciones/' + id + '/leer', { method: 'DELETE', headers: HF.TOKEN ? { 'Authorization': 'Bearer ' + HF.TOKEN } : {} });
    cargarNotificaciones();
  } catch {}
}

async function marcarTodasLeidas() {
  try {
    const notifApi = HF.API.replace(/\/proyectos\/api$/, '/api').replace(/\/logistica\/api$/, '/api').replace(/\/nomina\/api$/, '/api').replace(/\/proveedores\/api$/, '/api');
    await fetch(notifApi + '/notificaciones/leer-todas', { method: 'DELETE', headers: HF.TOKEN ? { 'Authorization': 'Bearer ' + HF.TOKEN } : {} });
    cargarNotificaciones();
    toggleNotifDropdown();
    toggleNotifDropdown();
  } catch {}
}

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Ahora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' h';
  const days = Math.floor(hours / 24);
  return days + ' d';
}

function initNotifications(pollMs) {
  cargarNotificaciones();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(cargarNotificaciones, pollMs || 60000);
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('notif-dropdown');
    const bell = document.querySelector('.notif-bell');
    if (dd && !dd.contains(e.target) && !bell?.contains(e.target)) dd.classList.remove('show');
  });
}

function injectNotificationBell(headerEl) {
  if (!headerEl || document.querySelector('.notif-bell')) return;
  const bell = document.createElement('div');
  bell.className = 'notif-bell';
  bell.onclick = toggleNotifDropdown;
  bell.innerHTML = '🔔<span class="notif-badge" id="notif-count"></span><div class="notif-dropdown" id="notif-dropdown"><div class="notif-header"><h4>Notificaciones</h4><button onclick="event.stopPropagation();marcarTodasLeidas()">Marcar todas leídas</button></div><div id="notif-permission-banner" style="padding:8px 12px;background:var(--surface2);border-radius:8px;margin-bottom:8px;font-size:12px"><p style="margin-bottom:6px">🔔 Activa las notificaciones del navegador</p><button class="btn btn-xs btn-primary" onclick="event.stopPropagation();activarNotificaciones()">Activar</button></div><div class="notif-list"><div class="notif-empty">Sin notificaciones</div></div></div>';
  headerEl.appendChild(bell);
  checkNotifPermission();
}

function checkNotifPermission() {
  const banner = document.getElementById('notif-permission-banner');
  if (!banner) return;
  if (!('Notification' in window) || Notification.permission === 'granted' || Notification.permission === 'denied') {
    banner.style.display = 'none';
  } else {
    banner.style.display = 'block';
  }
}

function activarNotificaciones() {
  if (!('Notification' in window)) return toast('Tu navegador no soporta notificaciones', 'error');
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      toast('Notificaciones activadas', 'success');
      checkNotifPermission();
      mostrarNotificacionBrowser('Notificaciones activadas', 'Recibirás alertas de tareas y proyectos', '');
    } else {
      toast('Permiso de notificaciones denegado', 'error');
      checkNotifPermission();
    }
  });
}

// ── Gestos táctiles: swipe desde borde izquierdo abre el sidebar ──
function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.querySelector('.sidebar-overlay')?.classList.add('show');
}
(function initSidebarSwipe() {
  let _sx = null, _sy = null;
  const EDGE = 40, MIN_DX = 50, MAX_DY = 75;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { _sx = null; return; }
    _sx = e.touches[0].clientX; _sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (_sx === null) return;
    const startX = _sx;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = Math.abs(t.clientY - _sy);
    const sb = document.getElementById('sidebar');
    _sx = null;
    if (!sb || dy > MAX_DY || Math.abs(dx) <= dy) return;
    if (dx > MIN_DX && startX <= EDGE && !sb.classList.contains('open')) openSidebar();
    else if (dx < -MIN_DX && sb.classList.contains('open') && typeof closeSidebar === 'function') closeSidebar();
  }, { passive: true });
})();
