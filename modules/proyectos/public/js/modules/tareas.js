let _tareasPage = 1;
let _tareasLimit = 20;
let _tareasTotal = 0;
let _tareasProyectos = [];
let _proyectoFiltroActual = null;
let _vistaAgrupada = false;
let _tareasDataCache = [];
let _miembrosProyectoCache = {};
let _filtroProyectoInit = false;
let _filtroAsignadoInit = false;

async function cargarProyectosSelect(forceReload = false) {
  const sel = document.getElementById('filtro-proyecto');
  const needsReload = forceReload || !sel || sel.options.length <= 1;
  if (_filtroProyectoInit && !needsReload) return;
  try {
    const saved = JSON.parse(localStorage.getItem('sy_tareas_filtros') || '{}');
    const savedVal = saved.proyecto || localStorage.getItem('sy_tareas_proyecto') || '';
    const data = await api('/proyectos');
    _tareasProyectos = data.proyectos || [];
    if (sel) {
      sel.innerHTML = '<option value="">Todos los proyectos</option>' + _tareasProyectos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
      if (savedVal) sel.value = savedVal;
    }
    _filtroProyectoInit = true;
  } catch {}
}

async function cargarFiltroAsignado() {
  if (_filtroAsignadoInit) return;
  await cargarTodosLosUsuarios();
  const wrap = document.getElementById('filtro-asignado-wrap');
  if (!wrap) return;

  // Restaurar filtros guardados
  const saved = JSON.parse(localStorage.getItem('sy_tareas_filtros') || '{}');
  wrap.innerHTML = selectBuscador('filtro-asignado', _todosUsuarios, saved.asignado || '', 'Todos los usuarios');
  initSelectBuscador('filtro-asignado');
  document.getElementById('filtro-asignado')?.addEventListener('change', () => { _tareasPage = 1; cargarTareas(); });
  _filtroAsignadoInit = true;
}

