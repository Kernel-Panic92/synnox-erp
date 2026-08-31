let usuario = null;
let _clientesPage = 1;
let clientesLimit = 20;
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
const pages = ['dashboard', 'pipeline', 'leads', 'clientes', 'contactos', 'visitas', 'cotizaciones', 'productos', 'inventario', 'importar', 'descuentos', 'admin'];
function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (el) el.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', pipeline: 'Pipeline', leads: 'Clientes Potenciales', clientes: 'Clientes', contactos: 'Contactos', visitas: 'Actividades', cotizaciones: 'Cotizaciones', productos: 'Productos', inventario: 'Inventario', importar: 'Importar SIESA', descuentos: 'Descuentos', admin: 'Admin' };
  document.getElementById('page-title').textContent = titles[page] || 'CRM';
  if (page === 'dashboard') cargarDashboard();
  if (page === 'pipeline') cargarPipeline();
  if (page === 'leads') cargarLeads();
  if (page === 'clientes') cargarClientes();
  if (page === 'contactos') cargarContactos();
  if (page === 'visitas') cargarVisitas();
  if (page === 'cotizaciones') cargarCotizaciones();
  if (page === 'productos') cargarProductos();
  if (page === 'inventario') cargarInventario();
  if (page === 'importar') cargarPaginaImportar();
  if (page === 'descuentos') cargarDescuentos();
  if (page === 'admin') cargarAdmin();
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
    const [r, s] = await Promise.all([
      apiFetch('/oportunidades/pipeline?' + params),
      apiFetch('/oportunidades/stats?' + params)
    ]);
    if (!r.ok) return;
    const { pipeline, stats } = r.data;
    if (s.ok) {
      const d = s.data;
      document.getElementById('stats-pipeline').innerHTML = `
        <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Oportunidades</div></div>
        <div class="stat-card"><div class="stat-value">$${formatMoney(d.monto_pipeline || 0)}</div><div class="stat-label">Pipeline abierto</div></div>
        <div class="stat-card"><div class="stat-value">$${formatMoney(d.forecast_ponderado || 0)}</div><div class="stat-label">Forecast ponderado</div><div class="stat-sub">monto × probabilidad</div></div>
        <div class="stat-card"><div class="stat-value">${d.win_rate || 0}%</div><div class="stat-label">Win rate</div><div class="stat-sub">${d.ganada||0} ganada · ${d.perdida||0} perdida</div></div>
      `;
    }
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
  const search = document.getElementById('filtro-cliente-search')?.value || '';
  const tipo = document.getElementById('filtro-cliente-tipo')?.value || '';
  const canal = document.getElementById('filtro-cliente-canal')?.value || '';
  const ciudad = document.getElementById('filtro-cliente-ciudad')?.value || '';
  const colNombre = document.getElementById('filtro-col-nombre')?.value || '';
  const colNit = document.getElementById('filtro-col-nit')?.value || '';
  const colCiudad = document.getElementById('filtro-col-ciudad')?.value || '';
  const params = new URLSearchParams({ page: _clientesPage, limit: clientesLimit });
  if (search) params.set('search', search);
  if (tipo) params.set('tipo', tipo);
  if (canal) params.set('canal', canal);
  if (ciudad) params.set('ciudad', ciudad);
  if (colNombre) params.set('col_nombre', colNombre);
  if (colNit) params.set('col_nit', colNit);
  if (colCiudad) params.set('col_ciudad', colCiudad);
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
        <td>${esc(e.canal || '—')}</td>
        <td>${esc(e.ciudad || '—')}</td>
        <td>${e.total_contactos || 0}</td>
        <td>${formatDate(e.creado_en)}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarCliente('${e.id}')" title="Editar cliente" aria-label="Editar cliente ${esc(e.nombre)}">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarCliente('${e.id}')" title="Eliminar cliente" aria-label="Eliminar cliente ${esc(e.nombre)}">🗑️</button>
        </td>
      </tr>
    `).join('');
  renderPagination('pag-clientes', r.data.total, _clientesPage, clientesLimit, (p) => { _clientesPage = p; cargarClientes(); });
  // Cargar ciudades para filtro
  const ciudades = [...new Set(data.map(e => e.ciudad).filter(Boolean))];
  const sel = document.getElementById('filtro-cliente-ciudad');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todas las ciudades</option>' + ciudades.map(c => `<option value="${esc(c)}" ${c === actual ? 'selected' : ''}>${esc(c)}</option>`).join('');
  cargarStatsClientes();
}

async function cargarStatsClientes() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-cliente-search')?.value;
    const tipo = document.getElementById('filtro-cliente-tipo')?.value;
    const canal = document.getElementById('filtro-cliente-canal')?.value;
    const ciudad = document.getElementById('filtro-cliente-ciudad')?.value;
    const colNombre = document.getElementById('filtro-col-nombre')?.value;
    const colNit = document.getElementById('filtro-col-nit')?.value;
    const colCiudad = document.getElementById('filtro-col-ciudad')?.value;
    if (search) params.set('search', search);
    if (tipo) params.set('tipo', tipo);
    if (canal) params.set('canal', canal);
    if (ciudad) params.set('ciudad', ciudad);
    if (colNombre) params.set('col_nombre', colNombre);
    if (colNit) params.set('col_nit', colNit);
    if (colCiudad) params.set('col_ciudad', colCiudad);

    const r = await apiFetch('/clientes/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    const topTipo = (d.por_tipo || []).slice(0, 2).map(t => `${esc(t.tipo || 'Sin tipo')}: ${t.total}`).join(' · ') || '—';
    const topCiudad = (d.por_ciudad || []).slice(0, 2).map(c => `${esc(c.ciudad)}: ${c.total}`).join(' · ') || '—';
    document.getElementById('stats-clientes').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Clientes</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px;line-height:1.3">${topTipo}</div><div class="stat-label">Por tipo</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px;line-height:1.3">${topCiudad}</div><div class="stat-label">Top ciudades</div></div>
      <div class="stat-card"><div class="stat-value">${d.recientes?.length || 0}</div><div class="stat-label">Recientes</div></div>
    `;
  } catch {}
}

function limpiarFiltrosClientes() {
  document.getElementById('filtro-cliente-search').value = '';
  document.getElementById('filtro-cliente-tipo').value = '';
  document.getElementById('filtro-cliente-ciudad').value = '';
  document.getElementById('filtro-cliente-canal').value = '';
  document.getElementById('filtro-col-nombre').value = '';
  document.getElementById('filtro-col-nit').value = '';
  document.getElementById('filtro-col-ciudad').value = '';
  clientesLimit = 20;
  document.getElementById('filtro-cliente-limit').value = '20';
  _clientesPage = 1;
  cargarClientes();
}

