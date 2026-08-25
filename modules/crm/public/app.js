let usuario = null;
let _empresasPage = 1;
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
const pages = ['dashboard', 'empresas', 'contactos'];
function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (el) el.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', empresas: 'Empresas', contactos: 'Contactos' };
  document.getElementById('page-title').textContent = titles[page] || 'CRM';
  if (page === 'dashboard') cargarDashboard();
  if (page === 'empresas') cargarEmpresas();
  if (page === 'contactos') cargarContactos();
}

// ── Dashboard ──
async function cargarDashboard() {
  try {
    const r = await apiFetch('/dashboard');
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.empresas_total || 0}</div><div class="stat-label">Empresas</div></div>
      <div class="stat-card"><div class="stat-value">${d.contactos_total || 0}</div><div class="stat-label">Contactos</div></div>
      <div class="stat-card"><div class="stat-value">${(d.empresas_por_tipo || []).find(t => t.tipo === 'potencial')?.total || 0}</div><div class="stat-label">Potenciales</div></div>
      <div class="stat-card"><div class="stat-value">${(d.empresas_por_tipo || []).find(t => t.tipo === 'real')?.total || 0}</div><div class="stat-label">Clientes Reales</div></div>
    `;
    const recientes = d.empresas_recientes || [];
    if (recientes.length) {
      document.getElementById('empresas-recientes').innerHTML = `
        <h4 style="margin-bottom:12px">Empresas Recientes</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Tipo</th><th>Ciudad</th><th>Creado</th></tr></thead><tbody>
          ${recientes.map(e => `<tr><td>${esc(e.nombre)}</td><td><span class="badge badge-${esc(e.tipo)}">${esc(e.tipo)}</span></td><td>${esc(e.ciudad || '—')}</td><td>${formatDate(e.creado_en)}</td></tr>`).join('')}
        </tbody></table></div>
      `;
    }
  } catch (err) { console.error('Dashboard error:', err); }
}

// ── Empresas ──
async function cargarEmpresas() {
  const search = document.getElementById('filtro-empresa-search').value;
  const tipo = document.getElementById('filtro-empresa-tipo').value;
  const params = new URLSearchParams({ page: _empresasPage, limit: _limit });
  if (search) params.set('search', search);
  if (tipo) params.set('tipo', tipo);
  const r = await apiFetch('/empresas?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-empresas');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(e => `
    <tr>
      <td><input type="checkbox" class="select-empresa" value="${e.id}"></td>
      <td><a href="#" onclick="verEmpresa('${e.id}');return false" style="color:var(--accent)">${esc(e.nombre)}</a></td>
      <td>${esc(e.nit || '—')}</td>
      <td><span class="badge badge-${esc(e.tipo)}">${esc(e.tipo)}</span></td>
      <td>${esc(e.ciudad || '—')}</td>
      <td>${e.total_contactos || 0}</td>
      <td>${formatDate(e.creado_en)}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editarEmpresa('${e.id}')" title="Editar">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarEmpresa('${e.id}')" title="Eliminar">🗑️</button>
      </td>
    </tr>
  `).join('');
  renderPagination('pag-empresas', r.data.total, _empresasPage, _limit, (p) => { _empresasPage = p; cargarEmpresas(); });
  // Cargar ciudades para filtro
  const ciudades = [...new Set(data.map(e => e.ciudad).filter(Boolean))];
  const sel = document.getElementById('filtro-empresa-ciudad');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todas las ciudades</option>' + ciudades.map(c => `<option value="${esc(c)}" ${c === actual ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function limpiarFiltrosEmpresas() {
  document.getElementById('filtro-empresa-search').value = '';
  document.getElementById('filtro-empresa-tipo').value = '';
  document.getElementById('filtro-empresa-ciudad').value = '';
  _empresasPage = 1;
  cargarEmpresas();
}

async function verEmpresa(id) {
  const r = await apiFetch('/empresas/' + id);
  if (!r.ok) return;
  const e = r.data.data;
  const contactos = e.contactos || [];
  document.getElementById('detalle-empresa-title').textContent = e.nombre;
  document.getElementById('detalle-empresa-content').innerHTML = `
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
  abrirModal('modal-detalle-empresa');
}

function abrirModalEmpresa(empresa = null) {
  document.getElementById('modal-empresa-title').textContent = empresa ? 'Editar Empresa' : 'Nueva Empresa';
  document.getElementById('empresa-id').value = empresa?.id || '';
  document.getElementById('empresa-nombre').value = empresa?.nombre || '';
  document.getElementById('empresa-nit').value = empresa?.nit || '';
  document.getElementById('empresa-tipo').value = empresa?.tipo || 'potencial';
  document.getElementById('empresa-sector').value = empresa?.sector || '';
  document.getElementById('empresa-direccion').value = empresa?.direccion || '';
  document.getElementById('empresa-ciudad').value = empresa?.ciudad || '';
  document.getElementById('empresa-telefono').value = empresa?.telefono || '';
  document.getElementById('empresa-email').value = empresa?.email || '';
  document.getElementById('empresa-website').value = empresa?.website || '';
  document.getElementById('empresa-notas').value = empresa?.notas || '';
  abrirModal('modal-empresa');
}

async function editarEmpresa(id) {
  const r = await apiFetch('/empresas/' + id);
  if (!r.ok) return;
  abrirModalEmpresa(r.data.data);
}

async function guardarEmpresa() {
  const id = document.getElementById('empresa-id').value;
  const body = {
    nombre: document.getElementById('empresa-nombre').value,
    nit: document.getElementById('empresa-nit').value || null,
    tipo: document.getElementById('empresa-tipo').value,
    sector: document.getElementById('empresa-sector').value || null,
    direccion: document.getElementById('empresa-direccion').value || null,
    ciudad: document.getElementById('empresa-ciudad').value || null,
    telefono: document.getElementById('empresa-telefono').value || null,
    email: document.getElementById('empresa-email').value || null,
    website: document.getElementById('empresa-website').value || null,
    notas: document.getElementById('empresa-notas').value || null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  const r = id
    ? await apiFetch('/empresas/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/empresas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Empresa actualizada' : 'Empresa creada', 'success');
  cerrarModal('modal-empresa');
  cargarEmpresas();
}

async function eliminarEmpresa(id) {
  confirmModal('¿Eliminar esta empresa?', 'Eliminar', 'delete', async () => {
    const r = await apiFetch('/empresas/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Empresa eliminada', 'success');
    cargarEmpresas();
  });
}

// ── Contactos ──
async function cargarContactos() {
  const search = document.getElementById('filtro-contacto-search').value;
  const empresaId = document.getElementById('filtro-contacto-empresa').value;
  const params = new URLSearchParams({ page: _contactosPage, limit: _limit });
  if (search) params.set('search', search);
  if (empresaId) params.set('empresa_id', empresaId);
  const r = await apiFetch('/contactos?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-contactos');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(c => `
    <tr>
      <td><input type="checkbox" class="select-contacto" value="${c.id}"></td>
      <td>${esc(c.nombre)}</td>
      <td>${esc(c.empresa_nombre || '—')}</td>
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
  // Cargar empresas en select de filtro
  await cargarEmpresasSelect('filtro-contacto-empresa', empresaId);
}

function limpiarFiltrosContactos() {
  document.getElementById('filtro-contacto-search').value = '';
  document.getElementById('filtro-contacto-empresa').value = '';
  _contactosPage = 1;
  cargarContactos();
}

async function cargarEmpresasSelect(selectId, selectedId) {
  const r = await apiFetch('/empresas?limit=500');
  if (!r.ok) return;
  const sel = document.getElementById(selectId);
  const actual = selectedId || sel.value;
  sel.innerHTML = '<option value="">Todas las empresas</option>' +
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
  await cargarEmpresasSelect('contacto-empresa', contacto?.empresa_id);
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
    empresa_id: document.getElementById('contacto-empresa').value,
    nombre: document.getElementById('contacto-nombre').value,
    cargo: document.getElementById('contacto-cargo').value || null,
    email: document.getElementById('contacto-email').value || null,
    telefono: document.getElementById('contacto-telefono').value || null,
    whatsapp: document.getElementById('contacto-whatsapp').value || null,
    es_decision_maker: document.getElementById('contacto-decision').value === 'true',
    notas: document.getElementById('contacto-notas').value || null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if (!body.empresa_id) return toast('Seleccione una empresa', 'error');
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
