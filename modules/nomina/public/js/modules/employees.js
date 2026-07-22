// employees.js - Employees & Centers module

let _empFiltroCorruptos = false;
let _empCorruptosIds = new Set();

async function renderEmpleados() {
  const search = document.getElementById('emp-search');
  if (search) search.value = '';
  _empFiltroCorruptos = false;
  // Fetch corrupted employees list (admin only)
  if (soyAdmin()) {
    try {
      const res = await GET('/api/empleados/corruptos');
      if (res.ok) {
        const lista = await res.json();
        _empCorruptosIds = new Set(lista.map(e => e.id));
        actualizarBannerCorruptos();
      }
    } catch (e) { /* ignore */ }
  }
  buscarEmpleados();
}

function actualizarBannerCorruptos() {
  const banner = document.getElementById('emp-corruptos-banner');
  const msg = document.getElementById('emp-corruptos-msg');
  if (!banner || !msg) return;
  const n = _empCorruptosIds.size;
  if (n > 0 && soyAdmin()) {
    banner.style.display = 'flex';
    msg.textContent = `⚠️ ${n} empleado${n > 1 ? 's' : ''} con caracteres corruptos (�) en el nombre. Edítalo${n > 1 ? 's' : ''} para corregirl${n > 1 ? 'os' : 'o'}.`;
  } else {
    banner.style.display = 'none';
  }
}

