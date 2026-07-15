let _tareasPage = 1;
let _tareasProyectos = [];

async function cargarProyectosSelect() {
  if (_tareasProyectos.length) return;
  try {
    const data = await api('/proyectos');
    _tareasProyectos = data.proyectos || [];
    const sel = document.getElementById('filtro-proyecto');
    if (sel) sel.innerHTML = '<option value="">Todos los proyectos</option>' + _tareasProyectos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  } catch {}
}

async function cargarTareas() {
  await cargarProyectosSelect();
  const params = new URLSearchParams();
  const proyecto = document.getElementById('filtro-proyecto')?.value;
  const estado = document.getElementById('filtro-estado')?.value;
  const prioridad = document.getElementById('filtro-prioridad')?.value;
  const q = document.getElementById('filtro-busqueda')?.value;
  if (proyecto) params.set('proyecto_id', proyecto);
  if (estado) params.set('estado', estado);
  if (prioridad) params.set('prioridad', prioridad);
  if (q) params.set('q', q);
  params.set('page', _tareasPage);
  params.set('limit', '20');

  try {
    const data = await api('/tareas?' + params.toString());
    const tareas = data.tareas || [];
    const ids = tareas.map(t => t.asignado_a).filter(Boolean);
    await cargarNombresUsuarios(ids);

    document.getElementById('tareas-tbody').innerHTML = tareas.map(t => `
      <tr>
        <td><a href="#" onclick="event.preventDefault();abrirModalDetalleTarea(${t.id})" style="font-weight:600">${esc(t.titulo)}</a></td>
        <td style="font-size:12px;color:var(--muted)">${esc(t.proyecto_nombre || '—')}</td>
        <td>${badgeEstado(t.estado)}</td>
        <td>${badgePrioridad(t.prioridad)}</td>
        <td class="nombre-asignado">${t.asignado_a ? esc(nombreUsuario(t.asignado_a)) : '<span style="color:var(--muted)">Sin asignar</span>'}</td>
        <td style="font-size:12px;color:var(--muted)">${formatDate(t.fecha_limite)}</td>
        <td>
          <button class="btn btn-xs btn-secondary" onclick="abrirModalTarea(${t.id})" title="Editar">&#9998;</button>
          <button class="btn btn-xs btn-danger" onclick="eliminarTarea(${t.id})" title="Eliminar">&#10005;</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No se encontraron tareas</td></tr>';

    const total = data.total || 0;
    const desde = total === 0 ? 0 : (_tareasPage - 1) * 20 + 1;
    const hasta = Math.min(_tareasPage * 20, total);
    document.getElementById('tareas-info').textContent = `Mostrando ${desde}-${hasta} de ${total} tareas`;
  } catch (err) {
    document.getElementById('tareas-tbody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">Error al cargar tareas</td></tr>';
  }
}

function tareasPagina(dir) {
  _tareasPage = Math.max(1, _tareasPage + dir);
  cargarTareas();
}

async function abrirModalTarea(id) {
  await cargarProyectosSelect();
  let t = null;
  if (id) {
    try { const d = await api('/tareas/' + id); t = d.tarea; } catch {}
  }

  const usuarios = Object.entries(_nombresUsuarios).map(([id, nom]) => `<option value="${id}" ${t?.asignado_a == id ? 'selected' : ''}>${esc(nom)}</option>`).join('');

  const body = `
    <div class="form-group"><label>Proyecto</label><select id="tarea-proyecto">${_tareasProyectos.map(p => `<option value="${p.id}" ${(t?.proyecto_id == p.id) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Titulo *</label><input id="tarea-titulo" value="${esc(t?.titulo || '')}"></div>
    <div class="form-group"><label>Descripcion</label><textarea id="tarea-desc">${esc(t?.descripcion || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Tipo</label><select id="tarea-tipo">
        <option value="tarea" ${t?.tipo === 'tarea' ? 'selected' : ''}>Tarea</option>
        <option value="bug" ${t?.tipo === 'bug' ? 'selected' : ''}>Bug</option>
        <option value="mejora" ${t?.tipo === 'mejora' ? 'selected' : ''}>Mejora</option>
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
        <option value="completada" ${t?.estado === 'completada' ? 'selected' : ''}>Completada</option>
      </select></div>
      <div class="form-group"><label>Asignado a</label><select id="tarea-asignado"><option value="">Sin asignar</option>${usuarios}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Fecha Limite</label><input type="date" id="tarea-fecha" value="${t?.fecha_limite ? t.fecha_limite.split('T')[0] : ''}"></div>
      <div class="form-group"><label>Estimacion (horas)</label><input type="number" id="tarea-estimacion" value="${t?.estimacion_horas || ''}" step="0.5" min="0"></div>
    </div>
  `;
  const actions = `<button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
    <button class="btn btn-sm btn-primary" onclick="guardarTarea(${id || 'null'})">Guardar</button>`;
  abrirModal(id ? 'Editar Tarea' : 'Nueva Tarea', body, actions);
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
  try {
    const [tareaRes, comRes] = await Promise.all([
      api('/tareas/' + id),
      api('/tareas/' + id + '/comentarios')
    ]);
    const t = tareaRes.tarea;
    await cargarNombresUsuarios([t.asignado_a, t.reportero].filter(Boolean));
    const comentarios = comRes.comentarios || [];
    await cargarNombresUsuarios(comentarios.map(c => c.usuario_id));

    const content = document.getElementById('modal-detalle-content');
    content.innerHTML = `
      <div class="modal-title">${esc(t.titulo)}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${badgeEstado(t.estado)} ${badgePrioridad(t.prioridad)}
        <span class="badge badge-muted">${esc(t.tipo || 'tarea')}</span>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(t.descripcion || 'Sin descripcion')}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--muted);margin-bottom:16px">
        <div>Proyecto: <strong>${esc(t.proyecto_nombre || '—')}</strong></div>
        <div>Asignado: <strong>${t.asignado_a ? esc(nombreUsuario(t.asignado_a)) : '—'}</strong></div>
        <div>Fecha limite: <strong>${formatDate(t.fecha_limite)}</strong></div>
        <div>Estimacion: <strong>${t.estimacion_horas ? t.estimacion_horas + 'h' : '—'}</strong></div>
      </div>
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
        <button class="btn btn-sm btn-primary" onclick="cerrarModal();abrirModalTarea(${t.id})">Editar Tarea</button>
        <button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cerrar</button>
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
