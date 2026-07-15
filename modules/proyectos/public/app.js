const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';
let usuario = null;
let _currentPage = 'dashboard';
let _nombresUsuarios = {};
let _todosUsuarios = [];

initFramework({
  basePath: BASE,
  apiPrefix: '/api',
  themeKey: 'proyectos_theme',
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

function logout() {
  document.cookie = 'launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  localStorage.removeItem('launcher_jwt');
  localStorage.removeItem(HF.TOKEN_KEY);
  window.location.href = '/';
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

async function init() {
  try {
    const data = await api('/auth/me');
    usuario = data;
    HF.USER = data;
    if (data.nombre) document.getElementById('user-name').textContent = data.nombre;
    if (data.rol) document.getElementById('user-role').textContent = data.rol === 'admin' ? 'Administrador' : (data.perfil_nombre || data.rol);
    if (data.rol) document.getElementById('user-badge').textContent = data.rol;
    await cargarTodosLosUsuarios();
    mostrarAppInterno();
  } catch {
    logout();
  }
}

init();
