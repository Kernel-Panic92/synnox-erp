const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';
const API = BASE + '/api';

function logout() {
  document.cookie = 'launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  window.location.href = '/';
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function mostrarLogoutConfirm() {
  document.getElementById('modal-logout').classList.add('show');
}

function cerrarLogoutConfirm() {
  document.getElementById('modal-logout').classList.remove('show');
}



function confirmarLogout() {
  cerrarLogoutConfirm();
  logout();
}

function toggleTheme() {
  document.body.classList.toggle('light');
  localStorage.setItem('synnox_theme', document.body.classList.contains('light') ? 'light' : 'dark');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.querySelector('.sidebar-overlay').classList.remove('show');
}

let _dashRefreshInterval = null;

/* ── Navigation ── */
function navigate(page) {
  if (_dashRefreshInterval) { clearInterval(_dashRefreshInterval); _dashRefreshInterval = null; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  document.getElementById('page-title').textContent = document.querySelector(`.nav-item[data-page="${page}"]`)?.textContent.trim() || page;
  closeSidebar();
  // Cargar datos según página
  if (page === 'dashboard') cargarDashboard();
  else if (page === 'vehiculos') cargarVehiculos();
  else if (page === 'pedidos') cargarPedidos();
  else if (page === 'rutas') cargarRutas();
  else if (page === 'reportes') { inicializarReportes(); cargarReporte(); }
  else if (page === 'config') cargarConfig();
  else if (page === 'mapa') cargarMapa();
  else if (page === 'clientes') cargarClientes();
  else if (page === 'sedes') cargarSedes();
  else if (page === 'widetech') rWidetech();
}

/* ── Init ── */
function renderSidebar(usuario) {
  const isAdmin = usuario.rol === 'admin';
  const modPermisos = usuario.modulos_permisos?.logistica || [];
  const items = [
    { page: 'dashboard', icon: '📊', label: 'Dashboard', show: true },
    { page: 'vehiculos', icon: '🚛', label: 'Vehículos', show: true },
    { page: 'pedidos', icon: '📦', label: 'Pedidos', show: true },
    { page: 'clientes', icon: '👤', label: 'Clientes', show: true },
    { page: 'sedes', icon: '🏢', label: 'Sedes', show: true },
    { page: 'rutas', icon: '🗺️', label: 'Rutas', show: true },
    { page: 'reportes', icon: '📈', label: 'Reportes', show: true },
    { page: 'mapa', icon: '🗺️', label: 'Mapa', show: true },
    { page: 'widetech', icon: '🛰️', label: 'Widetech', show: isAdmin || modPermisos.includes('configurar') },
    { page: 'config', icon: '⚙️', label: 'Configuración', show: isAdmin || modPermisos.includes('configurar') },
  ];
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = items.filter(i => i.show).map((i, idx) =>
    `<div class="nav-item${idx === 0 ? ' active' : ''}" data-page="${i.page}" onclick="navigate('${i.page}')">
      <span class="icon">${i.icon}</span> ${i.label}
    </div>`
  ).join('');
}

async function init() {
  if (localStorage.getItem('synnox_theme') !== 'dark') document.body.classList.add('light');
  const hoy = new Date().toISOString().split('T')[0];
  const fFecha = document.getElementById('filtro-fecha');
  if (fFecha) fFecha.value = hoy;
  const mFecha = document.getElementById('mapa-fecha');
  if (mFecha) mFecha.value = hoy;
  try {
    const data = await api('/auth/me');
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = data.nombre || data.email;
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = data.perfil_nombre || data.rol || '';
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = data.email || '';
    const badgeEl = document.getElementById('user-badge');
    if (badgeEl) {
      badgeEl.textContent = data.perfil_nombre || data.rol || '';
      badgeEl.className = 'badge role-badge role-' + (data.rol || '').toLowerCase();
    }
    renderSidebar(data);
    cargarDashboard();
  } catch { logout(); }
}

async function cargarVersion() {
  try {
    const data = await api('/version');
    window._appVer = 'v' + data.version;
    const el = document.getElementById('app-version');
    if (el) el.textContent = window._appVer;
    const verInput = document.getElementById('cfg-version');
    if (verInput) verInput.value = window._appVer;
  } catch { window._appVer = 'v—'; }
}

/* ── Modal helpers ── */
function abrirModal(titulo, desc, bodyHtml, accionesHtml) {
  document.getElementById('modal-title').textContent = titulo;
  document.getElementById('modal-desc').textContent = desc || '';
  document.getElementById('modal-body').innerHTML = bodyHtml || '';
  document.getElementById('modal-actions').innerHTML = accionesHtml || '';
  document.getElementById('modal-overlay').classList.add('show');
}
function cerrarModal() {
  if (window._activeModalMap) { window._activeModalMap.remove(); window._activeModalMap = null; }
  document.getElementById('modal-overlay').classList.remove('show');
}
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) cerrarModal();
});

/* ── Toast ── */
function mostrarAlerta(mensaje, tipo) {
  tipo = tipo || 'info';
  const iconos = { error:'✕', success:'✓', warning:'!', info:'i' };
  const div = document.createElement('div');
  div.className = 'toast ' + tipo;
  div.innerHTML = '<span class="icon">' + (iconos[tipo] || 'i') + '</span><span class="text">' + mensaje + '</span>';
  div.onclick = function() { descartarToast(div); };
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => descartarToast(div), 6000);
}

function confirmarModal(titulo, mensaje) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-title').textContent = titulo;
    document.getElementById('modal-desc').textContent = mensaje;
    document.getElementById('modal-body').innerHTML = '';
    document.getElementById('modal-actions').innerHTML =
      '<button class="btn btn-secondary" id="btn-confirm-no">Cancelar</button>' +
      '<button class="btn btn-danger" id="btn-confirm-yes">Confirmar</button>';
    overlay.classList.add('show');

    function ocultar() {
      overlay.classList.remove('show');
    }
    document.getElementById('btn-confirm-yes').onclick = function() { ocultar(); resolve(true); };
    document.getElementById('btn-confirm-no').onclick = function() { ocultar(); resolve(false); };
  });
}
function descartarToast(el) {
  if (!el || el.classList.contains('removing')) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 300);
}
document.getElementById('modal-forgot')?.addEventListener('click', function(e) {
  if (e.target === this) cerrarForgot();
});

/* ── Dashboard ── */
async function cargarDashboard() {
  const statsEl = document.getElementById('dash-stats');
  const listEl = document.getElementById('dash-rutas-list');
  const weatherEl = document.getElementById('dash-weather');
  const alertsEl = document.getElementById('dash-alerts');
  const vehiculosListEl = document.getElementById('dash-vehiculos-list');
  const pedidosListEl = document.getElementById('dash-pedidos-list');
  try {
    const [vehiculos, pedidos, rutas, todosPedidos] = await Promise.allSettled([
      api('/vehiculos'),
      api('/pedidos?estado=pendiente'),
      api('/rutas?fecha=' + new Date().toISOString().split('T')[0]),
      api('/pedidos?limit=5'),
    ]);

    const vehiculosData = vehiculos.status === 'fulfilled' ? vehiculos.value : { vehiculos: [], total: 0 };
    const pedidosData = pedidos.status === 'fulfilled' ? pedidos.value : { total: 0 };
    const rutasData = rutas.status === 'fulfilled' ? rutas.value : { rutas: [], total: 0 };
    const todosPedidosData = todosPedidos.status === 'fulfilled' ? todosPedidos.value : { pedidos: [] };

    const enRuta = (vehiculosData.vehiculos || []).filter(v => v.estado === 'en_ruta').length;
    const disponibles = (vehiculosData.vehiculos || []).filter(v => v.estado === 'disponible').length;
    const mantencion = (vehiculosData.vehiculos || []).filter(v => v.estado === 'mantencion' || v.estado === 'inactivo').length;

    // Stats cards
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">Vehículos</div><div class="stat-value">${vehiculosData.total || 0}</div><div class="stat-sub">${disponibles} disponibles · ${enRuta} en ruta</div></div>
      <div class="stat-card"><div class="stat-label">Pedidos pendientes</div><div class="stat-value" style="color:${pedidosData.total > 0 ? 'var(--warning)' : 'var(--success)'};">${pedidosData.total || 0}</div><div class="stat-sub">sin asignar a ruta</div></div>
      <div class="stat-card"><div class="stat-label">Rutas hoy</div><div class="stat-value">${rutasData.total || 0}</div><div class="stat-sub">${(rutasData.rutas || []).filter(r => r.estado === 'completada').length || 0} completadas</div></div>
      <div class="stat-card"><div class="stat-label">Total pedidos</div><div class="stat-value">${todosPedidosData.pedidos?.length || 0}</div><div class="stat-sub">en el sistema</div></div>
    `;

    // Routes list
    if ((rutasData.rutas || []).length) {
      listEl.innerHTML = rutasData.rutas.map(r => `
        <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span><strong>${r.nombre}</strong> · ${r.placa || '—'}</span>
          <span><span class="badge badge-${r.estado==='planificada'?'info':r.estado==='en_ejecucion'?'warning':r.estado==='completada'?'success':'danger'}">${r.estado}</span></span>
        </div>
      `).join('');
    } else {
      listEl.innerHTML = '<p class="text-muted">No hay rutas para hoy</p>';
    }

    // Vehicle status
    if (vehiculosListEl) {
      const statusGroups = [
        { label: 'Disponibles', count: disponibles, color: 'var(--success)', icon: '🟢' },
        { label: 'En ruta', count: enRuta, color: 'var(--warning)', icon: '🟡' },
        { label: 'Mantenimiento', count: mantencion, color: 'var(--danger)', icon: '🔴' },
      ];
      vehiculosListEl.innerHTML = statusGroups.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
          <span>${s.icon} ${s.label}</span>
          <strong style="color:${s.color};">${s.count}</strong>
        </div>
      `).join('');
    }

    // Recent orders
    if (pedidosListEl) {
      const pedidosRows = pedidos.pedidos || [];
      if (pedidosRows.length) {
        pedidosListEl.innerHTML = pedidosRows.slice(0, 5).map(p => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span>${esc(p.numero_factura || p.cliente_nombre || '—')}</span>
            <span class="badge badge-${p.estado==='entregado'?'success':p.estado==='en_ruta'?'warning':'info'}" style="font-size:11px;">${p.estado}</span>
          </div>
        `).join('');
      } else {
        pedidosListEl.innerHTML = '<p class="text-muted">No hay pedidos recientes</p>';
      }
    }

    // Weather — one card per sede with coordinates
    if (weatherEl) {
      try {
        const sedesRes = await api('/sedes');
        const sedes = (sedesRes.sedes || []).filter(s => s.latitud && s.longitud);
        if (sedes.length) {
          const weatherCards = await Promise.allSettled(sedes.map(async (sede) => {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${sede.latitud}&longitude=${sede.longitud}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=America/Bogota`);
            const data = await res.json();
            const c = data.current;
            const icons = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 51: '🌦️', 61: '🌧️', 71: '❄️', 95: '⛈️' };
            const icon = icons[c.weather_code] || '🌤️';
            return `
              <div style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
                <div style="font-size:11px;font-weight:600;margin-bottom:4px;">${icon} ${sede.nombre.length > 15 ? sede.nombre.slice(0,15)+'…' : sede.nombre}</div>
                <div style="font-size:18px;font-weight:700;">${c.temperature_2m}°C</div>
                <div style="font-size:10px;color:var(--muted);">💧${c.relative_humidity_2m}% 🌬️${c.wind_speed_10m}km/h</div>
                <div style="font-size:9px;color:var(--muted);margin-top:2px;">${c.temperature_2m > 30 ? '🔥' : c.temperature_2m < 15 ? '❄️' : '✅'} ${c.temperature_2m > 30 ? 'Caluroso' : c.temperature_2m < 15 ? 'Frío' : 'OK'}</div>
              </div>`;
          }));
          const successful = weatherCards.filter(r => r.status === 'fulfilled').map(r => r.value);
          if (successful.length) {
            weatherEl.style.display = 'block';
            weatherEl.innerHTML = `
              <h4 style="margin-bottom:10px;font-family:var(--font-head);font-size:15px;">🌤️ Clima por sede</h4>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;">
                ${successful.join('')}
              </div>`;
          }
        }
      } catch {}
    }

    // Alerts
    if (alertsEl) {
      const alertItems = [];
      if (pedidosData.total > 10) alertItems.push({ icon: '⚠️', text: `${pedidosData.total} pedidos sin ruta asignada`, color: 'var(--warning)' });
      if (mantencion > 0) alertItems.push({ icon: '🔧', text: `${mantencion} vehículo(s) en mantenimiento`, color: 'var(--danger)' });
      if ((rutasData.rutas || []).some(r => r.estado === 'fallida')) alertItems.push({ icon: '❌', text: 'Hay rutas fallidas hoy', color: 'var(--danger)' });
      if (alertItems.length) {
        alertsEl.style.display = 'block';
        alertsEl.innerHTML = `
          <h4 style="margin-bottom:8px;font-family:var(--font-head);font-size:15px;">⚠️ Alertas</h4>
          ${alertItems.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:${a.color};">${a.icon} ${a.text}</div>`).join('')}
        `;
      }
    }

    // Auto-refresh every 30 seconds (only if not already set)
    if (!_dashRefreshInterval) {
      _dashRefreshInterval = setInterval(() => {
        if (document.getElementById('page-dashboard')?.classList.contains('active')) {
          cargarDashboard();
        } else {
          clearInterval(_dashRefreshInterval);
          _dashRefreshInterval = null;
        }
      }, 30000);
    }

  } catch (e) {
    statsEl.innerHTML = '<p class="text-muted">Error al cargar dashboard</p>';
  }
}

/* ── Vehículos ── */
async function cargarVehiculos() {
  const tbody = document.querySelector('#tbl-vehiculos tbody');
  const estado = document.getElementById('filtro-vehiculos-estado').value;
  const q = document.getElementById('filtro-vehiculos-q').value.trim();
  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (q) params.set('q', q);
  try {
    const data = await api('/vehiculos?' + params.toString());
    if (!data.vehiculos?.length) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">No hay vehículos registrados</td></tr>'; return; }
    tbody.innerHTML = data.vehiculos.map(v => `
      <tr>
        <td><input type="checkbox" class="cb-vehiculo" value="${v.id}" onchange="actualizarBtnEliminar('vehiculo')"></td>
        <td><strong>${v.placa}</strong></td>
        <td>${v.alias || '—'}</td>
        <td>${v.color ? '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:'+esc(v.color)+';vertical-align:middle;border:1px solid var(--border);"></span> ' : ''}${v.sede || '—'}</td>
        <td>${v.capacidad_peso} kg</td>
        <td>${v.capacidad_volumen} m³</td>
        <td><span class="badge badge-${v.estado==='disponible'?'success':v.estado==='en_ruta'?'warning':'danger'}">${v.estado}</span></td>
        <td><button class="btn btn-sm btn-secondary" onclick="editarVehiculo(${v.id})" title="Editar">✏️</button> <button class="btn btn-sm btn-danger" onclick="confirmarEliminar('vehiculo',${v.id},'${v.placa}')" title="Eliminar">🗑️</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Error al cargar</td></tr>';
  }
}

function abrirModalVehiculo(data) {
  const d = data || {};
  abrirModal(
    data ? 'Editar vehículo' : 'Nuevo vehículo',
    data ? 'Actualiza los datos del vehículo' : 'Registra un nuevo vehículo en la flota',
    `
      <div class="form-grid">
        <div class="form-group"><label>Placa *</label><input id="v-placa" value="${d.placa||''}" placeholder="TVD921"></div>
        <div class="form-group"><label>Alias</label><input id="v-alias" value="${d.alias||''}" placeholder="TVD921"></div>
        <div class="form-group"><label>Color</label><input type="color" id="v-color" value="${d.color||'#00A86B'}" style="width:100%;height:40px;padding:4px;cursor:pointer;"></div>
        <div class="form-group"><label>Sede</label><select id="v-sede" data-sede="${d.sede||''}"><option value="">Cargando...</option></select></div>
        <div class="form-group"><label>Capacidad peso (kg)</label><input type="number" id="v-peso" value="${d.capacidad_peso||5000}"></div>
        <div class="form-group"><label>Capacidad volumen (m³)</label><input type="number" step="0.1" id="v-vol" value="${d.capacidad_volumen||20}"></div>
        <div class="form-group"><label>Estado</label><select id="v-estado">
          <option value="disponible" ${d.estado==='disponible'||!d.estado?'selected':''}>Disponible</option>
          <option value="en_ruta" ${d.estado==='en_ruta'?'selected':''}>En ruta</option>
          <option value="mantenimiento" ${d.estado==='mantenimiento'?'selected':''}>Mantenimiento</option>
        </select></div>
      </div>
    `,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="${data ? 'guardarVehiculo('+d.id+')' : 'guardarVehiculo()'}">${data ? 'Guardar cambios' : 'Crear vehículo'}</button>`
  );
  setTimeout(poblarSedesVehiculo, 100);
}

async function poblarSedesVehiculo() {
  const select = document.getElementById('v-sede');
  if (!select) return;
  try {
    const data = await api('/sedes');
    const sedes = data.sedes || [];
    const sedeActual = select.dataset.sede || '';
    select.innerHTML = '<option value="">— Sin sede —</option>' +
      sedes.map(s => `<option value="${esc(s.nombre)}" ${s.nombre===sedeActual?'selected':''}>${esc(s.nombre)}</option>`).join('');
  } catch { select.innerHTML = '<option value="">Error al cargar</option>'; }
}

function editarVehiculo(id) {
  api('/vehiculos/' + id).then(d => abrirModalVehiculo(d.vehiculo)).catch(e => mostrarAlerta(e.message, 'error'));
}

async function guardarVehiculo(id) {
  const body = {
    placa: document.getElementById('v-placa').value.trim(),
    alias: document.getElementById('v-alias').value.trim(),
    color: document.getElementById('v-color').value,
    sede: document.getElementById('v-sede').value.trim(),
    capacidad_peso: +document.getElementById('v-peso').value,
    capacidad_volumen: +document.getElementById('v-vol').value,
    estado: document.getElementById('v-estado').value
  };
  if (!body.placa) { mostrarAlerta('La placa es requerida', 'warning'); return; }
  try {
    if (id) await api('/vehiculos/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/vehiculos', { method: 'POST', body: JSON.stringify(body) });
    cerrarModal();
    cargarVehiculos();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── Pedidos ── */
async function cargarPedidos() {
  const tbody = document.querySelector('#tbl-pedidos tbody');
  const estado = document.getElementById('filtro-pedidos').value;
  const q = document.getElementById('filtro-pedidos-q').value.trim();
  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (q) params.set('q', q);
  try {
    const data = await api('/pedidos?' + params.toString());
    if (!data.pedidos?.length) { tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted" style="padding:32px;">No hay pedidos</td></tr>'; return; }
    tbody.innerHTML = data.pedidos.map(p => `
      <tr>
        <td><input type="checkbox" class="cb-pedido" value="${p.id}" onchange="actualizarBtnEliminar('pedido')"></td>
        <td><strong>${p.numero_factura}</strong></td>
        <td class="truncate">${esc(p.cliente_nombre_real) || esc(p.cliente_nombre) || '—'}</td>
        <td class="truncate">${p.direccion || '—'}</td>
        <td style="white-space:nowrap">$${Number(p.valor_contado||0).toLocaleString()}</td>
        <td style="white-space:nowrap">$${Number(p.valor_credito||0).toLocaleString()}</td>
        <td>${p.placa || '—'}</td>
        <td><span class="badge badge-${p.estado==='entregado'?'success':p.estado==='pendiente'?'warning':p.estado==='fallido'?'danger':p.estado==='cancelado'?'danger':'info'}">${p.estado}</span></td>
        <td>${esc(p.cliente_ruta || p.cliente_ruta_moto || '') || (p.ruta_id ? 'Ruta #'+p.ruta_id : '—')}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="verPedido(${p.id})" title="Ver">👁️</button> <button class="btn btn-sm btn-secondary" onclick="editarPedido(${p.id})" title="Editar">✏️</button> <button class="btn btn-sm btn-danger" onclick="confirmarEliminar('pedido',${p.id},'${p.numero_factura}')" title="Eliminar">🗑️</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Error al cargar</td></tr>';
  }
}

