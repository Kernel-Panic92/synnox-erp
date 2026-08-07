let _proyectos = [];
let _centrosCache = null;
let _centrosCacheTs = 0;
const CENTROS_CACHE_TTL = 30000;
let _centrosPromise = null;
let _proyectoMiembrosActual = null;
let _miembrosSeleccionados = new Set();
let _miembrosRoles = {};
let _proyFiltroAsignadoInit = false;

async function cargarFiltrosProyectos() {
  await Promise.all([cargarCentrosProyectos(), cargarTodosLosUsuarios()]);
  const centroSel = document.getElementById('filtro-proy-centro');
  if (centroSel && centroSel.options.length <= 1) {
    centroSel.innerHTML = '<option value="">Todos los centros</option>' +
      (_centrosCache || []).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  }
  if (!_proyFiltroAsignadoInit) {
    const wrap = document.getElementById('filtro-proy-asignado-wrap');
    if (wrap) {
      wrap.innerHTML = selectBuscador('filtro-proy-asignado', _todosUsuarios, '', 'Todos los usuarios');
      initSelectBuscador('filtro-proy-asignado');
      document.getElementById('filtro-proy-asignado')?.addEventListener('change', () => cargarProyectos());
    }
    _proyFiltroAsignadoInit = true;
  }
}

