let usuario = null;
let _clientesPage = 1;
let _contactosPage = 1;
const _limit = 20;

const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';

async function cargarNombreModulo() {
  const logo = document.querySelector('.logo[data-module-id]');
  const nombreEl = logo?.querySelector('[data-module-name]');
  if (!logo || !nombreEl) return;
  try {
    const token = localStorage.getItem('launcher_jwt');
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch('/api/modulos', { credentials: 'include', headers });
    if (!res.ok) return;
    const modulos = await res.json();
    const modulo = modulos.find(m => m.id === logo.dataset.moduleId);
    if (!modulo?.nombre) return;
    nombreEl.textContent = modulo.nombre;
    document.title = modulo.nombre + ' — SynnoxERP';
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  initFramework({ basePath: BASE, apiPrefix: '/api', themeKey: 'synnox_theme', tokenKey: 'launcher_jwt' });
  cargarNombreModulo();
  init();
});

async function init() {
  try {
    const r = await apiFetch('/auth/me');
    if (!r.ok) return mostrarLogin();
    usuario = r.data || r;
    document.getElementById('user-name').textContent = usuario.nombre || usuario.email;
    document.getElementById('user-role').textContent = usuario.rol || '';
    document.getElementById('sidebar-user-name').textContent = usuario.nombre || '';
    document.getElementById('sidebar-user-role').textContent = usuario.rol || '';
    try {
      const v = await fetch(HF.API.replace('/api', '') + '/api/version');
      const vd = await v.json();
      document.getElementById('app-version').textContent = 'v' + (vd.version || '?');
    } catch {}
    navigate('dashboard');
  } catch { mostrarLogin(); }
}

