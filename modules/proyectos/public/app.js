const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';
let usuario = null;
let _currentPage = 'dashboard';
let _nombresUsuarios = {};
let _todosUsuarios = [];
let _todosUsuariosTs = 0;
const USUARIOS_CACHE_TTL = 30000; // 30 segundos
let _usuariosPromise = null;

initFramework({
  basePath: BASE,
  apiPrefix: '/api',
  themeKey: 'synnox_theme',
  tokenKey: 'platform_jwt',
  routes: {
    dashboard: () => cargarDashboard(),
    proyectos: () => cargarProyectos(),
    tareas: () => cargarTareas(),
    tablero: () => cargarTablero(),
    reportes: () => cargarReportes(),
    archivo: () => cargarArchivo(),
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
  const hash = location.hash.slice(1);
  const saved = localStorage.getItem('sy_last_page');

  if (hash && hash.includes('?')) {
    const [page, query] = hash.split('?');
    const params = new URLSearchParams(query);
    const proyecto = params.get('proyecto');
    if (page === 'tareas' && proyecto) {
      const filtros = JSON.parse(localStorage.getItem('sy_tareas_filtros') || '{}');
      filtros.proyecto = proyecto;
      localStorage.setItem('sy_tareas_filtros', JSON.stringify(filtros));
    }
    navigate(page || saved || 'dashboard');
  } else {
    navigate(hash || saved || 'dashboard');
  }
}

async function cargarTodosLosUsuarios() {
  const age = Date.now() - _todosUsuariosTs;
  if (_todosUsuarios.length && age < USUARIOS_CACHE_TTL) return _todosUsuarios;

  // Intentar desde localStorage
  if (!_todosUsuarios.length) {
    const cached = cacheGet('usuarios', 300000); // 5 min
    if (cached) {
      _todosUsuarios = cached;
      _todosUsuariosTs = Date.now();
      for (const u of _todosUsuarios) _nombresUsuarios[u.id] = u.nombre;
      return _todosUsuarios;
    }
  }

  if (_usuariosPromise) return _usuariosPromise;
  _usuariosPromise = (async () => {
    try {
      const data = await api('/usuarios');
      _todosUsuarios = data.usuarios || [];
      _todosUsuariosTs = Date.now();
      for (const u of _todosUsuarios) _nombresUsuarios[u.id] = u.nombre;
      cacheSet('usuarios', _todosUsuarios);
    } catch {}
    _usuariosPromise = null;
    return _todosUsuarios;
  })();
  return _todosUsuarios.length ? _todosUsuarios : _usuariosPromise;
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
  const displayVal = sel ? (sel.email ? `${sel.nombre} (${sel.email})` : sel.nombre) : '';
  const optionsHtml = usuarios.map(u => {
    const label = u.email ? `${u.nombre} (${u.email})` : u.nombre;
    return `<div class="select-buscador-option${u.id == selectedId ? ' selected' : ''}" data-value="${u.id}">${esc(label)}</div>`;
  }).join('');
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
      if (!opt.dataset.value && !q) { opt.style.display = ''; visible++; return; }
      if (!opt.dataset.value) { opt.style.display = 'none'; return; }
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
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
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
    try { initNotifications(15000); } catch {}
    injectNotificationBell(document.querySelector('.header-actions'));
    if (!tienePermiso('crear')) {
      const btnNuevo = document.querySelector('#page-proyectos .btn-primary');
      if (btnNuevo) btnNuevo.style.display = 'none';
    }
    if (!tienePermiso('crear_tarea')) {
      const btnNuevaTarea = document.querySelector('#page-tareas .btn-primary');
      if (btnNuevaTarea) btnNuevaTarea.style.display = 'none';
    }
    if (usuario?.rol !== 'admin' && usuario?.rol !== 'gerente') {
      const btnMigrar = document.getElementById('archivo-btn-migrar');
      if (btnMigrar) btnMigrar.style.display = 'none';
      const btnMigrarProy = document.getElementById('archivo-proy-btn-migrar');
      if (btnMigrarProy) btnMigrarProy.style.display = 'none';
      const btnsAdminArchivo = document.querySelectorAll('#page-archivo .btn-sm.btn-secondary');
      btnsAdminArchivo.forEach(b => {
        if (b.textContent.includes('Configurar')) b.style.display = 'none';
      });
    }
    mostrarAppInterno();
    // Refresh periódico de sesión (cada 15 min)
    setInterval(async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (HF.TOKEN || '') } });
        if (res.ok) {
          const d = await res.json();
          if (d.jwt) localStorage.setItem('platform_jwt', d.jwt);
        }
      } catch {}
    }, 15 * 60 * 1000);
    // Refresh al volver visible la pestaña
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden) {
        try {
          const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (HF.TOKEN || '') } });
          if (res.ok) {
            const d = await res.json();
            if (d.jwt) localStorage.setItem('platform_jwt', d.jwt);
          }
        } catch {}
      }
    });
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