async function verCliente(id) {
  const r = await apiFetch('/clientes/' + id);
  if (!r.ok) return;
  const e = r.data.data;

  // Fetch sucursales, facturas and cotizaciones
  const [sucR, facR, cotR] = await Promise.all([
    apiFetch('/clientes/' + id + '/sucursales'),
    apiFetch('/clientes/' + id + '/facturas'),
    apiFetch('/cotizaciones?cliente_id=' + id + '&limit=50')
  ]);
  const sucursales = sucR.ok ? (sucR.data.data || []) : [];
  const facturas = facR.ok ? (facR.data.data || []) : [];
  const cotizaciones = cotR.ok ? (cotR.data.data || []) : [];

  document.getElementById('detalle-cliente-title').textContent = e.nombre;
  document.getElementById('detalle-cliente-content').innerHTML = `
    <div style="display:flex;gap:16px;border-bottom:1px solid var(--border);margin-bottom:16px">
      <button class="tab-btn active" onclick="cambiarTabCliente('datos',this)">Datos Basicos</button>
      <button class="tab-btn" onclick="cambiarTabCliente('sucursales',this)">Sucursales (${sucursales.length})</button>
      <button class="tab-btn" onclick="cambiarTabCliente('contactos',this)">Contactos (${(e.contactos || []).length})</button>
      <button class="tab-btn" onclick="cambiarTabCliente('cotizaciones',this)">Cotizaciones (${cotizaciones.length})</button>
      <button class="tab-btn" onclick="cambiarTabCliente('facturas',this)">Facturas (${facturas.length})</button>
    </div>

    <div id="tab-cliente-datos">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Razon Social</div><div>${esc(e.nombre)}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Numero de Identificacion</div><div>${esc(e.nit || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Correo Electronico</div><div>${esc(e.email || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Asesor Comercial</div><div>${esc(e.asesor_comercial || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Canal</div><div>${esc(e.canal || '—')}</div></div>
        </div>
        <div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Nombre Establecimiento</div><div>${esc(e.razon_social || e.nombre)}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Telefono</div><div>${esc(e.telefono || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Pagina Web</div><div>${esc(e.website || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Tipo Negocio</div><div>${esc(e.tipo_negocio || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Tipo Cliente</div><div>${esc(e.tipo || '—')}</div></div>
        </div>
      </div>
      ${e.direccion ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Direccion</div><div>${esc(e.direccion)}</div></div>` : ''}
    </div>

    <div id="tab-cliente-sucursales" style="display:none">
      ${sucursales.length ? `<div class="tbl-wrap tbl-scrollable"><table class="tbl"><thead><tr><th>Codigo</th><th>Nombre</th><th>Direccion</th><th>Ciudad</th><th>Telefono</th><th>Principal</th><th></th></tr></thead><tbody>
        ${sucursales.map(s => `<tr>
          <td><strong>${esc(s.codigo || '—')}</strong></td>
          <td>${esc(s.nombre)}</td>
          <td>${esc(s.direccion || '—')}</td>
          <td>${esc(s.ciudad || '—')}</td>
          <td>${esc(s.telefono || '—')}</td>
          <td>${s.es_principal ? '<span class="badge badge-aprobada">Principal</span>' : ''}</td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="editarSucursal('${s.id}','${id}')" title="Editar sucursal" aria-label="Editar sucursal ${esc(s.nombre)}">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="eliminarSucursal('${s.id}','${id}')" title="Eliminar sucursal" aria-label="Eliminar sucursal ${esc(s.nombre)}">🗑️</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin sucursales</p>'}
      <button class="btn btn-sm btn-primary" onclick="abrirModalSucursal('${id}')" style="margin-top:8px">+ Nueva Sucursal</button>
    </div>

    <div id="tab-cliente-contactos" style="display:none">
      ${(e.contactos || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Cargo</th><th>Email</th><th>Telefono</th></tr></thead><tbody>
        ${e.contactos.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.cargo || '—')}</td><td>${esc(c.email || '—')}</td><td>${esc(c.telefono || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin contactos</p>'}
    </div>

    <div id="tab-cliente-facturas" style="display:none">
      ${facturas.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Numero</th><th>Estado</th><th>Fecha</th><th>Vencimiento</th><th>Valor Total</th></tr></thead><tbody>
        ${facturas.map(f => `<tr>
          <td><strong>${esc(f.numero)}</strong></td>
          <td><span class="badge badge-${f.estado === 'Aprobadas' ? 'aprobada' : 'info'}">${esc(f.estado || '—')}</span></td>
          <td>${formatDate(f.fecha)}</td>
          <td>${formatDate(f.fecha_vencimiento)}</td>
          <td><strong>$${formatMoney(f.valor_total || 0)}</strong></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin facturas registradas. Se sincronizarán cuando tengamos la API del ERP.</p>'}
    </div>

    <div id="tab-cliente-cotizaciones" style="display:none">
      ${cotizaciones.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Numero</th><th>Estado</th><th>Estado ERP</th><th>Total</th><th>Vencimiento</th></tr></thead><tbody>
        ${cotizaciones.map(c => `<tr style="cursor:pointer" onclick="hideModal('modal-detalle-cliente');verCotizacion('${c.id}')">
          <td><a href="#" style="color:var(--accent)">${esc(c.numero)}</a></td>
          <td><span class="badge badge-${c.estado}">${esc(c.estado)}</span></td>
          <td>${esc(c.estado_erp || '—')}</td>
          <td><strong>$${formatMoney(c.valor_total || 0)}</strong></td>
          <td>${formatDate(c.vencimiento)}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin cotizaciones para este cliente.</p>'}
    </div>
  `;
  showModal('modal-detalle-cliente');
}

function cambiarTabCliente(tab, btn) {
  document.querySelectorAll('#modal-detalle-cliente [id^="tab-cliente-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#modal-detalle-cliente .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-cliente-' + tab).style.display = '';
  btn.classList.add('active');
}

// ── Sucursales ──
function abrirModalSucursal(clienteId, sucursal = null) {
  document.getElementById('modal-sucursal-title').textContent = sucursal ? 'Editar Sucursal' : 'Nueva Sucursal';
  document.getElementById('sucursal-id').value = sucursal?.id || '';
  document.getElementById('sucursal-cliente-id').value = clienteId;
  document.getElementById('sucursal-codigo').value = sucursal?.codigo || '';
  document.getElementById('sucursal-nombre').value = sucursal?.nombre || '';
  document.getElementById('sucursal-direccion').value = sucursal?.direccion || '';
  document.getElementById('sucursal-ciudad').value = sucursal?.ciudad || '';
  document.getElementById('sucursal-departamento').value = sucursal?.departamento || '';
  document.getElementById('sucursal-telefono').value = sucursal?.telefono || '';
  document.getElementById('sucursal-email').value = sucursal?.email || '';
  document.getElementById('sucursal-contacto').value = sucursal?.contacto_nombre || '';
  document.getElementById('sucursal-principal').checked = sucursal?.es_principal || false;
  showModal('modal-sucursal');
}

async function editarSucursal(sucursalId, clienteId) {
  const r = await apiFetch('/sucursales/' + sucursalId);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalSucursal(clienteId, r.data.data);
}

async function guardarSucursal() {
  const id = document.getElementById('sucursal-id').value;
  const clienteId = document.getElementById('sucursal-cliente-id').value;
  const body = {
    codigo: document.getElementById('sucursal-codigo').value,
    nombre: document.getElementById('sucursal-nombre').value,
    direccion: document.getElementById('sucursal-direccion').value,
    ciudad: document.getElementById('sucursal-ciudad').value,
    departamento: document.getElementById('sucursal-departamento').value,
    telefono: document.getElementById('sucursal-telefono').value,
    email: document.getElementById('sucursal-email').value,
    contacto_nombre: document.getElementById('sucursal-contacto').value,
    es_principal: document.getElementById('sucursal-principal').checked
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');

  const url = id ? '/sucursales/' + id : '/clientes/' + clienteId + '/sucursales';
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Sucursal actualizada' : 'Sucursal creada', 'success');
  hideModal('modal-sucursal');
  verCliente(clienteId);
}

async function eliminarSucursal(sucursalId, clienteId) {
  confirmar({ titulo: 'Eliminar sucursal', mensaje: 'Eliminar esta sucursal?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/sucursales/' + sucursalId, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Sucursal eliminada', 'success');
    verCliente(clienteId);
  }});
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

function bulkDeleteCurrent() {
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  const mode = document.getElementById('bulk-select-mode').value;
  const funcs = { clientes: bulkDeleteClientes, contactos: bulkDeleteContactos, cotizaciones: bulkDeleteCotizaciones, productos: bulkDeleteProductos };

  if (mode === 'all') {
    if (funcs[activePage]) funcs[activePage]();
    else toast('Bulk delete no disponible para esta página', 'error');
    return;
  }

  const checked = document.querySelectorAll('.row-check:checked').length;
  if (!checked) return toast('Selecciona registros o cambia a "Todos los registros"', 'error');

  if (funcs[activePage]) funcs[activePage]();
  else toast('Bulk delete no disponible para esta página', 'error');
}

// Show bulk bar when "all" mode is selected
document.getElementById('bulk-select-mode')?.addEventListener('change', function() {
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (this.value === 'all') {
    bar?.classList.add('visible');
    if (countEl) countEl.textContent = 'Todos';
  } else {
    updateBulkBar();
  }
});

async function bulkDeleteClientes() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];

  if (mode === 'all') {
    // Fetch ALL client IDs
    const r = await apiFetch('/clientes?limit=10000');
    if (!r.ok) return toast('Error al obtener clientes', 'error');
    ids = (r.data.data || []).map(c => c.id);
  } else {
    ids = [...document.querySelectorAll('.cb-cliente:checked')].map(cb => cb.value);
  }

  if (!ids.length) return toast('No hay clientes para eliminar', 'error');

  confirmar({ titulo: 'Eliminar clientes', mensaje: `¿Eliminar ${ids.length} cliente(s)?`, icono: '🗑️', onConfirm: async () => {
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

// ── Leads ──
let _leadsPage = 1;

async function cargarLeads() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-lead-search')?.value;
    const estado = document.getElementById('filtro-lead-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);
    params.set('page', _leadsPage);
    params.set('limit', _limit);

    const r = await apiFetch('/leads?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-leads');
    const data = r.data.data || [];
    const estadoColors = { nuevo: 'info', contactado: 'warning', calificado: 'potencial', enviado_erp: 'siesa', convertido: 'aprobada', perdido: 'rechazada' };

    tbody.innerHTML = data.map(l => `
      <tr>
        <td><input type="checkbox" class="row-check cb-lead" value="${l.id}" onchange="event.stopPropagation();updateBulkBar()"></td>
        <td><a href="#" onclick="verLead('${l.id}');return false" style="color:var(--accent)">${esc(l.raison_social)}</a></td>
        <td>${esc(l.numero_identificacion || '—')}</td>
        <td>${esc(l.ciudad || '—')}</td>
        <td><span class="badge badge-${estadoColors[l.estado] || 'info'}">${esc(l.estado)}</span></td>
        <td>${esc(l.asesor_comercial || '—')}</td>
        <td>${esc(l.telefono || '—')}</td>
        <td>${esc(l.email || '—')}</td>
        <td>${formatDate(l.creado_en)}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarLead('${l.id}')" title="Editar lead" aria-label="Editar lead ${esc(l.raison_social)}">✏️</button>
          ${l.estado !== 'convertido' && l.estado !== 'enviado_erp' ? `<button class="btn btn-sm btn-primary" onclick="enviarLeadERP('${l.id}','${esc(l.raison_social)}')" title="Convertir a tercero" aria-label="Convertir lead ${esc(l.raison_social)}">🔄</button>` : ''}
          ${l.estado === 'enviado_erp' ? `<button class="btn btn-sm btn-primary" onclick="marcarConvertido('${l.id}','${esc(l.raison_social)}')" title="Marcar como convertido" aria-label="Marcar lead ${esc(l.raison_social)} como convertido">✅</button>` : ''}
          ${l.estado !== 'convertido' ? `<button class="btn btn-sm btn-danger" onclick="eliminarLead('${l.id}')" title="Eliminar lead" aria-label="Eliminar lead ${esc(l.raison_social)}">🗑️</button>` : ''}
        </td>
      </tr>
    `).join('');

    renderPagination('pag-leads', r.data.total, _leadsPage, _limit, (p) => { _leadsPage = p; cargarLeads(); });
    cargarStatsLeads();
  } catch (err) { console.error('Error cargar leads:', err); }
}

async function cargarStatsLeads() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-lead-search')?.value;
    const estado = document.getElementById('filtro-lead-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);

    const r = await apiFetch('/leads/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-leads').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value">${d.convertidos || 0}</div><div class="stat-label">Convertidos</div></div>
      <div class="stat-card"><div class="stat-value">${(d.por_estado || []).find(e => e.estado === 'nuevo')?.total || 0}</div><div class="stat-label">Nuevos</div></div>
      <div class="stat-card"><div class="stat-value">${(d.por_estado || []).find(e => e.estado === 'enviado_erp')?.total || 0}</div><div class="stat-label">Enviados ERP</div></div>
    `;
  } catch {}
}

function limpiarFiltrosLeads() {
  document.getElementById('filtro-lead-search').value = '';
  document.getElementById('filtro-lead-estado').value = '';
  _leadsPage = 1;
  cargarLeads();
}

function abrirModalLead(lead = null) {
  document.getElementById('modal-lead-title').textContent = lead ? 'Editar Lead' : 'Nuevo Lead';
  document.getElementById('lead-id').value = lead?.id || '';
  document.getElementById('lead-razon-social').value = lead?.raison_social || '';
  document.getElementById('lead-nit').value = lead?.numero_identificacion || '';
  document.getElementById('lead-nombre-est').value = lead?.nombre_establecimiento || '';
  document.getElementById('lead-estado').value = lead?.estado || 'nuevo';
  document.getElementById('lead-ciudad').value = lead?.ciudad || '';
  document.getElementById('lead-departamento').value = lead?.departamento || '';
  document.getElementById('lead-direccion').value = lead?.direccion || '';
  document.getElementById('lead-telefono').value = lead?.telefono || '';
  document.getElementById('lead-email').value = lead?.email || '';
  document.getElementById('lead-asesor').value = lead?.asesor_comercial || '';
  document.getElementById('lead-canal').value = lead?.canal || '';
  document.getElementById('lead-notas').value = lead?.notas || '';
  showModal('modal-lead');
}

async function editarLead(id) {
  const r = await apiFetch('/leads/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalLead(r.data.data);
}

async function verLead(id) {
  const r = await apiFetch('/leads/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalLead(r.data.data);
}

async function guardarLead() {
  const id = document.getElementById('lead-id').value;
  const body = {
    raison_social: document.getElementById('lead-razon-social').value,
    numero_identificacion: document.getElementById('lead-nit').value,
    nombre_establecimiento: document.getElementById('lead-nombre-est').value,
    estado: document.getElementById('lead-estado').value,
    ciudad: document.getElementById('lead-ciudad').value,
    departamento: document.getElementById('lead-departamento').value,
    direccion: document.getElementById('lead-direccion').value,
    telefono: document.getElementById('lead-telefono').value,
    email: document.getElementById('lead-email').value,
    asesor_comercial: document.getElementById('lead-asesor').value,
    canal: document.getElementById('lead-canal').value,
    notas: document.getElementById('lead-notas').value
  };
  if (!body.raison_social) return toast('La razon social es obligatoria', 'error');

  const r = id
    ? await apiFetch('/leads/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Lead actualizado' : 'Lead creado', 'success');
  hideModal('modal-lead');
  cargarLeads();
}

async function eliminarLead(id) {
  confirmar({ titulo: 'Eliminar lead', mensaje: 'Eliminar este lead?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/leads/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Lead eliminado', 'success');
    cargarLeads();
  }});
}

async function enviarLeadERP(id, nombre) {
  confirmar({ titulo: 'Convertir a tercero', mensaje: `Enviar "${nombre}" al ERP para crear tercero?`, icono: '🔄', onConfirm: async () => {
    const r = await apiFetch('/leads/' + id + '/convertir', { method: 'POST' });
    if (r.status === 503) {
      toast('API de SIESA no disponible. Solicita a contabilidad la creación del tercero.', 'error');
      return;
    }
    if (!r.ok) return toast(r.data?.error || 'Error al enviar', 'error');
    toast('Lead enviado a ERP', 'success');
    cargarLeads();
  }});
}

async function marcarConvertido(id, nombre) {
  confirmar({ titulo: 'Confirmar conversion', mensaje: `¿"${nombre}" ya fue creado como tercero en el ERP?`, icono: '✅', onConfirm: async () => {
    const r = await apiFetch('/leads/' + id + '/confirmar', { method: 'PUT' });
    if (!r.ok) return toast(r.data?.error || 'Error al confirmar', 'error');
    toast('Lead convertido en cliente', 'success');
    cargarLeads();
  }});
}

async function reconciliarLeads() {
  confirmar({ titulo: 'Reconciliar leads', mensaje: 'Comparar leads con clientes existentes por NIT?', icono: '🔍', onConfirm: async () => {
    const r = await apiFetch('/leads/reconciliar', { method: 'POST' });
    if (!r.ok) return toast(r.data?.error || 'Error al reconciliar', 'error');
    if (r.data.convertidos === 0) {
      toast('No se encontraron leads que coincidan con clientes existentes', 'info');
    } else {
      toast(`${r.data.convertidos} lead(s) marcado(s) como convertido(s)`, 'success');
    }
    cargarLeads();
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
      <td><input type="checkbox" class="row-check cb-contacto" value="${c.id}" onchange="updateBulkBar()"></td>
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
  cargarStatsContactos();
}

async function cargarStatsContactos() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-contacto-search')?.value;
    const clienteId = document.getElementById('filtro-contacto-cliente')?.value;
    if (search) params.set('search', search);
    if (clienteId) params.set('cliente_id', clienteId);

    const r = await apiFetch('/contactos/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-contactos').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Contactos</div></div>
      <div class="stat-card"><div class="stat-value">${d.con_email || 0}</div><div class="stat-label">Con email</div></div>
      <div class="stat-card"><div class="stat-value">${d.con_telefono || 0}</div><div class="stat-label">Con telefono</div></div>
      <div class="stat-card"><div class="stat-value">${d.decision_makers || 0}</div><div class="stat-label">Decision makers</div></div>
    `;
  } catch {}
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

async function bulkDeleteContactos() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];
  if (mode === 'all') {
    const r = await apiFetch('/contactos?limit=10000');
    if (!r.ok) return toast('Error al obtener contactos', 'error');
    ids = (r.data.data || []).map(c => c.id);
  } else {
    ids = [...document.querySelectorAll('.cb-contacto:checked')].map(cb => cb.value);
  }
  if (!ids.length) return toast('No hay contactos para eliminar', 'error');
  confirmar({ titulo: 'Eliminar contactos', mensaje: `¿Eliminar ${ids.length} contacto(s)?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/contactos/seleccionados', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} contactos eliminados`, 'success');
    clearSelection();
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

  // Store activity ID for delete
  document.getElementById('modal-detalle-visita').dataset.visitaId = v.id;
  document.getElementById('btn-eliminar-visita').style.display = '';

  document.getElementById('detalle-visita-title').textContent = `Actividad — ${esc(v.asunto || v.cliente_nombre || '')}`;
  document.getElementById('detalle-visita-content').innerHTML = `
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Cliente:</strong> ${esc(v.cliente_nombre || '—')}</div>
      <div><strong>Tipo:</strong> ${esc(v.tipo_actividad || '—')}</div>
    </div>
    ${v.asunto ? `<div style="margin-bottom:12px"><strong>Asunto:</strong> ${esc(v.asunto)}</div>` : ''}
    ${v.descripcion ? `<div style="margin-bottom:12px"><strong>Descripcion:</strong><br>${esc(v.descripcion)}</div>` : ''}
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Inicio:</strong> ${formatDateTime(v.fecha_inicio || v.fecha)}</div>
      <div><strong>Fin:</strong> ${v.fecha_fin ? formatDateTime(v.fecha_fin) : (v.checkout ? formatDateTime(v.checkout.fecha) : '—')}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Estado:</strong> ${esc(v.estado || (v.checkout ? 'realizada' : 'en_proceso'))}</div>
      <div><strong>Recordatorio:</strong> ${esc(v.recordatorio || 'nunca')}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Duracion:</strong> <span style="font-size:16px;font-weight:700;color:var(--accent)">${v.duracion || '—'}</span></div>
      <div><strong>Lugar:</strong> ${esc(v.lugar || '—')}</div>
    </div>
    ${v.propietario_nombre ? `<div style="margin-bottom:12px"><strong>Propietario:</strong> ${esc(v.propietario_nombre || '#' + v.vendedor_id)}</div>` : `<div style="margin-bottom:12px"><strong>Vendedor:</strong> ${esc(v.vendedor_nombre || '#' + v.vendedor_id)}</div>`}
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

async function eliminarActividad() {
  const id = document.getElementById('modal-detalle-visita').dataset.visitaId;
  if (!id) return;
  confirmar({ titulo: 'Eliminar actividad', mensaje: 'Eliminar esta actividad?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/visitas/' + id, { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast('Actividad eliminada', 'success');
    hideModal('modal-detalle-visita');
    cargarVisitas();
  }});
}

function limpiarFiltrosVisitas() {
  document.getElementById('filtro-visitas-vendedor').value = '';
  document.getElementById('filtro-visitas-desde').value = '';
  document.getElementById('filtro-visitas-hasta').value = '';
  cargarVisitas();
}

let _actClientesCache = [];

async function cargarActClientesCache() {
  if (_actClientesCache.length) return _actClientesCache;
  const r = await apiFetch('/clientes?limit=1000');
  if (!r.ok) return [];
  const data = r.data.data || r.data || [];
  _actClientesCache = Array.isArray(data) ? data : [];
  return _actClientesCache;
}

function filtrarActClientes(q) {
  const sel = document.getElementById('act-cliente');
  const selectedDiv = document.getElementById('act-cliente-selected');
  const qq = (q || '').toLowerCase().trim();
  // single select: if already selected, ignore new search unless cleared
  if (sel.value && selectedDiv.style.display !== 'none') return;
  if (!qq) { sel.style.display = 'none'; sel.innerHTML = ''; return; }
  const filtered = _actClientesCache.filter(c =>
    (c.nombre && c.nombre.toLowerCase().includes(qq)) ||
    (c.nit && String(c.nit).toLowerCase().includes(qq)) ||
    (c.codigo_siesa && String(c.codigo_siesa).toLowerCase().includes(qq))
  ).slice(0, 20);
  if (!filtered.length) { sel.innerHTML = '<option>No hay resultados</option>'; sel.style.display = ''; return; }
  sel.innerHTML = filtered.map(c => `<option value="${c.id}">${esc(c.nombre)} — ${esc(c.nit || c.codigo_siesa || '')}</option>`).join('');
  sel.style.display = '';
  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value || opt.textContent === 'No hay resultados') return;
    selectedDiv.textContent = '✓ ' + opt.textContent + '  ✕';
    selectedDiv.style.display = '';
    selectedDiv.title = 'Click para quitar';
    selectedDiv.style.cursor = 'pointer';
    selectedDiv.onclick = () => { selectedDiv.style.display = 'none'; sel.value = ''; document.getElementById('act-cliente-search').value = ''; };
    sel.style.display = 'none';
    document.getElementById('act-cliente-search').value = '';
  };
}

let _actMap = null;

function actualizarActGPSGroup() {
  const tipo = document.getElementById('act-tipo')?.value;
  const estado = document.getElementById('act-estado')?.value;
  const group = document.getElementById('act-gps-group');
  if (!group) return;
  group.style.display = '';
  const necesita = tipo === 'reunion' && (estado === 'en_proceso' || estado === 'realizada');
  const hint = document.querySelector('#act-gps-group label small');
  if (hint) hint.textContent = necesita ? '— auto al guardar (Reunión)' : '— se capturará al pasar a En Proceso / Realizada (solo Reunión)';
  setTimeout(() => {
    const mapEl = document.getElementById('act-map');
    if (mapEl && !mapEl._leaflet_id) {
      _actMap = L.map(mapEl, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([4.6, -74.07], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(_actMap);
      setTimeout(() => _actMap.invalidateSize(), 200);
    } else if (_actMap) {
      setTimeout(() => _actMap.invalidateSize(), 150);
    }
  }, 120);
  if (necesita) {
    const coordsEl = document.getElementById('act-coords');
    const textEl = document.getElementById('act-coords-text');
    if ((!coordsEl.dataset.lat || !coordsEl.dataset.lng) && (!textEl || textEl.textContent === '—')) obtenerGPSAct();
  }
}

function setActMapMarker(lat, lng) {
  if (!_actMap) return;
  _actMap.setView([lat, lng], 16);
  _actMap.eachLayer(l => { if (l instanceof L.Marker) _actMap.removeLayer(l); });
  L.marker([lat, lng]).addTo(_actMap);
  setTimeout(() => _actMap.invalidateSize(), 150);
}

function obtenerGPSAct() {
  const el = document.getElementById('act-coords');
  const textEl = document.getElementById('act-coords-text');
  if (!el) return;
  if (!navigator.geolocation) { if (textEl) textEl.textContent = 'GPS no disponible'; return; }
  if (textEl) textEl.textContent = 'Obteniendo GPS...';
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude.toFixed(6);
    const lng = pos.coords.longitude.toFixed(6);
    el.dataset.lat = lat;
    el.dataset.lng = lng;
    el.dataset.precision = String(Math.round(pos.coords.accuracy));
    if (textEl) textEl.textContent = `${lat}, ${lng} · ±${Math.round(pos.coords.accuracy)}m`;
    setActMapMarker(parseFloat(lat), parseFloat(lng));
  }, err => {
    if (textEl) textEl.textContent = 'Error GPS: ' + err.message;
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function obtenerGPSActPromise() {
  return new Promise(resolve => {
    const el = document.getElementById('act-coords');
    const textEl = document.getElementById('act-coords-text');
    if (el && el.dataset.lat && el.dataset.lng) return resolve();
    if (!navigator.geolocation) return resolve();
    navigator.geolocation.getCurrentPosition(pos => {
      if (el) {
        el.dataset.lat = String(pos.coords.latitude.toFixed(6));
        el.dataset.lng = String(pos.coords.longitude.toFixed(6));
        el.dataset.precision = String(Math.round(pos.coords.accuracy));
        if (textEl) textEl.textContent = `${el.dataset.lat}, ${el.dataset.lng} · ±${el.dataset.precision}m`;
        setActMapMarker(parseFloat(el.dataset.lat), parseFloat(el.dataset.lng));
      }
      resolve();
    }, () => resolve(), { enableHighAccuracy: true, timeout: 7000 });
  });
}

async function abrirModalCrearActividad() {
  document.getElementById('act-asunto').value = '';
  document.getElementById('act-descripcion').value = '';
  document.getElementById('act-tipo').value = 'reunion';
  document.getElementById('act-lugar').value = '';
  document.getElementById('act-fecha-inicio').value = '';
  document.getElementById('act-fecha-fin').value = '';
  document.getElementById('act-estado').value = 'no_iniciada';
  document.getElementById('act-recordatorio').value = 'nunca';
  document.getElementById('act-foto').value = '';
  const coordsEl2 = document.getElementById('act-coords');
  coordsEl2.value = ''; coordsEl2.dataset.lat = ''; coordsEl2.dataset.lng = ''; coordsEl2.dataset.precision = '';
  const txt2 = document.getElementById('act-coords-text'); if (txt2) txt2.textContent = '—';
  if (_actMap) { try { _actMap.remove(); } catch {} _actMap = null; const mEl = document.getElementById('act-map'); if (mEl) { mEl._leaflet_id = null; mEl.innerHTML = ''; } }
  document.getElementById('act-cliente-search').value = '';
  document.getElementById('act-cliente').value = '';
  document.getElementById('act-cliente').style.display = 'none';
  document.getElementById('act-cliente').innerHTML = '';
  document.getElementById('act-cliente-selected').style.display = 'none';
  document.getElementById('act-cliente-selected').textContent = '';
  await cargarActClientesCache();
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const fi = document.getElementById('act-fecha-inicio');
  const ff = document.getElementById('act-fecha-fin');
  fi.min = nowLocal; ff.min = nowLocal;
  fi.removeAttribute('max'); ff.removeAttribute('max');
  const tipoEl = document.getElementById('act-tipo');
  const estadoEl = document.getElementById('act-estado');
  tipoEl.onchange = actualizarActGPSGroup;
  estadoEl.onchange = actualizarActGPSGroup;
  actualizarActGPSGroup();
  showModal('modal-crear-actividad');
}

async function guardarActividad() {
  const clienteId = document.getElementById('act-cliente').value;
  const asunto = document.getElementById('act-asunto').value.trim();
  const descripcion = document.getElementById('act-descripcion').value.trim();
  const tipo = document.getElementById('act-tipo').value;
  const estado = document.getElementById('act-estado').value;
  const fechaInicioVal = document.getElementById('act-fecha-inicio').value;
  const fechaFinVal = document.getElementById('act-fecha-fin').value;
  if (!clienteId) return toast('Selecciona un cliente (busca por NIT o nombre y elige)', 'error');
  if (!asunto && !descripcion) return toast('Escribe el nombre de la actividad', 'error');
  const now = new Date(); now.setSeconds(0,0);
  if (fechaInicioVal && new Date(fechaInicioVal) < now) return toast('Fecha inicio no puede ser pasada (anti-fraude)', 'error');
  if (fechaFinVal && new Date(fechaFinVal) < now) return toast('Fecha fin no puede ser pasada (anti-fraude)', 'error');
  if (fechaInicioVal && fechaFinVal && new Date(fechaFinVal) < new Date(fechaInicioVal)) return toast('Fecha fin no puede ser anterior a inicio', 'error');

  const btn = document.getElementById('btn-guardar-actividad');
  const necesitaGPS = tipo === 'reunion' && (estado === 'en_proceso' || estado === 'realizada');
  if (necesitaGPS) {
    const coordsEl = document.getElementById('act-coords');
    if (!coordsEl.dataset.lat) {
      btn.disabled = true; btn.textContent = 'Obteniendo GPS...';
      await obtenerGPSActPromise();
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  }

  const fd = new FormData();
  fd.append('cliente_id', clienteId);
  fd.append('asunto', asunto);
  fd.append('descripcion', descripcion);
  fd.append('tipo_actividad', tipo);
  fd.append('lugar', document.getElementById('act-lugar').value);
  fd.append('fecha_inicio', document.getElementById('act-fecha-inicio').value || '');
  fd.append('fecha_fin', document.getElementById('act-fecha-fin').value || '');
  fd.append('estado', estado);
  fd.append('recordatorio', document.getElementById('act-recordatorio').value);
  const coordsEl = document.getElementById('act-coords');
  if (coordsEl.dataset.lat && coordsEl.dataset.lng) {
    fd.append('latitud', coordsEl.dataset.lat);
    fd.append('longitud', coordsEl.dataset.lng);
    fd.append('precision_gps', coordsEl.dataset.precision || '');
  }
  const foto = document.getElementById('act-foto').files[0];
  if (foto) fd.append('foto', foto);

  btn.disabled = true; btn.textContent = 'Guardando...';
  const r = await fetch(HF.API + '/actividades', { method: 'POST', credentials: 'include', body: fd });
  const data = await r.json().catch(() => ({}));
  btn.disabled = false; btn.textContent = 'Guardar';
  if (!r.ok) return toast(data.error || 'Error al crear', 'error');
  toast(necesitaGPS ? (estado === 'en_proceso' ? 'Check-in registrado' : 'Check-out registrado') : 'Actividad creada', 'success');
  hideModal('modal-crear-actividad');
  cargarVisitas();
}

async function abrirModalVisita(tipo) {
  document.getElementById('modal-visita-title').textContent = tipo === 'checkin' ? 'Check-in' : 'Check-out';
  document.getElementById('visita-tipo').value = tipo;
  document.getElementById('visita-coords').value = 'Obteniendo GPS...';
  document.getElementById('visita-notas').value = '';
  document.getElementById('visita-foto').value = '';
  document.getElementById('visita-asunto').value = '';
  document.getElementById('visita-lugar').value = '';
  document.getElementById('visita-tipo-actividad').value = 'visita';
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
  formData.append('asunto', document.getElementById('visita-asunto').value);
  formData.append('lugar', document.getElementById('visita-lugar').value);
  formData.append('tipo_actividad', document.getElementById('visita-tipo-actividad').value);
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
    const erpColors = { '': 'info', 'borrador': 'info', 'enviada': 'warning', 'aprobada': 'success', 'rechazada': 'danger', 'vencida': 'muted', 'convertida': 'success' };
    tbody.innerHTML = data.map(c => {
      const sinCPV = !c.documento_erp;
      const estadoErpHtml = sinCPV
        ? '<span class="badge badge-danger">No enviado</span>'
        : `<span class="badge badge-info">${esc(c.estado_erp)}</span>`;
      const docErpHtml = sinCPV ? '<span style="color:var(--muted)">—</span>' : esc(c.documento_erp);
      return `
      <tr class="${sinCPV ? 'row-no-erp' : ''}">
        <td><input type="checkbox" class="row-check cb-cotizacion" value="${c.id}" onchange="updateBulkBar()"></td>
        <td><a href="#" onclick="verCotizacion('${c.id}');return false" style="color:var(--accent);text-decoration:underline">${esc(c.numero)}</a></td>
        <td>${esc(c.cliente_nombre || '—')}</td>
        <td><span class="badge badge-${c.estado}">${esc(c.estado)}</span></td>
        <td>${c.total_items || 0}</td>
        <td><strong>$${formatMoney(c.valor_total || 0)}</strong></td>
        <td>${formatDate(c.vencimiento)}</td>
        <td>${estadoErpHtml}</td>
        <td>${docErpHtml}</td>
        <td>
          <button class="btn btn-sm btn-secondary btn-action" onclick="editarCotizacion('${c.id}')" title="Editar cotizacion" aria-label="Editar cotizacion ${esc(c.numero)}">✏️</button>
          ${c.estado === 'borrador' ? `<button class="btn btn-sm btn-danger btn-action" onclick="eliminarCotizacion('${c.id}')" title="Eliminar cotizacion" aria-label="Eliminar cotizacion ${esc(c.numero)}">🗑️</button>` : ''}
          ${c.estado === 'borrador' ? `<button class="btn btn-sm btn-primary btn-action" onclick="cambiarEstadoCotizacion('${c.id}','enviada')" title="Enviar cotizacion" aria-label="Enviar cotizacion ${esc(c.numero)}">📤</button>` : ''}
          ${c.estado === 'enviada' ? `<button class="btn btn-sm btn-primary btn-action" onclick="cambiarEstadoCotizacion('${c.id}','aprobada')" title="Aprobar cotizacion" aria-label="Aprobar cotizacion ${esc(c.numero)}">✅</button>` : ''}
          ${sinCPV ? `<button class="btn btn-sm btn-primary btn-action" onclick="enviarCotizacionERP('${c.id}','${esc(c.numero)}')" title="Enviar al ERP" aria-label="Enviar cotizacion ${esc(c.numero)} al ERP">🚀</button>` : ''}
        </td>
      </tr>
    `}).join('');

    renderPagination('pag-cotizaciones', r.data.total, _cotizacionesPage, _limit, (p) => { _cotizacionesPage = p; cargarCotizaciones(); });
    cargarStatsCotizaciones();
  } catch (err) { console.error('Error cargar cotizaciones:', err); }
}

async function cargarStatsCotizaciones() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-cotizacion-search')?.value;
    const estado = document.getElementById('filtro-cotizacion-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);

    const r = await apiFetch('/cotizaciones/stats?' + params);
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

async function bulkDeleteCotizaciones() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];
  if (mode === 'all') {
    const r = await apiFetch('/cotizaciones?limit=10000');
    if (!r.ok) return toast('Error al obtener cotizaciones', 'error');
    ids = (r.data.data || []).map(c => c.id);
  } else {
    ids = [...document.querySelectorAll('.cb-cotizacion:checked')].map(cb => cb.value);
  }
  if (!ids.length) return toast('No hay cotizaciones para eliminar', 'error');
  confirmar({ titulo: 'Eliminar cotizaciones', mensaje: `¿Eliminar ${ids.length} cotizacion(es)? Solo se eliminan las en borrador.`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/cotizaciones/seleccionados', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} cotizaciones eliminadas`, 'success');
    clearSelection();
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

async function enviarCotizacionERP(id, numero) {
  confirmar({ titulo: 'Enviar al ERP', mensaje: `¿Enviar cotización ${numero} al ERP?`, icono: '🚀', onConfirm: async () => {
    const r = await apiFetch('/cotizaciones/' + id + '/enviar-erp', { method: 'POST' });
    if (!r.ok) return toast(r.data?.error || 'Error al enviar al ERP', 'error');
    toast(r.data?.message || 'Cotización enviada al ERP', 'success');
    cargarCotizaciones();
  }});
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
      <tr style="cursor:pointer" onclick="verProducto('${p.id}')">
        <td><input type="checkbox" class="row-check cb-producto" value="${p.id}" onchange="event.stopPropagation();updateBulkBar()"></td>
        <td><strong>${esc(p.codigo)}</strong></td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.unidad_medida || 'UND')}</td>
        <td>$${formatMoney(p.precio_unitario || 0)}</td>
        <td>${p.tasa_impuesto || 0}%</td>
        <td>${esc(p.categoria || '—')}</td>
        <td>${esc(p.bodega || '—')}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarProducto('${p.id}')" title="Editar producto" aria-label="Editar producto ${esc(p.nombre)}">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarProducto('${p.id}')" title="Eliminar producto" aria-label="Eliminar producto ${esc(p.nombre)}">🗑️</button>
        </td>
      </tr>
    `).join('');

    renderPagination('pag-productos', r.data.total, _productosPage, 50, (p) => { _productosPage = p; cargarProductos(); });
    cargarStatsProductos();
  } catch (err) { console.error('Error cargar productos:', err); }
}

async function cargarStatsProductos() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-producto-search')?.value;
    const categoria = document.getElementById('filtro-producto-categoria')?.value;
    if (search) params.set('search', search);
    if (categoria) params.set('categoria', categoria);

    const r = await apiFetch('/productos/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    const topCat = (d.por_categoria || []).slice(0, 2).map(c => `${esc(c.categoria || 'Sin categoria')}: ${c.total}`).join(' · ') || '—';
    document.getElementById('stats-productos').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Productos</div></div>
      <div class="stat-card"><div class="stat-value">${d.con_precio || 0}</div><div class="stat-label">Con precio</div></div>
      <div class="stat-card"><div class="stat-value">${d.sin_categoria || 0}</div><div class="stat-label">Sin categoria</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px;line-height:1.3">${topCat}</div><div class="stat-label">Top categorias</div></div>
    `;
  } catch {}
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
  const codigoInput = document.getElementById('producto-codigo');
  codigoInput.readOnly = !!producto;
  codigoInput.title = producto ? 'El codigo de referencia no se puede editar' : '';
  showModal('modal-producto');
}

async function editarProducto(id) {
  const r = await apiFetch('/productos/' + id);
  if (!r.ok) return toast(r.data?.error || 'Producto no encontrado', 'error');
  abrirModalProducto(r.data.data);
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

  const url = id ? '/productos/' + id : '/productos';
  const method = id ? 'PUT' : 'POST';
  // codigo es identificador interno, no se envia en edicion
  const payload = id ? (({ codigo, ...rest }) => rest)(body) : body;
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Producto actualizado' : 'Producto creado', 'success');
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

async function verProducto(id) {
  const r = await apiFetch('/productos/' + id);
  if (!r.ok) return toast(r.data?.error || 'Producto no encontrado', 'error');
  const p = r.data.data;

  // Fetch EANs, inventory, prices
  const [eanR, invR, priceR] = await Promise.all([
    apiFetch('/productos/' + id + '/ean'),
    apiFetch('/productos/' + id + '/inventario'),
    apiFetch('/productos/' + id + '/precios')
  ]);
  const eans = eanR.ok ? (eanR.data.data || []) : [];
  const inventario = invR.ok ? (invR.data.data || []) : [];
  const precios = priceR.ok ? (priceR.data.data || []) : [];

  const totalInv = inventario.reduce((s, i) => s + parseFloat(i.existencia || 0), 0);

  document.getElementById('detalle-producto-title').textContent = p.nombre;
  document.getElementById('detalle-producto-content').innerHTML = `
    <!-- Tabs -->
    <div style="display:flex;gap:16px;border-bottom:1px solid var(--border);margin-bottom:16px">
      <button class="tab-btn active" onclick="cambiarTabProducto('info',this)">Informacion Basica</button>
      <button class="tab-btn" onclick="cambiarTabProducto('precios',this)">Precios (${precios.length})</button>
      <button class="tab-btn" onclick="cambiarTabProducto('inventario',this)">Inventario (${inventario.length})</button>
      <button class="tab-btn" onclick="cambiarTabProducto('ean',this)">Codigos de Barras (${eans.length})</button>
    </div>

    <!-- Tab Info Basica -->
    <div id="tab-producto-info">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
        <div><strong>ID Item:</strong> ${esc(p.codigo)}</div>
        <div><strong>Referencia:</strong> ${esc(p.codigo)}</div>
        <div><strong>Descripcion:</strong> ${esc(p.nombre)}</div>
        <div><strong>Unidad:</strong> ${esc(p.unidad_medida || '—')}</div>
        <div><strong>Precio base:</strong> $${formatMoney(p.precio_unitario || 0)}</div>
        <div><strong>Impuesto:</strong> ${p.tasa_impuesto || 0}%</div>
        <div><strong>Categoria:</strong> ${esc(p.categoria || '—')}</div>
        <div><strong>Bodega:</strong> ${esc(p.bodega || '—')}</div>
        <div><strong>Estado:</strong> <span class="badge badge-${p.activo ? 'aprobada' : 'rechazada'}">${p.activo ? 'Activo' : 'Inactivo'}</span></div>
      </div>
      ${p.descripcion ? `<div style="margin-bottom:12px"><strong>Descripcion completa:</strong><br>${esc(p.descripcion)}</div>` : ''}
      ${p.marca ? `<div style="margin-bottom:12px"><strong>Marca:</strong> ${esc(p.marca)}</div>` : ''}
    </div>

    <!-- Tab Precios -->
    <div id="tab-producto-precios" style="display:none">
      ${precios.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Lista de precio</th><th>U.M.</th><th>Moneda</th><th>Precio</th>
      </tr></thead><tbody>
        ${precios.map(pr => `<tr>
          <td>${esc(pr.lista_nombre || '—')}</td>
          <td>${esc(pr.unidad_medida || '—')}</td>
          <td>${esc(pr.moneda || 'COP')}</td>
          <td><strong>$${formatMoney(pr.precio || 0)}</strong></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">No hay precios configurados para este producto</p>'}
    </div>

    <!-- Tab Inventario -->
    <div id="tab-producto-inventario" style="display:none">
      ${inventario.length ? `
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>ID Bodega</th><th>Bodega</th><th>Existencia</th><th>Comprometida</th><th>Disponible</th>
        </tr></thead><tbody>
          ${inventario.map(inv => `<tr>
            <td>${esc(inv.bodega || '—')}</td>
            <td>${esc(inv.bodega || '—')}</td>
            <td>${inv.existencia || 0}</td>
            <td>${inv.comprometida || 0}</td>
            <td><strong>${(parseFloat(inv.existencia || 0) - parseFloat(inv.comprometida || 0))}</strong></td>
          </tr>`).join('')}
        </tbody></table></div>
        <div style="text-align:right;font-weight:600;margin-top:8px">Total: ${totalInv}</div>
      ` : '<p style="color:var(--muted)">No hay datos de inventario para este producto</p>'}
    </div>

    <!-- Tab Codigos de Barras -->
    <div id="tab-producto-ean" style="display:none">
      ${eans.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>GTIN</th><th>Descripcion</th><th>U.M.</th><th>Principal</th>
      </tr></thead><tbody>
        ${eans.map(e => `<tr>
          <td><strong>${esc(e.gtin)}</strong></td>
          <td>${esc(e.descripcion || '—')}</td>
          <td>${esc(e.unidad_medida || '—')}</td>
          <td>${e.es_principal ? '<span class="badge badge-aprobada">Principal</span>' : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin codigos de barras registrados</p>'}
    </div>

    ${p.foto_url ? `<div style="margin-top:16px"><img src="${esc(p.foto_url)}" style="max-width:200px;border-radius:8px;border:1px solid var(--border)"></div>` : ''}
  `;
  showModal('modal-detalle-producto');
}

function cambiarTabProducto(tab, btn) {
  document.querySelectorAll('#modal-detalle-producto [id^="tab-producto-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#modal-detalle-producto .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-producto-' + tab).style.display = '';
  btn.classList.add('active');
}

async function bulkDeleteProductos() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];
  if (mode === 'all') {
    const r = await apiFetch('/productos?limit=10000');
    if (!r.ok) return toast('Error al obtener productos', 'error');
    ids = (r.data.data || []).map(p => p.id);
  } else {
    ids = [...document.querySelectorAll('.cb-producto:checked')].map(cb => cb.value);
  }
  if (!ids.length) return toast('No hay productos para eliminar', 'error');
  confirmar({ titulo: 'Eliminar productos', mensaje: `¿Eliminar ${ids.length} producto(s)?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/productos/seleccionados', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} productos eliminados`, 'success');
    clearSelection();
    cargarProductos();
  }});
}

// ── Inventario ──
let _invPage = 1;
let _invLimit = 50;

async function cargarInventario() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-inv-search')?.value;
    const bodega = document.getElementById('filtro-inv-bodega')?.value;
    const stock = document.getElementById('filtro-inv-stock')?.value;
    if (search) params.set('search', search);
    if (bodega) params.set('bodega', bodega);
    if (stock) params.set('stock', stock);
    params.set('page', _invPage);
    params.set('limit', _invLimit);

    const r = await apiFetch('/inventario?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-inventario');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(inv => {
      const disponible = parseFloat(inv.existencia || 0) - parseFloat(inv.comprometida || 0);
      return `<tr>
        <td><strong>${esc(inv.codigo)}</strong></td>
        <td>${esc(inv.nombre)}</td>
        <td>${esc(inv.bodega)}</td>
        <td>${inv.existencia || 0}</td>
        <td>${inv.comprometida || 0}</td>
        <td><strong style="color:${disponible > 0 ? 'var(--success)' : 'var(--danger)'}">${disponible}</strong></td>
        <td>$${formatMoney(inv.precio || 0)}</td>
        <td>${esc(inv.unidad_medida || '—')}</td>
      </tr>`;
    }).join('');

    renderPagination('pag-inventario', r.data.total, _invPage, _invLimit, (p) => { _invPage = p; cargarInventario(); });
    cargarBodegasSelect();
    cargarStatsInventario();
  } catch (err) { console.error('Error cargar inventario:', err); }
}

async function cargarBodegasSelect() {
  try {
    const r = await apiFetch('/inventario/bodegas');
    if (!r.ok) return;
    const select = document.getElementById('filtro-inv-bodega');
    const current = select?.value || '';
    select.innerHTML = '<option value="">Todas las bodegas</option>' +
      (r.data.data || []).map(b => `<option value="${esc(b.bodega)}" ${b.bodega === current ? 'selected' : ''}>${esc(b.bodega)} (${b.productos} productos, ${b.total_existencia} uds)</option>`).join('');
  } catch {}
}

async function cargarStatsInventario() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-inv-search')?.value;
    const bodega = document.getElementById('filtro-inv-bodega')?.value;
    const stock = document.getElementById('filtro-inv-stock')?.value;
    if (search) params.set('search', search);
    if (bodega) params.set('bodega', bodega);
    if (stock) params.set('stock', stock);

    const r = await apiFetch('/inventario/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-inventario').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total_registros || 0}</div><div class="stat-label">Registros</div></div>
      <div class="stat-card"><div class="stat-value">${d.bodegas || 0}</div><div class="stat-label">Bodegas</div></div>
      <div class="stat-card"><div class="stat-value">${d.productos_con_stock || 0}</div><div class="stat-label">Con stock</div></div>
      <div class="stat-card"><div class="stat-value">${formatMoney(d.total_existencia || 0)}</div><div class="stat-label">Total unidades</div></div>
    `;
  } catch {}
}

function limpiarFiltrosInventario() {
  document.getElementById('filtro-inv-search').value = '';
  document.getElementById('filtro-inv-bodega').value = '';
  document.getElementById('filtro-inv-stock').value = '';
  _invPage = 1;
  cargarInventario();
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

  // Show order hint for initial imports
  const orderHint = document.getElementById('importar-orden-hint');
  const orderText = document.getElementById('importar-orden-texto');
  const orderMap = {
    bodegas: 'Primero ← Después: Items, Inventario',
    items: '← Después: Precios, Inventario, Códigos barras',
    codigos_barra: '← Después: Precios',
    precios: '← Después: Inventario',
    inventario: '← Después: Clientes',
    clientes: '← Después: Vendedores',
    vendedores: 'Último'
  };
  if (orderMap[tipo]) {
    orderText.textContent = orderMap[tipo];
    orderHint.style.display = '';
  } else {
    orderHint.style.display = 'none';
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

  const div = document.getElementById('importar-resultado');
  div.innerHTML = `
    <div style="padding:12px;background:var(--surface2);border-radius:8px;font-size:13px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div class="spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div>
        <span id="importar-status">Procesando...</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">
        <div id="importar-progress-bar" style="height:100%;background:var(--accent);width:0%;transition:width .2s"></div>
      </div>
      <div id="importar-progress-text" style="font-size:11px;color:var(--muted);margin-top:4px">0 / 0 registros</div>
    </div>
  `;

  try {
    const response = await fetch(HF.API + '/importar', { method: 'POST', credentials: 'include', body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress') {
            const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
            document.getElementById('importar-progress-bar').style.width = pct + '%';
            document.getElementById('importar-progress-text').textContent = `${data.current} / ${data.total} registros (${pct}%)`;
            document.getElementById('importar-status').textContent = `Procesando ${data.current} de ${data.total}...`;
          } else if (data.type === 'done') {
            document.getElementById('importar-progress-bar').style.width = '100%';
            document.getElementById('importar-progress-bar').style.background = 'var(--success)';
            document.getElementById('importar-status').textContent = '✅ Importación completada';
            div.innerHTML = `
              <div style="padding:12px;background:#d4edda;border-radius:8px;font-size:13px">
                <div style="font-weight:600;margin-bottom:8px">✅ Importación completada — ${tipo}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px">
                  ${data.insertados !== undefined ? `<div><strong>${data.insertados}</strong><br><span style="font-size:11px;color:var(--muted)">Insertados</span></div>` : ''}
                  ${data.actualizados !== undefined ? `<div><strong>${data.actualizados}</strong><br><span style="font-size:11px;color:var(--muted)">Actualizados</span></div>` : ''}
                  ${data.sucursales !== undefined ? `<div><strong>${data.sucursales}</strong><br><span style="font-size:11px;color:var(--muted)">Sucursales</span></div>` : ''}
                  ${data.contactos !== undefined ? `<div><strong>${data.contactos}</strong><br><span style="font-size:11px;color:var(--muted)">Contactos</span></div>` : ''}
                  ${data.listas !== undefined ? `<div><strong>${data.listas}</strong><br><span style="font-size:11px;color:var(--muted)">Listas precio</span></div>` : ''}
                  <div><strong>${data.fallidos || 0}</strong><br><span style="font-size:11px;color:var(--muted)">Fallidos</span></div>
                </div>
                ${data.errores?.length ? `<div style="margin-top:8px;font-size:11px;color:var(--muted);max-height:100px;overflow-y:auto">${data.errores.join('<br>')}</div>` : ''}
              </div>
            `;
            toast(`${data.insertados} insertados, ${data.actualizados} actualizados`, 'success');
          }
        } catch {}
      }
    }
  } catch (e) {
    div.innerHTML = `<div style="padding:12px;background:#f8d7da;border-radius:8px;color:#721c24;font-size:13px">❌ Error de red: ${e.message}</div>`;
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

// ── Admin Perfiles Venta ──
const CRM_PERMISOS = ['ver','crear_contacto','editar_contacto','eliminar_contacto','ver_pipeline','editar_pipeline','crear_oportunidad','registrar_visita','ver_visitas','ver_mis_visitas','crear_cotizacion','aprobar_descuento','campanas','reportes','configurar','siesa_sync'];
let _perfilesVentaCache=[];

async function cargarAdmin(){
  document.getElementById('btn-volver-admin').style.display='none';
  const misPermisos = await apiFetch('/perfiles-venta/me/mis-permisos');
  const perms = new Set((misPermisos.ok && misPermisos.data?.permisos) || []);
  const esAdmin = usuario?.rol==='admin';
  const puedeConfigurar = esAdmin || perms.has('configurar') || perms.has('siesa_sync');
  const puedeAprobar = esAdmin || perms.has('aprobar_descuento');
  const puedeVerAdmin = esAdmin || puedeConfigurar || puedeAprobar;
  // Ocultar/mostrar Admin en sidebar según permisos
  const navAdmin = document.querySelector('.nav-item[data-page="admin"]');
  if (navAdmin) navAdmin.style.display = puedeVerAdmin ? '' : 'none';
  // Si no tiene acceso, mostrar aviso
  if (!puedeVerAdmin) {
    document.getElementById('admin-cards').innerHTML='<p style="color:var(--muted)">No tienes permisos de administración.</p>';
    adminAbrirInicio();
    return;
  }
  const cards=[
    {icon:'👥',titulo:'Perfiles de Venta',desc:'Crear/editar perfiles y asignar vendedores',seccion:'perfiles',perm:true},
    {icon:'📥',titulo:'Importar SIESA',desc:'Cargar datos desde archivos del ERP/CRM',seccion:'importar',perm:puedeConfigurar},
    {icon:'💰',titulo:'Descuentos pendientes',desc:'Solicitudes por aprobar',seccion:'descuentos',perm:puedeAprobar},
    {icon:'🔄',titulo:'Sincronizar ERP',desc:'SIESA Hub (cuando esté disponible)',seccion:'siesa',perm:puedeConfigurar},
  ];
  document.getElementById('admin-cards').innerHTML=cards.filter(c=>c.perm).map(c=>`
    <div onclick="adminAbrirSeccion('${c.seccion}')" style="border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--surface);cursor:pointer;transition:.15s">
      <div style="font-size:28px">${c.icon}</div>
      <div style="font-weight:600;margin-top:8px">${c.titulo}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${c.desc}</div>
    </div>`).join('');
  adminAbrirInicio();
}
function adminAbrirInicio(){
  document.getElementById('admin-inicio').style.display='';
  document.getElementById('admin-seccion').style.display='none';
  ocultarVolverAdmin();
}
function adminVolver(){ adminAbrirInicio(); }
function mostrarVolverAdmin(texto){
  const b=document.getElementById('btn-volver-admin');
  if(!b) return;
  b.textContent=texto||'← Volver';
  b.style.display='';
  _volverAdminFn = (texto && texto.includes('Admin')) ? function(){ navigate('admin'); } : adminAbrirInicio;
}
function ocultarVolverAdmin(){
  const b=document.getElementById('btn-volver-admin');
  if(b){ b.style.display='none'; b.textContent='← Volver'; }
  _volverAdminFn=null;
}
let _volverAdminFn=null;
function volverDesdeAdmin(){
  const b=document.getElementById('btn-volver-admin');
  if(b) b.style.display='none';
  if(typeof _volverAdminFn==='function'){ _volverAdminFn(); return; }
  navigate('admin');
}
async function adminAbrirSeccion(seccion){
  // Secciones que navegan a una página propia (botón header '← Volver a Admin')
  if(seccion==='importar' || seccion==='descuentos'){
    mostrarVolverAdmin('← Volver a Admin');
    navigate(seccion);
    return;
  }
  // Sub-vistas internas (botón header '← Volver')
  const cont=document.getElementById('admin-seccion');
  document.getElementById('admin-inicio').style.display='none';
  mostrarVolverAdmin('← Volver');
  cont.style.display='';
  if(seccion==='perfiles'){
    cont.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Perfiles de Venta</h3><button class="btn btn-sm btn-primary" onclick="abrirModalPerfilVenta()">+ Nuevo Perfil</button></div><p style="color:var(--muted);font-size:12px">Si un usuario no está asignado a ningún perfil, no podrá crear cotizaciones (solo lectura).</p><div id="perfiles-venta-list" style="display:grid;gap:12px"></div>';
    cargarPerfilesVenta();
  } else if(seccion==='siesa'){
    cont.innerHTML='<h3 style="margin:0 0 12px">Sincronizar con SIESA Hub</h3><p style="color:var(--muted);font-size:13px">Integración con la API de SIESA Hub en preparación. Por ahora se importa por CSV desde la sección Importar SIESA.</p>';
  }
}
async function cargarPerfilesVenta(){
  const r=await apiFetch('/perfiles-venta');
  if(!r.ok) return toast(r.data?.error||'Error cargando perfiles','error');
  _perfilesVentaCache=r.data.data||[];
  const c=document.getElementById('perfiles-venta-list');
  if(!c) return;
  c.innerHTML=_perfilesVentaCache.map(p=>`
    <div style="border:1px solid var(--border);border-radius:10px;padding:14px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><strong>${esc(p.nombre)}</strong> <span style="color:var(--muted);font-size:12px">(${p.usuarios_count} usuarios)</span><br><span style="color:var(--muted);font-size:12px">${esc(p.descripcion||'')}</span><br><span style="font-size:11px;color:var(--muted)">${(p.permisos||[]).join(', ')||'sin permisos'}</span></div>
        <div style="display:flex;gap:6px;align-items:start">
          <button class="btn btn-sm btn-secondary" onclick="abrirModalPerfilVentaUsuarios(${p.id})">Usuarios</button>
          <button class="btn btn-sm btn-secondary" onclick="abrirModalPerfilVenta(${p.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarPerfilVenta(${p.id})">Eliminar</button>
        </div>
      </div>
    </div>`).join('') || '<p style="color:var(--muted)">Sin perfiles</p>';
}
function abrirModalPerfilVenta(id){
  const p=id? _perfilesVentaCache.find(x=>x.id===id):null;
  document.getElementById('perfil-venta-id').value=p?.id||'';
  document.getElementById('perfil-venta-nombre').value=p?.nombre||'';
  document.getElementById('perfil-venta-desc').value=p?.descripcion||'';
  const cont=document.getElementById('perfil-venta-permisos');
  cont.innerHTML=CRM_PERMISOS.map(perm=>`<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" value="${perm}" ${(p?.permisos||[]).includes(perm)?'checked':''}> ${perm}</label>`).join('');
  showModal('modal-perfil-venta');
}
async function guardarPerfilVenta(){
  const id=document.getElementById('perfil-venta-id').value;
  const nombre=document.getElementById('perfil-venta-nombre').value.trim();
  const descripcion=document.getElementById('perfil-venta-desc').value.trim();
  const permisos=[...document.querySelectorAll('#perfil-venta-permisos input:checked')].map(i=>i.value);
  if(!nombre) return toast('Nombre requerido','error');
  const r=id? await apiFetch('/perfiles-venta/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre,descripcion,permisos})})
             : await apiFetch('/perfiles-venta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre,descripcion,permisos})});
  if(!r.ok) return toast(r.data?.error||'Error','error');
  hideModal('modal-perfil-venta'); cargarPerfilesVenta();
}
async function eliminarPerfilVenta(id){
  confirmar({titulo:'Eliminar perfil',mensaje:'¿Eliminar perfil de venta?',icono:'🗑️',onConfirm: async()=>{
    const r=await apiFetch('/perfiles-venta/'+id,{method:'DELETE'}); if(!r.ok) return toast(r.data?.error||'Error','error');
    toast('Eliminado','success'); cargarPerfilesVenta();
  }});
}
let _perfilVentaUsuariosCache=[];
async function abrirModalPerfilVentaUsuarios(id){
  document.getElementById('perfil-venta-usuarios-id').value=id;
  const title=_perfilesVentaCache.find(x=>x.id===id)?.nombre||'';
  document.getElementById('perfil-venta-usuarios-title').textContent='Asignar usuarios — '+title;
  const r=await apiFetch('/perfiles-venta/'+id+'/usuarios'); if(!r.ok) return toast(r.data?.error||'Error','error');
  _perfilVentaUsuariosCache=r.data.usuarios||[];
  const asignados=new Set(r.data.asignados||[]);
  document.getElementById('perfil-venta-usuarios-lista').innerHTML=_perfilVentaUsuariosCache.map(u=>`<label style="display:flex;gap:8px;align-items:center;padding:6px;border-bottom:1px solid var(--border)"><input type="checkbox" value="${u.id}" ${asignados.has(u.id)?'checked':''}> <span style="flex:1"><strong>${esc(u.nombre)}</strong> <span style="color:var(--muted)">${esc(u.email||'')}</span></span><span style="font-size:11px;color:var(--muted)">${esc(u.rol||'')}</span></label>`).join('');
  document.getElementById('perfil-venta-usuarios-filtro').value='';
  showModal('modal-perfil-venta-usuarios');
}
function filtrarPerfilVentaUsuarios(){
  const q=document.getElementById('perfil-venta-usuarios-filtro').value.toLowerCase();
  document.querySelectorAll('#perfil-venta-usuarios-lista label').forEach(l=>{ l.style.display=l.textContent.toLowerCase().includes(q)?'':'none'; });
}
function perfilVentaSelTodos(v){
  document.querySelectorAll('#perfil-venta-usuarios-lista input[type=checkbox]').forEach(cb=>{ if(cb.closest('label').style.display!=='none') cb.checked=v; });
}
async function guardarPerfilVentaUsuarios(){
  const id=document.getElementById('perfil-venta-usuarios-id').value;
  const usuario_ids=[...document.querySelectorAll('#perfil-venta-usuarios-lista input:checked')].map(i=>parseInt(i.value));
  const r=await apiFetch('/perfiles-venta/'+id+'/usuarios',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario_ids})});
  if(!r.ok) return toast(r.data?.error||'Error','error');
  toast('Asignaciones guardadas','success'); hideModal('modal-perfil-venta-usuarios'); cargarPerfilesVenta();
}
