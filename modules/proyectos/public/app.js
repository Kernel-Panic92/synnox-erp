const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';
let usuario = null;
let _currentPage = 'dashboard';
let _nombresUsuarios = {};

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

async function cargarNombresUsuarios(ids) {
  const faltantes = ids.filter(id => !_nombresUsuarios[id]);
  if (!faltantes.length) return;
  try {
    const data = await api('/usuarios');
    for (const u of data.usuarios || []) _nombresUsuarios[u.id] = u.nombre;
  } catch {}
}

function nombreUsuario(id) {
  return _nombresUsuarios[id] || ('#' + id);
}

async function init() {
  try {
    const data = await api('/auth/me');
    usuario = data;
    HF.USER = data;
    mostrarApp();
  } catch {
    logout();
  }
}

init();
