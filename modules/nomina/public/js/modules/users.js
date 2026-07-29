// users.js - User management (read-only + employee assignments)
// User CRUD (create, edit, delete, reset password) is managed from the Launcher.
// This module only handles employee assignments (usuario_empleados).

let _empAsigSeleccionados = new Set();

function renderUsuarios() {
  poblarSedesUsuarios();
  const tbody = document.getElementById('usuarios-body');
  if (!tbody) return;

  const q = (document.getElementById('usr-buscar')?.value || '').toLowerCase();
  const filRol = document.getElementById('usr-fil-rol')?.value || '';
  const filSede = document.getElementById('usr-fil-sede')?.value || '';
  const filEstado = document.getElementById('usr-fil-estado')?.value || '';

  let data = usuarios;
  if (q) data = data.filter(u => u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  if (filRol) data = data.filter(u => u.rol === filRol);
  if (filSede) data = data.filter(u => u.sede === filSede);
  if (filEstado !== '') data = data.filter(u => String(u.activo) === filEstado);

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">🔐</div><div class="empty-text">No hay usuarios</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = data.map(u => `<tr>
    <td data-label="Nombre"><strong>${esc(u.nombre)}</strong></td>
    <td data-label="Email">${esc(u.email)}</td>
    <td data-label="Rol"><span class="badge badge-${esc(u.rol)}">${esc(rolLabel(u.rol))}</span></td>
    <td data-label="Sede"><span style="font-size:12px;color:var(--accent)">📍 ${esc(u.sede||'—')}</span></td>
    <td data-label="Estado"><span class="badge badge-${u.activo?'activo':'inactivo'}">${u.activo?'Activo':'Inactivo'}</span></td>
    <td data-label="Creado">${esc(fmtDate(u.creado))}</td>
    <td data-label="Acciones"><div class="actions-cell">
      <button class="btn btn-secondary btn-sm" onclick="asignarEmpleados('${esc(u.id)}')" title="Asignar empleados">👥 Asignar</button>
    </div></td>
  </tr>`).join('');
}

// ── Employee assignment modal ──

function renderEmpModal(filtro = '') {
  const q = filtro.toLowerCase();
  const lista = q
    ? empleados.filter(e =>
        e.nombre.toLowerCase().includes(q) ||
        (e.cargo||'').toLowerCase().includes(q) ||
        (e.sede||'').toLowerCase().includes(q)
      )
    : empleados;

  const container = document.getElementById('usr-emp-list');
  if (!container) return;

  if (!lista.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:12px;">Sin resultados</div>';
    return;
  }
  container.innerHTML = lista.map(e => {
    const checked = _empAsigSeleccionados.has(e.id);
    return `<label style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:7px;cursor:pointer;transition:background 0.1s;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='transparent'">
      <input type="checkbox" value="${esc(e.id)}" ${checked?'checked':''} onchange="toggleEmpAsig('${esc(e.id)}',this.checked)"
        style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer;flex-shrink:0;">
      <span style="flex:1;min-width:0;">
        <span style="font-size:13px;font-weight:500;">${esc(e.nombre)}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:6px;">${esc(e.cargo||'')} · 📍${esc(e.sede||'')}</span>
      </span>
    </label>`;
  }).join('');
  actualizarContadorEmp();
}

function toggleEmpAsig(id, checked) {
  if (checked) _empAsigSeleccionados.add(id);
  else         _empAsigSeleccionados.delete(id);
  actualizarContadorEmp();
}

function filtrarEmpModal() {
  const q = document.getElementById('usr-emp-search')?.value || '';
  renderEmpModal(q);
}

function seleccionarTodosEmp(sel) {
  if (sel) empleados.forEach(e => _empAsigSeleccionados.add(e.id));
  else     _empAsigSeleccionados.clear();
  renderEmpModal(document.getElementById('usr-emp-search')?.value || '');
}

function actualizarContadorEmp() {
  const n = _empAsigSeleccionados.size;
  const el = document.getElementById('usr-emp-count');
  if (el) el.textContent = n > 0 ? `${n} seleccionado${n>1?'s':''}` : 'Sin restricción';
}

let _asignandoUsuarioId = null;

function asignarEmpleados(userId) {
  _asignandoUsuarioId = userId;
  const u = usuarios.find(u => u.id === userId);
  document.getElementById('modal-emp-title').textContent = `Empleados de ${u?.nombre || 'Usuario'}`;

  _empAsigSeleccionados = new Set();
  const searchEl = document.getElementById('usr-emp-search');
  if (searchEl) searchEl.value = '';

  GET('/api/usuarios/' + userId + '/empleados').then(res => {
    if (res.ok) return res.json();
    return [];
  }).then(lista => {
    _empAsigSeleccionados = new Set(lista);
    renderEmpModal();
  }).catch(() => renderEmpModal());

  document.getElementById('modal-empleados').classList.add('open');
  document.getElementById('modal-empleados').style.display = 'flex';
}

async function guardarEmpleados() {
  if (!_asignandoUsuarioId) return;
  try {
    await PUT('/api/usuarios/' + _asignandoUsuarioId + '/empleados', { empleados: [..._empAsigSeleccionados] });
    cerrarModal('modal-empleados');
    showToast('Empleados actualizados.');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Filters ──

function filtrarUsuarios() {
  renderUsuarios();
}

function limpiarFiltrosUsuario() {
  ['usr-buscar','usr-fil-rol','usr-fil-sede','usr-fil-estado'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderUsuarios();
}

// Populate sede filter from global centros
function poblarSedesUsuarios() {
  const sel = document.getElementById('usr-fil-sede');
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todas las sedes</option>';
  if (centros && centros.length) {
    centros.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.nombre;
      opt.textContent = c.nombre;
      if (c.nombre === actual) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}
