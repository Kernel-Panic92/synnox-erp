const _columnas = [
  { id: 'pendiente', label: 'Pendiente', color: '#fdcb6e' },
  { id: 'en_progreso', label: 'En Progreso', color: '#6c5ce7' },
  { id: 'revision', label: 'Revision', color: '#a29bfe' },
  { id: 'completada', label: 'Completada', color: '#00b894' }
];

async function cargarTablero() {
  const proyectoId = document.getElementById('tablero-proyecto')?.value;
  await cargarProyectosSelectKanban();
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (proyectoId) params.set('proyecto_id', proyectoId);
    const data = await api('/tareas?' + params.toString());
    const tareas = data.tareas || [];
    const ids = tareas.map(t => t.asignado_a).filter(Boolean);
    await cargarNombresUsuarios(ids);

    const board = document.getElementById('kanban-board');
    board.innerHTML = _columnas.map(col => {
      const items = tareas.filter(t => t.columna === col.id);
      return `
        <div class="kanban-col" data-columna="${col.id}"
          ondragover="event.preventDefault()"
          ondragenter="event.target.closest('.kanban-col')?.classList.add('drag-over')"
          ondragleave="event.target.closest('.kanban-col')?.classList.remove('drag-over')"
          ondrop="soltarTarea(event, '${col.id}')">
          <h4><span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${col.color}"></span>${col.label}</span><span class="count">${items.length}</span></h4>
          ${items.map(t => `
            <div class="kanban-card" draggable="true" data-tarea-id="${t.id}"
              ondragstart="event.dataTransfer.setData('text/plain', '${t.id}');event.target.classList.add('dragging')"
              ondragend="event.target.classList.remove('dragging')">
              <div class="card-title" onclick="abrirModalDetalleTarea(${t.id})" style="cursor:pointer">${esc(t.titulo)}</div>
              <div class="card-meta">
                ${badgePrioridad(t.prioridad)}
                ${!proyectoId && t.proyecto_nombre ? `<span>&#x1F4C1; ${esc(t.proyecto_nombre)}</span>` : ''}
                ${t.asignado_a ? `<span>&#x1F464; ${esc(nombreUsuario(t.asignado_a))}</span>` : ''}
                ${t.fecha_limite ? `<span>&#x1F4C5; ${formatDate(t.fecha_limite)}</span>` : ''}
              </div>
              ${t.columna === 'en_progreso' && t.asignado_a ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;gap:4px">
                <button class="btn btn-xs btn-info" onclick="event.stopPropagation();abrirModalSolicitarRevision(${t.id})" title="Solicitar revision">&#x1F504; Revisión</button>
              </div>` : ''}
              ${t.columna === 'revision' && (usuario?.rol === 'admin' || usuario?.rol === 'gerente') ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;gap:4px">
                <button class="btn btn-xs btn-success" onclick="event.stopPropagation();aprobarTarea(${t.id})" title="Aprobar">&#10003; Aprobar</button>
                <button class="btn btn-xs btn-danger" onclick="event.stopPropagation();rechazarTarea(${t.id})" title="Rechazar">&#10007;</button>
              </div>` : ''}
              ${t.columna === 'revision' && usuario?.rol !== 'admin' && usuario?.rol !== 'gerente' ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--warning)">&#x23F3; Pend. aprobación</div>` : ''}
              ${t.estado_aprobacion === 'rechazada' ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--danger)" title="${esc(t.motivo_rechazo || '')}">&#x26A0; Rechazada</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('kanban-board').innerHTML = '<div class="empty-state" style="width:100%"><p>Error al cargar tablero</p></div>';
  }
}

async function soltarTarea(event, columnaDestino) {
  event.preventDefault();
  event.target.closest('.kanban-col')?.classList.remove('drag-over');
  const tareaId = parseInt(event.dataTransfer.getData('text/plain'));
  if (!tareaId || isNaN(tareaId)) return;

  try {
    await api('/tareas/reordenar', { method: 'PUT', body: JSON.stringify({ tarea_id: tareaId, columna: columnaDestino, orden: 0 }) });
    toast('Tarea movida a ' + _columnas.find(c => c.id === columnaDestino)?.label || columnaDestino, 'success');
    cargarTablero();
  } catch (err) { toast(err.message, 'error'); }
}

async function cargarProyectosSelectKanban() {
  try {
    const data = await api('/proyectos');
    const proyectos = data.proyectos || [];
    const sel = document.getElementById('tablero-proyecto');
    const current = sel.value;
    sel.innerHTML = '<option value="">Selecciona un proyecto</option>' + proyectos.map(p => `<option value="${p.id}" ${current == p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  } catch {}
}