async function verPedido(id) {
  try {
    const data = await api('/pedidos/' + id);
    const p = data.pedido;
    document.getElementById('pedido-detalle').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
        <div><strong>Factura:</strong><br>${p.numero_factura}</div>
        <div><strong>Cliente:</strong><br>${p.cliente_nombre || '—'}</div>
        <div><strong>Dirección:</strong><br>${p.direccion || '—'}</div>
        <div><strong>Ciudad:</strong><br>${p.ciudad || '—'}</div>
        <div><strong>Teléfono:</strong><br>${p.telefono || '—'}</div>
        <div><strong>V. Contado:</strong><br>$${Number(p.valor_contado||0).toLocaleString()}</div>
        <div><strong>V. Crédito:</strong><br>$${Number(p.valor_credito||0).toLocaleString()}</div>
        <div><strong>Conductor:</strong><br>${p.conductor || '—'}</div>
        <div><strong>Placa:</strong><br>${p.placa || '—'}</div>
        <div><strong>Nro Guía:</strong><br>${p.nro_guia || '—'}</div>
        <div><strong>Estado:</strong><br><span class="badge badge-${p.estado==='entregado'?'success':p.estado==='pendiente'?'warning':p.estado==='cancelado'?'danger':'info'}">${p.estado}</span></div>
        <div><strong>Ruta:</strong><br>${p.ruta_id ? 'Ruta #'+p.ruta_id : 'Sin asignar'}</div>
        <div><strong>Latitud:</strong><br>${p.latitud || '—'}</div>
        <div><strong>Longitud:</strong><br>${p.longitud || '—'}</div>
        <div><strong>Fecha creación:</strong><br>${p.created_at ? new Date(p.created_at).toLocaleString('es-CO') : '—'}</div>
        <div><strong>Última actualización:</strong><br>${p.updated_at ? new Date(p.updated_at).toLocaleString('es-CO') : '—'}</div>
      </div>`;
    document.getElementById('modal-pedido').classList.add('show');
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── Clientes ── */
async function cargarClientes() {
  const grid = document.getElementById('cli-grid');
  const count = document.getElementById('cli-count');
  const filtro = document.getElementById('filtro-clientes')?.value.trim() || '';
  try {
    const data = await api('/clientes' + (filtro ? '?q=' + encodeURIComponent(filtro) : ''));
    if (!data.clientes?.length) {
      grid.innerHTML = '<div class="text-center text-muted" style="padding:32px;grid-column:1/-1;">No hay clientes</div>';
      count.textContent = '0 clientes';
      actualizarBtnEliminar('cliente');
      return;
    }
    count.textContent = data.clientes.length + ' cliente' + (data.clientes.length !== 1 ? 's' : '');
    grid.innerHTML = data.clientes.map(c => {
      const nombre = c.nombre || '';
      const iniciales = nombre.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
      let hue = 0;
      for (let i = 0; i < nombre.length; i++) hue = nombre.charCodeAt(i) + ((hue << 5) - hue);
      const bg = `hsl(${Math.abs(hue) % 360}, 60%, 45%)`;
      return `<div class="cli-card" data-id="${c.id}">
        <div class="cli-card-head">
          <input type="checkbox" class="cb-cliente" value="${c.id}" onchange="actualizarBtnEliminar('cliente')">
          <div class="cli-avatar" style="background:${bg}" title="${esc(c.nombre)}">${iniciales}</div>
          <div style="flex:1;min-width:0">
            <div class="cli-name"><strong>${esc(c.nombre) || '—'}</strong></div>
            <div class="cli-meta">${esc(c.ciudad || '—')} · ${esc(c.telefono || '—')}</div>
            <div class="cli-addr" title="${esc(c.direccion || '')}">📍 ${esc(c.direccion || 'Sin dirección')}</div>
          </div>
        </div>
        <div class="cli-stats">
          <div class="cli-stat"><strong>${c.cantidad_pedidos || 0}</strong>Pedidos</div>
          <div class="cli-stat"><strong>${c.ultima_importacion ? new Date(c.ultima_importacion).toLocaleDateString('es-CO') : '—'}</strong>Última importación</div>
        </div>
        <div style="padding:4px 0;font-size:11px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);margin-top:4px;padding-top:6px;">
          ${c.ruta ? '<span>🚛 ' + esc(c.ruta) + '</span>' : ''}
          ${c.ruta_moto ? '<span>🏍️ ' + esc(c.ruta_moto) + '</span>' : ''}
        </div>
        <div class="cli-actions">
          <button class="btn btn-sm btn-secondary" onclick="editarCliente(${c.id})" style="flex:1">✏️ Editar</button>
          <button class="btn btn-sm btn-danger" onclick="confirmarEliminar('cliente',${c.id})">🗑️</button>
        </div>
      </div>`;
    }).join('');
    actualizarBtnEliminar('cliente');
  } catch (e) {
    grid.innerHTML = '<div class="text-center text-muted" style="padding:32px;grid-column:1/-1;">Error al cargar</div>';
  }
}

/* ── CRUD: Pedidos ── */
function abrirModalPedido(data) {
  const d = data || {};
  abrirModal(
    data ? 'Editar pedido' : 'Nuevo pedido',
    data ? 'Actualiza los datos del pedido' : 'Registra un nuevo pedido',
    `
      <div class="form-grid">
        <div class="form-group"><label>Factura *</label><input id="p-factura" value="${d.numero_factura||''}" placeholder="FEV-00001"></div>
        <div class="form-group"><label>Sede</label><select id="p-sede" onchange="filtrarVehiculosPorSede()"><option value="">Seleccione sede</option></select></div>
        <div class="form-group"><label>Vehículo *</label>
          <div class="input-wrap">
            <input id="p-vehiculo-search" placeholder="Escriba para buscar..." autocomplete="off" oninput="buscarVehiculo()" onfocus="abrirDropdownVehiculo()">
            <button class="btn-dd" type="button" onclick="abrirDropdownVehiculo()" tabindex="-1">▼</button>
          </div>
          <input type="hidden" id="p-vehiculo" value="${d.vehiculo_id||''}">
          <div id="p-vehiculo-dropdown" class="dd-search"></div>
        </div>
        <div class="form-group"><label>Cliente *</label>
          <div class="input-wrap">
            <input id="p-cliente-search" placeholder="Escriba para buscar..." autocomplete="off" oninput="buscarCliente()" onfocus="abrirDropdownCliente()">
            <button class="btn-dd" type="button" onclick="abrirDropdownCliente()" tabindex="-1">▼</button>
          </div>
          <input type="hidden" id="p-cliente-id" value="${d.cliente_id||''}">
          <div id="p-cliente-dropdown" class="dd-search"></div>
        </div>
        <div class="form-group"><label>Dirección</label><input id="p-direccion" value="${d.direccion||''}" placeholder="Calle 123 #45-67"></div>
        <div class="form-group"><label>Ciudad</label><input id="p-ciudad" value="${d.ciudad||''}" placeholder="Medellín"></div>
        <div class="form-group"><label>Teléfono</label><input id="p-telefono" value="${d.telefono||''}" placeholder="3001234567"></div>
        <div class="form-group"><label>Latitud</label><input type="number" step="any" id="p-lat" value="${d.latitud||''}" placeholder="6.2476"></div>
        <div class="form-group"><label>Longitud</label><input type="number" step="any" id="p-lng" value="${d.longitud||''}" placeholder="-75.5658"></div>
        <div class="form-group"><label>Valor Crédito</label><input type="number" id="p-valor" value="${d.valor_credito||0}"></div>
        <div class="form-group"><label>Valor Contado</label><input type="number" id="p-valor-contado" value="${d.valor_contado||0}"></div>
        <div class="form-group"><label>Estado</label><select id="p-estado">
          <option value="pendiente" ${(d.estado||'pendiente')==='pendiente'?'selected':''}>Pendiente</option>
          <option value="asignado" ${d.estado==='asignado'?'selected':''}>Asignado</option>
          <option value="en_ruta" ${d.estado==='en_ruta'?'selected':''}>En ruta</option>
          <option value="entregado" ${d.estado==='entregado'?'selected':''}>Entregado</option>
          <option value="fallido" ${d.estado==='fallido'?'selected':''}>Fallido</option>
          <option value="cancelado" ${d.estado==='cancelado'?'selected':''}>Cancelado</option>
        </select></div>
      </div>
      <div class="mapa-pin" id="mapa-pin-pedido"></div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;">💡 Haz clic en el mapa para posicionar o arrastra el marcador</p>
    `,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="${data ? 'guardarPedido('+d.id+')' : 'guardarPedido()'}">${data ? 'Guardar cambios' : 'Crear pedido'}</button>`
  );
  setTimeout(async () => {
    if (!_sedesCache) { const res = await api('/sedes'); _sedesCache = res.sedes || []; }
    const select = document.getElementById('p-sede');
    if (select) {
      select.innerHTML = '<option value="">Seleccione sede</option>' +
        _sedesCache.map(s => `<option value="${esc(s.nombre)}" ${s.nombre === d.sede ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
    }
    await filtrarVehiculosPorSede(d.vehiculo_id);
    try { const cr = await api('/clientes'); _clientesCache = cr.clientes || []; } catch { _clientesCache = []; }
    if (d.cliente_nombre && !d.cliente_id) {
      document.getElementById('p-cliente-search').value = d.cliente_nombre;
    } else if (d.cliente_id) {
      const c = _clientesCache.find(x => x.id == d.cliente_id);
      if (c) { document.getElementById('p-cliente-search').value = c.nombre; document.getElementById('p-cliente-id').value = c.id; }
    }
    configurarAutocompletePedido();
    initMapaPin('mapa-pin-pedido', 'p-lat', 'p-lng');
  }, 50);
}

function editarPedido(id) {
  api('/pedidos/' + id).then(d => abrirModalPedido(d.pedido)).catch(e => mostrarAlerta(e.message, 'error'));
}

async function guardarPedido(id) {
  const body = {
    numero_factura: document.getElementById('p-factura').value.trim(),
    cliente_id: document.getElementById('p-cliente-id').value || null,
    cliente_nombre: document.getElementById('p-cliente-search').value.trim(),
    direccion: document.getElementById('p-direccion').value.trim(),
    ciudad: document.getElementById('p-ciudad').value.trim(),
    telefono: document.getElementById('p-telefono').value.trim(),
    latitud: document.getElementById('p-lat').value ? +document.getElementById('p-lat').value : null,
    longitud: document.getElementById('p-lng').value ? +document.getElementById('p-lng').value : null,
    valor_credito: +document.getElementById('p-valor').value,
    valor_contado: +document.getElementById('p-valor-contado').value,
    estado: document.getElementById('p-estado').value,
    sede: document.getElementById('p-sede').value,
    vehiculo_id: document.getElementById('p-vehiculo').value || null
  };
  if (!body.numero_factura) { mostrarAlerta('La factura es requerida', 'warning'); return; }
  if (!body.vehiculo_id) { mostrarAlerta('Debe seleccionar un vehículo', 'warning'); return; }
  if (!body.cliente_nombre) { mostrarAlerta('Debe seleccionar o escribir un cliente', 'warning'); return; }
  try {
    if (id) await api('/pedidos/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/pedidos', { method: 'POST', body: JSON.stringify(body) });
    cerrarModal();
    cargarPedidos();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── CRUD: Clientes ── */
function abrirModalCliente(data) {
  const d = data || {};
  abrirModal(
    data ? 'Editar cliente' : 'Nuevo cliente',
    data ? 'Actualiza los datos del cliente' : 'Registra un nuevo cliente',
    `
      <div class="form-grid">
        <div class="form-group"><label>Nombre *</label><input id="c-nombre" value="${d.nombre||''}" placeholder="Nombre del cliente"></div>
        <div class="form-group"><label>Dirección</label><input id="c-direccion" value="${d.direccion||''}" placeholder="Busca y selecciona una dirección..." autocomplete="off"></div>
        <div class="form-group"><label>Ciudad</label><input id="c-ciudad" value="${d.ciudad||''}" placeholder="Medellín"></div>
        <div class="form-group"><label>Teléfono</label><input id="c-telefono" value="${d.telefono||''}" placeholder="3001234567"></div>
        <div class="form-group"><label>Ruta (Vehículo)</label><input id="c-ruta" value="${d.ruta||''}" placeholder="Ej: 005 - BELEN/LAURELES/FLORESTA"></div>
        <div class="form-group"><label>Ruta (Moto)</label><input id="c-ruta-moto" value="${d.ruta_moto||''}" placeholder="Ej: 024 - ROBLEDO"></div>
        <div class="form-group"><label>Latitud</label><input type="number" step="any" id="c-lat" value="${d.latitud||''}" placeholder="6.2476"></div>
        <div class="form-group"><label>Longitud</label><input type="number" step="any" id="c-lng" value="${d.longitud||''}" placeholder="-75.5658"></div>
      </div>
      <div class="mapa-pin" id="mapa-pin-cliente"></div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;">💡 Haz clic en el mapa para posicionar o arrastra el marcador</p>
    `,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="${data ? 'guardarCliente('+d.id+')' : 'guardarCliente()'}">${data ? 'Guardar cambios' : 'Crear cliente'}</button>`
  );
  setTimeout(() => { configurarAutocompleteCliente(); initMapaPin('mapa-pin-cliente', 'c-lat', 'c-lng'); }, 300);
}

function editarCliente(id) {
  api('/clientes/' + id).then(d => abrirModalCliente(d.cliente)).catch(e => mostrarAlerta(e.message, 'error'));
}

async function guardarCliente(id) {
  const body = {
    nombre: document.getElementById('c-nombre').value.trim(),
    direccion: document.getElementById('c-direccion').value.trim(),
    ciudad: document.getElementById('c-ciudad').value.trim(),
    telefono: document.getElementById('c-telefono').value.trim(),
    ruta: document.getElementById('c-ruta').value.trim() || null,
    ruta_moto: document.getElementById('c-ruta-moto').value.trim() || null,
    latitud: document.getElementById('c-lat').value ? +document.getElementById('c-lat').value : null,
    longitud: document.getElementById('c-lng').value ? +document.getElementById('c-lng').value : null
  };
  if (!body.nombre) { mostrarAlerta('El nombre es requerido', 'warning'); return; }
  try {
    if (id) await api('/clientes/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/clientes', { method: 'POST', body: JSON.stringify(body) });
    cerrarModal();
    cargarClientes();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── CRUD: Sedes ── */
async function cargarSedes() {
  const tbody = document.querySelector('#tbl-sedes tbody');
  const filtro = document.getElementById('filtro-sedes').value.trim();
  try {
    const data = await api('/sedes' + (filtro ? '?q=' + encodeURIComponent(filtro) : ''));
    if (!data.sedes?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">No hay sedes registradas</td></tr>';
      return;
    }
    tbody.innerHTML = data.sedes.map(s => `<tr>
      <td><strong>${esc(s.nombre)}</strong></td>
      <td>${esc(s.centro_operacion || '—')}</td>
      <td>${esc(s.ciudad || '—')}</td>
      <td>${esc(s.direccion || '—')}</td>
      <td>${esc(s.telefono || '—')}</td>
      <td>${s.latitud != null && s.longitud != null ? Number(s.latitud).toFixed(4)+', '+Number(s.longitud).toFixed(4) : '—'}</td>
      <td><span class="badge badge-${s.activo ? 'success' : 'danger'}">${s.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td><button class="btn btn-sm btn-secondary" onclick="editarSede(${s.id})" title="Editar">✏️</button> <button class="btn btn-sm btn-danger" onclick="confirmarEliminar('sede',${s.id},'${esc(s.nombre)}')" title="Eliminar">🗑️</button></td>
    </tr>`).join('');
  } catch (e) {
    console.error('Error al cargar sedes:', e);
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">Error al cargar: ' + esc(e.message) + '</td></tr>';
  }
}

function abrirModalSede(data) {
  const d = data || {};
  abrirModal(
    data ? 'Editar sede' : 'Nueva sede',
    data ? 'Actualiza los datos de la sede' : 'Registra una nueva ubicación o punto de partida',
    `<div class="form-grid">
        <div class="form-group"><label>Nombre *</label><input id="s-nombre" value="${d.nombre||''}" placeholder="Medellín Centro"></div>
        <div class="form-group"><label>Centro de Operación</label><input id="s-centro" value="${d.centro_operacion||''}" placeholder="Norte, Sur, Este, Oeste..."></div>
        <div class="form-group"><label>Ciudad</label><input id="s-ciudad" value="${d.ciudad||''}" placeholder="Medellín"></div>
        <div class="form-group"><label>Dirección</label><input id="s-direccion" value="${d.direccion||''}" placeholder="Carrera 50 #45-12"></div>
        <div class="form-group"><label>Teléfono</label><input id="s-telefono" value="${d.telefono||''}" placeholder="3001234567"></div>
        <div class="form-group"><label>Latitud</label><input type="number" step="any" id="s-lat" value="${d.latitud||''}" placeholder="6.2476"></div>
        <div class="form-group"><label>Longitud</label><input type="number" step="any" id="s-lng" value="${d.longitud||''}" placeholder="-75.5658"></div>
        ${data ? `<div class="form-group"><label>Activo</label><select id="s-activo">
          <option value="true" ${d.activo!==false?'selected':''}>Activo</option>
          <option value="false" ${d.activo===false?'selected':''}>Inactivo</option>
        </select></div>` : ''}
      </div>
      <div class="mapa-pin" id="mapa-pin-sede"></div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;">💡 Haz clic en el mapa para posicionar o arrastra el marcador</p>
    `,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="${data ? 'guardarSede('+d.id+')' : 'guardarSede()'}">${data ? 'Guardar cambios' : 'Crear sede'}</button>`
  );
  setTimeout(() => { configurarAutocompleteSede(); initMapaPin('mapa-pin-sede', 's-lat', 's-lng'); }, 100);
}

function editarSede(id) {
  api('/sedes/' + id).then(d => abrirModalSede(d.sede)).catch(e => mostrarAlerta(e.message, 'error'));
}

async function guardarSede(id) {
  const body = {
    nombre: document.getElementById('s-nombre').value.trim(),
    centro_operacion: document.getElementById('s-centro').value.trim(),
    ciudad: document.getElementById('s-ciudad').value.trim(),
    direccion: document.getElementById('s-direccion').value.trim(),
    telefono: document.getElementById('s-telefono').value.trim(),
    latitud: document.getElementById('s-lat').value ? +document.getElementById('s-lat').value : null,
    longitud: document.getElementById('s-lng').value ? +document.getElementById('s-lng').value : null
  };
  if (id) {
    const activoEl = document.getElementById('s-activo');
    if (activoEl) body.activo = activoEl.value === 'true';
  }
  if (!body.nombre) { mostrarAlerta('El nombre es requerido', 'warning'); return; }
  try {
    if (id) await api('/sedes/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/sedes', { method: 'POST', body: JSON.stringify(body) });
    cerrarModal();
    cargarSedes();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── Eliminar (genérico) ── */
async function confirmarEliminar(tipo, id, label) {
  const ok = await confirmarModal('Confirmar eliminación', label ? `¿Eliminar ${tipo} "${label}"?` : `¿Eliminar ${tipo} #${id}?`);
  if (!ok) return;
  const endpoints = { vehiculo: '/vehiculos/', pedido: '/pedidos/', cliente: '/clientes/', sede: '/sedes/', ruta: '/rutas/' };
  const ep = endpoints[tipo];
  if (!ep) return;
  try {
    await api(ep + id, { method: 'DELETE' });
    if (tipo === 'vehiculo') cargarVehiculos();
    else if (tipo === 'pedido') cargarPedidos();
    else if (tipo === 'cliente') cargarClientes();
    else if (tipo === 'sede') cargarSedes();
    else if (tipo === 'ruta') cargarRutas();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── Bulk delete ── */
function actualizarBtnEliminar(tipo) {
  const checks = document.querySelectorAll('.cb-' + tipo + ':checked');
  const btn = document.getElementById('btn-del-' + tipo);
  if (btn) btn.style.display = checks.length > 0 ? 'inline-flex' : 'none';
  if (tipo === 'cliente') {
    const total = document.querySelectorAll('.cb-cliente').length;
    const selAll = document.querySelector('#page-clientes input[onchange*="toggleAll"]');
    if (selAll && total > 0) selAll.checked = checks.length === total;
  }
}

function toggleAll(tipo, checked) {
  document.querySelectorAll('.cb-' + tipo).forEach(cb => cb.checked = checked);
  actualizarBtnEliminar(tipo);
}

async function asignarMasivoPedido() {
  const checks = document.querySelectorAll('.cb-pedido:checked');
  if (!checks.length) { mostrarAlerta('Seleccione uno o más pedidos primero', 'warning'); return; }
  const ids = Array.from(checks).map(c => +c.value);

  if (!_sedesCache || !_sedesCache.length) {
    const res = await api('/sedes');
    _sedesCache = res.sedes || [];
  }
  if (!_vehiculosCache || !_vehiculosCache.length) {
    const res = await api('/vehiculos');
    _vehiculosCache = res.vehiculos || [];
  }

  abrirModal(
    'Asignación masiva',
    `${ids.length} pedido(s) seleccionado(s)`,
    `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-group">
          <label>Sede</label>
          <select id="masivo-sede" onchange="filtrarVehiculosEnBulk()">
            <option value="">— Sin cambio —</option>
            ${_sedesCache.map(s => `<option value="${esc(s.nombre)}">${esc(s.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Vehículo</label>
          <select id="masivo-vehiculo">
            <option value="">— Sin cambio —</option>
          </select>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0;">💡 Solo se actualizarán los pedidos que no estén asignados a una ruta.</p>
      </div>
    `,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="guardarAsignacionMasiva(${JSON.stringify(ids)})">Aplicar</button>`
  );

  filtrarVehiculosEnBulk();
}

async function guardarAsignacionMasiva(ids) {
  const body = { ids };
  const vehiculoEl = document.getElementById('masivo-vehiculo');
  const sedeEl = document.getElementById('masivo-sede');
  if (vehiculoEl.value) body.vehiculo_id = +vehiculoEl.value;
  if (sedeEl.value) body.sede = sedeEl.value;
  if (!body.vehiculo_id && !body.sede) { mostrarAlerta('Seleccione un vehículo o una sede', 'warning'); return; }

  try {
    const res = await api('/pedidos/asignar-masivo', { method: 'PUT', body: JSON.stringify(body) });
    cerrarModal();
    mostrarAlerta(res.mensaje, 'success');
    cargarPedidos();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function filtrarVehiculosEnBulk() {
  const sede = document.getElementById('masivo-sede').value;
  const sel = document.getElementById('masivo-vehiculo');
  if (!sel) return;
  let lista = sede ? _vehiculosCache.filter(v => v.sede === sede) : _vehiculosCache;
  sel.innerHTML = '<option value="">— Sin cambio —</option>' +
    lista.map(v => `<option value="${v.id}">${esc(v.placa)}${v.sede ? ' — '+esc(v.sede) : ''}</option>`).join('');
}

async function asignarRutaMasivo() {
  const checks = document.querySelectorAll('.cb-cliente:checked');
  if (!checks.length) { mostrarAlerta('Seleccione uno o más clientes primero', 'warning'); return; }
  const ids = Array.from(checks).map(c => +c.value);

  abrirModal(
    'Asignar ruta a clientes',
    `${ids.length} cliente(s) seleccionado(s)`,
    `
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-group">
          <label>Ruta (vehículo)</label>
          <input id="masivo-ruta" placeholder="Ej: Itagüí, Medellín Centro..." style="width:100%;">
        </div>
        <div class="form-group">
          <label>Ruta (moto)</label>
          <input id="masivo-ruta-moto" placeholder="Ej: Itagüí Moto, Zona Sur..." style="width:100%;">
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0;">💡 Deja en blanco los campos que no quieras modificar.</p>
      </div>
    `,
    `<button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" onclick="guardarRutaMasiva(${JSON.stringify(ids)})">Aplicar</button>`
  );
}

async function guardarRutaMasiva(ids) {
  const body = { ids };
  const rutaEl = document.getElementById('masivo-ruta');
  const rutaMotoEl = document.getElementById('masivo-ruta-moto');
  if (rutaEl.value.trim()) body.ruta = rutaEl.value.trim();
  if (rutaMotoEl.value.trim()) body.ruta_moto = rutaMotoEl.value.trim();
  if (!body.ruta && !body.ruta_moto) { mostrarAlerta('Escriba al menos una ruta', 'warning'); return; }

  try {
    const res = await api('/clientes/asignar-ruta-masivo', { method: 'PUT', body: JSON.stringify(body) });
    cerrarModal();
    mostrarAlerta(res.mensaje, 'success');
    cargarClientes();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function eliminarSeleccionados(tipo) {
  const checks = document.querySelectorAll('.cb-' + tipo + ':checked');
  if (!checks.length) return;
  const ids = Array.from(checks).map(c => +c.value);
  const ok = await confirmarModal('Confirmar eliminación', `¿Eliminar ${ids.length} ${tipo}(s) seleccionados?`);
  if (!ok) return;
  const ep = { vehiculo: '/vehiculos/seleccionados', pedido: '/pedidos/seleccionados', cliente: '/clientes/seleccionados', ruta: '/rutas/' };
  try {
    if (tipo === 'ruta') {
      await api('/rutas/', { method: 'DELETE', body: JSON.stringify({ ids }) });
    } else {
      await api(ep[tipo], { method: 'DELETE', body: JSON.stringify({ ids }) });
    }
    if (tipo === 'vehiculo') cargarVehiculos();
    else if (tipo === 'pedido') cargarPedidos();
    else if (tipo === 'cliente') cargarClientes();
    else if (tipo === 'ruta') cargarRutas();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── Rutas ── */
let _rutasFechaDefaultSet = false;

function toggleRutasTodas(checked) {
  const fechaInput = document.getElementById('filtro-fecha');
  if (checked) {
    fechaInput.value = '';
    fechaInput.disabled = true;
  } else {
    fechaInput.disabled = false;
    if (!fechaInput.value) fechaInput.value = new Date().toISOString().split('T')[0];
  }
  cargarRutas();
}

async function cargarRutas() {
  const tbody = document.querySelector('#tbl-rutas tbody');
  const fechaInput = document.getElementById('filtro-fecha');
  if (!_rutasFechaDefaultSet && !fechaInput.value && !document.getElementById('chk-rutas-todas').checked) {
    fechaInput.value = new Date().toISOString().split('T')[0];
    _rutasFechaDefaultSet = true;
  }
  const fecha = fechaInput.value;
  const sede = document.getElementById('filtro-rutas-sede')?.value || '';
  poblarSedesRutas();
  poblarRutasZona();
  try {
    const params = new URLSearchParams();
    if (fecha) params.set('fecha', fecha);
    if (sede) params.set('sede', sede);
    const data = await api('/rutas?' + params.toString());
    if (!data.rutas?.length) {
      const msg = fecha ? 'No hay rutas para ' + fecha : 'No hay rutas registradas';
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted" style="padding:32px;">' + msg + '</td></tr>'; return;
    }
    tbody.innerHTML = data.rutas.map(r => `
      <tr>
        <td><input type="checkbox" class="cb-ruta" value="${r.id}" onchange="actualizarBtnEliminar('ruta')"></td>
        <td><strong>${r.nombre || 'Ruta #'+r.id}</strong></td>
        <td>${r.placa || '—'}</td>
        <td>${r.sede || '—'}</td>
        <td>${r.cantidad_paradas || 0}</td>
        <td>${r.distancia_total_estimada ? r.distancia_total_estimada+' km' : '—'}</td>
        <td>${r.tiempo_estimado ? r.tiempo_estimado+' min' : '—'}</td>
        <td><span class="badge badge-${r.estado==='planificada'?'info':r.estado==='en_ejecucion'?'warning':r.estado==='completada'?'success':'danger'}">${r.estado}</span></td>
        <td>${r.fecha ? r.fecha.slice(0,10) : '—'}</td>
        <td style="white-space:nowrap"><button class="btn btn-sm btn-icon btn-secondary" onclick="verRuta(${r.id})" title="Ver">👁️</button><button class="btn btn-sm btn-icon btn-secondary" onclick="exportarRutaGMaps(${r.id})" title="Abrir en Google Maps"><svg viewBox="0 0 24 24" width="20" height="20" fill="#4285F4" style="display:block"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></button>${r.estado!=='completada'&&r.estado!=='fallida'?`<button class="btn btn-sm btn-icon btn-success" onclick="completarRuta(${r.id})" title="Completar">✓</button>`:''}<button class="btn btn-sm btn-icon btn-danger" onclick="confirmarEliminar('ruta',${r.id})" title="Eliminar">🗑️</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Error al cargar</td></tr>';
  }
}

let _sedesCache = null;
async function poblarSedesRutas() {
  const select = document.getElementById('filtro-rutas-sede');
  if (!select) return;
  try {
    if (!_sedesCache) { const d = await api('/sedes'); _sedesCache = d.sedes || []; }
    const actual = select.value;
    select.innerHTML = '<option value="">Todas las sedes</option>' +
      _sedesCache.map(s => `<option value="${esc(s.nombre)}" ${s.nombre===actual?'selected':''}>${esc(s.nombre)}</option>`).join('');
  } catch {}
}

async function poblarRutasZona() {
  const select = document.getElementById('filtro-ruta-zona');
  if (!select) return;
  try {
    const data = await api('/clientes?q=');
    const rutas = [...new Set((data.clientes||[]).flatMap(c => [c.ruta, c.ruta_moto]).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Todas las zonas</option>' +
      rutas.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  } catch {}
}

var _vehiculosCache = [];

async function filtrarVehiculosPorSede(selectedId) {
  const input = document.getElementById('p-vehiculo-search');
  if (!input) return;
  const sede = document.getElementById('p-sede')?.value;
  try {
    const q = sede ? `?q=${encodeURIComponent(sede)}` : '';
    const data = await api('/vehiculos' + q);
    _vehiculosCache = data.vehiculos || [];
    const actual = _vehiculosCache.find(v => v.id == (selectedId || document.getElementById('p-vehiculo').value));
    if (actual) {
      input.value = esc(actual.placa) + ' - ' + esc(actual.alias || actual.sede || 'Sin alias');
      document.getElementById('p-vehiculo').value = actual.id;
    } else if (selectedId) {
      input.value = '';
      document.getElementById('p-vehiculo').value = '';
    }
  } catch { input.value = ''; document.getElementById('p-vehiculo').value = ''; }
}

function mostrarVehiculos(filtro) {
  const dd = document.getElementById('p-vehiculo-dropdown');
  let lista = _vehiculosCache;
  if (filtro) {
    const lower = filtro.toLowerCase();
    lista = lista.filter(v => ((v.placa || '') + ' ' + (v.alias || v.sede || '')).toLowerCase().includes(lower));
  }
  if (!lista.length) { dd.innerHTML = '<div class="dd-item disabled">Sin resultados</div>'; dd.classList.add('show'); return; }
  dd.innerHTML = lista.map(v =>
    `<div class="dd-item" data-id="${v.id}" onclick="seleccionarVehiculo(${v.id})">${esc(v.placa)} — ${esc(v.alias || v.sede || 'Sin alias')}</div>`
  ).join('');
  dd.classList.add('show');
}

function abrirDropdownVehiculo() {
  if (_vehiculosCache.length) mostrarVehiculos(document.getElementById('p-vehiculo-search').value);
}

function buscarVehiculo() {
  mostrarVehiculos(document.getElementById('p-vehiculo-search').value);
}

function seleccionarVehiculo(id) {
  const v = _vehiculosCache.find(x => x.id == id);
  if (!v) return;
  document.getElementById('p-vehiculo-search').value = esc(v.placa) + ' - ' + esc(v.alias || v.sede || 'Sin alias');
  document.getElementById('p-vehiculo').value = v.id;
  document.getElementById('p-vehiculo-dropdown').innerHTML = '';
  document.getElementById('p-vehiculo-dropdown').classList.remove('show');
}

var _clientesCache = [];

function mostrarClientes(filtro) {
  const dd = document.getElementById('p-cliente-dropdown');
  let lista = _clientesCache;
  if (filtro) {
    const lower = filtro.toLowerCase();
    lista = lista.filter(c => (c.nombre || '').toLowerCase().includes(lower));
  }
  if (!lista.length) { dd.innerHTML = '<div class="dd-item disabled">Sin resultados</div>'; dd.classList.add('show'); return; }
  dd.innerHTML = lista.map(c =>
    `<div class="dd-item" data-id="${c.id}" onclick="seleccionarCliente(${c.id})">${esc(c.nombre)}${c.ciudad ? ' <span style="color:var(--muted)">— ' + esc(c.ciudad) + '</span>' : ''}</div>`
  ).join('');
  dd.classList.add('show');
}

function abrirDropdownCliente() {
  if (_clientesCache.length) mostrarClientes(document.getElementById('p-cliente-search').value);
}

function buscarCliente() {
  mostrarClientes(document.getElementById('p-cliente-search').value);
}

function seleccionarCliente(id) {
  const c = _clientesCache.find(x => x.id == id);
  if (!c) return;
  document.getElementById('p-cliente-search').value = esc(c.nombre);
  document.getElementById('p-cliente-id').value = c.id;
  document.getElementById('p-cliente-dropdown').innerHTML = '';
  document.getElementById('p-cliente-dropdown').classList.remove('show');
}

document.addEventListener('click', function(e) {
  ['p-vehiculo-dropdown', 'p-cliente-dropdown'].forEach(id => {
    const dd = document.getElementById(id);
    if (dd && !e.target.closest('#p-vehiculo-search, #p-vehiculo-dropdown, #p-cliente-search, #p-cliente-dropdown, .btn-dd')) {
      dd.innerHTML = '';
      dd.classList.remove('show');
    }
  });
});

async function verRuta(id) {
  try {
    const data = await api('/rutas/' + id);
    const r = data.ruta;
    const paradas = data.paradas || [];
    const tienenCoords = paradas.some(p => p.latitud && p.longitud);
    abrirModal(
      r.nombre || 'Ruta #' + r.id,
      `Vehículo: ${r.vehiculo_id} · Conductor: ${r.conductor_nombre||'—'} · Distancia: ${r.distancia_total_estimada||'—'} km · Tiempo: ${r.tiempo_estimado||'—'} min`,
      `<div class="tbl-wrap" style="margin-bottom:12px;"><table class="tbl"><thead><tr><th>#</th><th>Cliente</th><th>Dir.</th><th>Estado</th><th></th></tr></thead><tbody>
        ${paradas.map(p => `<tr><td>${p.secuencia}</td><td>${esc(p.cliente_nombre||'—')}</td><td class="truncate">${esc(p.direccion||'')}</td><td><span class="badge badge-${p.estado==='completada'?'success':'warning'}">${p.estado}</span></td>${p.latitud && p.longitud ? `<td><a href="https://www.google.com/maps/@${p.latitud},${p.longitud},3a,75y,90t/data=!3m6!1e1!3m4!1s!2e0!7i13312!8i6656" target="_blank" title="Street View" style="color:var(--accent);text-decoration:none;font-size:13px;">🗺️</a></td>` : '<td></td>'}</tr>`).join('')}
      </tbody></table></div>
      ${tienenCoords ? '<div id="mapa-ruta-detalle" style="height:280px;border-radius:10px;border:1px solid var(--border);"></div>' : ''}`,
      `<button class="btn btn-primary" onclick="descargarRutaPDF(${id})">🖨️ PDF</button>
       <button class="btn btn-secondary" onclick="previewRutaPDF(${id})">👁️ Vista previa</button>
       <button class="btn btn-secondary" onclick="exportarRutaGMaps(${id})"><svg viewBox="0 0 24 24" width="16" height="16" fill="#4285F4" style="vertical-align:middle;margin-right:4px;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg> Google Maps</button>
       <button class="btn btn-secondary" onclick="cerrarRutaDetalle()">Cerrar</button>`
    );
    if (tienenCoords) setTimeout(() => {
      const color = r.color_vehiculo || null;
      initMapaRutaDetalle(paradas, r.geometria, color, r.sede);
    }, 200);
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

function initMapaRutaDetalle(paradas, geometria, colorRuta, sedeNombre) {
  const el = document.getElementById('mapa-ruta-detalle');
  if (!el || el._leafletMap) return;
  const map = L.map(el).setView([paradas[0].latitud, paradas[0].longitud], 14);
  agregarCapasMapa(map);
  const coords = paradas.filter(p => p.latitud && p.longitud).map(p => [p.latitud, p.longitud]);
  const color = colorRuta || '#00A86B';
  if (coords.length) {
    if (geometria && geometria.coordinates && geometria.coordinates.length) {
      L.geoJSON(geometria, { style: { color, weight: 3 } }).addTo(map);
      // Start flag at depot (primer punto de la geometria)
      const inicio = [geometria.coordinates[0][1], geometria.coordinates[0][0]];
      L.marker(inicio, { icon: L.divIcon({ html: '🏁', className: '', iconSize: [24, 24], iconAnchor: [12, 24] }) })
        .addTo(map).bindPopup(`<b>Salida</b><br>${esc(sedeNombre || 'Depósito')}`);
    } else {
      L.polyline(coords, { color, weight: 3 }).addTo(map);
      // Start flag at first stop
      L.marker(coords[0], { icon: L.divIcon({ html: '🏁', className: '', iconSize: [24, 24], iconAnchor: [12, 24] }) })
        .addTo(map).bindPopup(`<b>Salida</b><br>${esc(paradas[0]?.cliente_nombre||'')}`);
    }
    coords.forEach((c, i) => {
      L.circleMarker(c, { radius: 6, color, fillColor: '#fff', fillOpacity: 0.9, weight: 2 })
        .addTo(map).bindPopup(`#${i+1} ${esc(paradas[i]?.cliente_nombre||'')}`);
    });
    // End flag at last stop
    const ultimo = coords[coords.length - 1];
    L.marker(ultimo, { icon: L.divIcon({ html: '🚩', className: '', iconSize: [24, 24], iconAnchor: [12, 24] }) })
      .addTo(map).bindPopup(`<b>Llegada</b><br>${esc(paradas[coords.length-1]?.cliente_nombre||'')}`);
    map.fitBounds(coords, { padding: [30,30] });
  }
  el._leafletMap = map;
  requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
}

function cerrarRutaDetalle() {
  const el = document.getElementById('mapa-ruta-detalle');
  if (el && el._leafletMap) { el._leafletMap.remove(); el._leafletMap = null; }
  cerrarModal();
}

function descargarRutaPDF(id) {
  const url = API + '/rutas-pdf/' + id + '/checklist.pdf';
  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error('Error al generar PDF');
      return res.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ruta_' + id + '_' + new Date().toISOString().slice(0,10) + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    })
    .catch(e => mostrarAlerta(e.message, 'error'));
}

function previewRutaPDF(id) {
  window.open(API + '/rutas-pdf/' + id + '/checklist.pdf?preview=1', '_blank');
}

async function exportarRutaGMaps(id) {
  try {
    const data = await api('/rutas/' + id);
    const paradas = (data.paradas||[]).filter(p => p.latitud && p.longitud);
    if (paradas.length < 1) { mostrarAlerta('La ruta no tiene paradas con coordenadas', 'warning'); return; }
    const r = data.ruta;
    // Origen: primer punto de la geometria (depot) o primera parada
    let origin;
    if (r.geometria && r.geometria.coordinates && r.geometria.coordinates.length) {
      origin = `${r.geometria.coordinates[0][1]},${r.geometria.coordinates[0][0]}`;
    } else {
      origin = `${paradas[0].latitud},${paradas[0].longitud}`;
    }
    const dest = `${paradas[paradas.length-1].latitud},${paradas[paradas.length-1].longitud}`;
    const waypoints = paradas.slice(0, -1).map(p => `${p.latitud},${p.longitud}`).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving&dir_action=navigate`;
    if (waypoints) url += `&waypoints=${waypoints}`;
    window.open(url, '_blank');
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function completarRuta(id) {
  const ok = await confirmarModal('Completar ruta', '¿Marcar esta ruta como completada?\n\nSe registrará la hora de finalización actual.');
  if (!ok) return;
  try {
    const ahora = new Date();
    const ts = ahora.getFullYear() + '-' + String(ahora.getMonth()+1).padStart(2,'0') + '-' + String(ahora.getDate()).padStart(2,'0') +
      ' ' + String(ahora.getHours()).padStart(2,'0') + ':' + String(ahora.getMinutes()).padStart(2,'0') + ':' + String(ahora.getSeconds()).padStart(2,'0');
    await api('/rutas/' + id, {
      method: 'PUT',
      body: JSON.stringify({ estado: 'completada', hora_fin_real: ts })
    });
    mostrarAlerta('Ruta marcada como completada', 'success');
    cargarRutas();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function generarRutas() {
  const fecha = document.getElementById('filtro-fecha').value;
  if (!fecha) { mostrarAlerta('Selecciona una fecha', 'warning'); return; }
  const sedeSelect = document.getElementById('filtro-rutas-sede');
  const sedeNombre = sedeSelect?.value || '';
  let sedeId = null;
  if (sedeNombre && _sedesCache) {
    const s = _sedesCache.find(x => x.nombre === sedeNombre);
    if (s) sedeId = s.id;
  }
  const rutaZona = document.getElementById('filtro-ruta-zona')?.value || '';
  const tipo = document.getElementById('filtro-ruta-tipo')?.value || 'vehiculo';
  const tipoLabel = tipo === 'moto' ? '🏍️ Moto' : '🚛 Vehículo';
  const msg = '¿Generar rutas optimizadas para ' + fecha + (sedeNombre ? ' (' + sedeNombre + ')' : '') + (rutaZona ? ' — ' + rutaZona : '') + ' [' + tipoLabel + ']?';
  const ok = await confirmarModal('Generar rutas', msg);
  if (!ok) return;
  try {
    const body = { fecha, tipo };
    if (sedeId) body.sede_id = sedeId;
    if (rutaZona) body.ruta = rutaZona;
    const data = await api('/rutas/generar', { method: 'POST', body: JSON.stringify(body) });
    mostrarAlerta(data.mensaje || 'Rutas generadas', 'success');
    cargarRutas();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

/* ── Importadores ── */
function iniciarDropZones() {
  ['siesa', 'widetech'].forEach(t => {
    const zone = document.getElementById('drop-' + t);
    const input = document.getElementById('file-' + t);
    if (!zone || !input) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        const ev = new Event('change', { bubbles: true });
        input.dispatchEvent(ev);
      }
    });
  });
}

function previsualizarArchivo(input, nameId) {
  const el = document.getElementById(nameId);
  if (input.files?.length) {
    el.textContent = input.files[0].name;
    el.style.display = 'block';
    const btnId = input.id === 'file-siesa' ? 'btn-import-siesa' : 'btn-import-widetech';
    document.getElementById(btnId).disabled = false;
    document.getElementById('result-' + input.id.replace('file-', '')).innerHTML = '';
  }
}

async function importarSiesa() {
  const input = document.getElementById('file-siesa');
  const resEl = document.getElementById('result-siesa');
  if (!input.files?.length) { resEl.innerHTML = '<div style="padding:10px;background:rgba(247,97,79,.1);border-radius:8px;color:var(--danger);font-size:13px;">❌ Selecciona un archivo PDF primero</div>'; return; }
  const btn = document.getElementById('btn-import-siesa');
  btn.disabled = true; btn.textContent = 'Importando...';
  const fd = new FormData();
  fd.append('archivo', input.files[0]);
  try {
    const res = await fetch(API + '/importadores/siesa', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    let html = `<div style="padding:10px;background:rgba(79,190,150,.1);border-radius:8px;color:var(--success);font-size:13px;">
      ✅ ${data.importados} pedidos importados${data.fallidos ? ', ' + data.fallidos + ' fallidos' : ''}
      ${data.clientesNuevos ? '<br>👤 ' + data.clientesNuevos + ' clientes nuevos' : ''}
      ${data.clientesActualizados ? '<br>🔄 ' + data.clientesActualizados + ' clientes actualizados' : ''}
    </div>`;
    if (data.debug) {
      const d = data.debug;
      const fevsHtml = d.fevs?.map(f => `${esc(f.fev)} | valor:${f.valor} | cliente:${esc(f.cliente)} | ciudad:${esc(f.ciudad)} | dir:${esc(f.direccion)} | tel:${f.telefono}`).join('\n') || '—';
      html += `<details style="margin-top:8px;background:var(--surface2);border-radius:8px;font-size:11px;font-family:monospace;color:var(--muted);padding:8px;cursor:pointer;">
        <summary style="font-weight:600;cursor:pointer;">🔍 Debug (${d.fevEncontrados || 0} FEVs)</summary>
        <div style="margin-top:6px;max-height:300px;overflow:auto;white-space:pre-wrap">
Fallback: ${d.fallbackUsed ? 'sí' : 'no'}
${fevsHtml ? '── FEVs ──\n' + fevsHtml + '\n' : ''}── RAW primeras líneas ──
${d.rawText ? esc(d.rawText).split('\n').slice(0,40).map((l,i) => `${i}: ${l}`).join('\n') : '—'}
        </div>
      </details>`;
    }
    resEl.innerHTML = html;
    input.value = ''; document.getElementById('file-siesa-name').style.display = 'none';
    cargarDashboard();
  } catch (e) {
    resEl.innerHTML = `<div style="padding:10px;background:rgba(247,97,79,.1);border-radius:8px;color:var(--danger);font-size:13px;">❌ ${e.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Importar';
  }
}

async function importarMaestroClientes() {
  const input = document.getElementById('file-maestro');
  const resEl = document.getElementById('result-maestro');
  if (!input.files?.length) { resEl.innerHTML = '<div style="padding:10px;background:rgba(247,97,79,.1);border-radius:8px;color:var(--danger);font-size:13px;">❌ Selecciona un archivo primero</div>'; return; }
  const btn = document.getElementById('btn-import-maestro');
  btn.disabled = true; btn.textContent = 'Importando...';
  const fd = new FormData();
  fd.append('archivo', input.files[0]);
  try {
    const res = await fetch(API + '/importadores/maestro-clientes', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    resEl.innerHTML = `<div style="padding:10px;background:rgba(79,190,150,.1);border-radius:8px;color:var(--success);font-size:13px;">
      ✅ ${data.total} registros procesados (${data.importados} nuevos, ${data.actualizados} actualizados)${data.errores ? '<br>⚠️ ' + data.errores.length + ' errores' : ''}
    </div>`;
    input.value = ''; document.getElementById('file-maestro-name').style.display = 'none';
    cargarClientes();
  } catch (e) {
    resEl.innerHTML = `<div style="padding:10px;background:rgba(247,97,79,.1);border-radius:8px;color:var(--danger);font-size:13px;">❌ ${e.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Importar';
  }
}

async function importarWidetech() {
  const input = document.getElementById('file-widetech');
  const resEl = document.getElementById('result-widetech');
  if (!input.files?.length) { resEl.innerHTML = '<div style="padding:10px;background:rgba(247,97,79,.1);border-radius:8px;color:var(--danger);font-size:13px;">❌ Selecciona un archivo Excel primero</div>'; return; }
  const btn = document.getElementById('btn-import-widetech');
  btn.disabled = true; btn.textContent = 'Importando...';
  const fd = new FormData();
  fd.append('archivo', input.files[0]);
  try {
    const res = await fetch(API + '/importadores/widetech', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    resEl.innerHTML = `<div style="padding:10px;background:rgba(79,190,150,.1);border-radius:8px;color:var(--success);font-size:13px;">
      ✅ ${data.importados} registros importados${data.fallidos ? ', ' + data.fallidos + ' fallidos' : ''}
    </div>`;
    input.value = ''; document.getElementById('file-widetech-name').style.display = 'none';
    cargarDashboard();
  } catch (e) {
    resEl.innerHTML = `<div style="padding:10px;background:rgba(247,97,79,.1);border-radius:8px;color:var(--danger);font-size:13px;">❌ ${e.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Importar';
  }
}

/* ── Configuración ── */
let cfgTab = 'smtp';

async function rConfig() {
  document.querySelectorAll('#cfg-tab-bar .btn').forEach(b => b.classList.toggle('active', b.dataset.cfg === cfgTab));
  const el = document.getElementById('cfg-content');
  try {
    const data = await api('/configuracion');
    const c = data.config || {};
    if (cfgTab === 'smtp') renderSmtp(el, c);
    else if (cfgTab === 'empresa') renderEmpresa(el);
    else if (cfgTab === 'backup') renderBackup(el, c);
    else if (cfgTab === 'seguridad') renderSeguridad(el, c);
    else if (cfgTab === 'auditoria') renderAuditoria(el);
    else if (cfgTab === 'mapas') renderMapas(el);
    else if (cfgTab === 'widetech') renderWidetech(el);
  } catch { el.innerHTML = '<p class="text-muted">Error al cargar configuración</p>'; }
}

function cargarConfig() { rConfig(); }

/* ── SMTP Tab ── */
function renderSmtp(el, c) {
  const heredar = c.smtp_heredar === '1' || c.smtp_heredar === 'true';
  el.innerHTML = `
    <div class="card" style="max-width:600px;">
      <h4 style="margin-bottom:16px;font-family:var(--font-head);">📧 Configuración SMTP</h4>
      <div style="margin-bottom:16px;padding:12px;background:var(--surface2);border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
          <input type="checkbox" id="cfg-heredar" ${heredar?'checked':''} onchange="toggleHeredarSmtp()">
          Heredar configuración del Launcher
        </label>
        <div id="cfg-launcher-url-wrap" style="margin-top:8px;${heredar?'':'display:none;'}">
          <label style="font-size:12px;color:var(--muted);">URL del Launcher</label>
          <input id="cfg-launcher-url" value="${esc(c.launcher_url||'http://localhost:3002')}" placeholder="http://localhost:3002" style="width:100%;padding:7px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;">
        </div>
      </div>

      <div id="cfg-smtp-local" style="${heredar?'opacity:0.5;pointer-events:none;':''}">
        <div class="form-grid">
          <div class="form-group"><label>Host SMTP</label><input id="cfg-host" value="${esc(c.smtp_host||'')}" placeholder="smtp.gmail.com"></div>
          <div class="form-group"><label>Puerto</label><input id="cfg-puerto" value="${c.smtp_puerto||'587'}" placeholder="587"></div>
          <div class="form-group"><label>TLS</label><select id="cfg-tls"><option value="1" ${c.smtp_tls==='1'?'selected':''}>Sí</option><option value="0" ${c.smtp_tls==='0'?'selected':''}>No</option></select></div>
          <div class="form-group"><label>Usuario</label><input id="cfg-usuario" value="${esc(c.smtp_usuario||'')}"></div>
          <div class="form-group"><label>Contraseña</label><input type="password" id="cfg-password" value="${c.smtp_password?'••••••••':''}"></div>
          <div class="form-group"><label>Remitente (From)</label><input id="cfg-remitente" value="${esc(c.smtp_remitente||'')}" placeholder="logistics@localhost"></div>
        </div>
      </div>
      <div class="flex" style="margin-top:8px;">
        <button class="btn btn-primary" onclick="guardarSmtp()">✓ Guardar</button>
        <button class="btn btn-secondary" onclick="testSmtp()">✉ Probar</button>
      </div>
      <div id="smtp-msg" style="margin-top:10px;"></div>
    </div>`;
}

function toggleHeredarSmtp() {
  const checked = document.getElementById('cfg-heredar').checked;
  document.getElementById('cfg-launcher-url-wrap').style.display = checked ? '' : 'none';
  document.getElementById('cfg-smtp-local').style.opacity = checked ? '0.5' : '';
  document.getElementById('cfg-smtp-local').style.pointerEvents = checked ? 'none' : '';
}

async function guardarSmtp() {
  const msg = document.getElementById('smtp-msg');
  try {
    const body = {
      smtp_heredar: document.getElementById('cfg-heredar').checked ? '1' : '0',
      launcher_url: document.getElementById('cfg-launcher-url').value.trim()
    };
    if (body.smtp_heredar !== '1') {
      body.smtp_host = document.getElementById('cfg-host').value.trim();
      body.smtp_puerto = document.getElementById('cfg-puerto').value.trim();
      body.smtp_tls = document.getElementById('cfg-tls').value;
      body.smtp_usuario = document.getElementById('cfg-usuario').value.trim();
      body.smtp_password = document.getElementById('cfg-password').value;
      body.smtp_remitente = document.getElementById('cfg-remitente').value.trim();
    }
    await api('/configuracion', { method: 'PUT', body: JSON.stringify(body) });
    msg.innerHTML = '<span style="color:var(--success)">✓ Configuración guardada</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function testSmtp() {
  const msg = document.getElementById('smtp-msg');
  msg.innerHTML = '<span class="text-muted">Enviando...</span>';
  try {
    const heredar = document.getElementById('cfg-heredar').checked;
    const body = { smtp_heredar: heredar ? '1' : '0', launcher_url: document.getElementById('cfg-launcher-url').value.trim() };
    if (!heredar) {
      body.host = document.getElementById('cfg-host').value.trim();
      body.puerto = document.getElementById('cfg-puerto').value.trim();
      body.tls = document.getElementById('cfg-tls').value;
      body.usuario = document.getElementById('cfg-usuario').value.trim();
      body.password = document.getElementById('cfg-password').value;
      body.remitente = document.getElementById('cfg-remitente').value.trim();
    }
    const data = await api('/configuracion/test', { method: 'POST', body: JSON.stringify(body) });
    msg.innerHTML = '<span style="color:var(--success)">✓ ' + data.mensaje + '</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

/* ── Backup Tab ── */
function renderBackup(el) {
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div class="card">
        <h4 style="margin-bottom:12px;font-family:var(--font-head);">📦 Exportar Backup</h4>
        <p class="text-muted" style="font-size:13px;margin-bottom:14px;">Descarga un ZIP con todas las tablas del sistema</p>
        <button class="btn btn-primary" onclick="descargarBackup()">💾 Descargar Backup</button>
        <div id="backup-ok" style="display:none;margin-top:10px;color:var(--success);">✓ Backup generado</div>
        <hr style="border-color:var(--border);margin:18px 0;">
        <h4 style="margin-bottom:8px;font-family:var(--font-head);font-size:14px;">🤖 Último Backup Automático</h4>
        <div id="ultimo-bk-info"><p class="text-muted">Cargando...</p></div>
        <button class="btn btn-secondary btn-sm mt-12" onclick="ejecutarBackupScript()">▶ Ejecutar ahora</button>
        <div id="bk-script-log" style="margin-top:8px;"></div>
      </div>
      <div class="card">
        <h4 style="margin-bottom:12px;font-family:var(--font-head);">♻️ Restaurar Backup</h4>
        <p class="text-muted" style="font-size:13px;margin-bottom:14px;">Selecciona un backup del servidor para restaurar</p>
        <div id="lista-backups"><p class="text-muted">Cargando...</p></div>
      </div>
    </div>`;
  cargarUltimoBackup();
  cargarListaBackups();
}

async function descargarBackup() {
  try {
    const res = await fetch(API + '/backup');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'logistics_backup_' + new Date().toISOString().slice(0,10) + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    document.getElementById('backup-ok').style.display = 'block';
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function cargarUltimoBackup() {
  const el = document.getElementById('ultimo-bk-info');
  try {
    const data = await api('/backup/ultimo');
    if (data.ultimo) el.innerHTML = `<div style="font-size:13px;">📅 ${new Date(data.ultimo.fecha).toLocaleString()} · ${data.ultimo.exitoso ? '✅ Exitoso' : '❌ Fallido'}</div>`;
    else el.innerHTML = '<p class="text-muted">Sin backups automáticos aún</p>';
  } catch { el.innerHTML = '<p class="text-muted">—</p>'; }
}

async function cargarListaBackups() {
  const el = document.getElementById('lista-backups');
  try {
    const data = await api('/backup/lista');
    if (!data.backups?.length) { el.innerHTML = '<p class="text-muted">No hay backups en el servidor</p>'; return; }
    el.innerHTML = data.backups.map(b => `
      <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
        <div><div style="font-weight:500;font-size:13px;">📦 ${b.nombre}</div><div style="font-size:11px;color:var(--muted);">${new Date(b.fecha).toLocaleDateString()} · ${b.tamaño}</div></div>
        <div class="flex">
          <button class="btn btn-sm btn-secondary" onclick="descargarBackupServidor('${b.nombre}')">⬇️</button>
          <button class="btn btn-sm btn-secondary" onclick="restaurarBackupLocal('${b.nombre}')">♻️</button>
        </div>
      </div>
    `).join('');
  } catch { el.innerHTML = '<p class="text-muted">Error al cargar</p>'; }
}

async function descargarBackupServidor(nombre) {
  try {
    const res = await fetch(API + '/backup/descargar/' + encodeURIComponent(nombre));
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function restaurarBackupLocal(nombre) {
  const ok = await confirmarModal('Restaurar backup', '¿Restaurar backup ' + nombre + '? Los datos actuales serán reemplazados.');
  if (!ok) return;
  try {
    const data = await api('/backup/restore/local/' + encodeURIComponent(nombre), { method: 'POST' });
    mostrarAlerta(data.mensaje || 'Restauración completada', 'success');
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

async function ejecutarBackupScript() {
  const log = document.getElementById('bk-script-log');
  log.innerHTML = '<span class="text-muted">Ejecutando...</span>';
  try {
    const data = await api('/backup/ejecutar', { method: 'POST' });
    log.innerHTML = '<span style="color:' + (data.ok ? 'var(--success)' : 'var(--danger)') + '">' + (data.ok ? '✓ Completado' : '✗ Error') + '</span>';
    cargarUltimoBackup();
    cargarListaBackups();
  } catch (e) { log.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

/* ── Seguridad Tab ── */
let secInterval = null;

function renderSeguridad(el) {
  if (secInterval) clearInterval(secInterval);
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="stat-card"><div class="stat-label">IPs Bloqueadas</div><div class="stat-value" id="sec-bloqueadas" style="color:var(--danger);">—</div></div>
      <div class="stat-card"><div class="stat-label">IPs en Seguimiento</div><div class="stat-value" id="sec-seguimiento" style="color:var(--warning);">—</div></div>
    </div>
    <div class="card" style="margin-bottom:20px;max-width:600px;">
      <h4 style="margin-bottom:12px;font-family:var(--font-head);">🌐 URL Pública</h4>
      <p class="text-muted" style="font-size:13px;margin-bottom:10px;">Usada en los enlaces de recuperación de contraseña</p>
      <div class="flex">
        <input type="text" id="cfg-app-url" value="" placeholder="https://logistica.midominio.com" style="flex:1;">
        <button class="btn btn-primary btn-sm" onclick="guardarAppUrl()">Guardar</button>
      </div>
      <div id="appurl-msg" style="margin-top:6px;font-size:12px;"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="card">
        <h4 style="margin-bottom:16px;font-family:var(--font-head);">⚙️ Configuración Rate Limiter</h4>
        <p class="text-muted" style="font-size:13px;margin-bottom:14px;">Límites de intentos de inicio de sesión</p>
        <div id="sec-rate-config">Cargando...</div>
        <button class="btn btn-primary btn-sm mt-12" onclick="guardarSecCfg()">💾 Guardar</button>
        <div id="sec-cfg-msg" style="margin-top:8px;"></div>
      </div>
      <div class="card">
        <h4 style="margin-bottom:16px;font-family:var(--font-head);">🚫 Protección Fail2ban</h4>
        <p class="text-muted" style="font-size:13px;margin-bottom:14px;">Servicio de protección a nivel de servidor</p>
        <div id="sec-fail2ban">Cargando...</div>
      </div>
    </div>
    <div class="card" id="sec-bloqueos-card">
      <h4 style="margin-bottom:12px;font-family:var(--font-head);">IPs Bloqueadas</h4>
      <div id="sec-bloqueos-list"><p class="text-muted">Cargando...</p></div>
    </div>
    <div class="card mt-12" id="sec-seguimiento-card">
      <h4 style="margin-bottom:12px;font-family:var(--font-head);">IPs en Seguimiento</h4>
      <div id="sec-seguimiento-list"><p class="text-muted">Cargando...</p></div>
    </div>`;
  cargarSecCfg();
  cargarSecStatus();
  secInterval = setInterval(cargarSecStatus, 10000);
}

async function cargarSecCfg() {
  try {
    const data = await api('/configuracion/seguridad');
    const c = data.config || {};
    const urlEl = document.getElementById('cfg-app-url');
    if (urlEl && c.app_url) urlEl.value = c.app_url;
    const el = document.getElementById('sec-rate-config');
    if (!el) return;
    el.innerHTML = `
      <div class="form-group"><label>Intentos máximos</label><input type="number" id="sec-login-max" value="${c.login_max_attempts||5}" min="1" max="100"></div>
      <div class="form-group"><label>Ventana (minutos)</label><input type="number" id="sec-login-window" value="${c.login_window_minutes||5}" min="1" max="1440"></div>
      <div class="form-group"><label>Bloqueo (minutos)</label><input type="number" id="sec-login-block" value="${c.login_block_minutes||30}" min="1" max="1440"></div>
    `;
    const f2 = document.getElementById('sec-fail2ban');
    if (data.fail2ban) {
      f2.innerHTML = `<div style="font-size:13px;">
        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span class="text-muted">Instalado</span><strong>${data.fail2ban.installed ? '✅ Sí' : '❌ No'}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border);"><span class="text-muted">Activo</span><strong>${data.fail2ban.active ? '✅ Sí' : '❌ No'}</strong></div>
        ${data.fail2ban.installed ? `<div class="flex" style="margin-top:10px;">
          <button class="btn btn-sm btn-secondary" onclick="f2bAction('start')">▶ Iniciar</button>
          <button class="btn btn-sm btn-secondary" onclick="f2bAction('stop')">⏹ Detener</button>
          <button class="btn btn-sm btn-secondary" onclick="f2bAction('restart')">↻ Reiniciar</button>
        </div><div id="f2b-msg" style="margin-top:6px;font-size:12px;"></div>` : ''}
      </div>`;
    }
  } catch {}
}

async function guardarSecCfg() {
  const msg = document.getElementById('sec-cfg-msg');
  try {
    await api('/configuracion/seguridad', { method: 'PUT', body: JSON.stringify({
      login_max_attempts: document.getElementById('sec-login-max')?.value,
      login_window_minutes: document.getElementById('sec-login-window')?.value,
      login_block_minutes: document.getElementById('sec-login-block')?.value
    })});
    msg.innerHTML = '<span style="color:var(--success)">✓ Guardado</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function guardarAppUrl() {
  const msg = document.getElementById('appurl-msg');
  const val = document.getElementById('cfg-app-url')?.value?.trim();
  try {
    await api('/configuracion/seguridad', { method: 'PUT', body: JSON.stringify({ app_url: val || '' }) });
    msg.innerHTML = '<span style="color:var(--success)">✓ URL guardada</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function f2bAction(action) {
  const msg = document.getElementById('f2b-msg');
  if (!msg) return;
  msg.innerHTML = '<span class="text-muted">Ejecutando ' + action + '...</span>';
  try {
    const data = await api('/configuracion/fail2ban/' + action, { method: 'POST' });
    msg.innerHTML = '<span style="color:var(--success)">✓ ' + data.mensaje + '</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function cargarSecStatus() {
  try {
    const data = await api('/auth/ratelimit-status');
    const bEl = document.getElementById('sec-bloqueadas');
    const sEl = document.getElementById('sec-seguimiento');
    if (bEl) bEl.textContent = data.totalBloqueadas || 0;
    if (sEl) sEl.textContent = data.totalIpsEnSeguimiento || 0;

    const bList = document.getElementById('sec-bloqueos-list');
    if (bList) {
      if (!data.bloqueadas?.length) { bList.innerHTML = '<p class="text-muted">Sin IPs bloqueadas</p>'; }
      else {
        bList.innerHTML = data.bloqueadas.map(b => `
          <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
            <div><span style="font-weight:500;">${b.ip}</span><span style="font-size:11px;color:var(--muted);margin-left:8px;">${b.intentos} intentos · ${b.minutosRestantes} min rest.</span></div>
            <button class="btn btn-sm btn-secondary" onclick="desbloquearIP('${b.ip}')">Desbloquear</button>
          </div>
        `).join('');
      }
    }

    const sList = document.getElementById('sec-seguimiento-list');
    if (sList) {
      if (!data.enSeguimiento?.length) { sList.innerHTML = '<p class="text-muted">Sin IPs en seguimiento</p>'; }
      else {
        sList.innerHTML = data.enSeguimiento.map(s => `
          <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
            <div><span style="font-weight:500;">${s.ip}</span><span style="font-size:11px;color:var(--muted);margin-left:8px;">${s.intentos}/${data.configuracion?.maxIntentos||5} intentos · ventana ${s.ventanaExpiraEn}</span></div>
            <progress max="${data.configuracion?.maxIntentos||5}" value="${s.intentos}" style="width:80px;height:6px;border-radius:3px;accent-color:var(--warning);"></progress>
          </div>
        `).join('');
      }
    }
  } catch {}
}



/* ── Auditoría Tab ── */
function renderAuditoria(el) {
  el.innerHTML = `
    <div class="stats-row" style="grid-template-columns:repeat(3,1fr);">
      <div class="stat-card"><div class="stat-label">Accesos hoy</div><div class="stat-value" id="aud-exitos-hoy">—</div></div>
      <div class="stat-card"><div class="stat-label">Fallidos hoy</div><div class="stat-value" id="aud-fallidos-hoy" style="color:var(--danger)">—</div></div>
      <div class="stat-card"><div class="stat-label">Accesos (7d)</div><div class="stat-value" id="aud-exitos-7d">—</div></div>
    </div>
    <div class="flex" style="margin-bottom:14px;flex-wrap:wrap;">
      <input type="text" id="aud-buscar" placeholder="🔍 Buscar usuario/email..." style="width:200px;" oninput="cargarAuditoria()">
      <select id="aud-fil-tipo" onchange="cargarAuditoria()" style="width:auto;">
        <option value="">Todos</option><option value="exito">Exitoso</option><option value="fallido">Fallido</option>
      </select>
      <input type="date" id="aud-desde" onchange="cargarAuditoria()" style="width:auto;">
      <input type="date" id="aud-hasta" onchange="cargarAuditoria()" style="width:auto;">
      <button class="btn btn-sm btn-secondary" onclick="cargarAuditoria()">🔄</button>
    </div>
    <div class="tbl-wrap">
      <table class="tbl"><thead><tr><th>Usuario</th><th>Email</th><th>Tipo</th><th>IP</th><th>Fecha</th></tr></thead><tbody id="aud-body"></tbody></table>
    </div>`;
  cargarAuditoria();
}

async function cargarAuditoria() {
  const params = new URLSearchParams();
  const tipo = document.getElementById('aud-fil-tipo')?.value;
  const buscar = document.getElementById('aud-buscar')?.value;
  const desde = document.getElementById('aud-desde')?.value;
  const hasta = document.getElementById('aud-hasta')?.value;
  if (tipo) params.set('tipo', tipo);
  if (buscar) params.set('buscar', buscar);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  try {
    const data = await api('/auditoria?' + params.toString());
    if (data.stats) {
      document.getElementById('aud-exitos-hoy').textContent = data.stats.exitos_hoy || 0;
      document.getElementById('aud-fallidos-hoy').textContent = data.stats.fallidos_hoy || 0;
      document.getElementById('aud-exitos-7d').textContent = data.stats.exitos_7d || 0;
    }
    const tbody = document.getElementById('aud-body');
    if (!data.historial?.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">Sin registros</td></tr>'; return; }
    tbody.innerHTML = data.historial.map(h => `
      <tr>
        <td>${esc(h.nombre||'—')}</td>
        <td>${esc(h.email||'—')}</td>
        <td><span class="badge badge-${h.tipo==='exito'?'success':'danger'}">${h.tipo==='exito'?'✅ Exitoso':'❌ Fallido'}</span></td>
        <td>${h.ip||'—'}</td>
        <td>${new Date(h.timestamp).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch {}
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Google Places Autocomplete para clientes ── */
window.iniciarAutocompleteCliente = function() {
  window.googleMapsListo = true;
};

function configurarAutocompleteCliente() {
  if (typeof google === 'undefined' || !window.googleMapsListo) {
    const input = document.getElementById('c-direccion');
    if (input && !input._aviso) {
      input._aviso = true;
      input.placeholder = '🔑 Configura API Key en Ajustes → Mapas';
      input.title = 'Ve a Configuración → Mapas para ingresar tu API key de Google Maps';
    }
    return;
  }
  const input = document.getElementById('c-direccion');
  if (!input || input._autocomplete) return;

  const ac = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'co' },
    fields: ['address_components', 'formatted_address', 'geometry', 'name']
  });
  input._autocomplete = true;

  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place.geometry) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    document.getElementById('c-lat').value = lat;
    document.getElementById('c-lng').value = lng;
    for (const comp of place.address_components || []) {
      if (comp.types.includes('locality') || comp.types.includes('administrative_area_level_2')) {
        document.getElementById('c-ciudad').value = comp.long_name;
        break;
      } else if (comp.types.includes('administrative_area_level_1')) {
        document.getElementById('c-ciudad').value = comp.long_name;
      }
    }
    if (place.formatted_address) input.value = place.formatted_address;
    actualizarMapaPin('mapa-pin-cliente', lat, lng);
  });
}

function configurarAutocompleteSede() {
  if (typeof google === 'undefined' || !window.googleMapsListo) {
    const input = document.getElementById('s-direccion');
    if (input && !input._aviso) {
      input._aviso = true;
      input.placeholder = '🔑 Configura API Key en Ajustes → Mapas';
      input.title = 'Ve a Configuración → Mapas para ingresar tu API key de Google Maps';
    }
    return;
  }
  const input = document.getElementById('s-direccion');
  if (!input || input._autocomplete) return;

  const ac = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'co' },
    fields: ['address_components', 'formatted_address', 'geometry', 'name']
  });
  input._autocomplete = true;

  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place.geometry) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    document.getElementById('s-lat').value = lat;
    document.getElementById('s-lng').value = lng;
    for (const comp of place.address_components || []) {
      if (comp.types.includes('locality') || comp.types.includes('administrative_area_level_2')) {
        document.getElementById('s-ciudad').value = comp.long_name;
        break;
      } else if (comp.types.includes('administrative_area_level_1')) {
        document.getElementById('s-ciudad').value = comp.long_name;
      }
    }
    if (place.formatted_address) input.value = place.formatted_address;
    actualizarMapaPin('mapa-pin-sede', lat, lng);
  });
}

function configurarAutocompletePedido() {
  if (typeof google === 'undefined' || !window.googleMapsListo) {
    const input = document.getElementById('p-direccion');
    if (input && !input._aviso) {
      input._aviso = true;
      input.placeholder = '🔑 Configura API Key en Ajustes → Mapas';
      input.title = 'Ve a Configuración → Mapas para ingresar tu API key de Google Maps';
    }
    return;
  }
  const input = document.getElementById('p-direccion');
  if (!input || input._autocomplete) return;

  const ac = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'co' },
    fields: ['address_components', 'formatted_address', 'geometry', 'name']
  });
  input._autocomplete = true;

  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place.geometry) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    document.getElementById('p-lat').value = lat;
    document.getElementById('p-lng').value = lng;
    for (const comp of place.address_components || []) {
      if (comp.types.includes('locality') || comp.types.includes('administrative_area_level_2')) {
        document.getElementById('p-ciudad').value = comp.long_name;
        break;
      } else if (comp.types.includes('administrative_area_level_1')) {
        document.getElementById('p-ciudad').value = comp.long_name;
      }
    }
    if (place.formatted_address) input.value = place.formatted_address;
    actualizarMapaPin('mapa-pin-pedido', lat, lng);
  });
}

function initMapaPin(containerId, latInputId, lngInputId) {
  const container = document.getElementById(containerId);
  if (!container || container._leafletMap) return;
  const latVal = parseFloat(document.getElementById(latInputId)?.value);
  const lngVal = parseFloat(document.getElementById(lngInputId)?.value);
  const hasCoords = !isNaN(latVal) && !isNaN(lngVal);
  const center = hasCoords ? [latVal, lngVal] : [6.2476, -75.5658];
  const map = L.map(container).setView(center, 14);
  agregarCapasMapa(map);
  container._leafletMap = map;
  window._activeModalMap = map;
  requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));

  if (hasCoords) {
    L.marker(center, { draggable: true }).addTo(map).on('dragend', (e) => {
      const pos = e.target.getLatLng();
      document.getElementById(latInputId).value = pos.lat.toFixed(8);
      document.getElementById(lngInputId).value = pos.lng.toFixed(8);
    });
  }

  map.on('click', (e) => {
    map.eachLayer((l) => { if (l instanceof L.Marker) map.removeLayer(l); });
    const m = L.marker(e.latlng, { draggable: true }).addTo(map);
    document.getElementById(latInputId).value = e.latlng.lat.toFixed(8);
    document.getElementById(lngInputId).value = e.latlng.lng.toFixed(8);
    m.on('dragend', () => {
      const pos = m.getLatLng();
      document.getElementById(latInputId).value = pos.lat.toFixed(8);
      document.getElementById(lngInputId).value = pos.lng.toFixed(8);
    });
  });
}

function actualizarMapaPin(containerId, lat, lng) {
  const container = document.getElementById(containerId);
  if (!container || !container._leafletMap) return;
  const map = container._leafletMap;
  map.eachLayer((layer) => { if (layer instanceof L.Marker) map.removeLayer(layer); });
  const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
  map.setView([lat, lng], 16);
  const isCliente = containerId === 'mapa-pin-cliente';
  const isSede = containerId === 'mapa-pin-sede';
  const latInputId = isCliente ? 'c-lat' : isSede ? 's-lat' : 'p-lat';
  const lngInputId = isCliente ? 'c-lng' : isSede ? 's-lng' : 'p-lng';
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    document.getElementById(latInputId).value = pos.lat.toFixed(8);
    document.getElementById(lngInputId).value = pos.lng.toFixed(8);
  });
}

/* ── Mapa ── */
let mapInstance = null;
let mapLayers = { rutas: [], vehiculos: [], paradas: [], sedes: [] };

const coloresRuta = ['#00A86B','#4f8ef7','#f7944f','#f7614f','#9b59b6','#1abc9c','#e67e22','#3498db'];
let mapaFitted = false;

const capasMapa = {
  'Calle': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
  'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
  'Oscuro': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CARTO' }),
  'Claro': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CARTO' })
};

const fallbackTileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

function agregarCapasMapa(map) {
  const nombreDefault = localStorage.getItem('mapa_capa') || 'Calle';
  let capa = capasMapa[nombreDefault] || capasMapa['Calle'];
  map.addLayer(capa);
  L.control.layers(capasMapa, null, { collapsed: true }).addTo(map);
  map.on('baselayerchange', e => localStorage.setItem('mapa_capa', e.name));
  // Fallback si los tiles no cargan
  map.on('tileerror', function() {
    const nombre = localStorage.getItem('mapa_capa') || 'Calle';
    if (nombre === 'Calle') {
      localStorage.setItem('mapa_capa', 'Claro');
      const nueva = capasMapa['Claro'];
      map.eachLayer(l => { if (l instanceof L.TileLayer) map.removeLayer(l); });
      map.addLayer(nueva);
    }
  });
}

function reiniciarMapa() {
  localStorage.removeItem('mapa_lat');
  localStorage.removeItem('mapa_lng');
  localStorage.removeItem('mapa_zoom');
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapaFitted = false;
  cargarMapa();
}

function resetMapaLayers() {
  Object.values(mapLayers).forEach(arr => arr.forEach(l => mapInstance?.removeLayer(l)));
  mapLayers = { rutas: [], vehiculos: [], paradas: [], sedes: [] };
}

async function cargarMapa() {
  const el = document.getElementById('mapa-contenedor');
  if (!el) return; // page not visible
  const fecha = document.getElementById('mapa-fecha').value || new Date().toISOString().split('T')[0];

  // Init map once
  if (!mapInstance) {
    const savedLat = parseFloat(localStorage.getItem('mapa_lat'));
    const savedLng = parseFloat(localStorage.getItem('mapa_lng'));
    const savedZoom = parseInt(localStorage.getItem('mapa_zoom'));
    const hasSaved = savedLat && savedLng && savedZoom;
    let center = hasSaved ? [savedLat, savedLng] : null;
    const zoom = hasSaved ? savedZoom : 13;

    // Try geolocation only on secure context (HTTPS or localhost)
    if (!center && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: false });
          });
          center = [pos.coords.latitude, pos.coords.longitude];
          localStorage.setItem('mapa_lat', pos.coords.latitude.toFixed(6));
          localStorage.setItem('mapa_lng', pos.coords.longitude.toFixed(6));
        } catch {}
      }
    }
    if (!center) center = [6.2476, -75.5658]; // Medellín fallback

    mapInstance = L.map(el).setView(center, zoom);
    agregarCapasMapa(mapInstance);

    // Locate me button
    const locateBtn = L.control({ position: 'topleft' });
    locateBtn.onAdd = function() {
      const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control');
      btn.innerHTML = '📍';
      btn.title = 'Mi ubicación';
      btn.style.cssText = 'width:30px;height:30px;font-size:16px;cursor:pointer;background:var(--surface);border:2px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;';
      btn.onclick = function(e) {
        e.stopPropagation();
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
          mostrarAlerta('Se requiere HTTPS para la ubicación', 'error');
          return;
        }
        if (!navigator.geolocation) { mostrarAlerta('Geolocation no soportado', 'error'); return; }
        btn.innerHTML = '⏳';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            mapInstance.setView(latlng, 15);
            L.marker(latlng, { icon: L.divIcon({ html: '📍', className: '', iconSize: [24, 24], iconAnchor: [12, 24] }) })
              .addTo(mapInstance).bindPopup('Tu ubicación');
            localStorage.setItem('mapa_lat', pos.coords.latitude.toFixed(6));
            localStorage.setItem('mapa_lng', pos.coords.longitude.toFixed(6));
            btn.innerHTML = '📍';
          },
          (err) => {
            btn.innerHTML = '📍';
            mostrarAlerta('No se pudo obtener ubicación: ' + (err.message || 'Permiso denegado'), 'error');
          },
          { timeout: 5000, enableHighAccuracy: false }
        );
      };
      return btn;
    };
    locateBtn.addTo(mapInstance);

    mapInstance.on('resize', () => mapInstance.invalidateSize());
    mapInstance.on('moveend', () => {
      const c = mapInstance.getCenter();
      localStorage.setItem('mapa_lat', c.lat.toFixed(6));
      localStorage.setItem('mapa_lng', c.lng.toFixed(6));
      localStorage.setItem('mapa_zoom', mapInstance.getZoom());
    });
    if (hasSaved) mapaFitted = true;
  }

  resetMapaLayers();

  try {
    const data = await api('/rutas/mapa/datos?fecha=' + fecha);
    const rutaSelect = document.getElementById('mapa-filtro-ruta');
    rutaSelect.innerHTML = '<option value="">Todas las rutas</option>' +
      data.rutas.map(r => `<option value="${r.id}">${esc(r.nombre||'Ruta #'+r.id)} · ${esc(r.placa)}</option>`).join('');

    // Sedes
    for (const s of (data.sedes || [])) {
      if (!s.latitud || !s.longitud) continue;
      const marker = L.marker([s.latitud, s.longitud], {
        icon: L.divIcon({
          className: 'sede-marker',
          html: '<div style="background:#f7944f;color:#fff;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">🏢</div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(mapInstance);
      marker.bindPopup(`<b>${esc(s.nombre)}</b>${s.centro_operacion ? '<br>Centro: ' + esc(s.centro_operacion) : ''}${s.ciudad ? '<br>📍 ' + esc(s.ciudad) : ''}${s.direccion ? '<br>🏠 ' + esc(s.direccion) : ''}`);
      mapLayers.sedes.push(marker);
    }

    // Vehicles
    for (const v of data.vehiculos) {
      if (!v.ultima_posicion_lat || !v.ultima_posicion_lng) continue;
      const marker = L.circleMarker([v.ultima_posicion_lat, v.ultima_posicion_lng], {
        radius: 8, color: '#4f8ef7', fillColor: '#4f8ef7', fillOpacity: 0.8
      }).addTo(mapInstance);
      marker.bindPopup(`<b>${esc(v.placa)}</b><br>${esc(v.alias||'')}<br>Estado: ${v.estado}`);
      mapLayers.vehiculos.push(marker);
    }

    // Routes + stops
    let idx = 0;
    for (const r of data.rutas) {
      const paradasRuta = data.paradas.filter(p => p.ruta_id === r.id).filter(p => p.latitud && p.longitud);
      if (paradasRuta.length < 2) continue;

      const color = r.color_vehiculo || coloresRuta[idx % coloresRuta.length];
      const coords = paradasRuta.map(p => [p.latitud, p.longitud]);

      // polyline (road-following if geometry exists)
      let poly;
      if (r.geometria && r.geometria.coordinates && r.geometria.coordinates.length) {
        poly = L.geoJSON(r.geometria, { style: { color, weight: 3, opacity: 0.8 } }).addTo(mapInstance);
      } else {
        poly = L.polyline(coords, { color, weight: 3, opacity: 0.8 }).addTo(mapInstance);
      }
      poly.bindPopup(`<b>${esc(r.nombre||'Ruta #'+r.id)}</b><br>${esc(r.placa)}<br>${r.cantidad_paradas||paradasRuta.length} paradas · ${r.distancia_total_estimada||'—'} km`);
      poly.rutaId = r.id;
      mapLayers.rutas.push(poly);

      // stop markers
      for (const p of paradasRuta) {
        const marker = L.circleMarker([p.latitud, p.longitud], {
          radius: 6, color, fillColor: '#fff', fillOpacity: 0.9, weight: 2
        }).addTo(mapInstance);
        marker.bindPopup(`<b>#${p.secuencia}</b> ${esc(p.cliente_nombre||'')}<br>${esc(p.numero_factura||'')}<br>${esc(p.direccion||'')}`);
        marker.rutaId = r.id;
        mapLayers.paradas.push(marker);
      }
      idx++;
    }

    if (!mapaFitted) {
      const allLayers = [...mapLayers.rutas, ...mapLayers.vehiculos, ...mapLayers.sedes];
      if (allLayers.length) mapInstance.fitBounds(allLayers, { padding: [40,40] });
      mapaFitted = true;
    }
  } catch {}
}

function filtrarMapaRuta() {
  const id = document.getElementById('mapa-filtro-ruta')?.value;
  mapLayers.rutas.forEach(poly => {
    if (!id) { poly.setStyle({ opacity: 0.8, weight: 3 }); }
    else { poly.setStyle({ opacity: poly.rutaId == id ? 1 : 0.15, weight: poly.rutaId == id ? 4 : 2 }); }
  });
  mapLayers.paradas.forEach(m => {
    if (!id) { m.setStyle({ opacity: 1 }); m.closeTooltip?.(); }
    else { m.setStyle({ opacity: m.rutaId == id ? 1 : 0.2 }); }
  });
}

/* ── Empresa Tab (Config) ── */
async function renderEmpresa(el) {
  el.innerHTML = '<p class="text-muted">Cargando...</p>';
  try {
    const [company, logoData] = await Promise.all([
      api('/configuracion/company'),
      api('/configuracion/logo')
    ]);
    const c = company;
    const logoUrl = logoData.logo || '';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;max-width:600px;">
        <div class="card">
          <h4 style="margin-bottom:16px;font-family:var(--font-head);">🏢 Datos de la Empresa</h4>
          <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Información que aparece en los PDFs de rutas.</p>
          <div class="form-group"><label>Nombre</label><input id="cfg-company-name" value="${esc(c.company_name||'')}" placeholder="Mi Empresa"></div>
          <div class="form-group"><label>Dirección</label><input id="cfg-company-address" value="${esc(c.company_address||'')}" placeholder="Cra 10 #20-30"></div>
          <div style="display:flex;gap:12px;">
            <div class="form-group" style="flex:1"><label>Teléfono</label><input id="cfg-company-phone" value="${esc(c.company_phone||'')}" placeholder="604 123 4567"></div>
            <div class="form-group" style="flex:1"><label>NIT</label><input id="cfg-company-nit" value="${esc(c.company_nit||'')}" placeholder="900.123.456-7"></div>
          </div>
          <div style="display:flex;gap:12px;">
            <div class="form-group" style="flex:1"><label>Latitud sede</label><input type="number" step="any" id="cfg-company-lat" value="${esc(c.company_latitud||'')}" placeholder="6.2476"></div>
            <div class="form-group" style="flex:1"><label>Longitud sede</label><input type="number" step="any" id="cfg-company-lng" value="${esc(c.company_longitud||'')}" placeholder="-75.5658"></div>
          </div>
          <button class="btn btn-primary" onclick="guardarCompany()">✓ Guardar</button>
          <div id="company-msg" style="margin-top:10px;font-size:13px;"></div>
        </div>
        <div class="card">
          <h4 style="margin-bottom:16px;font-family:var(--font-head);">🖼️ Logo de la Empresa</h4>
          <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Aparece en el encabezado de los PDFs. Formato PNG/JPG, máx 500KB.</p>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
            <div id="logo-preview" style="width:100px;height:100px;border:2px dashed var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface2);">
              ${logoUrl ? `<img src="${logoUrl}" style="max-width:100%;max-height:100%;object-fit:contain;">` : '<span style="font-size:28px;color:var(--muted);">📷</span>'}
            </div>
            <div>
              <input type="file" id="logo-file" accept="image/*" style="display:none;" onchange="previewLogo(this)">
              <button class="btn btn-secondary" onclick="document.getElementById('logo-file').click()">📁 Seleccionar logo</button>
              ${logoUrl ? '<button class="btn btn-danger" onclick="eliminarLogo()" style="margin-left:8px;">🗑️</button>' : ''}
            </div>
          </div>
          <button class="btn btn-primary" onclick="guardarLogo()">✓ Guardar logo</button>
          <div id="logo-msg" style="margin-top:10px;font-size:13px;"></div>
        </div>
      </div>`;
  } catch { el.innerHTML = '<p class="text-muted">Error al cargar configuración</p>'; }
}

function previewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const msg = document.getElementById('logo-msg');
  if (!file.type.match(/^image\/(png|jpe?g|svg\+xml)$/)) {
    msg.innerHTML = '<span style="color:var(--danger)">✗ Formato no soportado. Usa PNG, JPG o SVG.</span>';
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      if (img.width > 500 || img.height > 500) {
        msg.innerHTML = `<span style="color:var(--warning)">⚠ Dimensions: ${img.width}x${img.height}px. Recomendado: máx 500x500px.</span>`;
      } else {
        msg.innerHTML = `<span style="color:var(--muted)">Dimensions: ${img.width}x${img.height}px</span>`;
      }
    };
    img.src = e.target.result;
    document.getElementById('logo-preview').innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:100%;object-fit:contain;">`;
  };
  reader.readAsDataURL(file);
}

async function guardarCompany() {
  const msg = document.getElementById('company-msg');
  try {
    await api('/configuracion/company', { method: 'PUT', body: JSON.stringify({
      company_name: document.getElementById('cfg-company-name').value.trim(),
      company_address: document.getElementById('cfg-company-address').value.trim(),
      company_phone: document.getElementById('cfg-company-phone').value.trim(),
      company_nit: document.getElementById('cfg-company-nit').value.trim(),
      company_latitud: document.getElementById('cfg-company-lat').value.trim(),
      company_longitud: document.getElementById('cfg-company-lng').value.trim(),
    })});
    msg.innerHTML = '<span style="color:var(--success)">✓ Guardado</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function guardarLogo() {
  const input = document.getElementById('logo-file');
  const msg = document.getElementById('logo-msg');
  const file = input.files[0];
  if (!file) { msg.innerHTML = '<span style="color:var(--danger)">✗ Selecciona un archivo</span>'; return; }
  if (!file.type.match(/^image\/(png|jpe?g|svg\+xml)$/)) {
    msg.innerHTML = '<span style="color:var(--danger)">✗ Formato no soportado. Usa PNG, JPG o SVG.</span>';
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await api('/configuracion/logo', { method: 'POST', body: JSON.stringify({ logo: e.target.result }) });
      msg.innerHTML = '<span style="color:var(--success)">✓ Logo guardado</span>';
    } catch (err) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + err.message + '</span>'; }
  };
  reader.readAsDataURL(file);
}

async function eliminarLogo() {
  const msg = document.getElementById('logo-msg');
  try {
    await api('/configuracion/logo', { method: 'DELETE' });
    document.getElementById('logo-preview').innerHTML = '<span style="font-size:28px;color:var(--muted);">📷</span>';
    msg.innerHTML = '<span style="color:var(--success)">✓ Logo eliminado</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

/* ── Mapas Tab (Config) ── */
async function renderMapas(el) {
  el.innerHTML = '<p class="text-muted">Cargando...</p>';
  try {
    const data = await api('/configuracion/gmaps/key');
    const key = data.key || '';
    el.innerHTML = `
      <div class="card" style="max-width:600px;">
        <h4 style="margin-bottom:16px;font-family:var(--font-head);">🗺️ Google Maps API Key</h4>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
          Necesitas una clave de API de Google Maps con la biblioteca "Places" habilitada.
          <br><a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:var(--accent)">Obtener API Key →</a>
        </p>
        <div class="form-group">
          <label>API Key</label>
          <input id="cfg-gmaps-key" value="${esc(key)}" placeholder="AIzaSy..." style="font-family:monospace;">
        </div>
        <div class="flex">
          <button class="btn btn-primary" onclick="guardarGmapsKey()">✓ Guardar</button>
          <button class="btn btn-secondary" onclick="probarGmapsKey()">🧪 Probar</button>
          ${key ? '<button class="btn btn-danger" onclick="eliminarGmapsKey()">🗑️ Eliminar</button>' : ''}
        </div>
        <div id="gmaps-msg" style="margin-top:10px;font-size:13px;"></div>
      </div>`;
  } catch { el.innerHTML = '<p class="text-muted">Error al cargar configuración</p>'; }
}

async function guardarGmapsKey() {
  const key = document.getElementById('cfg-gmaps-key').value.trim();
  const msg = document.getElementById('gmaps-msg');
  if (!key) { msg.innerHTML = '<span style="color:var(--danger)">✗ Ingresa una API key</span>'; return; }
  try {
    await api('/configuracion/gmaps/key', { method: 'PUT', body: JSON.stringify({ key }) });
    msg.innerHTML = '<span style="color:var(--success)">✓ Guardada en el servidor. Recarga para aplicar.</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function eliminarGmapsKey() {
  const msg = document.getElementById('gmaps-msg');
  try {
    await api('/configuracion/gmaps/key', { method: 'DELETE' });
    msg.innerHTML = '<span style="color:var(--success)">✓ Eliminada. Recarga para aplicar.</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function probarGmapsKey() {
  const key = document.getElementById('cfg-gmaps-key').value.trim();
  const msg = document.getElementById('gmaps-msg');
  if (!key) { msg.innerHTML = '<span style="color:var(--danger)">✗ Ingresa una API key primero</span>'; return; }
  msg.innerHTML = '<span class="text-muted">Probando...</span>';
  try {
    const d = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Medellin&key=${key}`).then(r=>r.json());
    if (d.status === 'OK') msg.innerHTML = '<span style="color:var(--success)">✓ API key válida</span>';
    else if (d.status === 'REQUEST_DENIED') msg.innerHTML = '<span style="color:var(--danger)">✗ API key denegada — habilita Geocoding API y Places API</span>';
    else msg.innerHTML = '<span style="color:var(--danger)">✗ Error: ' + d.status + '</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

/* ── Widetech Tab ── */
async function renderWidetech(el) {
  el.innerHTML = '<p class="text-muted">Cargando...</p>';
  try {
    const data = await api('/widetech/config');
    const c = data.config || {};
    el.innerHTML = `
      <div class="card" style="max-width:600px;">
        <h4 style="margin-bottom:16px;font-family:var(--font-head);">🛰️ Widetech API</h4>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
          Configuración de la API de seguimiento GPS de Widetech.
          Los datos se usan para tracking en tiempo real de vehículos, rutas y geocercas.
          <br><a href="https://developers.widetech.co" target="_blank" style="color:var(--accent)">Documentación API →</a>
        </p>
        <div class="form-grid">
          <div class="form-group">
            <label>URL Base</label>
            <input id="wt-url" value="${esc(c.widetech_url||'https://web1ws.shareservice.co')}" placeholder="https://web1ws.shareservice.co" style="font-family:monospace;">
          </div>
          <div class="form-group">
            <label>Usuario</label>
            <input id="wt-user" value="${esc(c.widetech_user||'')}" placeholder="usuario plataforma Space" autocomplete="off">
          </div>
          <div class="form-group">
            <label>Contraseña</label>
            <input type="password" id="wt-pass" value="${c.widetech_password?'••••••••':''}" placeholder="contraseña" autocomplete="off">
          </div>
          <div class="form-group">
            <label>Idioma</label>
            <select id="wt-lang">
              <option value="1" ${c.widetech_lang==='2'?'':'selected'}>Español</option>
              <option value="2" ${c.widetech_lang==='2'?'selected':''}>Inglés</option>
            </select>
          </div>
          <div class="form-group">
            <label>Intervalo entre consultas (segundos)</label>
            <input id="wt-rate" value="${c.widetech_rate_limit||'25'}" placeholder="25" type="number" min="20" max="300">
            <small style="color:var(--muted);font-size:11px;">Mínimo 20 segundos según límite de Widetech</small>
          </div>
        </div>
        <div class="flex" style="margin-top:8px;">
          <button class="btn btn-primary" onclick="guardarWidetech()">✓ Guardar</button>
          <button class="btn btn-secondary" onclick="testWidetech()">🔌 Probar conexión</button>
        </div>
        <div id="wt-msg" style="margin-top:10px;font-size:13px;"></div>
      </div>`;
  } catch { el.innerHTML = '<p class="text-muted">Error al cargar configuración</p>'; }
}

async function guardarWidetech() {
  const msg = document.getElementById('wt-msg');
  const rate = parseInt(document.getElementById('wt-rate').value) || 25;
  if (rate < 20) { msg.innerHTML = '<span style="color:var(--danger)">✗ El intervalo mínimo es 20 segundos</span>'; return; }
  try {
    const body = {
      widetech_url: document.getElementById('wt-url').value.trim(),
      widetech_user: document.getElementById('wt-user').value.trim(),
      widetech_password: document.getElementById('wt-pass').value,
      widetech_lang: document.getElementById('wt-lang').value,
      widetech_rate_limit: String(rate)
    };
    await api('/widetech/config', { method: 'PUT', body: JSON.stringify(body) });
    msg.innerHTML = '<span style="color:var(--success)">✓ Configuración guardada</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function testWidetech() {
  const msg = document.getElementById('wt-msg');
  msg.innerHTML = '<span class="text-muted">Conectando con Widetech...</span>';
  try {
    let password = document.getElementById('wt-pass').value;
    if (password.includes('•')) {
      const saved = await api('/widetech/config');
      password = saved.config?.widetech_password || password;
    }
    const body = {
      url: document.getElementById('wt-url').value.trim(),
      user: document.getElementById('wt-user').value.trim(),
      password
    };
    const data = await api('/widetech/test', { method: 'POST', body: JSON.stringify(body) });
    msg.innerHTML = '<span style="color:var(--success)">✓ ' + data.mensaje + '</span>';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

/* ── Widetech Sync Tab ── */
let wtTab = 'sync';

async function rWidetech() {
  document.querySelectorAll('#wt-tabs .rpt-tab').forEach(b => b.classList.toggle('active', b.dataset.wt === wtTab));
  const el = document.getElementById('wt-content');
  if (wtTab === 'sync') renderWtSync(el);
  else if (wtTab === 'vehiculos') renderWtVehiculos(el);
  else if (wtTab === 'zonas') renderWtZonas(el);
}




async function renderWtSync(el) {
  el.innerHTML = `
    <div class="card">
      <h4 style="margin-bottom:16px;font-family:var(--font-head);">🔄 Sincronizar rutas con Widetech</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
        Las rutas de logística se pueden empujar a Widetech como itinerarios (CreateItinerary).
        Selecciona una ruta y asígnale un conductor para enviarla.
      </p>
      <div class="form-grid" style="grid-template-columns:1fr 1fr auto;margin-bottom:14px;">
        <div class="form-group">
          <label>Ruta</label>
          <select id="wt-sync-ruta" style="max-width:100%;">
            <option value="">— Cargando rutas —</option>
          </select>
        </div>
        <div class="form-group">
          <label>Conductor (opcional)</label>
          <input id="wt-sync-driver" placeholder="Nombre del conductor">
        </div>
        <div class="form-group" style="align-self:flex-end;">
          <button class="btn btn-primary" onclick="pushRutaWidetech()">📤 Enviar a Widetech</button>
        </div>
      </div>
      <div id="wt-sync-msg" style="margin-top:10px;font-size:13px;"></div>
    </div>
    <div id="wt-sync-log" style="margin-top:14px;"></div>`;
  cargarRutasParaSync();
}

async function cargarRutasParaSync() {
  const sel = document.getElementById('wt-sync-ruta');
  try {
    const data = await api('/rutas?estado=planificada');
    const rutas = data.rutas || [];
    if (!rutas.length) {
      sel.innerHTML = '<option value="">— No hay rutas planificadas —</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Seleccionar ruta —</option>' +
      rutas.map(r => `<option value="${r.id}">#${r.id} ${r.nombre || 'Sin nombre'} — ${r.placa || '?'} ${r.fecha ? r.fecha.slice(0,10) : ''}</option>`).join('');
  } catch {
    sel.innerHTML = '<option value="">— Error al cargar —</option>';
  }
}

async function pushRutaWidetech() {
  const rutaId = document.getElementById('wt-sync-ruta').value;
  const msg = document.getElementById('wt-sync-msg');
  if (!rutaId) { msg.innerHTML = '<span style="color:var(--danger)">✗ Selecciona una ruta</span>'; return; }
  const ok = await confirmarModal('Enviar a Widetech', '¿Enviar la ruta #' + rutaId + ' como itinerario a Widetech?');
  if (!ok) return;
  msg.innerHTML = '<span class="text-muted">Enviando a Widetech (espera ~25s)...</span>';
  try {
    const data = await api('/widetech-sync/push-route', { method: 'POST', body: JSON.stringify({ rutaId: parseInt(rutaId) }) });
    msg.innerHTML = '<span style="color:var(--success)">✓ ' + data.mensaje + '</span>';
    cargarRutasParaSync();
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function renderWtVehiculos(el) {
  el.innerHTML = `
    <div class="card" style="max-width:600px;">
      <h4 style="margin-bottom:16px;font-family:var(--font-head);">🚦 Estado de vehículos en Widetech</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
        Importa vehículos desde Widetech o verifica su estado de conexión.
      </p>
      <h5 style="margin-bottom:8px;font-size:13px;color:var(--accent);">📥 Importar placas desde Widetech</h5>
      <p style="font-size:12px;color:var(--muted);margin-bottom:8px;">Pega las placas separadas por coma, espacio o salto de línea.</p>
      <textarea id="wt-bulk-plates" rows="4" placeholder="WOU345, BJS360, VDW339, ITX050&#10;TMI968 KOL658 TDY762 WOU022 BKL711 SNU621" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:13px;font-family:monospace;resize:vertical;"></textarea>
      <div class="flex" style="margin-top:8px;">
        <button class="btn btn-primary" onclick="bulkImportarPlacas()">🔍 Verificar e importar</button>
        <span id="wt-bulk-msg" style="font-size:13px;"></span>
      </div>
      <div id="wt-bulk-progress" style="margin-top:10px;"></div>
      <hr style="border-color:var(--border);margin:16px 0;">
      <h5 style="margin-bottom:8px;font-size:13px;color:var(--accent);">📄 Importar desde archivo Widetech (.xlsx)</h5>
      <p style="font-size:12px;color:var(--muted);margin-bottom:8px;">Exporta tu flota desde Widetech (OnLine System → LastLocation) y sube el archivo aquí.</p>
      <input type="file" id="wt-xlsx-file" accept=".xlsx" style="display:none;" onchange="subirXlsxWidetech()">
      <button class="btn btn-secondary" onclick="document.getElementById('wt-xlsx-file').click()">📎 Seleccionar archivo .xlsx</button>
      <div id="wt-xlsx-msg" style="margin-top:8px;font-size:13px;"></div>
      <hr style="border-color:var(--border);margin:16px 0;">
      <h5 style="margin-bottom:8px;font-size:13px;color:var(--accent);">🔍 Verificar placa individual</h5>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <input id="wt-check-placa" placeholder="ABC123" style="text-transform:uppercase;flex:1;min-width:120px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:13px;">
        <button class="btn btn-secondary" onclick="checkPlacaWidetech()">🔍 Verificar</button>
      </div>
      <div id="wt-check-placa-msg" style="margin-top:6px;font-size:13px;margin-bottom:14px;"></div>
      <hr style="border-color:var(--border);margin:16px 0;">
      <h5 style="margin-bottom:8px;font-size:13px;color:var(--accent);">🔍 Verificar todos los vehículos de logística</h5>
      <button class="btn btn-primary" onclick="cargarWtCheckVehiculos()">🔍 Verificar todos</button>
      <div id="wt-vehiculos-msg" style="margin-top:10px;font-size:13px;"></div>
    </div>
    <div id="wt-vehiculos-table" style="margin-top:14px;"></div>`;
}

async function bulkImportarPlacas() {
  const raw = document.getElementById('wt-bulk-plates').value.trim();
  const msg = document.getElementById('wt-bulk-msg');
  const progress = document.getElementById('wt-bulk-progress');
  if (!raw) { msg.innerHTML = '<span style="color:var(--danger)">Pega al menos una placa</span>'; return; }
  const plates = raw.split(/[,;\s\n\r\t]+/).map(p => p.trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(plates)];
  const total = unique.length;
  msg.innerHTML = `<span class="text-muted">Verificando ${total} placas... (~${Math.ceil(total * 0.5)} min)</span>`;
  progress.innerHTML = '';
  try {
    let done = 0;
    const batchSize = 1;
    const interval = setInterval(() => {
      if (done < total) {
        const pct = Math.round((done / total) * 100);
        progress.innerHTML = `<div style="background:var(--surface2);border-radius:6px;height:6px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s;"></div></div><span style="font-size:12px;color:var(--muted);">${done}/${total}</span>`;
      }
    }, 1000);
    const data = await api('/widetech-sync/bulk-check-plates', {
      method: 'POST',
      body: JSON.stringify({ plates: unique })
    });
    clearInterval(interval);
    progress.innerHTML = '';
    const s = data.summary;
    let resultHtml = `<div style="margin-top:10px;padding:10px;background:var(--surface2);border-radius:8px;font-size:13px;">`;
    resultHtml += `<strong>✅ ${s.imported} importados</strong> · <strong>📍 ${s.found - s.imported} ya existían</strong> · <strong>❌ ${s.notFound} no encontrados en Widetech</strong>`;
    resultHtml += `</div>`;
    resultHtml += `<div style="margin-top:8px;max-height:200px;overflow-y:auto;">`;
    for (const r of data.results) {
      const icon = r.created ? '🆕' : r.exists ? '✅' : '❌';
      const detail = r.dateGps ? ` (último GPS: ${r.dateGps})` : r.error ? ` (${r.error})` : '';
      resultHtml += `<div style="font-size:12px;padding:2px 0;">${icon} <strong>${r.plate}</strong>${detail}</div>`;
    }
    resultHtml += `</div>`;
    progress.innerHTML = resultHtml;
    msg.innerHTML = `<span style="color:var(--success)">✓ Completado</span>`;
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; progress.innerHTML = ''; }
}

async function subirXlsxWidetech() {
  const input = document.getElementById('wt-xlsx-file');
  const msg = document.getElementById('wt-xlsx-msg');
  const file = input.files[0];
  if (!file) return;
  msg.innerHTML = '<span class="text-muted">Subiendo y procesando archivo...</span>';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(API + '/widetech-sync/import-xlsx', {
      method: 'POST',
      body: formData
    });
    if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    const s = data.summary;
    let html = `<div style="padding:10px;background:var(--surface2);border-radius:8px;font-size:13px;">`;
    html += `<strong>✅ ${s.imported} importados</strong> · <strong>📍 ${s.existing} ya existían</strong> · <strong>Total: ${s.total}</strong>`;
    html += `</div>`;
    if (data.vehicles?.length) {
      html += `<div style="margin-top:8px;max-height:200px;overflow-y:auto;">`;
      for (const v of data.vehicles) {
        const icon = v.created ? '🆕' : '✅';
        const loc = v.location ? ' — ' + esc(v.location.substring(0, 60)) : '';
        html += `<div style="font-size:12px;padding:2px 0;">${icon} <strong>${v.plate}</strong>${loc}</div>`;
      }
      html += `</div>`;
    }
    msg.innerHTML = html;
    input.value = '';
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function checkPlacaWidetech() {
  const plate = document.getElementById('wt-check-placa').value.trim().toUpperCase();
  const msg = document.getElementById('wt-check-placa-msg');
  if (!plate) { msg.innerHTML = '<span style="color:var(--danger)">✗ Ingresa una placa</span>'; return; }
  msg.innerHTML = '<span class="text-muted">Consultando placa ' + plate + '...</span>';
  try {
    const data = await api('/widetech-sync/check-plate', { method: 'POST', body: JSON.stringify({ plate }) });
    if (data.exists) {
      let txt = '✓ Placa ' + plate + ' existe en Widetech';
      if (data.importada) txt += ' — importada a logística como nuevo vehículo';
      else txt += ' — ya estaba en logística';
      if (data.dateGps) txt += ' (último GPS: ' + data.dateGps + ')';
      msg.innerHTML = '<span style="color:var(--success)">' + txt + '</span>';
    } else {
      msg.innerHTML = '<span style="color:var(--warning)">⚠️ Placa ' + plate + ' no encontrada en Widetech</span>';
    }
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function cargarWtCheckVehiculos() {
  const msg = document.getElementById('wt-vehiculos-msg');
  const tbl = document.getElementById('wt-vehiculos-table');
  msg.innerHTML = '<span class="text-muted">Consultando Widetech para cada vehículo...</span>';
  tbl.innerHTML = '';
  try {
    const data = await api('/widetech-sync/check-vehicles', { method: 'POST' });
    const results = data.results || [];
    msg.innerHTML = `<span style="color:var(--success)">✓ ${results.length} vehículos verificados</span>`;
    if (!results.length) { tbl.innerHTML = '<p class="text-muted" style="padding:20px;">No hay vehículos registrados</p>'; return; }
    tbl.innerHTML = `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Placa</th><th>Estado</th><th>Último GPS</th></tr></thead>
          <tbody>${results.map(r => `
            <tr>
              <td><strong>${esc(r.placa)}</strong></td>
              <td>${r.online ? '<span class="badge badge-success">🟢 Online</span>' : r.error ? '<span class="badge badge-danger" title="'+esc(r.error)+'">🔴 Error</span>' : '<span class="badge badge-warning">🟡 Sin boot</span>'}</td>
              <td><small>${r.ultimo_gps || '—'}</small></td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

async function renderWtZonas(el) {
  el.innerHTML = `
    <div class="card" style="max-width:600px;">
      <h4 style="margin-bottom:16px;font-family:var(--font-head);">📐 Zonas Widetech (Geocercas)</h4>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
        Geocercas configuradas en la plataforma Widetech. Puedes consultarlas y visualizar sus polígonos.
      </p>
      <div class="form-group">
        <label>Nombre de zona (opcional — vacío trae todas)</label>
        <input id="wt-zone-name" placeholder="Dejar vacío para todas">
      </div>
      <button class="btn btn-primary" onclick="cargarWtZonas()">🔍 Consultar zonas</button>
      <div id="wt-zonas-msg" style="margin-top:10px;font-size:13px;"></div>
    </div>
    <div id="wt-zonas-table" style="margin-top:14px;"></div>`;
}

async function cargarWtZonas() {
  const msg = document.getElementById('wt-zonas-msg');
  const tbl = document.getElementById('wt-zonas-table');
  msg.innerHTML = '<span class="text-muted">Consultando zonas Widetech...</span>';
  tbl.innerHTML = '';
  try {
    const name = document.getElementById('wt-zone-name').value.trim();
    const q = name ? '?name=' + encodeURIComponent(name) : '';
    const data = await api('/widetech-sync/zones' + q);
    const zones = data.zones || [];
    msg.innerHTML = `<span style="color:var(--success)">✓ ${zones.length} zonas encontradas</span>`;
    if (!zones.length) { tbl.innerHTML = '<p class="text-muted" style="padding:20px;">Sin zonas disponibles</p>'; return; }
    tbl.innerHTML = `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>ID</th><th>Nombre</th><th>Latitud</th><th>Longitud</th><th>Tipo</th></tr></thead>
          <tbody>${zones.map(z => `
            <tr>
              <td>${z.cpID || z.id || '—'}</td>
              <td><strong>${esc(z.cpName || z.Name || '—')}</strong></td>
              <td>${z.cpLat || '—'}</td>
              <td>${z.cpLng || '—'}</td>
              <td>${z.cpType || '—'}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}
const _rptState = { tipo: 'rutas', page: 1, sort: '', order: 'DESC' };

const RPT_CONFIG = {
  rutas: {
    columns: [
      { key: 'nombre', label: 'Nombre', sort: 'r.nombre' },
      { key: 'fecha', label: 'Fecha', sort: 'r.fecha' },
      { key: 'placa', label: 'Vehículo', sort: 'v.placa' },
      { key: 'sede', label: 'Sede', sort: 'r.sede' },
      { key: 'estado', label: 'Estado', sort: 'r.estado' },
      { key: 'cantidad_paradas', label: 'Paradas', sort: 'r.cantidad_paradas' },
      { key: 'paradas_completadas', label: 'Completadas', sort: 'r.paradas_completadas' },
      { key: 'eficiencia', label: 'Eficiencia %', sort: 'r.eficiencia' },
    ],
    estados: [{ v: '', l: 'Todos' }, { v: 'planificada', l: 'Planificada' }, { v: 'en_ejecucion', l: 'En ejecución' }, { v: 'completada', l: 'Completada' }, { v: 'fallida', l: 'Fallida' }],
    summaryKeys: ['total','planificadas','completadas','fallidas','eficiencia_promedio'],
    summaryLabels: ['Total','Planificadas','Completadas','Fallidas','Eficiencia Prom.'],
    summaryColors: ['var(--text)','var(--accent)','var(--success)','var(--danger)','var(--warning)'],
    summarySuffix: ['','','','','%'],
    filters: ['sede', 'estado'],
  },
  pedidos: {
    columns: [
      { key: 'numero_factura', label: 'Factura', sort: 'p.numero_factura' },
      { key: 'cliente_nombre', label: 'Cliente', sort: 'p.cliente_nombre' },
      { key: 'ciudad', label: 'Ciudad', sort: 'p.ciudad' },
      { key: 'estado', label: 'Estado', sort: 'p.estado' },
      { key: 'valor_credito', label: 'Valor', sort: 'p.valor_credito' },
      { key: 'ruta_nombre', label: 'Ruta', sort: 'r.nombre' },
      { key: 'created_at', label: 'Creado', sort: 'p.created_at' },
    ],
    estados: [{ v: '', l: 'Todos' }, { v: 'pendiente', l: 'Pendiente' }, { v: 'asignado', l: 'Asignado' }, { v: 'en_ruta', l: 'En ruta' }, { v: 'entregado', l: 'Entregado' }, { v: 'fallido', l: 'Fallido' }],
    summaryKeys: ['total','pendientes','entregados','fallidos','valor_total'],
    summaryLabels: ['Total','Pendientes','Entregados','Fallidos','Valor Total'],
    summaryColors: ['var(--text)','var(--accent)','var(--success)','var(--danger)','var(--warning)'],
    summarySuffix: ['','','','',''],
    summaryFormat: ['int','int','int','int','currency'],
    filters: ['estado', 'ciudad'],
  },
  vehiculos: {
    columns: [
      { key: 'placa', label: 'Placa', sort: 'v.placa' },
      { key: 'alias', label: 'Alias', sort: 'v.alias' },
      { key: 'estado', label: 'Estado', sort: 'v.estado' },
      { key: 'sede', label: 'Sede', sort: 'v.sede' },
      { key: 'capacidad_peso', label: 'Cap. Peso (kg)', sort: 'v.capacidad_peso' },
      { key: 'capacidad_volumen', label: 'Cap. Vol. (m³)', sort: 'v.capacidad_volumen' },
      { key: 'pedidos_activos', label: 'Pedidos Activos', sort: 'pedidos_activos' },
    ],
    estados: [{ v: '', l: 'Todos' }, { v: 'disponible', l: 'Disponible' }, { v: 'en_ruta', l: 'En ruta' }, { v: 'mantencion', l: 'Mantenimiento' }, { v: 'inactivo', l: 'Inactivo' }],
    summaryKeys: ['total','disponibles','en_ruta','mantenimiento','capacidad_peso_total'],
    summaryLabels: ['Total','Disponibles','En ruta','Mantenimiento','Cap. Peso Total'],
    summaryColors: ['var(--text)','var(--success)','var(--warning)','var(--danger)','var(--accent)'],
    summarySuffix: ['','','','',' kg'],
    filters: ['estado', 'sede'],
  },
  eficiencia: {
    columns: [
      { key: 'placa', label: 'Vehículo', sort: 'v.placa' },
      { key: 'fecha', label: 'Fecha', sort: 'h.fecha' },
      { key: 'paradas_planificadas', label: 'Paradas Plan.', sort: 'h.paradas_planificadas' },
      { key: 'paradas_completadas', label: 'Paradas Comp.', sort: 'h.paradas_completadas' },
      { key: 'tasa_exito', label: 'Tasa Éxito %', sort: 'h.tasa_exito' },
      { key: 'eficiencia_distancia', label: 'Efic. Dist. %', sort: 'h.eficiencia_distancia' },
      { key: 'eficiencia_tiempo', label: 'Efic. Tiempo %', sort: 'h.eficiencia_tiempo' },
    ],
    estados: [],
    summaryKeys: ['total_rutas','paradas_planificadas','paradas_completadas','tasa_exito_promedio','eficiencia_distancia_promedio'],
    summaryLabels: ['Total Rutas','Paradas Plan.','Paradas Comp.','Tasa Éxito Prom.','Efic. Distancia Prom.'],
    summaryColors: ['var(--text)','var(--accent)','var(--success)','var(--warning)','var(--accent)'],
    summarySuffix: ['','','','%','%'],
    filters: ['vehiculo'],
  },
};

async function inicializarReportes() {
  const hoy = new Date().toISOString().split('T')[0];
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0];
  document.getElementById('rpt-fecha-desde').value = hace30;
  document.getElementById('rpt-fecha-hasta').value = hoy;
  // Poblar sedes
  try {
    const sedes = await api('/sedes');
    const sel = document.getElementById('rpt-sede');
    sel.innerHTML = '<option value="">Todas</option>' + (sedes.sedes||[]).map(s => `<option value="${esc(s.nombre)}">${esc(s.nombre)}</option>`).join('');
  } catch {}
  // Poblar vehículos
  try {
    const v = await api('/vehiculos');
    const sel = document.getElementById('rpt-vehiculo');
    sel.innerHTML = '<option value="">Todos</option>' + (v.vehiculos||[]).map(vv => `<option value="${vv.id}">${esc(vv.placa)} — ${esc(vv.alias||'')}</option>`).join('');
  } catch {}
}

function cambiarTipoReporte(tipo) {
  _rptState.tipo = tipo;
  _rptState.page = 1;
  _rptState.sort = '';
  document.querySelectorAll('.rpt-tab').forEach(t => t.classList.toggle('active', t.dataset.tipo === tipo));
  const cfg = RPT_CONFIG[tipo];
  // Show/hide filters
  document.getElementById('rpt-filter-sede-wrapper').style.display = cfg.filters.includes('sede') ? '' : 'none';
  document.getElementById('rpt-filter-estado-wrapper').style.display = cfg.filters.includes('estado') ? '' : 'none';
  document.getElementById('rpt-filter-ciudad-wrapper').style.display = cfg.filters.includes('ciudad') ? '' : 'none';
  document.getElementById('rpt-filter-vehiculo-wrapper').style.display = cfg.filters.includes('vehiculo') ? '' : 'none';
  // Poblar estados
  const estSel = document.getElementById('rpt-estado');
  if (cfg.estados.length) {
    estSel.innerHTML = cfg.estados.map(e => `<option value="${e.v}">${e.l}</option>`).join('');
    estSel.style.display = '';
  } else {
    estSel.style.display = 'none';
  }
  cargarReporte();
}

async function cargarReporte() {
  const { tipo, page } = _rptState;
  const cfg = RPT_CONFIG[tipo];
  const tbody = document.getElementById('rpt-tbody');
  const thead = document.getElementById('rpt-thead');
  try {
    const params = new URLSearchParams({
      page,
      limit: document.getElementById('rpt-page-size').value,
      fechaDesde: document.getElementById('rpt-fecha-desde').value,
      fechaHasta: document.getElementById('rpt-fecha-hasta').value,
    });
    if (_rptState.sort) { params.set('sort', _rptState.sort); params.set('order', _rptState.order); }
    const sede = document.getElementById('rpt-sede').value;
    if (sede) params.set('sede', sede);
    const estado = document.getElementById('rpt-estado').value;
    if (estado) params.set('estado', estado);
    const ciudad = document.getElementById('rpt-ciudad').value;
    if (ciudad) params.set('ciudad', ciudad);
    const vehiculo = document.getElementById('rpt-vehiculo').value;
    if (vehiculo) params.set('vehiculoId', vehiculo);

    const data = await api('/reportes/' + tipo + '?' + params.toString());

    // Summary
    renderReporteSummary(data.summary, tipo);

    // Counter
    document.getElementById('rpt-counter').textContent = `Mostrando ${data.rows.length} de ${data.total} registros`;

    // Table header
    const sortField = _rptState.sort;
    thead.innerHTML = '<tr>' + cfg.columns.map(c => {
      const active = sortField === c.sort;
      const dir = active && _rptState.order === 'ASC' ? ' ▲' : active ? ' ▼' : '';
      return `<th onclick="ordenarReporte('${c.sort}')" style="cursor:pointer;user-select:none;white-space:nowrap">${c.label}${dir}</th>`;
    }).join('') + '</tr>';

    // Table body
    if (!data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="' + cfg.columns.length + '" class="text-center text-muted" style="padding:32px;">Sin resultados</td></tr>';
    } else {
      tbody.innerHTML = data.rows.map(r => {
        const vals = cfg.columns.map(c => {
          let v = r[c.key];
          if (v === null || v === undefined) return '—';
          if (c.key === 'valor_credito' || c.key === 'valor_total') return '$' + Number(v).toLocaleString('es-CO', { minimumFractionDigits: 0 });
          if (c.key === 'eficiencia' || c.key === 'tasa_exito' || c.key === 'eficiencia_distancia' || c.key === 'eficiencia_tiempo' || c.key === 'eficiencia_distancia_promedio' || c.key === 'tasa_exito_promedio') return Number(v).toFixed(1) + '%';
          if (c.key === 'fecha' || c.key === 'created_at') return String(v).slice(0, 10);
          if (c.key === 'estado') return `<span class="badge badge-${v==='planificada'||v==='pendiente'?'info':v==='completada'||v==='entregado'||v==='disponible'?'success':v==='en_ejecucion'||v==='en_ruta'?'warning':'danger'}">${v}</span>`;
          if (c.key === 'capacidad_peso' || c.key === 'capacidad_peso_total') return Number(v).toLocaleString() + ' kg';
          if (c.key === 'capacidad_volumen') return Number(v).toFixed(1) + ' m³';
          return String(v);
        });
        return '<tr>' + vals.map(v => '<td>' + v + '</td>').join('') + '</tr>';
      }).join('');
    }

    // Pagination
    if (data.totalPages > 1) {
      document.getElementById('rpt-pagination').innerHTML =
        `<button class="btn btn-sm btn-secondary" onclick="cambiarPagina(-1)" ${page<=1?'disabled':''}>← Anterior</button>` +
        `<span>Página ${page} de ${data.totalPages}</span>` +
        `<button class="btn btn-sm btn-secondary" onclick="cambiarPagina(1)" ${page>=data.totalPages?'disabled':''}>Siguiente →</button>`;
    } else {
      document.getElementById('rpt-pagination').innerHTML = '';
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Error: ' + e.message + '</td></tr>';
  }
}

function renderReporteSummary(summary, tipo) {
  const cfg = RPT_CONFIG[tipo];
  const el = document.getElementById('rpt-summary');
  el.innerHTML = cfg.summaryKeys.map((k, i) => {
    let v = summary ? summary[k] : 0;
    if (v === null || v === undefined) v = 0;
    if (cfg.summaryFormat && cfg.summaryFormat[i] === 'currency') {
      v = '$' + Number(v).toLocaleString('es-CO', { minimumFractionDigits: 0 });
    } else if (cfg.summarySuffix[i] === '%') {
      v = Number(v).toFixed(1) + '%';
    } else if (cfg.summarySuffix[i] === ' kg') {
      v = Number(v).toLocaleString() + ' kg';
    } else {
      v = Number(v).toLocaleString();
    }
    return `<div class="summary-item"><div class="summary-value" style="color:${cfg.summaryColors[i]}">${v}</div><div class="summary-label">${cfg.summaryLabels[i]}</div></div>`;
  }).join('');
}

function ordenarReporte(campo) {
  if (_rptState.sort === campo) {
    _rptState.order = _rptState.order === 'ASC' ? 'DESC' : 'ASC';
  } else {
    _rptState.sort = campo;
    _rptState.order = 'DESC';
  }
  _rptState.page = 1;
  cargarReporte();
}

function cambiarPagina(dir) {
  _rptState.page = Math.max(1, _rptState.page + dir);
  cargarReporte();
}

function limpiarFiltrosReporte() {
  document.getElementById('rpt-fecha-desde').value = '';
  document.getElementById('rpt-fecha-hasta').value = '';
  document.getElementById('rpt-sede').value = '';
  document.getElementById('rpt-estado').value = '';
  document.getElementById('rpt-ciudad').value = '';
  document.getElementById('rpt-vehiculo').value = '';
  _rptState.page = 1;
  cargarReporte();
}

async function exportarReporte() {
  const { tipo } = _rptState;
  mostrarAlerta('Generando Excel...', 'info');
  try {
    const body = { tipo,
      fechaDesde: document.getElementById('rpt-fecha-desde').value,
      fechaHasta: document.getElementById('rpt-fecha-hasta').value,
      sede: document.getElementById('rpt-sede').value,
      estado: document.getElementById('rpt-estado').value,
      ciudad: document.getElementById('rpt-ciudad').value,
      vehiculoId: document.getElementById('rpt-vehiculo').value,
    };
    const headers = { 'Content-Type': 'application/json' };
    const res = await fetch(API + '/reportes/exportar', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reporte_${tipo}_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    mostrarAlerta('Excel descargado', 'success');
  } catch (e) { mostrarAlerta(e.message, 'error'); }
}

init();

