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
  confirmar({ titulo: 'Cerrar sesion', mensaje: '¿Cerrar sesion?', icono: '⏻', onConfirm: () => {
    document.cookie.split(';').forEach(c => { document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/'); });
    localStorage.removeItem('launcher_jwt');
    window.location.href = '/';
  }});
}

// ── Navigation ──
const pages = ['dashboard', 'pipeline', 'clientes', 'contactos', 'visitas', 'cotizaciones', 'productos', 'importar', 'descuentos'];
function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (el) el.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', pipeline: 'Pipeline', clientes: 'Clientes', contactos: 'Contactos', visitas: 'Visitas', cotizaciones: 'Cotizaciones', productos: 'Productos', importar: 'Importar SIESA', descuentos: 'Descuentos' };
  document.getElementById('page-title').textContent = titles[page] || 'CRM';
  if (page === 'dashboard') cargarDashboard();
  if (page === 'pipeline') cargarPipeline();
  if (page === 'clientes') cargarClientes();
  if (page === 'contactos') cargarContactos();
  if (page === 'visitas') cargarVisitas();
  if (page === 'cotizaciones') cargarCotizaciones();
  if (page === 'productos') cargarProductos();
  if (page === 'importar') cargarPaginaImportar();
  if (page === 'descuentos') cargarDescuentos();
}

// ── Dashboard ──
async function cargarDashboard() {
  try {
    const r = await apiFetch('/dashboard');
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.clientes_total || 0}</div><div class="stat-label">Clientes</div></div>
      <div class="stat-card"><div class="stat-value">${d.oportunidades_abiertas || 0}</div><div class="stat-label">Oportunidades</div></div>
      <div class="stat-card"><div class="stat-value">$${formatMoney(d.monto_pipeline || 0)}</div><div class="stat-label">Pipeline</div></div>
      <div class="stat-card"><div class="stat-value">${d.cotizaciones_pendientes || 0}</div><div class="stat-label">Cotiz. pendientes</div></div>
      <div class="stat-card"><div class="stat-value">${d.descuentos_pendientes || 0}</div><div class="stat-label">Desc. pendientes</div></div>
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
  document.getElementById('btn-eliminar-oportunidad').style.display = oportunidad?.id ? '' : 'none';
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
  showModal('modal-oportunidad');
}

async function editarOportunidad(id) {
  const r = await apiFetch('/oportunidades/' + id);
  if (!r.ok) return;
  abrirModalOportunidad(r.data.data);
}

async function eliminarOportunidad(id, nombre) {
  confirmar({ titulo: 'Eliminar oportunidad', mensaje: `Eliminar la oportunidad "${nombre}"?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/oportunidades/' + id, { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast('Oportunidad eliminada', 'success');
    cargarPipeline();
  }});
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
  hideModal('modal-oportunidad');
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
      <td><input type="checkbox" class="row-check cb-cliente" value="${e.id}" onchange="updateBulkBar()"></td>
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
  showModal('modal-detalle-cliente');
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
  showModal('modal-cliente');
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
  hideModal('modal-cliente');
  cargarClientes();
}

async function eliminarCliente(id) {
  confirmar({ titulo: 'Eliminar', mensaje: '¿Eliminar esta cliente?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/clientes/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Cliente eliminada', 'success');
    cargarClientes();
  }});
}

async function bulkDeleteClientes() {
  const ids = [...document.querySelectorAll('.cb-cliente:checked')].map(cb => cb.value);
  if (!ids.length) return toast('Selecciona al menos un cliente', 'error');
  confirmar({ titulo: 'Eliminar clientes', mensaje: `¿Eliminar ${ids.length} cliente(s) seleccionados?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/clientes/seleccionados', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminadas} clientes eliminados`, 'success');
    clearSelection();
    cargarClientes();
  }});
}