async function cargarProyectos() {
  try {
    await cargarFiltrosProyectos();
    const data = await api('/proyectos');
    _proyectos = data.proyectos || [];
    const ids = _proyectos.map(p => p.asignado_a).filter(Boolean);
    const memberIds = _proyectos.flatMap(p => (p.miembros || []).map(m => m.usuario_id));
    await cargarNombresUsuarios([...new Set([...ids, ...memberIds])]);

    const q = (document.getElementById('filtro-proy-busqueda')?.value || '').toLowerCase();
    const filtroEstado = document.getElementById('filtro-proy-estado')?.value || '';
    const filtroAprob = document.getElementById('filtro-proy-aprobacion')?.value || '';
    const filtroCentro = document.getElementById('filtro-proy-centro')?.value || '';
    const filtroAsignado = document.getElementById('filtro-proy-asignado')?.value || '';
    const orden = document.getElementById('filtro-proy-orden')?.value || 'recientes';

    let filtrados = _proyectos.filter(p => {
      if (filtroEstado && p.estado !== filtroEstado) return false;
      if (filtroAprob && (p.estado_aprobacion || 'pendiente') !== filtroAprob) return false;
      if (filtroCentro && String(p.centro_id || '') !== filtroCentro) return false;
      if (filtroAsignado && String(p.asignado_a || '') !== filtroAsignado) return false;
      if (q) {
        const match = p.nombre.toLowerCase().includes(q) ||
          (p.descripcion || '').toLowerCase().includes(q) ||
          nombreUsuario(p.asignado_a).toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    if (orden === 'nombre') {
      filtrados.sort((a, b) => a.nombre.localeCompare(b.nombre));
    } else if (orden === 'fecha') {
      filtrados.sort((a, b) => {
        if (!a.fecha_limite) return 1;
        if (!b.fecha_limite) return -1;
        return new Date(a.fecha_limite) - new Date(b.fecha_limite);
      });
    } else if (orden === 'progreso') {
      filtrados.sort((a, b) => {
        const pctA = parseInt(a.total_tareas) > 0 ? Math.round((parseInt(a.tareas_completadas) / parseInt(a.total_tareas)) * 100) : 0;
        const pctB = parseInt(b.total_tareas) > 0 ? Math.round((parseInt(b.tareas_completadas) / parseInt(b.total_tareas)) * 100) : 0;
        return pctB - pctA;
      });
    }

    document.getElementById('proyectos-count').textContent = `${filtrados.length} proyecto(s)`;
    const grid = document.getElementById('proyectos-grid');

    if (!filtrados.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">&#x1F4C1;</div><p>${q ? 'No se encontraron proyectos' : 'No hay proyectos. Crea el primero para empezar.'}</p></div>`;
      return;
    }

    grid.innerHTML = filtrados.map(p => {
      const total = parseInt(p.total_tareas) || 0;
      const completadas = parseInt(p.tareas_completadas) || 0;
      const pct = total > 0 ? Math.round((completadas / total) * 100) : 0;
      const estadoCls = p.estado === 'completado' ? 'badge-success' : p.estado === 'archivado' ? 'badge-muted' : 'badge-info';
      const aprobCls = p.estado_aprobacion === 'aprobada' ? 'badge-success' : p.estado_aprobacion === 'rechazada' ? 'badge-danger' : 'badge-muted';
      const centro = _centrosCache?.find(c => c.id === p.centro_id);
      return `
        <div class="card" style="cursor:pointer" onclick="verTareasProyecto(${p.id})">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <strong style="font-size:15px">${esc(p.nombre)}</strong>
            <span style="display:flex;gap:6px">
              <span class="badge ${aprobCls}">${p.estado_aprobacion || 'pendiente'}</span>
              <span class="badge ${estadoCls}">${p.estado || 'activo'}</span>
            </span>
          </div>
          ${p.descripcion ? `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">${esc(p.descripcion)}</p>` : ''}
          ${centro ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px">&#x1F3E2; ${esc(centro.nombre)}</div>` : ''}
          ${p.asignado_a ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px">&#x1F464; ${esc(nombreUsuario(p.asignado_a))}</div>` : ''}
          ${p.miembros?.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">${p.miembros.slice(0, 4).map(m => `<span class="badge badge-muted" style="font-size:10px" title="${m.rol}">${esc(nombreUsuario(m.usuario_id))}</span>`).join('')}${p.miembros.length > 4 ? `<span class="badge badge-muted" style="font-size:10px">+${p.miembros.length - 4}</span>` : ''}</div>` : ''}
          ${p.fecha_limite ? `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">&#x1F4C5; ${formatDate(p.fecha_limite)}</div>` : ''}
          <div style="display:flex;gap:8px;font-size:11px;margin-bottom:8px">
            <span>&#x23F3; ${parseInt(p.tareas_pendientes) || 0}</span>
            <span>&#x1F3C3; ${parseInt(p.tareas_en_progreso) || 0}</span>
            <span>&#x2705; ${completadas}</span>
          </div>
          <div style="background:var(--surface2);border-radius:10px;height:6px;margin-bottom:12px">
            <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:10px;transition:width .3s"></div>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${pct}% completado (${completadas}/${total})</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${p.estado !== 'completado' && (p.estado_aprobacion !== 'aprobada') && (parseInt(p.total_tareas) === 0 || parseInt(p.tareas_completadas) === parseInt(p.total_tareas)) && (['admin','gerente'].includes(usuario?.rol) || p.asignado_a === usuario?.id) ? `<button class="btn btn-xs btn-success" onclick="event.stopPropagation();aprobarProyecto(${p.id})" title="Aprobar">&#10003;</button>` : ''}
            ${p.estado_aprobacion === 'aprobada' && (['admin','gerente'].includes(usuario?.rol) || p.asignado_a === usuario?.id) ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();rechazarProyecto(${p.id})" title="Desaprobar">&#10007;</button>` : ''}
            ${p.estado_aprobacion === 'aprobada' && ['admin','gerente'].includes(usuario?.rol) ? `<button class="btn btn-xs btn-warning" onclick="event.stopPropagation();cerrarProyecto(${p.id})" title="Cerrar proyecto">&#x1F516;</button>` : ''}
            ${tienePermiso('editar') ? `<button class="btn btn-xs btn-secondary" onclick="event.stopPropagation();abrirModalProyecto(${p.id})" title="Editar">&#9998;</button>` : ''}
            ${tienePermiso('eliminar') ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();eliminarProyecto(${p.id})" title="Eliminar">&#10005;</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('proyectos-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Error al cargar proyectos</p></div>';
  }
}

function proyectosLimpiarFiltros() {
  document.getElementById('filtro-proy-estado').value = '';
  document.getElementById('filtro-proy-aprobacion').value = '';
  document.getElementById('filtro-proy-centro').value = '';
  document.getElementById('filtro-proy-orden').value = 'recientes';
  document.getElementById('filtro-proy-busqueda').value = '';
  const asignado = document.getElementById('filtro-proy-asignado');
  const display = document.getElementById('filtro-proy-asignado-display');
  if (asignado) asignado.value = '';
  if (display) display.value = '';
  cargarProyectos();
}

function verTareasProyecto(proyectoId) {
  _proyectoFiltroActual = proyectoId;
  localStorage.setItem('sy_tareas_proyecto', proyectoId);
  navigate('tareas');
  setTimeout(() => {
    const sel = document.getElementById('filtro-proyecto');
    if (sel) { sel.value = proyectoId; cargarTareas(); }
  }, 100);
}

async function cargarCentrosProyectos() {
  const age = Date.now() - _centrosCacheTs;
  if (_centrosCache && age < CENTROS_CACHE_TTL) return;
  if (_centrosPromise) return _centrosPromise;
  _centrosPromise = (async () => {
    try {
      const centros = await api('/centros');
      _centrosCache = Array.isArray(centros) ? centros : [];
      _centrosCacheTs = Date.now();
    } catch { _centrosCache = []; }
    _centrosPromise = null;
  })();
  return _centrosPromise;
}

async function abrirModalProyecto(id) {
  await cargarCentrosProyectos();
  await cargarTodosLosUsuarios();
  const p = id ? _proyectos.find(x => x.id === id) : null;
  const titulo = p ? 'Editar Proyecto' : 'Nuevo Proyecto';
  const centroOpts = (_centrosCache || []).map(c =>
    `<option value="${c.id}" ${p?.centro_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`
  ).join('');

  const miembrosHtml = id ? `
    <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:13px">Miembros del proyecto <span style="font-weight:400;color:var(--muted)">(${(p?.miembros || []).length})</span></strong>
        <button class="btn btn-xs btn-secondary" onclick="abrirModalMiembros(${id})">Gestionar miembros</button>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${(p?.miembros || []).map(m => {
          const rolBadge = m.rol === 'lider' ? 'badge-info' : m.rol === 'miembro' ? 'badge-muted' : 'badge-warning';
          return `<span class="badge ${rolBadge}" style="font-size:11px">${esc(nombreUsuario(m.usuario_id))} · ${m.rol}</span>`;
        }).join('') || '<span style="font-size:12px;color:var(--muted)">Sin miembros</span>'}
      </div>
    </div>
  ` : '';

  const body = `
    <div class="form-group"><label>Nombre *</label><input id="proy-nombre" value="${esc(p?.nombre || '')}"></div>
    <div class="form-group"><label>Descripcion</label><textarea id="proy-desc">${esc(p?.descripcion || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Centro de Operación</label><select id="proy-centro">
        <option value="">— Sin centro —</option>${centroOpts}
      </select></div>
      <div class="form-group"><label>Estado</label><select id="proy-estado">
        <option value="activo" ${p?.estado === 'activo' ? 'selected' : ''}>Activo</option>
        <option value="completado" ${p?.estado === 'completado' ? 'selected' : ''}>Completado</option>
        <option value="archivado" ${p?.estado === 'archivado' ? 'selected' : ''}>Archivado</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Fecha Limite</label><input type="date" id="proy-fecha" value="${p?.fecha_limite ? p.fecha_limite.split('T')[0] : ''}"></div>
      <div class="form-group"><label>Responsable del proyecto</label>${selectBuscador('proy-asignado', _todosUsuarios, p?.asignado_a, 'Buscar usuario...')}</div>
    </div>
    ${miembrosHtml}
  `;
  const actions = `<button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
    <button class="btn btn-sm btn-primary" onclick="guardarProyecto(${id || 'null'})">Guardar</button>`;
  abrirModal(titulo, '', body, actions);
  initSelectBuscador('proy-asignado');
}

async function guardarProyecto(id) {
  const centroEl = document.getElementById('proy-centro');
  const body = {
    nombre: document.getElementById('proy-nombre').value.trim(),
    descripcion: document.getElementById('proy-desc').value.trim(),
    estado: document.getElementById('proy-estado').value,
    fecha_limite: document.getElementById('proy-fecha').value || null,
    centro_id: centroEl?.value ? Number(centroEl.value) : null,
    asignado_a: parseInt(document.getElementById('proy-asignado').value) || null
  };
  if (!body.nombre) return toast('El nombre es requerido', 'error');
  try {
    if (id) {
      await api('/proyectos/' + id, { method: 'PUT', body: JSON.stringify(body) });
      toast('Proyecto actualizado', 'success');
    } else {
      await api('/proyectos', { method: 'POST', body: JSON.stringify(body) });
      toast('Proyecto creado', 'success');
    }
    cerrarModal();
    cargarProyectos();
  } catch (err) { toast(err.message, 'error'); }
}

async function eliminarProyecto(id) {
  const ok = await confirmarModal('Eliminar Proyecto', 'Se eliminaran tambien todas las tareas del proyecto. Continuar?');
  if (!ok) return;
  try {
    await api('/proyectos/' + id, { method: 'DELETE' });
    toast('Proyecto eliminado', 'success');
    cargarProyectos();
  } catch (err) { toast(err.message, 'error'); }
}

async function aprobarProyecto(id) {
  try {
    await api('/proyectos/' + id + '/aprobar', { method: 'PUT' });
    toast('Proyecto aprobado', 'success');
    cargarProyectos();
  } catch (err) { toast(err.message, 'error'); }
}

async function rechazarProyecto(id) {
  try {
    await api('/proyectos/' + id + '/rechazar', { method: 'PUT' });
    toast('Proyecto desaprobado', 'warning');
    cargarProyectos();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Gestión de miembros (checkbox list) ──
async function abrirModalMiembros(proyectoId) {
  await cargarTodosLosUsuarios();
  if (!_todosUsuarios.length) {
    toast('No se pudieron cargar los usuarios', 'error');
    return;
  }
  const p = _proyectos.find(x => x.id === proyectoId);
  _proyectoMiembrosActual = proyectoId;
  _miembrosSeleccionados = new Set();
  _miembrosRoles = {};

  const miembros = p?.miembros || [];
  for (const m of miembros) {
    _miembrosSeleccionados.add(m.usuario_id);
    _miembrosRoles[m.usuario_id] = m.rol;
  }

  const searchEl = document.getElementById('miembro-search');
  if (searchEl) searchEl.value = '';

  renderMiembrosModal();
  document.getElementById('modal-miembros').style.display = 'flex';
}

function renderMiembrosModal(filtro = '') {
  const q = filtro.toLowerCase();
  const lista = q
    ? _todosUsuarios.filter(u =>
        u.nombre.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      )
    : _todosUsuarios;

  const container = document.getElementById('miembros-list');
  if (!container) return;

  if (!lista.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:12px;">Sin resultados</div>';
    actualizarContadorMiembros();
    return;
  }

  container.innerHTML = lista.map(u => {
    const checked = _miembrosSeleccionados.has(u.id);
    const rol = _miembrosRoles[u.id] || 'miembro';
    const nombre = u.nombre || u.name || `Usuario #${u.id}`;
    const email = u.email || '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:7px;border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='transparent'">
      <input type="checkbox" value="${u.id}" ${checked ? 'checked' : ''} onchange="toggleMiembro(${u.id},this.checked)"
        style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nombre)}</div>
        ${email ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(email)}</div>` : ''}
      </div>
      <select ${!checked ? 'disabled' : ''} onchange="setMiembroRol(${u.id},this.value)"
        style="font-size:12px;padding:4px 6px;border-radius:4px;border:1px solid var(--border);flex-shrink:0;background:var(--surface);color:var(--text);width:90px;${!checked ? 'opacity:0.4' : ''}">
        <option value="miembro" ${rol === 'miembro' ? 'selected' : ''}>Miembro</option>
        <option value="lider" ${rol === 'lider' ? 'selected' : ''}>Líder</option>
        <option value="observador" ${rol === 'observador' ? 'selected' : ''}>Observador</option>
      </select>
    </div>`;
  }).join('');
  actualizarContadorMiembros();
}

function toggleMiembro(id, checked) {
  if (checked) {
    _miembrosSeleccionados.add(id);
    if (!_miembrosRoles[id]) _miembrosRoles[id] = 'miembro';
  } else {
    _miembrosSeleccionados.delete(id);
    delete _miembrosRoles[id];
  }
  renderMiembrosModal(document.getElementById('miembro-search')?.value || '');
}

function setMiembroRol(id, rol) {
  _miembrosRoles[id] = rol;
}

function filtrarMiembrosModal() {
  const q = document.getElementById('miembro-search')?.value || '';
  renderMiembrosModal(q);
}

function seleccionarTodosMiembros(todos) {
  if (todos) {
    for (const u of _todosUsuarios) {
      _miembrosSeleccionados.add(u.id);
      if (!_miembrosRoles[u.id]) _miembrosRoles[u.id] = 'miembro';
    }
  } else {
    _miembrosSeleccionados.clear();
    _miembrosRoles = {};
  }
  renderMiembrosModal(document.getElementById('miembro-search')?.value || '');
}

function actualizarContadorMiembros() {
  const el = document.getElementById('miembros-count');
  if (el) el.textContent = `${_miembrosSeleccionados.size} seleccionado(s)`;
}

async function guardarMiembrosProyecto() {
  if (!_proyectoMiembrosActual) return;
  const miembros = [..._miembrosSeleccionados].map(id => ({
    usuario_id: id,
    rol: _miembrosRoles[id] || 'miembro'
  }));
  try {
    await api('/proyectos/' + _proyectoMiembrosActual + '/miembros', {
      method: 'PUT',
      body: JSON.stringify({ miembros })
    });
    toast('Miembros actualizados', 'success');
    delete _miembrosProyectoCache[_proyectoMiembrosActual];
    document.getElementById('modal-miembros').style.display = 'none';
    await cargarProyectos();
    abrirModalProyecto(_proyectoMiembrosActual);
  } catch (err) { toast(err.message, 'error'); }
}

// ── Actas de cierre ──
async function cargarActas() {
  try {
    const data = await api('/actas');
    const actas = data.actas || [];
    document.getElementById('actas-count').textContent = `${actas.length} acta(s)`;
    const grid = document.getElementById('actas-grid');
    if (!actas.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">&#x1F4CB;</div><p>No hay actas de cierre. Genera una desde la vista de un proyecto.</p></div>';
      return;
    }
    grid.innerHTML = actas.map(a => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <strong style="font-size:14px">${esc(a.proyecto_nombre)}</strong>
          <span class="badge badge-info" style="font-size:11px">Acta #${a.id}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">
          ${new Date(a.created_at).toLocaleDateString('es-CO')}
          ${a.observaciones ? ' — ' + esc(a.observaciones.slice(0, 80)) + (a.observaciones.length > 80 ? '...' : '') : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-xs btn-secondary" onclick="verActa(${a.id})">👁️ Ver</button>
          <button class="btn btn-xs btn-primary" onclick="descargarActaPDF(${a.id})">📄 PDF</button>
          <button class="btn btn-xs btn-danger" onclick="eliminarActa(${a.id})">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function cerrarProyecto(id) {
  const p = _proyectos.find(x => x.id === id);
  if (!p) return;
  const body = `
    <div class="form-group"><label>Resumen ejecutivo</label><textarea id="acta-resumen" rows="3" placeholder="Describe brevemente los resultados del proyecto...">${esc(p.descripcion || '')}</textarea></div>
    <div class="form-group"><label>Observaciones de cierre</label><textarea id="acta-obs" rows="3" placeholder="Notas adicionales sobre el cierre..."></textarea></div>
  `;
  const actions = `<button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
    <button class="btn btn-sm btn-primary" onclick="generarActaCierre(${id})">Cerrar y generar acta</button>`;
  abrirModal('Cerrar Proyecto', `¿Cerrar "${p.nombre}" y generar acta de cierre?`, body, actions);
}

async function generarActaCierre(proyectoId) {
  const resumen = document.getElementById('acta-resumen')?.value || '';
  const obs = document.getElementById('acta-obs')?.value || '';
  try {
    await api('/actas', { method: 'POST', body: JSON.stringify({ proyecto_id: proyectoId, resumen_ejecutivo: resumen, observaciones: obs }) });
    await api('/proyectos/' + proyectoId, { method: 'PUT', body: JSON.stringify({ estado: 'completado' }) });
    cerrarModal();
    toast('Acta generada y proyecto cerrado', 'success');
    cargarProyectos();
  } catch (err) { toast(err.message, 'error'); }
}

async function verActa(id) {
  try {
    const data = await api('/actas/' + id);
    const a = data.acta;
    const tareas = data.tareas || [];
    const body = `
      <div style="font-size:13px;margin-bottom:12px">
        <div><strong>Proyecto:</strong> ${esc(a.proyecto_nombre)}</div>
        <div><strong>Estado:</strong> ${esc(a.proyecto_estado)}</div>
        <div><strong>Fecha cierre:</strong> ${new Date(a.created_at).toLocaleDateString('es-CO')}</div>
      </div>
      ${a.resumen_ejecutivo ? `<div style="margin-bottom:12px"><strong>Resumen ejecutivo:</strong><p style="font-size:13px;color:var(--muted)">${esc(a.resumen_ejecutivo)}</p></div>` : ''}
      <div style="margin-bottom:12px"><strong>Tareas (${tareas.length}):</strong></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tarea</th><th>Estado</th><th>Prioridad</th><th>Asignado</th></tr></thead><tbody>
        ${tareas.map(t => `<tr><td>${esc(t.titulo)}</td><td><span class="badge badge-${t.estado==='completada'?'success':'warning'}">${t.estado}</span></td><td>${esc(t.prioridad)}</td><td>${esc(t.asignado_nombre || '—')}</td></tr>`).join('')}
      </tbody></table></div>
      ${a.observaciones ? `<div style="margin-top:12px"><strong>Observaciones:</strong><p style="font-size:13px;color:var(--muted)">${esc(a.observaciones)}</p></div>` : ''}
    `;
    const actions = `<button class="btn btn-sm btn-primary" onclick="descargarActaPDF(${id})">📄 Descargar PDF</button>
      <button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cerrar</button>`;
    abrirModal('Acta de Cierre #' + id, '', body, actions);
  } catch (err) { toast(err.message, 'error'); }
}

function descargarActaPDF(id) {
  window.open(BASE + '/api/actas/' + id + '/pdf', '_blank');
}

async function eliminarActa(id) {
  const ok = await confirmarModal('Eliminar Acta', '¿Eliminar esta acta de cierre?');
  if (!ok) return;
  try {
    await api('/actas/' + id, { method: 'DELETE' });
    toast('Acta eliminada', 'success');
    cargarActas();
  } catch (err) { toast(err.message, 'error'); }
}
