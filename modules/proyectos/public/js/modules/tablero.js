const _columnas = [
  { id: 'pendiente', label: 'Pendiente', color: '#fdcb6e' },
  { id: 'en_progreso', label: 'En Progreso', color: '#6c5ce7' },
  { id: 'revision', label: 'Revision', color: '#a29bfe' },
  { id: 'completada', label: 'Completada', color: '#00b894' }
];

async function cargarTablero() {
  const proyectoId = document.getElementById('tablero-proyecto')?.value;
  await cargarProyectosSelectKanban();
  if (!proyectoId) {
    document.getElementById('kanban-board').innerHTML = '<div class="empty-state" style="width:100%"><div class="icon">&#x1F5C2;</div><p>Selecciona un proyecto para ver el tablero Kanban</p></div>';
    return;
  }
  try {
    const params = new URLSearchParams({ proyecto_id: proyectoId, limit: '200' });
    const data = await HF.api('/tareas?' + params.toString());
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
              ondragend="event.target.classList.remove('dragging')"
              onclick="abrirModalDetalleTarea(${t.id})">
              <div class="card-title">${esc(t.titulo)}</div>
              <div class="card-meta">
                ${badgePrioridad(t.prioridad)}
                ${t.asignado_a ? `<span>&#x1F464; ${esc(nombreUsuario(t.asignado_a))}</span>` : ''}
                ${t.fecha_limite ? `<span>&#x1F4C5; ${formatDate(t.fecha_limite)}</span>` : ''}
              </div>
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
    await HF.api('/tareas/reordenar', { method: 'PUT', body: JSON.stringify({ tarea_id: tareaId, columna: columnaDestino, orden: 0 }) });
    toast('Tarea movida a ' + _columnas.find(c => c.id === columnaDestino)?.label || columnaDestino, 'success');
    cargarTablero();
  } catch (err) { toast(err.message, 'error'); }
}

async function cargarProyectosSelectKanban() {
  try {
    const data = await HF.api('/proyectos');
    const proyectos = data.proyectos || [];
    const sel = document.getElementById('tablero-proyecto');
    const current = sel.value;
    sel.innerHTML = '<option value="">Selecciona un proyecto</option>' + proyectos.map(p => `<option value="${p.id}" ${current == p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  } catch {}
}