async function apiFetch(path, opts = {}) {
  try {
    const r = await fetch(HF.API + path, { credentials: 'include', ...opts });
    if (r.status === 401) { mostrarLogin(); return { ok: false }; }
    const data = await r.json();
    return { ok: r.ok, data, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

function mostrarLogin() {
  window.location.href = '/';
}

function mostrarLogoutConfirm() {
  confirmModal('¿Cerrar sesion?', 'Cerrar sesion', 'info', () => {
    document.cookie.split(';').forEach(c => { document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/'); });
    localStorage.removeItem('launcher_jwt');
    window.location.href = '/';
  });
}

// ── Navigation ──
const pages = ['dashboard', 'pipeline', 'clientes', 'contactos', 'visitas'];
function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (el) el.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', pipeline: 'Pipeline', clientes: 'Clientes', contactos: 'Contactos', visitas: 'Visitas GPS' };
  document.getElementById('page-title').textContent = titles[page] || 'CRM';
  if (page === 'dashboard') cargarDashboard();
  if (page === 'pipeline') cargarPipeline();
  if (page === 'clientes') cargarClientes();
  if (page === 'contactos') cargarContactos();
  if (page === 'visitas') cargarVisitas();
}

// ── Dashboard ──
async function cargarDashboard() {
  try {
    const r = await apiFetch('/dashboard');
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.clientes_total || 0}</div><div class="stat-label">Clientes</div></div>
      <div class="stat-card"><div class="stat-value">${d.contactos_total || 0}</div><div class="stat-label">Contactos</div></div>
      <div class="stat-card"><div class="stat-value">${d.oportunidades_abiertas || 0}</div><div class="stat-label">Oportunidades abiertas</div></div>
      <div class="stat-card"><div class="stat-value">$${formatMoney(d.monto_pipeline || 0)}</div><div class="stat-label">Pipeline value</div></div>
    `;
    const recientes = d.clientes_recientes || [];
    if (recientes.length) {
      document.getElementById('clientes-recientes').innerHTML = `
        <h4 style="margin-bottom:12px">Clientes Recientes</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Tipo</th><th>Ciudad</th><th>Creado</th></tr></thead><tbody>
          ${recientes.map(e => `<tr><td>${esc(e.nombre)}</td><td><span class="badge badge-${esc(e.tipo)}">${esc(e.tipo)}</span></td><td>${esc(e.ciudad || '—')}</td><td>${formatDate(e.creado_en)}</td></tr>`).join('')}
        </tbody></table></div>
      `;
    }
  } catch (err) { console.error('Dashboard error:', err); }
}

// ── Pipeline Kanban ──
const ETAPAS = [
  { id: 'lead', label: 'Lead', color: '#6c757d' },
  { id: 'calificado', label: 'Calificado', color: '#17a2b8' },
  { id: 'propuesta', label: 'Propuesta', color: '#ffc107' },
  { id: 'negociacion', label: 'Negociacion', color: '#fd7e14' },
  { id: 'ganada', label: 'Ganada', color: '#00A86B' },
  { id: 'perdida', label: 'Perdida', color: '#dc3545' }
];

async function cargarPipeline() {
  try {
    const vendedor = document.getElementById('filtro-pipeline-vendedor')?.value || '';
    const params = new URLSearchParams();
    if (vendedor) params.set('vendedor', vendedor);
    const r = await apiFetch('/oportunidades/pipeline?' + params);
    if (!r.ok) return;
    const { pipeline, stats } = r.data;
    const kanban = document.getElementById('pipeline-kanban');
    kanban.innerHTML = ETAPAS.map(etapa => `
      <div class="kanban-col" data-etapa="${etapa.id}" ondragover="allowDrop(event)" ondrop="dropOportunidad(event, '${etapa.id}')" ondragleave="dragLeave(event)">
        <h4>
          <span>${etapa.label}</span>
          <span>
            <span class="total">$${formatMoney(stats[etapa.id]?.total || 0)}</span>
            <span class="count">${stats[etapa.id]?.count || 0}</span>
          </span>
        </h4>
        ${(pipeline[etapa.id] || []).map(o => `
          <div class="kanban-card" draggable="true" ondragstart="dragOportunidad(event, '${o.id}')" onclick="editarOportunidad('${o.id}')">
            <div class="card-title">${esc(o.nombre)}</div>
            <div class="card-cliente">${esc(o.cliente_nombre || '—')}</div>
            <div class="card-monto">$${formatMoney(o.monto_esperado || 0)}</div>
            <div class="card-meta">
              <span>${o.probabilidad || 0}%</span>
              <span>${formatDate(o.fecha_cierre_estimada)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  } catch (err) { console.error('Pipeline error:', err); }
}

function limpiarFiltrosPipeline() {
  document.getElementById('filtro-pipeline-vendedor').value = '';
  cargarPipeline();
}

function allowDrop(ev) { ev.preventDefault(); ev.currentTarget.classList.add('drag-over'); }
function dragLeave(ev) { ev.currentTarget.classList.remove('drag-over'); }
function dragOportunidad(ev, id) {
  ev.dataTransfer.setData('text/plain', id);
  ev.target.classList.add('dragging');
}
async function dropOportunidad(ev, etapa) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  const id = ev.dataTransfer.getData('text/plain');
  if (!id) return;
  const r = await apiFetch('/oportunidades/' + id + '/mover', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ etapa })
  });
  if (!r.ok) return toast('Error al mover oportunidad', 'error');
  toast('Oportunidad movida a ' + ETAPAS.find(e => e.id === etapa)?.label, 'success');
  cargarPipeline();
}

async function abrirModalOportunidad(oportunidad = null) {
  document.getElementById('modal-oportunidad-title').textContent = oportunidad ? 'Editar Oportunidad' : 'Nueva Oportunidad';
  document.getElementById('oportunidad-id').value = oportunidad?.id || '';
  document.getElementById('oportunidad-nombre').value = oportunidad?.nombre || '';
  document.getElementById('oportunidad-monto').value = oportunidad?.monto_esperado || '';
  document.getElementById('oportunidad-probabilidad').value = oportunidad?.probabilidad || 10;
  document.getElementById('oportunidad-etapa').value = oportunidad?.etapa || 'lead';
  document.getElementById('oportunidad-fecha').value = oportunidad?.fecha_cierre_estimada || '';
  document.getElementById('oportunidad-motivo-perdida').value = oportunidad?.motivo_perdida || '';
  document.getElementById('oportunidad-etapa').onchange = function() {
    document.getElementById('grupo-motivo-perdida').style.display = this.value === 'perdida' ? 'block' : 'none';
  };
  document.getElementById('grupo-motivo-perdida').style.display = (oportunidad?.etapa === 'perdida') ? 'block' : 'none';
  await cargarClientesSelect('oportunidad-cliente', oportunidad?.cliente_id);
  await cargarContactosOportunidad(oportunidad?.contacto_id);
  await cargarVendedoresSelect('oportunidad-vendedor', oportunidad?.vendedor_id);
  abrirModal('modal-oportunidad');
}

async function editarOportunidad(id) {
  const r = await apiFetch('/oportunidades/' + id);
  if (!r.ok) return;
  abrirModalOportunidad(r.data.data);
}

async function guardarOportunidad() {
  const id = document.getElementById('oportunidad-id').value;
  const body = {
    nombre: document.getElementById('oportunidad-nombre').value,
    cliente_id: document.getElementById('oportunidad-cliente').value,
    contacto_id: document.getElementById('oportunidad-contacto').value || null,
    monto_esperado: parseFloat(document.getElementById('oportunidad-monto').value) || 0,
    probabilidad: parseInt(document.getElementById('oportunidad-probabilidad').value) || 0,
    etapa: document.getElementById('oportunidad-etapa').value,
    fecha_cierre_estimada: document.getElementById('oportunidad-fecha').value || null,
    vendedor_id: document.getElementById('oportunidad-vendedor').value || usuario?.id,
    motivo_perdida: document.getElementById('oportunidad-etapa').value === 'perdida' ? (document.getElementById('oportunidad-motivo-perdida').value || null) : null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if (!body.cliente_id) return toast('Seleccione un cliente', 'error');
  const r = id
    ? await apiFetch('/oportunidades/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/oportunidades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Oportunidad actualizada' : 'Oportunidad creada', 'success');
  cerrarModal('modal-oportunidad');
  cargarPipeline();
}

async function cargarContactosOportunidad(selectedId) {
  const clienteId = document.getElementById('oportunidad-cliente')?.value;
  const sel = document.getElementById('oportunidad-contacto');
  sel.innerHTML = '<option value="">Sin contacto</option>';
  if (!clienteId) return;
  const r = await apiFetch('/contactos?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  for (const c of r.data.data || []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre;
    if (selectedId && c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function cargarVendedoresSelect(selectId, selectedId) {
  const r = await apiFetch('/auth/me');
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">Sin asignar</option>';
  // TODO: endpoint para listar usuarios del launcher
  if (usuario) {
    const opt = document.createElement('option');
    opt.value = usuario.id;
    opt.textContent = usuario.nombre + ' (' + (usuario.email || '') + ')';
    if (selectedId == usuario.id || !selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
}

function formatMoney(n) {
  return Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
async function cargarClientes() {
  const search = document.getElementById('filtro-cliente-search').value;
  const tipo = document.getElementById('filtro-cliente-tipo').value;
  const params = new URLSearchParams({ page: _clientesPage, limit: _limit });
  if (search) params.set('search', search);
  if (tipo) params.set('tipo', tipo);
  const r = await apiFetch('/clientes?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-clientes');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(e => `
    <tr>
      <td><input type="checkbox" class="select-cliente" value="${e.id}"></td>
      <td><a href="#" onclick="verCliente('${e.id}');return false" style="color:var(--accent)">${esc(e.nombre)}</a></td>
      <td>${esc(e.nit || '—')}</td>
      <td><span class="badge badge-${esc(e.tipo)}">${esc(e.tipo)}</span></td>
      <td>${esc(e.ciudad || '—')}</td>
      <td>${e.total_contactos || 0}</td>
      <td>${formatDate(e.creado_en)}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editarCliente('${e.id}')" title="Editar">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarCliente('${e.id}')" title="Eliminar">🗑️</button>
      </td>
    </tr>
  `).join('');
  renderPagination('pag-clientes', r.data.total, _clientesPage, _limit, (p) => { _clientesPage = p; cargarClientes(); });
  // Cargar ciudades para filtro
  const ciudades = [...new Set(data.map(e => e.ciudad).filter(Boolean))];
  const sel = document.getElementById('filtro-cliente-ciudad');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todas las ciudades</option>' + ciudades.map(c => `<option value="${esc(c)}" ${c === actual ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function limpiarFiltrosClientes() {
  document.getElementById('filtro-cliente-search').value = '';
  document.getElementById('filtro-cliente-tipo').value = '';
  document.getElementById('filtro-cliente-ciudad').value = '';
  _clientesPage = 1;
  cargarClientes();
}

async function verCliente(id) {
  const r = await apiFetch('/clientes/' + id);
  if (!r.ok) return;
  const e = r.data.data;
  const contactos = e.contactos || [];
  document.getElementById('detalle-cliente-title').textContent = e.nombre;
  document.getElementById('detalle-cliente-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div><strong>NIT:</strong> ${esc(e.nit || '—')}</div>
      <div><strong>Tipo:</strong> <span class="badge badge-${esc(e.tipo)}">${esc(e.tipo)}</span></div>
      <div><strong>Sector:</strong> ${esc(e.sector || '—')}</div>
      <div><strong>Ciudad:</strong> ${esc(e.ciudad || '—')}</div>
      <div><strong>Direccion:</strong> ${esc(e.direccion || '—')}</div>
      <div><strong>Telefono:</strong> ${esc(e.telefono || '—')}</div>
      <div><strong>Email:</strong> ${esc(e.email || '—')}</div>
      <div><strong>Website:</strong> ${esc(e.website || '—')}</div>
    </div>
    ${e.notas ? `<div style="margin-bottom:16px"><strong>Notas:</strong><br>${esc(e.notas)}</div>` : ''}
    <h4>Contactos (${contactos.length})</h4>
    ${contactos.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Cargo</th><th>Email</th><th>Telefono</th></tr></thead><tbody>
      ${contactos.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.cargo || '—')}</td><td>${esc(c.email || '—')}</td><td>${esc(c.telefono || '—')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p style="color:var(--muted)">Sin contactos registrados</p>'}
  `;
  abrirModal('modal-detalle-cliente');
}

function abrirModalCliente(cliente = null) {
  document.getElementById('modal-cliente-title').textContent = cliente ? 'Editar Cliente' : 'Nueva Cliente';
  document.getElementById('cliente-id').value = cliente?.id || '';
  document.getElementById('cliente-nombre').value = cliente?.nombre || '';
  document.getElementById('cliente-nit').value = cliente?.nit || '';
  document.getElementById('cliente-tipo').value = cliente?.tipo || 'potencial';
  document.getElementById('cliente-sector').value = cliente?.sector || '';
  document.getElementById('cliente-direccion').value = cliente?.direccion || '';
  document.getElementById('cliente-ciudad').value = cliente?.ciudad || '';
  document.getElementById('cliente-telefono').value = cliente?.telefono || '';
  document.getElementById('cliente-email').value = cliente?.email || '';
  document.getElementById('cliente-website').value = cliente?.website || '';
  document.getElementById('cliente-notas').value = cliente?.notas || '';
  abrirModal('modal-cliente');
}

async function editarCliente(id) {
  const r = await apiFetch('/clientes/' + id);
  if (!r.ok) return;
  abrirModalCliente(r.data.data);
}

async function guardarCliente() {
  const id = document.getElementById('cliente-id').value;
  const body = {
    nombre: document.getElementById('cliente-nombre').value,
    nit: document.getElementById('cliente-nit').value || null,
    tipo: document.getElementById('cliente-tipo').value,
    sector: document.getElementById('cliente-sector').value || null,
    direccion: document.getElementById('cliente-direccion').value || null,
    ciudad: document.getElementById('cliente-ciudad').value || null,
    telefono: document.getElementById('cliente-telefono').value || null,
    email: document.getElementById('cliente-email').value || null,
    website: document.getElementById('cliente-website').value || null,
    notas: document.getElementById('cliente-notas').value || null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  const r = id
    ? await apiFetch('/clientes/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Cliente actualizada' : 'Cliente creada', 'success');
  cerrarModal('modal-cliente');
  cargarClientes();
}

async function eliminarCliente(id) {
  confirmModal('¿Eliminar esta cliente?', 'Eliminar', 'delete', async () => {
    const r = await apiFetch('/clientes/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Cliente eliminada', 'success');
    cargarClientes();
  });
}

// ── Contactos ──
async function cargarContactos() {
  const search = document.getElementById('filtro-contacto-search').value;
  const clienteId = document.getElementById('filtro-contacto-cliente').value;
  const params = new URLSearchParams({ page: _contactosPage, limit: _limit });
  if (search) params.set('search', search);
  if (clienteId) params.set('cliente_id', clienteId);
  const r = await apiFetch('/contactos?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-contactos');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(c => `
    <tr>
      <td><input type="checkbox" class="select-contacto" value="${c.id}"></td>
      <td>${esc(c.nombre)}</td>
      <td>${esc(c.cliente_nombre || '—')}</td>
      <td>${esc(c.cargo || '—')}</td>
      <td>${esc(c.email || '—')}</td>
      <td>${esc(c.telefono || '—')}</td>
      <td>${c.es_decision_maker ? '✅' : '—'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editarContacto('${c.id}')" title="Editar">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarContacto('${c.id}')" title="Eliminar">🗑️</button>
      </td>
    </tr>
  `).join('');
  renderPagination('pag-contactos', r.data.total, _contactosPage, _limit, (p) => { _contactosPage = p; cargarContactos(); });
  // Cargar clientes en select de filtro
  await cargarClientesSelect('filtro-contacto-cliente', clienteId);
}

function limpiarFiltrosContactos() {
  document.getElementById('filtro-contacto-search').value = '';
  document.getElementById('filtro-contacto-cliente').value = '';
  _contactosPage = 1;
  cargarContactos();
}

async function cargarClientesSelect(selectId, selectedId) {
  const r = await apiFetch('/clientes?limit=500');
  if (!r.ok) return;
  const sel = document.getElementById(selectId);
  const actual = selectedId || sel.value;
  sel.innerHTML = '<option value="">Todas las clientes</option>' +
    (r.data.data || []).map(e => `<option value="${e.id}" ${e.id === actual ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('');
}

async function abrirModalContacto(contacto = null) {
  document.getElementById('modal-contacto-title').textContent = contacto ? 'Editar Contacto' : 'Nuevo Contacto';
  document.getElementById('contacto-id').value = contacto?.id || '';
  document.getElementById('contacto-nombre').value = contacto?.nombre || '';
  document.getElementById('contacto-cargo').value = contacto?.cargo || '';
  document.getElementById('contacto-email').value = contacto?.email || '';
  document.getElementById('contacto-telefono').value = contacto?.telefono || '';
  document.getElementById('contacto-whatsapp').value = contacto?.whatsapp || '';
  document.getElementById('contacto-decision').value = contacto?.es_decision_maker ? 'true' : 'false';
  document.getElementById('contacto-notas').value = contacto?.notas || '';
  await cargarClientesSelect('contacto-cliente', contacto?.cliente_id);
  abrirModal('modal-contacto');
}

async function editarContacto(id) {
  const r = await apiFetch('/contactos/' + id);
  if (!r.ok) return;
  abrirModalContacto(r.data.data);
}

async function guardarContacto() {
  const id = document.getElementById('contacto-id').value;
  const body = {
    cliente_id: document.getElementById('contacto-cliente').value,
    nombre: document.getElementById('contacto-nombre').value,
    cargo: document.getElementById('contacto-cargo').value || null,
    email: document.getElementById('contacto-email').value || null,
    telefono: document.getElementById('contacto-telefono').value || null,
    whatsapp: document.getElementById('contacto-whatsapp').value || null,
    es_decision_maker: document.getElementById('contacto-decision').value === 'true',
    notas: document.getElementById('contacto-notas').value || null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if (!body.cliente_id) return toast('Seleccione un cliente', 'error');
  const r = id
    ? await apiFetch('/contactos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/contactos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Contacto actualizado' : 'Contacto creado', 'success');
  cerrarModal('modal-contacto');
  cargarContactos();
}

async function eliminarContacto(id) {
  confirmModal('¿Eliminar este contacto?', 'Eliminar', 'delete', async () => {
    const r = await apiFetch('/contactos/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Contacto eliminado', 'success');
    cargarContactos();
  });
}

// ── Visitas GPS ──
async function cargarVisitas() {
  const vendedor = document.getElementById('filtro-visitas-vendedor')?.value || '';
  const desde = document.getElementById('filtro-visitas-desde')?.value || '';
  const hasta = document.getElementById('filtro-visitas-hasta')?.value || '';
  const params = new URLSearchParams({ limit: 100 });
  if (vendedor) params.set('vendedor', vendedor);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const r = await apiFetch('/visitas?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-visitas');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(v => `
    <tr>
      <td><span class="badge badge-${v.tipo}">${v.tipo}</span></td>
      <td>${esc(v.cliente_nombre || '—')}</td>
      <td>#${v.vendedor_id}</td>
      <td>${formatDateTime(v.fecha)}</td>
      <td><a href="https://www.google.com/maps?q=${v.latitud},${v.longitud}" target="_blank" rel="noopener">${v.latitud?.toFixed(4)}, ${v.longitud?.toFixed(4)}</a></td>
      <td>${v.evidencia_foto ? `<a href="${v.evidencia_foto}" target="_blank" rel="noopener">📷</a>` : '—'}</td>
      <td>${esc(v.notas || '—')}</td>
    </tr>
  `).join('');

  // Resumen simple
  const checkins = data.filter(v => v.tipo === 'checkin').length;
  const checkouts = data.filter(v => v.tipo === 'checkout').length;
  document.getElementById('visitas-resumen').innerHTML = `
    <div class="stats-row" style="margin-bottom:0">
      <div class="stat-card"><div class="stat-value">${checkins}</div><div class="stat-label">Check-ins</div></div>
      <div class="stat-card"><div class="stat-value">${checkouts}</div><div class="stat-label">Check-outs</div></div>
      <div class="stat-card"><div class="stat-value">${data.length}</div><div class="stat-label">Total</div></div>
    </div>
  `;
}

function limpiarFiltrosVisitas() {
  document.getElementById('filtro-visitas-vendedor').value = '';
  document.getElementById('filtro-visitas-desde').value = '';
  document.getElementById('filtro-visitas-hasta').value = '';
  cargarVisitas();
}

async function abrirModalVisita(tipo) {
  document.getElementById('modal-visita-title').textContent = tipo === 'checkin' ? 'Check-in' : 'Check-out';
  document.getElementById('visita-tipo').value = tipo;
  document.getElementById('visita-coords').value = 'Obteniendo GPS...';
  document.getElementById('visita-notas').value = '';
  document.getElementById('visita-foto').value = '';
  document.getElementById('btn-guardar-visita').disabled = true;
  document.getElementById('btn-guardar-visita').textContent = 'Obteniendo GPS...';
  await cargarClientesSelect('visita-cliente', '');
  document.getElementById('visita-cliente').onchange = () => {
    cargarContactosVisita();
    cargarOportunidadesVisita();
  };
  await cargarContactosVisita();
  await cargarOportunidadesVisita();
  abrirModal('modal-visita');
  obtenerGPSVisita();
}

async function cargarContactosVisita() {
  const clienteId = document.getElementById('visita-cliente')?.value;
  const sel = document.getElementById('visita-contacto');
  sel.innerHTML = '<option value="">Sin contacto</option>';
  if (!clienteId) return;
  const r = await apiFetch('/contactos?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  for (const c of r.data.data || []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre;
    sel.appendChild(opt);
  }
}

async function cargarOportunidadesVisita() {
  const clienteId = document.getElementById('visita-cliente')?.value;
  const sel = document.getElementById('visita-oportunidad');
  sel.innerHTML = '<option value="">Sin oportunidad</option>';
  if (!clienteId) return;
  const r = await apiFetch('/oportunidades?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  for (const o of r.data.data || []) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.nombre;
    sel.appendChild(opt);
  }
}

function obtenerGPSVisita() {
  if (!navigator.geolocation) {
    document.getElementById('visita-coords').value = 'GPS no disponible';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coords = `${pos.coords.latitude},${pos.coords.longitude}`;
      document.getElementById('visita-coords').value = coords;
      document.getElementById('visita-coords').dataset.precision = pos.coords.accuracy;
      document.getElementById('btn-guardar-visita').disabled = false;
      document.getElementById('btn-guardar-visita').textContent = 'Guardar';
    },
    (err) => {
      document.getElementById('visita-coords').value = 'Error GPS: ' + err.message;
      document.getElementById('btn-guardar-visita').disabled = false;
      document.getElementById('btn-guardar-visita').textContent = 'Reintentar GPS';
      document.getElementById('btn-guardar-visita').onclick = () => { obtenerGPSVisita(); };
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

async function guardarVisita() {
  const tipo = document.getElementById('visita-tipo').value;
  const coords = document.getElementById('visita-coords').value;
  if (!coords || coords.includes('Obteniendo') || coords.includes('Error')) {
    return toast('Espera a obtener el GPS', 'warning');
  }
  const [lat, lng] = coords.split(',');
  const clienteId = document.getElementById('visita-cliente').value;
  if (!clienteId) return toast('Selecciona un cliente', 'error');

  const formData = new FormData();
  formData.append('tipo', tipo);
  formData.append('cliente_id', clienteId);
  formData.append('contacto_id', document.getElementById('visita-contacto').value);
  formData.append('oportunidad_id', document.getElementById('visita-oportunidad').value);
  formData.append('latitud', lat.trim());
  formData.append('longitud', lng.trim());
  formData.append('precision_gps', document.getElementById('visita-coords').dataset.precision || '');
  formData.append('notas', document.getElementById('visita-notas').value);
  const foto = document.getElementById('visita-foto').files[0];
  if (foto) formData.append('foto', foto);

  const r = await fetch(HF.API + '/visitas/' + tipo, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  const data = await r.json();
  if (!r.ok) return toast(data.error || 'Error al guardar', 'error');
  toast(tipo === 'checkin' ? 'Check-in registrado' : 'Check-out registrado', 'success');
  cerrarModal('modal-visita');
  cargarVisitas();
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Utils ──
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); }
function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('active'); }

function renderPagination(containerId, total, page, limit, onPage) {
  const container = document.getElementById(containerId);
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:16px">
      <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="event.preventDefault()">Anterior</button>
      <span style="font-size:12px;color:var(--muted)">Pagina ${page} de ${totalPages} (${total} total)</span>
      <button class="btn btn-sm btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="event.preventDefault()">Siguiente</button>
    </div>
  `;
  const btns = container.querySelectorAll('button');
  btns[0].onclick = () => { onPage(page - 1); };
  btns[1].onclick = () => { onPage(page + 1); };
}

function toggleSelectAll(checkbox, tipo) {
  document.querySelectorAll(`.select-${tipo}`).forEach(cb => { cb.checked = checkbox.checked; });
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.querySelector('.sidebar-overlay').classList.toggle('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.querySelector('.sidebar-overlay').classList.remove('open'); }
function toggleSidebarCollapse() { document.getElementById('sidebar').classList.toggle('collapsed'); }
