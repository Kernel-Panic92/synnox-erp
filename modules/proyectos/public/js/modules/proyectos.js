let _proyectos = [];
let _centrosCache = null;

async function cargarProyectos() {
  try {
    const data = await api('/proyectos');
    _proyectos = data.proyectos || [];
    const q = (document.getElementById('filtro-proy-busqueda')?.value || '').toLowerCase();
    const filtrados = q ? _proyectos.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      (p.descripcion || '').toLowerCase().includes(q) ||
      nombreUsuario(p.asignado_a).toLowerCase().includes(q)
    ) : _proyectos;
    document.getElementById('proyectos-count').textContent = `${filtrados.length} proyecto(s)`;
    const ids = _proyectos.map(p => p.asignado_a).filter(Boolean);
    await cargarNombresUsuarios(ids);
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
        <div class="card" style="cursor:pointer">
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
            ${p.estado !== 'completado' && (p.estado_aprobacion !== 'aprobada') && ['admin','gerente'].includes(usuario?.rol) ? `<button class="btn btn-xs btn-success" onclick="event.stopPropagation();aprobarProyecto(${p.id})" title="Aprobar">&#10003;</button>` : ''}
            ${p.estado_aprobacion === 'aprobada' && ['admin','gerente'].includes(usuario?.rol) ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();rechazarProyecto(${p.id})" title="Desaprobar">&#10007;</button>` : ''}
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

async function cargarCentrosProyectos() {
  if (_centrosCache) return;
  try {
    const centros = await api('/centros');
    _centrosCache = Array.isArray(centros) ? centros : [];
  } catch { _centrosCache = []; }
}

async function abrirModalProyecto(id) {
  await cargarCentrosProyectos();
  await cargarTodosLosUsuarios();
  const p = id ? _proyectos.find(x => x.id === id) : null;
  const titulo = p ? 'Editar Proyecto' : 'Nuevo Proyecto';
  const centroOpts = (_centrosCache || []).map(c =>
    `<option value="${c.id}" ${p?.centro_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`
  ).join('');
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
      <div class="form-group"><label>Asignado a</label>${selectBuscador('proy-asignado', _todosUsuarios, p?.asignado_a, 'Buscar usuario...')}</div>
    </div>
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
