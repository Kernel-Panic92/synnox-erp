const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';
const API = BASE + '/api';
let usuario = null;
let _currentPage = 'dashboard';
let _nombresUsuarios = {};

function getToken() {
  const c = document.cookie.split('; ').find(r => r.startsWith('launcher_jwt='));
  return c ? c.split('=')[1] : localStorage.getItem('launcher_jwt');
}

function logout() {
  document.cookie = 'launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  localStorage.removeItem('launcher_jwt');
  window.location.href = '/';
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Sesion expirada'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function navigate(page) {
  _currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  const titles = { dashboard: 'Dashboard', proyectos: 'Proyectos', tareas: 'Tareas', tablero: 'Tablero', reportes: 'Reportes' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'dashboard') cargarDashboard();
  else if (page === 'proyectos') cargarProyectos();
  else if (page === 'tareas') cargarTareas();
  else if (page === 'tablero') cargarTablero();
  else if (page === 'reportes') cargarReportes();

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleTheme() {
  document.body.classList.toggle('light');
  localStorage.setItem('synnox_theme', document.body.classList.contains('light') ? 'light' : 'dark');
}

async function cargarNombresUsuarios(ids) {
  const faltantes = ids.filter(id => !_nombresUsuarios[id]);
  if (!faltantes.length) return;
  try {
    const idsParam = faltantes.join(',');
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
    document.getElementById('user-name').textContent = data.nombre;
    document.getElementById('user-role').textContent = data.rol === 'admin' ? 'Administrador' : (data.perfil_nombre || data.rol);
    document.getElementById('user-avatar').textContent = (data.nombre || 'U')[0].toUpperCase();
    if (localStorage.getItem('synnox_theme') !== 'dark') document.body.classList.add('light');
    await cargarNombresUsuarios([]);
    cargarDashboard();
  } catch { logout(); }
}

init();
