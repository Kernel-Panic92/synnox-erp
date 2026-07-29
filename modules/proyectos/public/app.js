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
    actas: () => cargarActas(),
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

function tienePermiso(perm) {
  if (!usuario) return false;
  if (usuario.rol === 'admin') return true;
  const permisos = usuario.modulos_permisos?.proyectos || [];
  return permisos.includes(perm);
}

function selectUsuarios(selectedId) {
  return '<option value="">Sin asignar</option>' +
    _todosUsuarios.map(u => `<option value="${u.id}" ${u.id == selectedId ? 'selected' : ''}>${esc(u.nombre)} (${esc(u.email)})</option>`).join('');
}

function filtrarSelectUsuarios(query, selectId) {
  const select = document.getElementById(selectId);
  const q = query.toLowerCase();
  const selected = select.value;
  const filtered = _todosUsuarios.filter(u =>
    u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  select.innerHTML = '<option value="">Sin asignar</option>' +
    filtered.map(u => `<option value="${u.id}" ${u.id == selected ? 'selected' : ''}>${esc(u.nombre)} (${esc(u.email)})</option>`).join('');
}

function selectBuscador(id, usuarios, selectedId, placeholder) {
  const sel = usuarios.find(u => u.id == selectedId);
  const displayVal = sel ? `${sel.nombre} (${sel.email})` : '';
  const optionsHtml = usuarios.map(u =>
    `<div class="select-buscador-option${u.id == selectedId ? ' selected' : ''}" data-value="${u.id}">${esc(u.nombre)} (${esc(u.email)})</div>`
  ).join('');
  return `
    <div class="select-buscador" id="${id}-wrapper">
      <input type="text" class="select-buscador-input" id="${id}-display"
        placeholder="${placeholder || 'Buscar...'}" value="${esc(displayVal)}" autocomplete="off">
      <input type="hidden" id="${id}" value="${selectedId || ''}">
      <div class="select-buscador-list" id="${id}-list">
        <div class="select-buscador-option" data-value="">Sin asignar</div>
        ${optionsHtml}
      </div>
    </div>`;
}

function initSelectBuscador(id) {
  const display = document.getElementById(id + '-display');
  const list = document.getElementById(id + '-list');
  const hidden = document.getElementById(id);
  if (!display || !list) return;

  display.addEventListener('focus', () => {
    display.value = '';
    Array.from(list.children).forEach(o => o.style.display = '');
    list.style.display = 'block';
  });

  display.addEventListener('input', () => {
    const q = display.value.toLowerCase();
    let visible = 0;
    Array.from(list.children).forEach(opt => {
      if (!opt.dataset.value) { opt.style.display = ''; visible++; return; }
      const match = opt.textContent.toLowerCase().includes(q);
      opt.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    if (visible === 0) {
      if (!list.querySelector('.empty-msg')) {
        const empty = document.createElement('div');
        empty.className = 'select-buscador-option empty-msg';
        empty.textContent = 'Sin resultados';
        list.appendChild(empty);
      }
    } else {
      const empty = list.querySelector('.empty-msg');
      if (empty) empty.remove();
    }
    list.style.display = 'block';
  });

  list.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.select-buscador-option');
    if (!opt || opt.classList.contains('empty-msg')) return;
    const val = opt.dataset.value || '';
    const text = val ? opt.textContent : '';
    hidden.value = val;
    display.value = text;
    list.querySelectorAll('.select-buscador-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    list.style.display = 'none';
  });

  display.addEventListener('blur', () => {
    setTimeout(() => { list.style.display = 'none'; }, 150);
  });
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
    initNotifications(60000);
    if (!tienePermiso('crear')) {
      const btnNuevo = document.querySelector('#page-proyectos .btn-primary');
      if (btnNuevo) btnNuevo.style.display = 'none';
    }
    if (!tienePermiso('crear_tarea')) {
      const btnNuevaTarea = document.querySelector('#page-tareas .btn-primary');
      if (btnNuevaTarea) btnNuevaTarea.style.display = 'none';
    }
    mostrarAppInterno();
  } catch (e) {
    document.getElementById('app-screen').style.display = 'none';
    const isModuleDenied = e.message?.includes('acceso al módulo') || e.message?.includes('Acceso denegado');
    const isSessionInvalid = e.message?.includes('Sesión invalidada') || e.message?.includes('Sesión expirada');
    const icon = isModuleDenied ? '🔒' : isSessionInvalid ? '🔑' : '⚠️';
    const title = isModuleDenied ? 'Acceso denegado' : isSessionInvalid ? 'Sesión expirada' : 'Error al cargar Proyectos';
    const msg = isModuleDenied
      ? 'No tienes permisos para acceder al módulo de Proyectos. Contacta al administrador.'
      : isSessionInvalid
        ? 'Tu sesión fue actualizada. Vuelve al Launcher e inicia sesión nuevamente.'
        : (e.message || 'No se pudo conectar con el servidor. Verifica tu sesión e intenta de nuevo.');
    document.body.insertAdjacentHTML('beforeend', `<div class="error-splash"><div class="error-splash-card"><div class="error-splash-icon">${icon}</div><div class="error-splash-title">${title}</div><div class="error-splash-msg">${msg}</div><a href="/" class="error-splash-btn error-splash-btn-primary">🏠 Volver al Launcher</a></div></div>`);
  }
}

init();