async function cargarTareas() {
  await Promise.all([cargarProyectosSelect(), cargarFiltroAsignado()]);

  // Restaurar filtros guardados en selects (solo la primera vez)
  if (!window._tareasFiltrosRestored) {
    const saved = JSON.parse(localStorage.getItem('sy_tareas_filtros') || '{}');
    if (saved.estado) document.getElementById('filtro-estado').value = saved.estado;
    if (saved.prioridad) document.getElementById('filtro-prioridad').value = saved.prioridad;
    window._tareasFiltrosRestored = true;
  }

  const newLimit = parseInt(document.getElementById('tareas-limit')?.value) || 20;
  if (newLimit !== _tareasLimit) { _tareasLimit = newLimit; _tareasPage = 1; }
  const params = new URLSearchParams();
  const proyecto = document.getElementById('filtro-proyecto')?.value;
  const estado = document.getElementById('filtro-estado')?.value;
  const prioridad = document.getElementById('filtro-prioridad')?.value;
  const asignado = document.getElementById('filtro-asignado')?.value;
  const q = document.getElementById('filtro-busqueda')?.value;

  // Guardar filtros en localStorage
  const filtros = { proyecto, estado, prioridad, asignado, q };
  localStorage.setItem('sy_tareas_filtros', JSON.stringify(filtros));

  if (proyecto) params.set('proyecto_id', proyecto);
  if (estado) params.set('estado', estado);
  if (prioridad) params.set('prioridad', prioridad);
  if (asignado) params.set('asignado_a', asignado);
  if (q) params.set('q', q);
  params.set('page', _tareasPage);
  params.set('limit', _tareasLimit);

  try {
    const data = await api('/tareas?' + params.toString());
    const tareas = data.tareas || [];
    _tareasTotal = data.total || 0;
    _tareasDataCache = tareas;
    const ids = tareas.map(t => t.asignado_a).filter(Boolean);
    const reporteroIds = tareas.map(t => t.reportero).filter(Boolean);
    await cargarNombresUsuarios([...new Set([...ids, ...reporteroIds])]);

    renderTareasFromCache();

    const desde = _tareasTotal === 0 ? 0 : (_tareasPage - 1) * _tareasLimit + 1;
    const hasta = Math.min(_tareasPage * _tareasLimit, _tareasTotal);
    document.getElementById('tareas-info').textContent = `Mostrando ${desde}-${hasta} de ${_tareasTotal} tareas`;

    const btnPrev = document.getElementById('tareas-btn-prev');
    const btnNext = document.getElementById('tareas-btn-next');
    if (btnPrev) btnPrev.disabled = _tareasPage <= 1;
    if (btnNext) btnNext.disabled = hasta >= _tareasTotal;
  } catch (err) {
    document.getElementById('tareas-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">Error al cargar tareas</td></tr>';
  }
}

function tareasPagina(dir) {
  const maxPage = Math.max(1, Math.ceil(_tareasTotal / _tareasLimit));
  _tareasPage = Math.max(1, Math.min(maxPage, _tareasPage + dir));
  cargarTareas();
}

function toggleVistaAgrupada() {
  _vistaAgrupada = !_vistaAgrupada;
  const btn = document.getElementById('btn-vista-agrupada');
  if (btn) btn.textContent = _vistaAgrupada ? '📋 Vista tabla' : '📁 Vista agrupada';
  renderTareasFromCache();
}

function renderTareasFromCache() {
  if (_vistaAgrupada) {
    renderTareasAgrupadas();
  } else {
    renderTareasTabla();
  }
}

function renderTareasTabla() {
  document.getElementById('tareas-wrap').style.display = 'block';
  document.getElementById('tareas-agrupadas').style.display = 'none';
  const tbody = document.getElementById('tareas-tbody');
  if (!tbody) return;

  tbody.innerHTML = _tareasDataCache.map(t => `
    <tr>
      <td><a href="#" onclick="event.preventDefault();abrirModalDetalleTarea(${t.id})" style="font-weight:600">${esc(t.titulo)}</a></td>
      <td style="font-size:12px;color:var(--muted)">${esc(t.proyecto_nombre || '—')}</td>
      <td>${badgeEstado(t.estado)} ${t.estado === 'revision' ? badgeAprobacion(t.estado_aprobacion) : ''}</td>
      <td>${badgePrioridad(t.prioridad)}</td>
      <td class="nombre-asignado">${t.asignado_a ? esc(nombreUsuario(t.asignado_a)) : '<span style="color:var(--muted)">Sin asignar</span>'}</td>
      <td style="font-size:12px;color:var(--muted)">${t.reportero ? esc(nombreUsuario(t.reportero)) : '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${formatDate(t.fecha_limite)}</td>
      <td>
        ${t.estado === 'en_progreso' ? `<button class="btn btn-xs btn-info" onclick="abrirModalSolicitarRevision(${t.id})" title="Solicitar revisión">&#x1F4CB;</button>` : ''}
        ${t.estado === 'revision' && (usuario?.rol === 'admin' || usuario?.rol === 'gerente') ? `<button class="btn btn-xs btn-success" onclick="aprobarTarea(${t.id})" title="Aprobar">&#10003;</button>` : ''}
        ${t.estado === 'revision' && (usuario?.rol === 'admin' || usuario?.rol === 'gerente') ? `<button class="btn btn-xs btn-danger" onclick="rechazarTarea(${t.id})" title="Rechazar">&#10007;</button>` : ''}
        ${t.estado === 'revision' && usuario?.rol !== 'admin' && usuario?.rol !== 'gerente' ? `<span class="badge badge-warning">Pend. aprobación</span>` : ''}
        ${t.estado !== 'completada' && t.estado !== 'revision' && (usuario?.rol === 'admin' || usuario?.rol === 'gerente') ? `<button class="btn btn-xs btn-success" onclick="completarTareaRapida(${t.id})" title="Marcar completada">&#10003;</button>` : ''}
        ${tienePermiso('editar_tarea') && (t.estado !== 'revision' || (usuario?.rol === 'admin' || usuario?.rol === 'gerente')) ? `<button class="btn btn-xs btn-secondary" onclick="abrirModalTarea(${t.id})" title="Editar">&#9998;</button>` : ''}
        ${tienePermiso('eliminar_tarea') && (t.estado !== 'revision' || (usuario?.rol === 'admin' || usuario?.rol === 'gerente')) ? `<button class="btn btn-xs btn-danger" onclick="eliminarTarea(${t.id})" title="Eliminar">&#10005;</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">No se encontraron tareas</td></tr>';
}

function renderTareasAgrupadas() {
  document.getElementById('tareas-wrap').style.display = 'none';
  const container = document.getElementById('tareas-agrupadas');
  container.style.display = 'block';

  const porProyecto = {};
  _tareasDataCache.forEach(t => {
    const key = t.proyecto_nombre || 'Sin proyecto';
    if (!porProyecto[key]) porProyecto[key] = [];
    porProyecto[key].push(t);
  });

  container.innerHTML = Object.entries(porProyecto).map(([proyecto, tareas]) => `
    <div style="margin-bottom:20px">
      <h3 style="font-size:14px;margin-bottom:8px;color:var(--accent)">${esc(proyecto)} <span style="color:var(--muted);font-weight:400">(${tareas.length})</span></h3>
      <div class="tbl-wrap">
        <table class="tbl"><thead><tr><th>Titulo</th><th>Estado</th><th>Prioridad</th><th>Asignado</th><th>Fecha Limite</th></tr></thead><tbody>
          ${tareas.map(t => `
            <tr>
              <td><a href="#" onclick="event.preventDefault();abrirModalDetalleTarea(${t.id})" style="font-weight:600">${esc(t.titulo)}</a></td>
              <td>${badgeEstado(t.estado)}</td>
              <td>${badgePrioridad(t.prioridad)}</td>
              <td>${t.asignado_a ? esc(nombreUsuario(t.asignado_a)) : '<span style="color:var(--muted)">Sin asignar</span>'}</td>
              <td style="font-size:12px;color:var(--muted)">${formatDate(t.fecha_limite)}</td>
            </tr>
          `).join('')}
        </tbody></table>
      </div>
    </div>
  `).join('') || '<p style="text-align:center;color:var(--muted);padding:40px">No se encontraron tareas</p>';
}

function tareasLimpiarFiltros() {
  document.getElementById('filtro-proyecto').value = '';
  document.getElementById('filtro-estado').value = '';
  document.getElementById('filtro-prioridad').value = '';
  document.getElementById('filtro-busqueda').value = '';
  const asignado = document.getElementById('filtro-asignado');
  const display = document.getElementById('filtro-asignado-display');
  if (asignado) asignado.value = '';
  if (display) display.value = '';
  localStorage.removeItem('sy_tareas_filtros');
  localStorage.removeItem('sy_tareas_proyecto');
  window._tareasFiltrosRestored = false;
  _tareasPage = 1;
  cargarTareas();
}

async function cargarMiembrosProyecto(proyectoId) {
  if (!proyectoId) return _todosUsuarios;
  if (_miembrosProyectoCache[proyectoId]) return _miembrosProyectoCache[proyectoId];
  try {
    const data = await api('/proyectos/' + proyectoId + '/miembros');
    const miembros = data.miembros || [];
    const asignado = data.asignado_a;
    const usuarioIds = new Set();
    for (const m of miembros) usuarioIds.add(Number(m.usuario_id));
    if (asignado) usuarioIds.add(Number(asignado));
    if (usuarioIds.size === 0) return _todosUsuarios;
    const lista = _todosUsuarios.filter(u => usuarioIds.has(Number(u.id)));
    _miembrosProyectoCache[proyectoId] = lista.length ? lista : _todosUsuarios;
    return _miembrosProyectoCache[proyectoId];
  } catch { return _todosUsuarios; }
}

async function actualizarSelectAsignadoTarea(proyectoId) {
  const usuarios = await cargarMiembrosProyecto(proyectoId);
  const wrapper = document.getElementById('tarea-asignado-wrapper');
  if (!wrapper) return;
  const hidden = document.getElementById('tarea-asignado');
  const currentVal = hidden?.value || '';
  const newHtml = selectBuscador('tarea-asignado', usuarios, currentVal, 'Buscar usuario...');
  wrapper.outerHTML = newHtml;
  initSelectBuscador('tarea-asignado');
}

async function abrirModalSolicitarRevision(tareaId) {
  let tareaData = null;
  try { const d = await api('/tareas/' + tareaId); tareaData = d.tarea; } catch {}
  const body = `
    <div style="margin-bottom:12px">
      <strong style="font-size:14px">${esc(tareaData?.titulo || 'Tarea #' + tareaId)}</strong>
      <p style="font-size:12px;color:var(--muted);margin-top:4px">Adjunta evidencia y comenta para solicitar la revisión al administrador</p>
    </div>
    <div style="border:1px dashed var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
      <div class="form-group"><label>Archivo de evidencia</label><input id="rev-file" type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px"></div>
      <div class="form-group" style="margin-top:8px"><label>Descripción de la evidencia</label><textarea id="rev-desc" placeholder="Describe el trabajo realizado..." style="min-height:60px;resize:vertical"></textarea></div>
    </div>
    <div class="form-group"><label>Comentario para el revisor (opcional)</label><textarea id="rev-comentario" placeholder="Agrega notas o comentarios para el admin..." style="min-height:50px;resize:vertical"></textarea></div>
  `;
  const actions = `
    <button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
    <button class="btn btn-sm btn-primary" onclick="ejecutarSolicitarRevision(${tareaId})">&#x1F504; Solicitar revisión</button>
  `;
  abrirModal('Solicitar Revisión', '', body, actions);
}

async function ejecutarSolicitarRevision(tareaId) {
  const desc = document.getElementById('rev-desc')?.value?.trim();
  const fileInput = document.getElementById('rev-file');
  const comentario = document.getElementById('rev-comentario')?.value?.trim();

  try {
    if (fileInput?.files?.length || desc) {
      const formData = new FormData();
      if (desc) formData.append('descripcion', desc);
      if (fileInput?.files?.length) formData.append('archivo', fileInput.files[0]);
      const headers = {};
      if (HF.TOKEN) headers['Authorization'] = 'Bearer ' + HF.TOKEN;
      const evRes = await fetch(HF.API + '/tareas/' + tareaId + '/evidencias', { method: 'POST', body: formData, headers });
      if (!evRes.ok) { const d = await evRes.json(); throw new Error(d.error || 'Error al subir evidencia'); }
    }
    if (comentario) {
      await api('/tareas/' + tareaId + '/comentarios', { method: 'POST', body: JSON.stringify({ contenido: comentario }) });
    }
    await api('/tareas/' + tareaId, { method: 'PUT', body: JSON.stringify({ estado: 'revision', columna: 'revision' }) });
    toast('Tarea enviada a revisión', 'success');
    cerrarModal();
    cargarTareas();
    if (_currentPage === 'tablero') cargarTablero();
  } catch (err) { toast(err.message, 'error'); }
}

async function completarTareaRapida(id) {
  const ok = await confirmarModal('Completar Tarea', '¿Marcar esta tarea como completada?');
  if (!ok) return;
  try {
    await api('/tareas/' + id, { method: 'PUT', body: JSON.stringify({ estado: 'completada', columna: 'completada' }) });
    toast('Tarea completada', 'success');
    cargarTareas();
    if (_currentPage === 'tablero') cargarTablero();
  } catch (err) { toast(err.message, 'error'); }
}

async function aprobarTarea(id) {
  const ok = await confirmarModal('Aprobar Tarea', '¿Aprobar esta tarea?');
  if (!ok) return;
  try {
    await api('/tareas/' + id + '/aprobar', { method: 'PUT' });
    toast('Tarea aprobada', 'success');
    cargarTareas();
    if (_currentPage === 'tablero') cargarTablero();
    if (document.getElementById('modal-detalle')?.classList.contains('show')) abrirModalDetalleTarea(id);
  } catch (err) { toast(err.message, 'error'); }
}

async function rechazarTarea(id) {
  const res = await window.prompt('Motivo de rechazo:');
  if (!res || !res.trim()) return;
  try {
    await api('/tareas/' + id + '/rechazar', { method: 'PUT', body: JSON.stringify({ motivo: res.trim() }) });
    toast('Tarea rechazada', 'warning');
    cargarTareas();
    if (_currentPage === 'tablero') cargarTablero();
    cerrarModalDetalle();
  } catch (err) { toast(err.message, 'error'); }
}

async function subirEvidencia(tareaId) {
  const desc = document.getElementById('evidencia-desc')?.value?.trim() || '';
  const fileInput = document.getElementById('evidencia-file');
  if (!fileInput?.files?.length && !desc) return toast('Agrega un archivo o una descripción', 'error');
  const formData = new FormData();
  if (desc) formData.append('descripcion', desc);
  if (fileInput?.files?.length) formData.append('archivo', fileInput.files[0]);
  try {
    const headers = {};
    if (HF.TOKEN) headers['Authorization'] = 'Bearer ' + HF.TOKEN;
    const res = await fetch(HF.API + '/tareas/' + tareaId + '/evidencias', { method: 'POST', body: formData, headers });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al subir evidencia'); }
    toast('Evidencia subida', 'success');
    abrirModalDetalleTarea(tareaId);
  } catch (err) { toast(err.message, 'error'); }
}

async function eliminarEvidencia(id) {
  const ok = await confirmarModal('Eliminar Evidencia', 'Eliminar esta evidencia?');
  if (!ok) return;
  try {
    await api('/tareas/evidencias/' + id, { method: 'DELETE' });
    toast('Evidencia eliminada', 'success');
    abrirModalDetalleTarea(window._tareaActual);
  } catch (err) { toast(err.message, 'error'); }
}

async function abrirModalTarea(id) {
  await cargarProyectosSelect();
  const proyectoFiltro = document.getElementById('filtro-proyecto')?.value || '';
  const proyectoDefault = _proyectoFiltroActual || proyectoFiltro;
  _proyectoFiltroActual = null;
  let t = null;
  if (id) {
    try { const d = await api('/tareas/' + id); t = d.tarea; } catch {}
  }

  const proyectoSel = t?.proyecto_id || proyectoDefault || '';
  if (proyectoSel) delete _miembrosProyectoCache[proyectoSel];
  const usuariosAsignados = proyectoSel ? await cargarMiembrosProyecto(proyectoSel) : _todosUsuarios;
  const esAdmin = usuario?.rol === 'admin' || usuario?.rol === 'gerente';

  const body = `
    <div class="form-group"><label>Proyecto</label><select id="tarea-proyecto" onchange="actualizarSelectAsignadoTarea(this.value)">${_tareasProyectos.map(p => `<option value="${p.id}" ${(t?.proyecto_id == p.id || (!t && proyectoDefault == p.id)) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Titulo *</label><input id="tarea-titulo" value="${esc(t?.titulo || '')}"></div>
    <div class="form-group"><label>Descripcion</label><textarea id="tarea-desc">${esc(t?.descripcion || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Tipo</label><select id="tarea-tipo">
        <option value="tarea" ${t?.tipo === 'tarea' ? 'selected' : ''}>Tarea</option>
        <option value="incidente" ${t?.tipo === 'incidente' ? 'selected' : ''}>Incidente</option>
        <option value="feature" ${t?.tipo === 'feature' ? 'selected' : ''}>Feature / Mejora</option>
        <option value="reunion" ${t?.tipo === 'reunion' ? 'selected' : ''}>Reunión</option>
        <option value="investigacion" ${t?.tipo === 'investigacion' ? 'selected' : ''}>Investigación</option>
        <option value="documentacion" ${t?.tipo === 'documentacion' ? 'selected' : ''}>Documentación</option>
        <option value="revision" ${t?.tipo === 'revision' ? 'selected' : ''}>Revisión / QA</option>
        <option value="configuracion" ${t?.tipo === 'configuracion' ? 'selected' : ''}>Configuración</option>
        <option value="capacitacion" ${t?.tipo === 'capacitacion' ? 'selected' : ''}>Capacitación</option>
        <option value="diseno" ${t?.tipo === 'diseno' ? 'selected' : ''}>Diseño</option>
        <option value="cumplimiento" ${t?.tipo === 'cumplimiento' ? 'selected' : ''}>Cumplimiento normativo</option>
        <option value="implementacion" ${t?.tipo === 'implementacion' ? 'selected' : ''}>Implementación</option>
      </select></div>
      <div class="form-group"><label>Prioridad</label><select id="tarea-prioridad">
        <option value="baja" ${t?.prioridad === 'baja' ? 'selected' : ''}>Baja</option>
        <option value="media" ${t?.prioridad === 'media' ? 'selected' : ''}>Media</option>
        <option value="alta" ${t?.prioridad === 'alta' ? 'selected' : ''}>Alta</option>
        <option value="critica" ${t?.prioridad === 'critica' ? 'selected' : ''}>Critica</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Estado</label><select id="tarea-estado">
        <option value="pendiente" ${t?.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
        <option value="en_progreso" ${t?.estado === 'en_progreso' ? 'selected' : ''}>En Progreso</option>
        <option value="revision" ${t?.estado === 'revision' ? 'selected' : ''}>Revision</option>
        ${(usuario?.rol === 'admin' || usuario?.rol === 'gerente') ? `<option value="completada" ${t?.estado === 'completada' ? 'selected' : ''}>Completada</option>` : ''}
      </select></div>
      <div class="form-group"><label>Asignado a</label>${selectBuscador('tarea-asignado', usuariosAsignados, id ? t?.asignado_a : usuario?.id, 'Buscar usuario...')}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Fecha Limite</label><input type="date" id="tarea-fecha" value="${t?.fecha_limite ? t.fecha_limite.split('T')[0] : ''}" ${(id && t?.asignado_a === usuario?.id && !esAdmin) ? 'disabled' : ''}></div>
      <div class="form-group"><label>Estimacion (horas)</label><input type="number" id="tarea-estimacion" value="${t?.estimacion_horas || ''}" step="0.5" min="0"></div>
    </div>
  `;
  const actions = `<button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
    <button class="btn btn-sm btn-primary" onclick="guardarTarea(${id || 'null'})">Guardar</button>`;
  abrirModal(id ? 'Editar Tarea' : 'Nueva Tarea', '', body, actions);
  initSelectBuscador('tarea-asignado');
}

async function guardarTarea(id) {
  const body = {
    proyecto_id: document.getElementById('tarea-proyecto').value || null,
    titulo: document.getElementById('tarea-titulo').value.trim(),
    descripcion: document.getElementById('tarea-desc').value.trim(),
    tipo: document.getElementById('tarea-tipo').value,
    prioridad: document.getElementById('tarea-prioridad').value,
    estado: document.getElementById('tarea-estado').value,
    columna: document.getElementById('tarea-estado').value,
    asignado_a: parseInt(document.getElementById('tarea-asignado').value) || null,
    fecha_limite: document.getElementById('tarea-fecha').value || null,
    estimacion_horas: parseFloat(document.getElementById('tarea-estimacion').value) || null
  };
  if (!body.titulo) return toast('El titulo es requerido', 'error');
  try {
    if (id) {
      await api('/tareas/' + id, { method: 'PUT', body: JSON.stringify(body) });
      toast('Tarea actualizada', 'success');
    } else {
      await api('/tareas', { method: 'POST', body: JSON.stringify(body) });
      toast('Tarea creada', 'success');
    }
    cerrarModal();
    cargarTareas();
    if (_currentPage === 'proyectos') cargarProyectos();
  } catch (err) { toast(err.message, 'error'); }
}

async function eliminarTarea(id) {
  const ok = await confirmarModal('Eliminar Tarea', 'Eliminar esta tarea?');
  if (!ok) return;
  try {
    await api('/tareas/' + id, { method: 'DELETE' });
    toast('Tarea eliminada', 'success');
    cargarTareas();
  } catch (err) { toast(err.message, 'error'); }
}

async function abrirModalDetalleTarea(id) {
  window._tareaActual = id;
  try {
    const [tareaRes, comRes, evRes] = await Promise.all([
      api('/tareas/' + id),
      api('/tareas/' + id + '/comentarios'),
      api('/tareas/' + id + '/evidencias')
    ]);
    const t = tareaRes.tarea;
    await cargarNombresUsuarios([t.asignado_a, t.reportero, t.aprobado_por].filter(Boolean));
    const comentarios = comRes.comentarios || [];
    await cargarNombresUsuarios(comentarios.map(c => c.usuario_id));
    const evidencias = evRes.evidencias || [];
    await cargarNombresUsuarios(evidencias.map(e => e.usuario_id));

    const esAdmin = usuario?.rol === 'admin' || usuario?.rol === 'gerente';
    const content = document.getElementById('modal-detalle-body');

    const evidenciaHtml = `
      <div class="evidencia-section" style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:12px">
        <strong style="font-size:13px">Evidencias (${evidencias.length})</strong>
        <div style="max-height:250px;overflow-y:auto;margin:8px 0">
          ${evidencias.map(e => {
            const ext = e.archivo_nombre ? e.archivo_nombre.split('.').pop().toLowerCase() : '';
            const esImagen = ['jpg','jpeg','png','gif','webp'].includes(ext);
            return `
              <div class="evidencia-item" style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--surface)">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                  <div>
                    <strong style="font-size:12px">${esc(nombreUsuario(e.usuario_id))}</strong>
                    <span style="color:var(--muted);font-size:11px;margin-left:6px">${formatDate(e.created_at)}</span>
                  </div>
                  ${esAdmin ? `<button class="btn btn-xs btn-danger" onclick="eliminarEvidencia(${e.id})" title="Eliminar">&#10005;</button>` : ''}
                </div>
                ${e.descripcion ? `<p style="font-size:12px;margin-bottom:6px">${esc(e.descripcion)}</p>` : ''}
                ${e.archivo_path ? (esImagen
                  ? `<img src="${BASE}/uploads/evidencias/${e.archivo_path}" style="max-width:100%;max-height:200px;border-radius:6px;cursor:pointer" onclick="window.open('${BASE}/uploads/evidencias/${e.archivo_path}')" alt="${esc(e.archivo_nombre)}">`
                  : `<div style="font-size:11px"><a href="${BASE}/uploads/evidencias/${e.archivo_path}" target="_blank" style="color:var(--accent)">&#x1F4CE; ${esc(e.archivo_nombre)} (${e.archivo_tamanio ? Math.round(e.archivo_tamanio/1024) + 'KB' : '?'})</a></div>`
                ) : ''}
              </div>
            `;
          }).join('') || '<p style="color:var(--muted);font-size:12px;padding:8px 0">Sin evidencias subidas</p>'}
        </div>
        <div class="evidencia-upload" style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px dashed var(--border);border-radius:8px">
          <textarea id="evidencia-desc" placeholder="Descripción del adjunto (opcional, no es la descripción de la tarea)..." style="font-size:12px;min-height:50px;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="evidencia-file" type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx" style="flex:1;font-size:12px">
            <button class="btn btn-sm btn-primary" onclick="subirEvidencia(${t.id})">Subir</button>
          </div>
        </div>
      </div>
    `;

    const aprobacionHtml = t.estado === 'revision' ? `
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:12px">
        <strong style="font-size:13px">Aprobación</strong>
        <div style="margin-top:8px;display:flex;gap:8px">
          ${esAdmin
            ? `<button class="btn btn-sm btn-success" onclick="aprobarTarea(${t.id})">&#10003; Aprobar</button>
               <button class="btn btn-sm btn-danger" onclick="rechazarTarea(${t.id})">&#10007; Rechazar</button>`
            : `<span class="badge badge-warning">Pendiente de aprobación por administrador</span>`
          }
        </div>
      </div>
    ` : '';

    const rechazoHtml = t.motivo_rechazo ? `
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:12px">
        <strong style="font-size:13px;color:var(--danger)">Rechazada</strong>
        <p style="font-size:12px;margin-top:4px;padding:8px;background:rgba(239,68,68,.08);border-radius:6px">${esc(t.motivo_rechazo)}</p>
      </div>
    ` : '';

    content.innerHTML = `
      <div class="modal-title">${esc(t.titulo)}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${badgeEstado(t.estado)} ${badgeAprobacion(t.estado_aprobacion)} ${badgePrioridad(t.prioridad)}
        <span class="badge badge-muted">${esc(t.tipo || 'tarea')}</span>
      </div>
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <strong style="font-size:13px">Descripcion</strong>
          <button class="btn btn-xs btn-secondary" onclick="editarDescripcionTarea(${t.id})" title="Editar descripcion">&#9998;</button>
        </div>
        <p id="tarea-desc-display" style="font-size:13px;color:var(--muted);margin:0">${esc(t.descripcion || 'Sin descripcion')}</p>
        <div id="tarea-desc-edit" style="display:none">
          <textarea id="tarea-desc-input" style="width:100%;min-height:60px;resize:vertical;font-size:13px">${esc(t.descripcion || '')}</textarea>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-xs btn-primary" onclick="guardarDescripcionTarea(${t.id})">Guardar</button>
            <button class="btn btn-xs btn-secondary" onclick="cancelarEdicionDescripcion()">Cancelar</button>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--muted);margin-bottom:16px">
        <div>Proyecto: <strong>${esc(t.proyecto_nombre || '—')}</strong></div>
        <div>Asignado: <strong>${t.asignado_a ? esc(nombreUsuario(t.asignado_a)) : '—'}</strong></div>
        <div>Fecha limite: <strong>${formatDate(t.fecha_limite)}</strong></div>
        <div>Estimacion: <strong>${t.estimacion_horas ? t.estimacion_horas + 'h' : '—'}</strong></div>
        ${t.aprobado_por ? `<div>Aprobado por: <strong>${esc(nombreUsuario(t.aprobado_por))}</strong></div>` : ''}
        ${t.aprobado_en ? `<div>Aprobado el: <strong>${formatDate(t.aprobado_en)}</strong></div>` : ''}
      </div>
      ${rechazoHtml}
      ${evidenciaHtml}
      ${aprobacionHtml}
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:8px">
        <strong style="font-size:13px">Comentarios (${comentarios.length})</strong>
      </div>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:12px">
        ${comentarios.map(c => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
            <strong>${esc(nombreUsuario(c.usuario_id))}</strong>
            <span style="color:var(--muted);margin-left:6px">${formatDate(c.created_at)}</span>
            <p style="margin-top:4px;color:var(--text)">${esc(c.contenido)}</p>
          </div>
        `).join('') || '<p style="color:var(--muted);font-size:12px;padding:8px 0">Sin comentarios</p>'}
      </div>
      <div style="display:flex;gap:8px">
        <input id="detalle-comentario" placeholder="Escribe un comentario..." style="flex:1" onkeydown="if(event.key==='Enter')agregarComentario(${t.id})">
        <button class="btn btn-sm btn-primary" onclick="agregarComentario(${t.id})">Enviar</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-primary" onclick="cerrarModalDetalle();abrirModalTarea(${t.id})">Editar Tarea</button>
        <button class="btn btn-sm btn-secondary" onclick="cerrarModalDetalle()">Cerrar</button>
      </div>
    `;
    document.getElementById('modal-detalle').classList.add('show');
  } catch (err) { toast(err.message, 'error'); }
}

async function agregarComentario(tareaId) {
  const input = document.getElementById('detalle-comentario');
  const contenido = input.value.trim();
  if (!contenido) return;
  try {
    await api('/tareas/' + tareaId + '/comentarios', { method: 'POST', body: JSON.stringify({ contenido }) });
    input.value = '';
    abrirModalDetalleTarea(tareaId);
  } catch (err) { toast(err.message, 'error'); }
}

function editarDescripcionTarea(id) {
  document.getElementById('tarea-desc-display').style.display = 'none';
  document.getElementById('tarea-desc-edit').style.display = 'block';
  document.getElementById('tarea-desc-input').focus();
}

function cancelarEdicionDescripcion() {
  document.getElementById('tarea-desc-display').style.display = 'block';
  document.getElementById('tarea-desc-edit').style.display = 'none';
}

async function guardarDescripcionTarea(id) {
  const desc = document.getElementById('tarea-desc-input').value.trim();
  try {
    await api('/tareas/' + id, { method: 'PUT', body: JSON.stringify({ descripcion: desc }) });
    toast('Descripcion actualizada', 'success');
    abrirModalDetalleTarea(id);
  } catch (err) { toast(err.message, 'error'); }
}
