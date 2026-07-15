let _proyectos = [];

async function cargarProyectos() {
  try {
    const data = await api('/proyectos');
    _proyectos = data.proyectos || [];
    document.getElementById('proyectos-count').textContent = `${_proyectos.length} proyecto(s)`;
    const grid = document.getElementById('proyectos-grid');

    if (!_proyectos.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">&#x1F4C1;</div><p>No hay proyectos. Crea el primero para empezar.</p></div>';
      return;
    }

    grid.innerHTML = _proyectos.map(p => {
      const total = parseInt(p.total_tareas) || 0;
      const completadas = parseInt(p.tareas_completadas) || 0;
      const pct = total > 0 ? Math.round((completadas / total) * 100) : 0;
      const estadoCls = p.estado === 'completado' ? 'badge-success' : p.estado === 'archivado' ? 'badge-muted' : 'badge-info';
      const aprobCls = p.estado_aprobacion === 'aprobada' ? 'badge-success' : p.estado_aprobacion === 'rechazada' ? 'badge-danger' : 'badge-muted';
      return `
        <div class="card" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <strong style="font-size:15px">${esc(p.nombre)}</strong>
            <span style="display:flex;gap:6px">
              <span class="badge ${aprobCls}">${p.estado_aprobacion || 'pendiente'}</span>
              <span class="badge ${estadoCls}">${p.estado || 'activo'}</span>
            </span>
          </div>
          ${p.descripcion ? `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">${esc(p.descripcion)}</p>` : ''}
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
            ${p.estado_aprobacion !== 'aprobada' && usuario?.rol === 'admin' ? `<button class="btn btn-xs btn-success" onclick="event.stopPropagation();aprobarProyecto(${p.id})">Aprobar</button>` : ''}
            ${p.estado_aprobacion === 'aprobada' && usuario?.rol === 'admin' ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();rechazarProyecto(${p.id})">Desaprobar</button>` : ''}
            <button class="btn btn-xs btn-secondary" onclick="event.stopPropagation();abrirModalProyecto(${p.id})">Editar</button>
            <button class="btn btn-xs btn-danger" onclick="event.stopPropagation();eliminarProyecto(${p.id})">Eliminar</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('proyectos-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Error al cargar proyectos</p></div>';
  }
}

async function abrirModalProyecto(id) {
  const p = id ? _proyectos.find(x => x.id === id) : null;
  const titulo = p ? 'Editar Proyecto' : 'Nuevo Proyecto';
  const body = `
    <div class="form-group"><label>Nombre *</label><input id="proy-nombre" value="${esc(p?.nombre || '')}"></div>
    <div class="form-group"><label>Descripcion</label><textarea id="proy-desc">${esc(p?.descripcion || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Estado</label><select id="proy-estado">
        <option value="activo" ${p?.estado === 'activo' ? 'selected' : ''}>Activo</option>
        <option value="completado" ${p?.estado === 'completado' ? 'selected' : ''}>Completado</option>
        <option value="archivado" ${p?.estado === 'archivado' ? 'selected' : ''}>Archivado</option>
      </select></div>
      <div class="form-group"><label>Fecha Limite</label><input type="date" id="proy-fecha" value="${p?.fecha_limite ? p.fecha_limite.split('T')[0] : ''}"></div>
    </div>
  `;
  const actions = `<button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
    <button class="btn btn-sm btn-primary" onclick="guardarProyecto(${id || 'null'})">Guardar</button>`;
  abrirModal(titulo, '', body, actions);
}

async function guardarProyecto(id) {
  const body = {
    nombre: document.getElementById('proy-nombre').value.trim(),
    descripcion: document.getElementById('proy-desc').value.trim(),
    estado: document.getElementById('proy-estado').value,
    fecha_limite: document.getElementById('proy-fecha').value || null
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