async function eliminarTodosClientes() {
  confirmar({ titulo: '⚠️ ELIMINAR TODOS', mensaje: '¿Estás seguro? Esto desactivará TODOS los clientes. Solo para testing.', icono: '⚠️', onConfirm: async () => {
    const r = await apiFetch('/clientes/todos', { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} clientes eliminados`, 'success');
    cargarClientes();
  }});
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
  showModal('modal-contacto');
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
  hideModal('modal-contacto');
  cargarContactos();
}

async function eliminarContacto(id) {
  confirmar({ titulo: 'Eliminar', mensaje: '¿Eliminar este contacto?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/contactos/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Contacto eliminado', 'success');
    cargarContactos();
  }});
}

// ── Visitas ──
function agruparVisitas(data) {
  const sorted = [...data].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const pares = [];
  const sinPar = [];

  const checkinsPendientes = {};
  for (const v of sorted) {
    const key = `${v.cliente_id || ''}_${v.vendedor_id}`;
    if (v.tipo === 'checkin') {
      checkinsPendientes[key] = v;
    } else if (v.tipo === 'checkout') {
      const checkin = checkinsPendientes[key];
      if (checkin) {
        delete checkinsPendientes[key];
        const inicio = new Date(checkin.fecha);
        const fin = new Date(v.fecha);
        const diffMs = fin - inicio;
        const horas = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        const duracion = horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;
        pares.push({ ...checkin, checkout: v, duracion, duracionMs: diffMs });
      } else {
        sinPar.push({ ...v, checkout: null, duracion: '—', duracionMs: 0 });
      }
    }
  }
  for (const [key, checkin] of Object.entries(checkinsPendientes)) {
    sinPar.push({ ...checkin, checkout: null, duracion: 'En curso', duracionMs: 0 });
  }
  return { pares, sinPar };
}

async function cargarVisitas() {
  const vendedor = document.getElementById('filtro-visitas-vendedor')?.value || '';
  const desde = document.getElementById('filtro-visitas-desde')?.value || '';
  const hasta = document.getElementById('filtro-visitas-hasta')?.value || '';
  const params = new URLSearchParams({ limit: 200 });
  if (vendedor) params.set('vendedor', vendedor);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const r = await apiFetch('/visitas?' + params);
  if (!r.ok) return;
  const data = r.data.data || [];
  const { pares, sinPar } = agruparVisitas(data);

  // Stats
  const duracionTotal = pares.reduce((s, p) => s + p.duracionMs, 0);
  const horasTotal = Math.floor(duracionTotal / 3600000);
  const minsTotal = Math.floor((duracionTotal % 3600000) / 60000);
  const duracionProm = pares.length ? duracionTotal / pares.length : 0;
  const promH = Math.floor(duracionProm / 3600000);
  const promM = Math.floor((duracionProm % 3600000) / 60000);
  const clientesUnicos = new Set(pares.map(p => p.cliente_id).filter(Boolean)).size;

  document.getElementById('visitas-resumen').innerHTML = `
    <div class="stats-row" style="margin-bottom:0">
      <div class="stat-card"><div class="stat-value">${pares.length}</div><div class="stat-label">Visitas</div></div>
      <div class="stat-card"><div class="stat-value">${sinPar.length ? sinPar.filter(v => v.tipo === 'checkin').length : 0}</div><div class="stat-label">En curso</div></div>
      <div class="stat-card"><div class="stat-value">${clientesUnicos}</div><div class="stat-label">Clientes visitados</div></div>
      <div class="stat-card"><div class="stat-value">${horasTotal}h ${minsTotal}m</div><div class="stat-label">Tiempo total</div></div>
      <div class="stat-card"><div class="stat-value">${promH}h ${promM}m</div><div class="stat-label">Promedio por visita</div></div>
    </div>
  `;

  // Agrupar pares por cliente
  const todos = [...pares, ...sinPar];
  const grupos = {};
  for (const v of todos) {
    const key = v.cliente_nombre || 'Sin cliente';
    if (!grupos[key]) grupos[key] = { cliente_id: v.cliente_id, cliente_nombre: v.cliente_nombre, visitas: [] };
    grupos[key].visitas.push(v);
  }

  const container = document.getElementById('visitas-agrupadas');
  const sorted = Object.values(grupos).sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre));

  if (!sorted.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No hay visitas para los filtros seleccionados.</p>';
    return;
  }

  container.innerHTML = sorted.map((g, gi) => {
    const totalVisitas = g.visitas.length;
    return `
      <div class="visita-grupo">
        <div class="visita-grupo-header" onclick="toggleGrupoVisitas(${gi})">
          <span class="visita-grupo-icon" id="visita-icon-${gi}">▶</span>
          <strong>${esc(g.cliente_nombre)}</strong>
          <span style="color:var(--muted);margin-left:8px;font-size:12px">${totalVisitas} visita(s)</span>
        </div>
        <div class="visita-grupo-body" id="visita-body-${gi}" style="display:none">
          <table class="tbl"><thead><tr>
            <th>Llegada</th><th>Salida</th><th>Duracion</th><th>Ubicacion</th><th>Foto</th><th>Notas</th>
          </tr></thead><tbody>
            ${g.visitas.map(v => `
              <tr style="cursor:pointer" onclick="verDetalleVisita(${JSON.stringify({ ...v, checkout: v.checkout || null }).replace(/"/g, '&quot;')})">
                <td>${formatDateTime(v.fecha)}</td>
                <td>${v.checkout ? formatDateTime(v.checkout.fecha) : '<span style="color:var(--warning)">En curso</span>'}</td>
                <td><strong>${v.duracion}</strong></td>
                <td>${v.latitud ? `<a href="https://www.google.com/maps?q=${v.latitud},${v.longitud}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📍 Maps</a>` : '—'}</td>
                <td>${v.evidencia_foto ? `<a href="${v.evidencia_foto}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📷</a>` : '—'}</td>
                <td>${esc(v.notas || '—')}</td>
              </tr>
            `).join('')}
          </tbody></table>
        </div>
      </div>
    `;
  }).join('');
}

function toggleGrupoVisitas(idx) {
  const body = document.getElementById('visita-body-' + idx);
  const icon = document.getElementById('visita-icon-' + idx);
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : '';
  icon.textContent = visible ? '▶' : '▼';
}

function verDetalleVisita(v) {
  const lat = v.latitud ? parseFloat(v.latitud) : null;
  const lng = v.longitud ? parseFloat(v.longitud) : null;
  const hasCoords = lat && lng;

  document.getElementById('detalle-visita-title').textContent = `Visita — ${esc(v.cliente_nombre || '')}`;
  document.getElementById('detalle-visita-content').innerHTML = `
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Cliente:</strong> ${esc(v.cliente_nombre || '—')}</div>
      <div><strong>Contacto:</strong> ${esc(v.contacto_nombre || '—')}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Llegada:</strong> ${formatDateTime(v.fecha)}</div>
      <div><strong>Salida:</strong> ${v.checkout ? formatDateTime(v.checkout.fecha) : '<span style="color:var(--warning)">En curso</span>'}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Duracion:</strong> <span style="font-size:16px;font-weight:700;color:var(--accent)">${v.duracion || '—'}</span></div>
      <div><strong>Vendedor:</strong> ${esc(v.vendedor_nombre || '#' + v.vendedor_id)}</div>
    </div>
    ${hasCoords ? `
      <div style="margin-bottom:12px">
        <strong>Ubicacion:</strong>
        <div id="visita-map" style="height:250px;border-radius:8px;border:1px solid var(--border);margin-top:6px"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">
          ${lat.toFixed(6)}, ${lng.toFixed(6)} ·
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" style="color:var(--accent)">Abrir en Google Maps</a>
        </div>
      </div>
    ` : ''}
    ${v.evidencia_foto ? `
      <div style="margin-bottom:12px"><strong>Evidencia:</strong><br>
        <a href="${v.evidencia_foto}" target="_blank" rel="noopener"><img src="${v.evidencia_foto}" style="max-width:100%;max-height:300px;border-radius:8px;margin-top:8px;border:1px solid var(--border)"></a>
      </div>
    ` : ''}
    ${v.notas ? `<div style="margin-bottom:12px"><strong>Notas:</strong><br>${esc(v.notas)}</div>` : ''}
  `;
  showModal('modal-detalle-visita');

  if (hasCoords) {
    setTimeout(() => {
      const mapEl = document.getElementById('visita-map');
      if (!mapEl || mapEl._leaflet_id) return;
      const map = L.map(mapEl, { zoomControl: true }).setView([lat, lng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
      }).addTo(map);
      const marker = L.marker([lat, lng]).addTo(map);
      marker.bindPopup(`<strong>${esc(v.cliente_nombre || 'Visita')}</strong><br>${formatDateTime(v.fecha)}`).openPopup();
      setTimeout(() => map.invalidateSize(), 200);
    }, 150);
  }
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
  showModal('modal-visita');
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
  hideModal('modal-visita');
  cargarVisitas();
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Cotizaciones ──
let _cotizacionesPage = 1;
let _cotizacionItems = [];

async function cargarCotizaciones() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-cotizacion-search')?.value;
    const estado = document.getElementById('filtro-cotizacion-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);
    params.set('page', _cotizacionesPage);
    params.set('limit', _limit);

    const r = await apiFetch('/cotizaciones?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-cotizaciones');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(c => `
      <tr>
        <td><a href="#" onclick="verCotizacion('${c.id}');return false" style="color:var(--accent);text-decoration:underline">${esc(c.numero)}</a></td>
        <td>${esc(c.cliente_nombre || '—')}</td>
        <td><span class="badge badge-${c.estado}">${esc(c.estado)}</span></td>
        <td>${c.total_items || 0}</td>
        <td>$${formatMoney(c.valor_subtotal || 0)}</td>
        <td>$${formatMoney(c.valor_descuento || 0)}</td>
        <td>$${formatMoney(c.valor_iva || 0)}</td>
        <td><strong>$${formatMoney(c.valor_total || 0)}</strong></td>
        <td>${formatDate(c.vencimiento)}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarCotizacion('${c.id}')">Editar</button>
          ${c.estado === 'borrador' ? `<button class="btn btn-sm btn-danger" onclick="eliminarCotizacion('${c.id}')">Eliminar</button>` : ''}
          ${c.estado === 'borrador' ? `<button class="btn btn-sm btn-primary" onclick="cambiarEstadoCotizacion('${c.id}','enviada')">Enviar</button>` : ''}
          ${c.estado === 'enviada' ? `<button class="btn btn-sm btn-primary" onclick="cambiarEstadoCotizacion('${c.id}','aprobada')">Aprobar</button>` : ''}
        </td>
      </tr>
    `).join('');

    renderPagination('pag-cotizaciones', r.data.total, _cotizacionesPage, _limit, (p) => { _cotizacionesPage = p; cargarCotizaciones(); });
    cargarStatsCotizaciones();
  } catch (err) { console.error('Error cargar cotizaciones:', err); }
}

async function cargarStatsCotizaciones() {
  try {
    const r = await apiFetch('/cotizaciones/stats');
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-cotizaciones').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value">$${formatMoney(d.monto_total || 0)}</div><div class="stat-label">Monto total</div></div>
      <div class="stat-card"><div class="stat-value">${d.descuentos_pendientes || 0}</div><div class="stat-label">Desc. pendientes</div></div>
    `;
  } catch {}
}

function limpiarFiltrosCotizaciones() {
  document.getElementById('filtro-cotizacion-search').value = '';
  document.getElementById('filtro-cotizacion-estado').value = '';
  _cotizacionesPage = 1;
  cargarCotizaciones();
}

async function abrirModalCotizacion(cotizacion = null) {
  document.getElementById('modal-cotizacion-title').textContent = cotizacion ? 'Editar Cotizacion' : 'Nueva Cotizacion';
  document.getElementById('cotizacion-id').value = cotizacion?.id || '';
  document.getElementById('cotizacion-validez').value = cotizacion?.validez_dias || 30;
  document.getElementById('cotizacion-descuento').value = 0;
  document.getElementById('cotizacion-notas').value = cotizacion?.notas || '';
  document.getElementById('cotizacion-orden-compra').value = cotizacion?.orden_compra || '';
  document.getElementById('cotizacion-centro-op').value = cotizacion?.centro_operacion || '';
  document.getElementById('cotizacion-bodega').value = cotizacion?.bodega || '';
  document.getElementById('cotizacion-condicion-pago').value = cotizacion?.condicion_pago || '';
  document.getElementById('cotizacion-fecha-entrega').value = cotizacion?.fecha_entrega ? cotizacion.fecha_entrega.split('T')[0] : '';

  await cargarClientesSelect('cotizacion-cliente', cotizacion?.cliente_id);
  await cargarOportunidadesSelect('cotizacion-oportunidad', cotizacion?.oportunidad_id);

  _cotizacionItems = [];
  if (cotizacion?.id) {
    const r = await apiFetch('/cotizaciones/' + cotizacion.id);
    if (r.ok) {
      _cotizacionItems = r.data.data.items || [];
      document.getElementById('cotizacion-descuento').value = r.data.data.valor_descuento > 0 ? ((r.data.data.valor_descuento / r.data.data.valor_subtotal) * 100).toFixed(2) : 0;
    }
  }
  renderItemsCotizacion();
  cambiarTabCotizacion('datos', document.querySelector('#modal-cotizacion .tab-btn'));
  showModal('modal-cotizacion');
}

function cambiarTabCotizacion(tab, btn) {
  document.querySelectorAll('#modal-cotizacion [id^="tab-cotizacion-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#modal-cotizacion .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-cotizacion-' + tab).style.display = '';
  if (btn) btn.classList.add('active');
}

let _buscarProductoTimer = null;
async function buscarProductosCatalogo() {
  clearTimeout(_buscarProductoTimer);
  _buscarProductoTimer = setTimeout(async () => {
    const q = document.getElementById('buscar-producto-input')?.value;
    if (!q || q.length < 2) { document.getElementById('catalogo-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">Escribe al menos 2 caracteres para buscar.</p>'; return; }
    const r = await apiFetch('/productos/buscar?q=' + encodeURIComponent(q));
    if (!r.ok) return;
    const data = r.data.data || [];
    if (!data.length) { document.getElementById('catalogo-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">No se encontraron productos.</p>'; return; }
    document.getElementById('catalogo-resultados').innerHTML = data.map(p => `
      <div class="catalogo-item" onclick="agregarProductoAlCarrito(${JSON.stringify(p).replace(/"/g, '&quot;')})">
        <span class="prod-codigo">${esc(p.codigo)}</span>
        <span class="prod-nombre">${esc(p.nombre)}</span>
        <span style="color:var(--muted);font-size:11px">${esc(p.unidad_medida || 'UND')}</span>
        <span class="prod-precio">$${formatMoney(p.precio_unitario || 0)}</span>
      </div>
    `).join('');
  }, 300);
}

function agregarProductoAlCarrito(producto) {
  _cotizacionItems.push({
    descripcion: producto.nombre,
    referencia: producto.codigo,
    unidad_medida: producto.unidad_medida || 'UND',
    cantidad: 1,
    precio_unitario: producto.precio_unitario || 0,
    descuento_pct: 0
  });
  renderItemsCotizacion();
  toast('Producto agregado al carrito', 'success');
  cambiarTabCotizacion('carrito', document.querySelectorAll('#modal-cotizacion .tab-btn')[2]);
}

function renderItemsCotizacion() {
  const container = document.getElementById('cotizacion-items-list');
  if (!_cotizacionItems.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:12px">Sin items. Busca en el catalogo o agrega manualmente.</p>';
  } else {
    container.innerHTML = `
      <div class="item-row" style="grid-template-columns:60px 1fr 50px 80px 60px 80px 30px;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">
        <div>Ref</div><div>Descripcion</div><div>U.M</div><div>Cant.</div><div>Desc%</div><div>Subtotal</div><div></div>
      </div>
    ` + _cotizacionItems.map((it, i) => {
      const sub = (it.cantidad || 1) * (it.precio_unitario || 0) * (1 - (it.descuento_pct || 0) / 100);
      return `
        <div class="item-row" style="grid-template-columns:60px 1fr 50px 80px 60px 80px 30px">
          <input value="${esc(it.referencia || '')}" onchange="updateItemCotizacion(${i},'referencia',this.value)" placeholder="Ref" style="font-size:11px">
          <input value="${esc(it.descripcion)}" onchange="updateItemCotizacion(${i},'descripcion',this.value)" placeholder="Descripcion">
          <input value="${esc(it.unidad_medida || 'UND')}" onchange="updateItemCotizacion(${i},'unidad_medida',this.value)" style="font-size:11px">
          <input type="number" value="${it.cantidad || 1}" min="0.01" step="0.01" onchange="updateItemCotizacion(${i},'cantidad',parseFloat(this.value))">
          <input type="number" value="${it.descuento_pct || 0}" min="0" max="100" step="0.01" onchange="updateItemCotizacion(${i},'descuento_pct',parseFloat(this.value))">
          <div style="font-weight:600;font-size:12px">$${formatMoney(sub)}</div>
          <button class="btn-icon" onclick="eliminarItemCotizacion(${i})">✕</button>
        </div>
      `;
    }).join('');
  }
  actualizarTotalesCotizacion();
}

function agregarItemCotizacion() {
  _cotizacionItems.push({ descripcion: '', cantidad: 1, precio_unitario: 0, descuento_pct: 0 });
  renderItemsCotizacion();
}

function updateItemCotizacion(idx, field, value) {
  _cotizacionItems[idx][field] = value;
  renderItemsCotizacion();
}

function eliminarItemCotizacion(idx) {
  _cotizacionItems.splice(idx, 1);
  renderItemsCotizacion();
}

function actualizarTotalesCotizacion() {
  let subtotal = 0;
  for (const it of _cotizacionItems) {
    const base = (it.cantidad || 1) * (it.precio_unitario || 0);
    subtotal += base * (1 - (it.descuento_pct || 0) / 100);
  }
  const descPct = parseFloat(document.getElementById('cotizacion-descuento')?.value || 0);
  const descuento = subtotal * (descPct / 100);
  const baseDesc = subtotal - descuento;
  const iva = baseDesc * 0.19;
  const total = baseDesc + iva;

  document.getElementById('cotizacion-totales').innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Subtotal:</span><span>$${formatMoney(subtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Descuento (${descPct}%):</span><span>-$${formatMoney(descuento)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>IVA (19%):</span><span>$${formatMoney(iva)}</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;border-top:1px solid var(--border);padding-top:8px;margin-top:8px"><span>Total:</span><span>$${formatMoney(total)}</span></div>
  `;
}

async function guardarCotizacion() {
  const id = document.getElementById('cotizacion-id').value;
  const body = {
    cliente_id: document.getElementById('cotizacion-cliente').value,
    oportunidad_id: document.getElementById('cotizacion-oportunidad').value || null,
    validez_dias: parseInt(document.getElementById('cotizacion-validez').value) || 30,
    notas: document.getElementById('cotizacion-notas').value,
    descuento_pct: parseFloat(document.getElementById('cotizacion-descuento').value) || 0,
    orden_compra: document.getElementById('cotizacion-orden-compra').value || null,
    centro_operacion: document.getElementById('cotizacion-centro-op').value || null,
    bodega: document.getElementById('cotizacion-bodega').value || null,
    condicion_pago: document.getElementById('cotizacion-condicion-pago').value || null,
    fecha_entrega: document.getElementById('cotizacion-fecha-entrega').value || null,
    items: _cotizacionItems.filter(it => it.descripcion?.trim())
  };

  if (!body.cliente_id) return toast('Seleccione un cliente', 'error');
  if (!body.items.length) return toast('Agregue al menos un item', 'error');

  const r = id
    ? await apiFetch('/cotizaciones/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/cotizaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Cotizacion actualizada' : 'Cotizacion creada', 'success');
  hideModal('modal-cotizacion');
  cargarCotizaciones();
}

async function editarCotizacion(id) {
  const r = await apiFetch('/cotizaciones/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalCotizacion(r.data);
}

async function verCotizacion(id) {
  const r = await apiFetch('/cotizaciones/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  const c = r.data;

  let itemsHtml = '';
  if (c.items?.length) {
    itemsHtml = `
      <h4 style="margin:16px 0 8px">Items</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>#</th><th>Ref</th><th>Descripcion</th><th>U.M</th><th>Cant.</th><th>Precio</th><th>Desc%</th><th>Subtotal</th>
      </tr></thead><tbody>
        ${c.items.map((it, i) => `<tr>
          <td>${i + 1}</td><td>${esc(it.referencia || '—')}</td><td>${esc(it.descripcion)}</td>
          <td>${esc(it.unidad_medida || 'UND')}</td><td>${it.cantidad}</td>
          <td>$${formatMoney(it.precio_unitario)}</td><td>${it.descuento_pct}%</td>
          <td>$${formatMoney(it.subtotal)}</td>
        </tr>`).join('')}
      </tbody></table></div>
    `;
  }

  let descHtml = '';
  if (c.descuentos?.length) {
    descHtml = `
      <h4 style="margin:16px 0 8px">Solicitudes de Descuento</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Tipo</th><th>Valor</th><th>Estado</th><th>Justificacion</th><th>Fecha</th>
      </tr></thead><tbody>
        ${c.descuentos.map(d => `<tr>
          <td>${d.tipo}</td><td>${d.valor_descuento}${d.tipo === 'porcentaje' ? '%' : ''}</td>
          <td><span class="badge badge-${d.estado}">${d.estado}</span></td>
          <td>${esc(d.justificacion || '—')}</td><td>${formatDate(d.creado_en)}</td>
        </tr>`).join('')}
      </tbody></table></div>
    `;
  }

  document.getElementById('detalle-cotizacion-title').textContent = `Cotizacion ${c.numero}`;
  document.getElementById('detalle-cotizacion-content').innerHTML = `
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Cliente:</strong> ${esc(c.cliente_nombre || '—')}</div>
      <div><strong>Estado:</strong> <span class="badge badge-${c.estado}">${c.estado}</span></div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Oportunidad:</strong> ${esc(c.oportunidad_nombre || '—')}</div>
      <div><strong>Vencimiento:</strong> ${formatDate(c.vencimiento)}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Orden de Compra:</strong> ${esc(c.orden_compra || '—')}</div>
      <div><strong>Centro Operacion:</strong> ${esc(c.centro_operacion || '—')}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Condicion Pago:</strong> ${esc(c.condicion_pago || '—')}</div>
      <div><strong>Fecha Entrega:</strong> ${formatDate(c.fecha_entrega)}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Bodega:</strong> ${esc(c.bodega || '—')}</div>
      <div><strong>Documento ERP:</strong> ${esc(c.documento_erp || '—')}</div>
    </div>
    ${c.notas ? `<div style="margin-bottom:12px"><strong>Notas:</strong> ${esc(c.notas)}</div>` : ''}
    <div style="padding:12px;background:var(--surface2);border-radius:8px;font-size:13px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Subtotal:</span><span>$${formatMoney(c.valor_subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Descuento:</span><span>-$${formatMoney(c.valor_descuento)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>IVA:</span><span>$${formatMoney(c.valor_iva)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;border-top:1px solid var(--border);padding-top:8px;margin-top:8px"><span>Total:</span><span>$${formatMoney(c.valor_total)}</span></div>
    </div>
    ${itemsHtml}
    ${descHtml}
  `;
  showModal('modal-detalle-cotizacion');
}

async function eliminarCotizacion(id) {
  confirmar({ titulo: 'Eliminar cotizacion', mensaje: 'Eliminar esta cotizacion?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/cotizaciones/' + id, { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast('Cotizacion eliminada', 'success');
    cargarCotizaciones();
  }});
}

async function cambiarEstadoCotizacion(id, estado) {
  const r = await apiFetch('/cotizaciones/' + id + '/estado', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado })
  });
  if (!r.ok) return toast(r.data?.error || 'Error al cambiar estado', 'error');
  toast('Estado actualizado a ' + estado, 'success');
  cargarCotizaciones();
}

// ── Descuentos ──
async function cargarDescuentos() {
  try {
    const params = new URLSearchParams();
    const estado = document.getElementById('filtro-descuento-estado')?.value;
    if (estado) params.set('estado', estado);

    const r = await apiFetch('/descuentos?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-descuentos');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(d => `
      <tr>
        <td>${esc(d.cotizacion_numero || '—')}</td>
        <td>${esc(d.cliente_nombre || '—')}</td>
        <td>${esc(d.solicitado_por_nombre || '—')}</td>
        <td>${d.tipo}</td>
        <td>${d.tipo === 'porcentaje' ? d.valor_descuento + '%' : '$' + formatMoney(d.valor_descuento)}</td>
        <td>$${formatMoney(d.monto_original)}</td>
        <td>$${formatMoney(d.monto_final)}</td>
        <td><span class="badge badge-${d.estado}">${d.estado}</span></td>
        <td>${formatDate(d.creado_en)}</td>
        <td>
          ${d.estado === 'pendiente' ? `
            <button class="btn btn-sm btn-primary" onclick="aprobarDescuento('${d.id}')">Aprobar</button>
            <button class="btn btn-sm btn-danger" onclick="rechazarDescuento('${d.id}')">Rechazar</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) { console.error('Error cargar descuentos:', err); }
}

function limpiarFiltrosDescuentos() {
  document.getElementById('filtro-descuento-estado').value = '';
  cargarDescuentos();
}

async function aprobarDescuento(id) {
  confirmar({ titulo: 'Aprobar descuento', mensaje: 'Aprobar esta solicitud de descuento?', icono: '✅', onConfirm: async () => {
    const r = await apiFetch('/descuentos/' + id + '/aprobar', { method: 'PUT' });
    if (!r.ok) return toast(r.data?.error || 'Error al aprobar', 'error');
    toast('Descuento aprobado', 'success');
    cargarDescuentos();
    cargarCotizaciones();
  }});
}

async function rechazarDescuento(id) {
  const motivo = prompt('Motivo del rechazo (opcional):');
  const r = await apiFetch('/descuentos/' + id + '/rechazar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo })
  });
  if (!r.ok) return toast(r.data?.error || 'Error al rechazar', 'error');
  toast('Descuento rechazado', 'success');
  cargarDescuentos();
}

async function cargarOportunidadesSelect(selectId, selectedId) {
  try {
    const r = await apiFetch('/oportunidades?limit=500');
    if (!r.ok) return;
    const data = r.data.data || [];
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Sin oportunidad</option>' +
      data.map(o => `<option value="${o.id}" ${o.id === selectedId ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('');
  } catch {}
}

// ── Productos ──
let _productosPage = 1;

async function cargarProductos() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-producto-search')?.value;
    const categoria = document.getElementById('filtro-producto-categoria')?.value;
    if (search) params.set('search', search);
    if (categoria) params.set('categoria', categoria);
    params.set('page', _productosPage);
    params.set('limit', 50);

    const r = await apiFetch('/productos?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-productos');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(p => `
      <tr>
        <td><strong>${esc(p.codigo)}</strong></td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.unidad_medida || 'UND')}</td>
        <td>$${formatMoney(p.precio_unitario || 0)}</td>
        <td>${p.tasa_impuesto || 0}%</td>
        <td>${esc(p.categoria || '—')}</td>
        <td>${esc(p.bodega || '—')}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarProducto('${p.id}')">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarProducto('${p.id}')">Eliminar</button>
        </td>
      </tr>
    `).join('');

    renderPagination('pag-productos', r.data.total, _productosPage, 50, (p) => { _productosPage = p; cargarProductos(); });
  } catch (err) { console.error('Error cargar productos:', err); }
}

function limpiarFiltrosProductos() {
  document.getElementById('filtro-producto-search').value = '';
  document.getElementById('filtro-producto-categoria').value = '';
  _productosPage = 1;
  cargarProductos();
}

async function abrirModalProducto(producto = null) {
  document.getElementById('modal-producto-title').textContent = producto ? 'Editar Producto' : 'Nuevo Producto';
  document.getElementById('producto-id').value = producto?.id || '';
  document.getElementById('producto-codigo').value = producto?.codigo || '';
  document.getElementById('producto-nombre').value = producto?.nombre || '';
  document.getElementById('producto-descripcion').value = producto?.descripcion || '';
  document.getElementById('producto-unidad').value = producto?.unidad_medida || 'UND';
  document.getElementById('producto-precio').value = producto?.precio_unitario || 0;
  document.getElementById('producto-tasa').value = producto?.tasa_impuesto || 0;
  document.getElementById('producto-categoria').value = producto?.categoria || '';
  document.getElementById('producto-bodega').value = producto?.bodega || '';
  showModal('modal-producto');
}

async function editarProducto(id) {
  const r = await apiFetch('/productos?limit=500');
  if (!r.ok) return;
  const data = r.data.data || [];
  const p = data.find(x => x.id === id);
  if (p) abrirModalProducto(p);
}

async function guardarProducto() {
  const id = document.getElementById('producto-id').value;
  const body = {
    codigo: document.getElementById('producto-codigo').value,
    nombre: document.getElementById('producto-nombre').value,
    descripcion: document.getElementById('producto-descripcion').value,
    unidad_medida: document.getElementById('producto-unidad').value,
    precio_unitario: parseFloat(document.getElementById('producto-precio').value) || 0,
    tasa_impuesto: parseFloat(document.getElementById('producto-tasa').value) || 0,
    categoria: document.getElementById('producto-categoria').value,
    bodega: document.getElementById('producto-bodega').value
  };

  if (!body.codigo || !body.nombre) return toast('Codigo y nombre son obligatorios', 'error');

  const r = await apiFetch('/productos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast('Producto guardado', 'success');
  hideModal('modal-producto');
  cargarProductos();
}

async function eliminarProducto(id) {
  confirmar({ titulo: 'Eliminar producto', mensaje: 'Eliminar este producto?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/productos/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Producto eliminado', 'success');
    cargarProductos();
  }});
}

// ── Importar SIESA ──
let _importarTipos = [];

async function cargarPaginaImportar() {
  const r = await apiFetch('/importar/tipos');
  if (!r.ok) return;
  _importarTipos = r.data.data || [];
  const container = document.getElementById('importar-tipos-container');
  container.innerHTML = _importarTipos.map(t => `
    <div style="display:flex;align-items:center;gap:16px;padding:14px 18px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;background:var(--surface);cursor:pointer" onclick="abrirModalImportar('${t.id}')">
      <span style="font-size:24px">${t.id === 'clientes' ? '🏢' : t.id === 'contactos' ? '👤' : t.id === 'leads' ? '🎯' : t.id === 'cotizaciones' ? '📄' : t.id === 'items' ? '📦' : '📊'}</span>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${esc(t.nombre)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(t.descripcion)}</div>
      </div>
      <span style="font-size:11px;color:var(--muted);background:var(--surface2);padding:4px 10px;border-radius:6px">${t.extensiones.toUpperCase()}</span>
      <span style="color:var(--accent);font-size:20px">→</span>
    </div>
  `).join('');
}

function abrirModalImportar(tipo) {
  document.getElementById('importar-tipo').value = tipo || '';
  cambiarTipoImportacion();
  document.getElementById('importar-archivo').value = '';
  document.getElementById('importar-resultado').innerHTML = '';
  showModal('modal-importar');
}

function cambiarTipoImportacion() {
  const tipo = document.getElementById('importar-tipo').value;
  const tipoInfo = _importarTipos.find(t => t.id === tipo);
  document.getElementById('importar-descripcion').textContent = tipoInfo ? tipoInfo.descripcion : '';
  document.getElementById('btn-ejecutar-importar').disabled = !tipo;
  document.getElementById('importar-archivo').value = '';
  document.getElementById('importar-resultado').innerHTML = '';
  if (tipoInfo) {
    document.getElementById('importar-archivo').accept = tipoInfo.extensiones.split(',').map(e => '.' + e).join(',');
  }
}

async function ejecutarImportacion() {
  const tipo = document.getElementById('importar-tipo').value;
  const fileInput = document.getElementById('importar-archivo');
  if (!tipo) return toast('Selecciona un tipo', 'error');
  if (!fileInput.files.length) return toast('Selecciona un archivo', 'error');

  const btn = document.getElementById('btn-ejecutar-importar');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  const formData = new FormData();
  formData.append('tipo', tipo);
  formData.append('archivo', fileInput.files[0]);

  try {
    const r = await fetch(HF.API + '/importar', { method: 'POST', credentials: 'include', body: formData });
    const data = await r.json();
    const div = document.getElementById('importar-resultado');
    if (!r.ok || !data.ok) {
      div.innerHTML = `<div style="padding:12px;background:#f8d7da;border-radius:8px;color:#721c24;font-size:13px">❌ ${data.error || 'Error al importar'}</div>`;
      return;
    }
    div.innerHTML = `
      <div style="padding:12px;background:#d4edda;border-radius:8px;font-size:13px">
        <div style="font-weight:600;margin-bottom:8px">✅ Importación completada</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <div><strong>${data.insertados}</strong><br><span style="font-size:11px;color:var(--muted)">Insertados</span></div>
          <div><strong>${data.actualizados}</strong><br><span style="font-size:11px;color:var(--muted)">Actualizados</span></div>
          <div><strong>${data.fallidos}</strong><br><span style="font-size:11px;color:var(--muted)">Fallidos</span></div>
        </div>
        ${data.errores?.length ? `<div style="margin-top:8px;font-size:11px;color:var(--muted);max-height:100px;overflow-y:auto">${data.errores.join('<br>')}</div>` : ''}
      </div>
    `;
    toast(`${data.insertados} insertados, ${data.actualizados} actualizados`, 'success');
  } catch (e) {
    document.getElementById('importar-resultado').innerHTML = `<div style="padding:12px;background:#f8d7da;border-radius:8px;color:#721c24;font-size:13px">❌ Error de red: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar';
  }
}

// ── Utils ──
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); }
function showModal(id) { document.getElementById(id).classList.add('active'); }
function hideModal(id) { document.getElementById(id).classList.remove('active'); }

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