async function toggleActivoEmpleado(id, activo) {
  const msg = activo ? '¿Activar este empleado?' : '¿Inactivar este empleado?';
  if (!await confirmModal(msg)) return;
  try {
    await PUT('/api/empleados/' + id + '/activo', { activo });
    showToast(activo ? 'Empleado activado' : 'Empleado inactivado', 'success');
    await cargarEmpleados();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function filtrarCorruptos() {
  _empFiltroCorruptos = !_empFiltroCorruptos;
  const btn = document.querySelector('#emp-corruptos-banner button');
  if (btn) btn.textContent = _empFiltroCorruptos ? 'Mostrar todos' : 'Mostrar afectados';
  buscarEmpleados();
}

function limpiarFiltroEmpleados() {
  const buscarInput = document.getElementById('emp-search');
  if (buscarInput) buscarInput.value = '';
  buscarEmpleados();
}

function buscarEmpleados() {
  const q = (document.getElementById('emp-search')?.value || '').toLowerCase().trim();
  let lista = q
    ? empleados.filter(e =>
        e.nombre.toLowerCase().includes(q) ||
        (e.cargo||'').toLowerCase().includes(q) ||
        (e.departamento||'').toLowerCase().includes(q) ||
        (e.sede||'').toLowerCase().includes(q) ||
        (e.email||'').toLowerCase().includes(q) ||
        (e.cedula||'').toLowerCase().includes(q)
      )
    : empleados;
  if (_empFiltroCorruptos && _empCorruptosIds.size) {
    lista = lista.filter(e => _empCorruptosIds.has(e.id));
  }

  const grid = document.getElementById('emp-grid');
  if (!grid) return;

  const countEl = document.getElementById('emp-count');
  if (countEl) {
    countEl.textContent = q
      ? `${lista.length} de ${empleados.length} empleados`
      : `${empleados.length} empleados`;
  }

  const btnNuevo = document.getElementById('btn-nuevo-emp');
  if (btnNuevo) btnNuevo.style.display = puedoEditar() ? '' : 'none';
  const btnImp = document.getElementById('btn-importar-emp');
  if (btnImp) btnImp.style.display = soyAdmin() ? '' : 'none';
  const permBanner = document.getElementById('emp-perm-banner');
  if (permBanner) permBanner.classList.toggle('show', !puedoEditar());

  if (!lista.length) {
    grid.innerHTML = q
      ? '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🔍</div><div class="empty-text">Sin resultados para "' + esc(q) + '"</div></div>'
      : '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">👤</div><div class="empty-text">No hay empleados registrados</div></div>';
    return;
  }

  // No renderizar más de 200 empleados a la vez — el resto requiere búsqueda
  const _empMaxRenderSinBusqueda = 200;
  const sinBusqueda = !q && !_empFiltroCorruptos;
  if (sinBusqueda && lista.length > _empMaxRenderSinBusqueda) {
    lista = lista.slice(0, _empMaxRenderSinBusqueda);
    setTimeout(() => {
      const msg = document.getElementById('emp-search-msg');
      if (msg) msg.textContent = `Mostrando los primeros ${_empMaxRenderSinBusqueda} empleados. Escribí para filtrar.`;
    }, 0);
  } else {
    const msg = document.getElementById('emp-search-msg');
    if (msg) msg.textContent = '';
  }

  // Pre-computar stats por empleado (O(N) en vez de O(N*M))
  const empStats = {};
  const t0 = performance.now();
  registros.forEach(r => {
    if (!empStats[r.empleadoId]) empStats[r.empleadoId] = { horas: 0, count: 0 };
    empStats[r.empleadoId].horas += parseFloat(r.horas || 0);
    empStats[r.empleadoId].count += 1;
  });


  grid.innerHTML = lista.map(e => {
    const initials = esc(e.nombre).split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const stats = empStats[e.id] || { horas: 0, count: 0 };
    const activo = e.activo !== 0;
    const acciones = puedoEditar()
      ? '<button class="btn btn-secondary btn-sm" onclick="editarEmpleado(\'' + esc(e.id) + '\')">✏ Editar</button>'
        + (activo ? ' <button class="btn btn-danger btn-sm" onclick="toggleActivoEmpleado(\'' + esc(e.id) + '\', false)">🚫</button>' : '')
        + (!activo ? ' <button class="btn btn-sm" style="background:rgba(79,190,150,.15);color:var(--success);border:1px solid rgba(79,190,150,.2)" onclick="toggleActivoEmpleado(\'' + esc(e.id) + '\', true)">✓</button>' : '')
      : '<span style="font-size:11px;color:var(--muted)">Solo lectura</span>';

    const badgeInactivo = !activo ? ' <span style="background:rgba(247,97,79,0.12);color:var(--danger);border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;">INACTIVO</span>' : '';

    return '<div class="emp-card">'
      + '<div class="emp-card-top">'
      + '<div class="emp-avatar" style="background:' + esc(empColor(e.nombre)) + '">' + esc(initials) + '</div>'
      + '<div class="emp-name">' + esc(e.nombre) + badgeInactivo + (_empCorruptosIds.has(e.id) ? ' <span style="color:var(--danger);font-size:10px;" title="Nombre con caracteres corruptos">⚠️</span>' : '') + '</div>'
      + '</div>'
      + '<div class="emp-dept">' + esc(e.cargo || '') + ' · ' + esc(e.departamento || '') + '</div>'
      + '<div class="emp-meta">'
      + (e.sede ? '<span class="loc">📍 ' + esc(e.sede) + '</span>' : '')
      + '<span>🔗 ' + esc(e.tipo_vinculacion || 'vinculado') + '</span>'
      + '</div>'
      + '<div class="emp-stats">'
      + '<div class="emp-stat"><strong>' + esc(stats.horas.toFixed(1)) + 'h</strong>horas</div>'
      + '<div class="emp-stat"><strong>' + esc(stats.count) + '</strong>regs</div>'
      + '</div>'
      + '<div class="emp-actions">' + acciones + '</div>'
      + '</div>';
  }).join('');
}

function abrirModalEmpleado(id = null) {
  const modal = document.getElementById('modal-empleado');
  const titulo = document.getElementById('modal-emp-title');

  if (!modal || !titulo) return;

  editEmpId = id;
  titulo.textContent = id ? 'Editar Empleado' : 'Nuevo Empleado';

  const activoGroup = document.getElementById('emp-activo-group');
  if (id) {
    const e = empleados.find(e => e.id === id);
    if (e) {
      document.getElementById('emp-nombre').value = e.nombre;
      document.getElementById('emp-cedula').value = e.cedula;
      document.getElementById('emp-cargo').value = e.cargo || '';
      document.getElementById('emp-depto').value = e.departamento || '';
      document.getElementById('emp-email').value = e.email || '';
      document.getElementById('emp-tel').value = e.telefono || '';
      document.getElementById('emp-sede').value = e.sede || '';
      document.getElementById('emp-tipo-vinculacion').value = e.tipo_vinculacion || 'vinculado';
      const chk = document.getElementById('emp-activo');
      if (chk) chk.checked = e.activo !== 0;
    }
    if (activoGroup) activoGroup.style.display = '';
  } else {
    ['emp-nombre','emp-cedula','emp-cargo','emp-depto','emp-email','emp-tel']
      .forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
    document.getElementById('emp-sede').value = '';
    document.getElementById('emp-tipo-vinculacion').value = 'vinculado';
    if (activoGroup) activoGroup.style.display = 'none';
  }

  modal.classList.add('open');
  modal.style.display = 'flex';
}

function editarEmpleado(id) {
  abrirModalEmpleado(id);
}

async function guardarEmpleado() {
  const nombre = document.getElementById('emp-nombre').value.trim();
  const cedula = document.getElementById('emp-cedula').value.trim();
  const cargo  = document.getElementById('emp-cargo').value.trim();
  const depto  = document.getElementById('emp-depto').value.trim();
  const email  = document.getElementById('emp-email').value.trim();
  const tel    = document.getElementById('emp-tel').value.trim();
  const sede   = document.getElementById('emp-sede').value;
  const tipoVinculacion = document.getElementById('emp-tipo-vinculacion')?.value || 'vinculado';

  if (!nombre || !cedula || !cargo || !depto || !sede) {
    showToast('Completa los campos obligatorios incluyendo sede.', 'error');
    return;
  }

  setLoading('btn-guardar-emp', true);
  try {
    const chk = document.getElementById('emp-activo');
    const body = { nombre, cedula, cargo, departamento: depto, sede, email, telefono: tel, tipo_vinculacion: tipoVinculacion };
    if (editEmpId) body.activo = chk ? chk.checked : true;
    const res = editEmpId ? await PUT('/api/empleados/' + editEmpId, body) : await POST('/api/empleados', body);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error al guardar');
    cerrarModal('modal-empleado');
    await loadAll();
    renderEmpleados();
    showToast(editEmpId ? 'Empleado actualizado.' : 'Empleado registrado.');
  } catch (e) {
    showToast(e.message, 'error');
  }
  setLoading('btn-guardar-emp', false);
}

// Centers management
function poblarSelectsCentros() {
  const selects = [
    document.getElementById('emp-sede'),
    document.getElementById('usr-sede'),
    document.getElementById('reg-sede'),
    document.getElementById('fil-sede'),
    document.getElementById('rpt-sede')
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const currentValue = sel.value;
    const isFilter = sel.id.includes('filtro') || sel.id.includes('fil-') || sel.id === 'rpt-sede';
    const filtered = centros.filter(c => c.activo);
    let html = isFilter ? '<option value="">Todos</option>' : '';
    for (let i = 0; i < filtered.length; i++) {
      html += '<option value="' + esc(filtered[i].nombre) + '">' + esc(filtered[i].nombre) + '</option>';
    }
    sel.innerHTML = html;
    if (currentValue) sel.value = currentValue;
  });
}

function renderCentros() {
  const tbody = document.getElementById('centros-body');
  if (!tbody) return;
  if (!centros.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:32px;">No hay centros registrados</td></tr>';
    return;
  }
  const rows = [];
  centros.forEach(function(c) {
    const empsCount = empleados.filter(function(e){ return e.sede === c.nombre; }).length;
    const estadoBadge = c.activo
      ? '<span style="background:rgba(79,190,150,0.15);color:#4fbe96;border-radius:6px;padding:2px 10px;font-size:11px;font-weight:700;">ACTIVO</span>'
      : '<span style="background:rgba(247,97,79,0.12);color:var(--danger);border-radius:6px;padding:2px 10px;font-size:11px;font-weight:700;">INACTIVO</span>';
    const fecha = c.creado ? new Date(c.creado).toLocaleDateString('es-CO') : '-';
    rows.push(
       '<tr>' +
       '<td data-label="Nombre" style="font-weight:600;">' + esc(c.nombre) + '</td>' +
       '<td data-label="Estado">' + estadoBadge + '</td>' +
       '<td data-label="Creado" style="color:var(--muted);font-size:13px;">' + esc(fecha) + '</td>' +
       '<td data-label="Empleados" style="color:var(--muted);">' + esc(empsCount) + ' empleado' + (empsCount !== 1 ? 's' : '') + '</td>' +
       '</tr>'
     );
  });
  tbody.innerHTML = rows.join('');
}


