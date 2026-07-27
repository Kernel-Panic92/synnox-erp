const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';
let usuario = null;
let _currentPage = 'dashboard';
let _nombresUsuarios = {};
let _todosUsuarios = [];

initFramework({
  basePath: BASE,
  apiPrefix: '/api',
  themeKey: 'synnox_theme',
  tokenKey: 'proyectos_token',
  routes: {
    dashboard: () => cargarDashboard(),
    proyectos: () => cargarProyectos(),
    tareas: () => cargarTareas(),
    tablero: () => cargarTablero(),
    reportes: () => cargarReportes(),
  },
  themePages: ['dashboard']
});

function getToken() {
  const c = document.cookie.split('; ').find(r => r.startsWith('launcher_jwt='));
  return c ? c.split('=')[1] : localStorage.getItem('launcher_jwt');
}

function mostrarAppInterno() {
  document.getElementById('app-screen').style.display = 'block';
  navigate(HF.themePages[0] || 'dashboard');
}

async function cargarTodosLosUsuarios() {
  if (_todosUsuarios.length) return _todosUsuarios;
  try {
    const data = await api('/usuarios');
    _todosUsuarios = data.usuarios || [];
    for (const u of _todosUsuarios) _nombresUsuarios[u.id] = u.nombre;
    return _todosUsuarios;
  } catch { return []; }
}

async function cargarNombresUsuarios(ids) {
  const faltantes = ids.filter(id => !_nombresUsuarios[id]);
  if (!faltantes.length) return;
  if (!_todosUsuarios.length) {
    await cargarTodosLosUsuarios();
    return;
  }
  for (const id of faltantes) {
    const u = _todosUsuarios.find(x => x.id === id);
    if (u) _nombresUsuarios[id] = u.nombre;
  }
}

function nombreUsuario(id) {
  return _nombresUsuarios[id] || ('#' + id);
}

function selectUsuarios(selectedId) {
  return '<option value="">Sin asignar</option>' +
    _todosUsuarios.map(u => `<option value="${u.id}" ${u.id == selectedId ? 'selected' : ''}>${esc(u.nombre)} (${esc(u.email)})</option>`).join('');
}

function filtrarSelectUsuarios(query, selectId) {
  const select = document.getElementById(selectId);
  const q = query.toLowerCase();
  const selected = select.value;
  Array.from(select.options).forEach(opt => {
    if (!opt.value) { opt.style.display = ''; return; }
    const u = _todosUsuarios.find(u => u.id == opt.value);
    opt.style.display = (u && (u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))) ? '' : 'none';
  });
  select.value = selected;
}

async function init() {
  try {
    const data = await api('/auth/me');
    usuario = data;
    HF.USER = data;
    if (data.nombre) document.getElementById('user-name').textContent = data.nombre;
    if (data.rol) document.getElementById('user-role').textContent = data.rol === 'admin' ? 'Administrador' : data.rol === 'gerente' ? 'Gerente' : (data.perfil_nombre || data.rol);
    if (data.rol) document.getElementById('user-badge').textContent = data.rol;
    // Footer user info
    const footerName = document.getElementById('sidebar-user-name');
    if (footerName && data.nombre) footerName.textContent = data.nombre;
    const footerRole = document.getElementById('sidebar-user-role');
    if (footerRole && data.rol) footerRole.textContent = data.rol === 'admin' ? 'Administrador' : data.rol === 'gerente' ? 'Gerente' : (data.perfil_nombre || data.rol);
    await cargarTodosLosUsuarios();
    mostrarAppInterno();
  } catch (e) {
    document.getElementById('app-screen').style.display = 'none';
    document.body.insertAdjacentHTML('beforeend', `<div class="error-splash"><div class="error-splash-card"><div class="error-splash-icon">⚠️</div><div class="error-splash-title">Error al cargar Proyectos</div><div class="error-splash-msg">${e.message || 'No se pudo conectar con el servidor. Verifica tu sesión e intenta de nuevo.'}</div><a href="/" class="error-splash-btn error-splash-btn-primary">🏠 Volver al Launcher</a></div></div>`);
  }
}

init();
