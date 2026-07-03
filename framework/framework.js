/* ── Horix Framework - JavaScript core ── */
/* Repo: https://github.com/Kernel-Panic92/horix-erp/tree/main/framework */
/* Usage: initHorixFramework({ apiPrefix: '/api', themeKey: 'myapp_theme', tokenKey: 'myapp_token', basePath: '/logistics' }) */

// ── Config ──
let HF = {
  API: '/api',
  TOKEN: null,
  USER: null,
  TOKEN_KEY: 'hf_token',
  THEME_KEY: 'hf_theme',
  themePages: ['dashboard'],
  routeMap: {},
};

// ── Init ──
function initHorixFramework(opts = {}) {
  HF.API = (opts.basePath || '') + (opts.apiPrefix || '/api');
  HF.TOKEN_KEY = opts.tokenKey || 'hf_token';
  HF.THEME_KEY = opts.themeKey || 'hf_theme';
  HF.TOKEN = localStorage.getItem(HF.TOKEN_KEY);
  HF.routeMap = opts.routes || {};
  HF.themePages = opts.themePages || ['dashboard'];

  if (localStorage.getItem(HF.THEME_KEY) === 'light') document.body.classList.add('light');

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
}

// ── HTTP client ──
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (HF.TOKEN) headers['Authorization'] = 'Bearer ' + HF.TOKEN;
  const res = await fetch(HF.API + path, { ...opts, headers });
  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/verificar')) {
    logout(); throw new Error('Sesión expirada');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
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
function abrirModal(titulo, desc, bodyHtml, accionesHtml) {
  document.getElementById('modal-title').textContent = titulo;
  document.getElementById('modal-desc').textContent = desc || '';
  document.getElementById('modal-body').innerHTML = bodyHtml || '';
  document.getElementById('modal-actions').innerHTML = accionesHtml || '';
  document.getElementById('modal-overlay').classList.add('show');
}
function cerrarModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

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
    if (badgeEl) badgeEl.textContent = HF.USER.perfil_nombre || HF.USER.rol || HF.USER.role || '';
  }
  navigate(HF.themePages[0] || 'dashboard');
}

function logout() {
  HF.TOKEN = null; HF.USER = null;
  localStorage.removeItem(HF.TOKEN_KEY);
  mostrarLogin();
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
function toggleAll(tipo, checked) {
  document.querySelectorAll('.cb-' + tipo).forEach(cb => cb.checked = checked);
  actualizarBtnEliminar(tipo);
}
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
