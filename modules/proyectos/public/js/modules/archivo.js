let _archivoPage = 1;
let _archivoLimit = 20;
let _archivoTotal = 0;
let _archivoData = [];
let _archivoProyectos = [];
let _archivoStats = null;
let _archivoConfig = null;

const debouncedCargarArchivo = debounce(cargarArchivo, 300);

function puedeAdministrarArchivo() {
  return usuario?.rol === 'admin' || usuario?.rol === 'gerente';
}

async function cargarArchivoStats() {
  try {
    const data = await api('/archivo/stats');
    _archivoStats = data.stats;
    _archivoConfig = data.config;

    const total = _archivoStats?.total || 0;
    const restauradas = _archivoStats?.restauradas || 0;
    const espacio = _archivoStats?.espacio || '—';
    const ultima = data.ultimaEjecucion;

    document.getElementById('archivo-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Tareas archivadas</div>
        <div class="stat-value">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Restauradas</div>
        <div class="stat-value" style="color:var(--accent)">${restauradas}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Espacio en BD</div>
        <div class="stat-value" style="color:var(--info)">${esc(espacio)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Última migración</div>
        <div class="stat-value" style="font-size:18px">${ultima ? formatDate(ultima.ejecutado_en) : 'Nunca'}</div>
      </div>
    `;

    const cfgText = _archivoConfig
      ? `Archivar después de <strong>${esc(_archivoConfig.meses_para_archivar)} meses</strong> · Conservar <strong>${esc(_archivoConfig.meses_retencion)} meses</strong> · Auto: <strong>${_archivoConfig.habilitado === 'true' ? 'Sí' : 'No'}</strong>`
      : '';
    document.getElementById('archivo-config-summary').innerHTML = cfgText;
  } catch (err) {
    document.getElementById('archivo-stats').innerHTML = `<div class="card" style="grid-column:1/-1;color:var(--muted);padding:20px">Error al cargar estadísticas</div>`;
  }
}

async function cargarProyectosArchivo() {
  try {
    const data = await api('/proyectos');
    _archivoProyectos = data.proyectos || [];
    const sel = document.getElementById('archivo-filtro-proyecto');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="">Todos los proyectos</option>' +
        _archivoProyectos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    }
  } catch {}
}

function renderArchivo() {
  const tbody = document.getElementById('archivo-tbody');
  if (!tbody) return;

  if (!_archivoData.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No hay tareas archivadas</td></tr>`;
    return;
  }

  tbody.innerHTML = _archivoData.map(a => `
    <tr>
      <td><a href="#" onclick="event.preventDefault();abrirModalArchivo(${a.id})" style="font-weight:600;color:var(--accent)">#${a.tarea_id_original} ${esc(a.titulo)}</a></td>
      <td style="font-size:12px;color:var(--muted)">${esc(a.proyecto_nombre || '—')}</td>
      <td>${badgePrioridad(a.prioridad)}</td>
      <td style="font-size:12px;color:var(--muted)">${formatDate(a.completada_en)}</td>
      <td style="font-size:12px;color:var(--muted)">${formatDate(a.archivada_en)}</td>
      <td>
        ${a.restaurada_como_id
          ? `<span class="badge badge-muted" title="Restaurada como #${a.restaurada_como_id}">Restaurada #${a.restaurada_como_id}</span>`
          : (puedeAdministrarArchivo() ? `<button class="btn btn-xs btn-secondary" onclick="reactivarArchivo(${a.id})" title="Reactivar tarea">&#x21BA;</button>` : '')}
      </td>
    </tr>
  `).join('');
}

function renderArchivoPagination() {
  const desde = _archivoTotal === 0 ? 0 : (_archivoPage - 1) * _archivoLimit + 1;
  const hasta = Math.min(_archivoPage * _archivoLimit, _archivoTotal);
  document.getElementById('archivo-info').textContent = `Mostrando ${desde}-${hasta} de ${_archivoTotal}`;

  const btnPrev = document.getElementById('archivo-btn-prev');
  const btnNext = document.getElementById('archivo-btn-next');
  if (btnPrev) btnPrev.disabled = _archivoPage <= 1;
  if (btnNext) btnNext.disabled = hasta >= _archivoTotal;
}

function archivoPagina(dir) {
  const maxPage = Math.max(1, Math.ceil(_archivoTotal / _archivoLimit));
  _archivoPage = Math.max(1, Math.min(maxPage, _archivoPage + dir));
  cargarArchivo();
}

function archivoLimpiarFiltros() {
  document.getElementById('archivo-filtro-proyecto').value = '';
  document.getElementById('archivo-filtro-desde').value = '';
  document.getElementById('archivo-filtro-hasta').value = '';
  document.getElementById('archivo-filtro-busqueda').value = '';
  _archivoPage = 1;
  cargarArchivo();
}

async function abrirModalArchivo(id) {
  try {
    const data = await api('/archivo/' + id);
    const a = data.archivada;
    const t = a.tarea_snapshot || {};
    const comentarios = a.comentarios_snapshot || [];
    const evidencias = a.evidencias_snapshot || [];

    const ids = [t.asignado_a, t.reportero, a.archivada_por].filter(Boolean)
      .concat(comentarios.map(c => c.usuario_id))
      .concat(evidencias.map(e => e.usuario_id));
    await cargarNombresUsuarios([...new Set(ids)]);

    const comentariosHtml = comentarios.length
      ? `<div style="max-height:160px;overflow-y:auto;margin:8px 0">
          ${comentarios.map(c => `
            <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
              <strong>${esc(nombreUsuario(c.usuario_id))}</strong>
              <span style="color:var(--muted);margin-left:6px">${formatDate(c.created_at)}</span>
              <p style="margin-top:4px">${esc(c.contenido)}</p>
            </div>
          `).join('')}
        </div>`
      : '<p style="color:var(--muted);font-size:12px;padding:8px 0">Sin comentarios</p>';

    const evidenciasHtml = evidencias.length
      ? `<div style="margin:8px 0">${evidencias.map(e => `
          <div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">
            ${e.archivo_path
              ? `<a href="${BASE}/uploads/evidencias/${esc(e.archivo_path)}" target="_blank" style="color:var(--accent)">&#x1F4CE; ${esc(e.archivo_nombre || e.archivo_path)}</a>`
              : esc(e.descripcion || 'Evidencia sin archivo')}
            ${e.archivo_tamanio ? `<span style="color:var(--muted);margin-left:6px">(${Math.round(e.archivo_tamanio / 1024)}KB)</span>` : ''}
          </div>
        `).join('')}</div>`
      : '<p style="color:var(--muted);font-size:12px;padding:8px 0">Sin evidencias</p>';

    const body = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${badgeEstado(t.estado)} ${badgePrioridad(t.prioridad)} <span class="badge badge-muted">${esc(t.tipo || 'tarea')}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--muted);margin-bottom:12px">
        <div>Proyecto: <strong>${esc(a.proyecto_nombre || '—')}</strong></div>
        <div>Asignado: <strong>${t.asignado_a ? esc(nombreUsuario(t.asignado_a)) : '—'}</strong></div>
        <div>Creador: <strong>${t.reportero ? esc(nombreUsuario(t.reportero)) : '—'}</strong></div>
        <div>Fecha límite: <strong>${formatDate(t.fecha_limite)}</strong></div>
        <div>Completada: <strong>${formatDate(a.completada_en)}</strong></div>
        <div>Archivada: <strong>${formatDate(a.archivada_en)}</strong></div>
        ${a.restaurada_como_id ? `<div style="grid-column:1/-1;color:var(--accent)">Restaurada como tarea #${a.restaurada_como_id} el ${formatDate(a.restaurada_en)}</div>` : ''}
      </div>
      <div style="margin-bottom:12px">
        <strong style="font-size:13px">Descripción</strong>
        <p style="font-size:13px;color:var(--muted);margin-top:4px;white-space:pre-wrap">${esc(t.descripcion || 'Sin descripción')}</p>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:12px">
        <strong style="font-size:13px">Comentarios (${comentarios.length})</strong>
        ${comentariosHtml}
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:12px">
        <strong style="font-size:13px">Evidencias (${evidencias.length})</strong>
        ${evidenciasHtml}
      </div>
    `;

    const actions = `
      ${!a.restaurada_como_id && puedeAdministrarArchivo()
        ? `<button class="btn btn-sm btn-primary" onclick="reactivarArchivo(${a.id})">&#x21BA; Reactivar tarea</button>`
        : ''}
      <button class="btn btn-sm btn-secondary" onclick="cerrarModalDetalle()">Cerrar</button>
    `;

    abrirModalDetalle('Tarea Archivada #' + a.tarea_id_original, body, actions);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function reactivarArchivo(id) {
  const ok = await confirmarModal('Reactivar tarea', '¿Crear una copia activa de esta tarea archivada? Se conservará el historial en el archivo.');
  if (!ok) return;
  try {
    const data = await api('/archivo/' + id + '/reactivar', { method: 'POST' });
    toast('Tarea reactivada como #' + data.nueva_tarea_id, 'success');
    cerrarModalDetalle();
    cargarArchivo();
    cargarArchivoStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function ejecutarMigracionArchivo() {
  const ok = await confirmarModal('Migrar tareas completadas', 'Esto archivará las tareas completadas que superen la antigüedad configurada. ¿Continuar?');
  if (!ok) return;
  try {
    const btn = document.getElementById('archivo-btn-migrar');
    if (btn) { btn.disabled = true; btn.textContent = 'Migrando...'; }
    const data = await api('/archivo/migrar', { method: 'POST' });
    toast(`Archivadas ${data.resultado.exitosas} tareas (${data.resultado.fallidas} fallidas)`, 'success');
    cargarArchivo();
    cargarArchivoStats();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    const btn = document.getElementById('archivo-btn-migrar');
    if (btn) { btn.disabled = false; btn.textContent = 'Migrar ahora'; }
  }
}

async function exportarArchivo() {
  try {
    const proyecto = document.getElementById('archivo-filtro-proyecto')?.value || '';
    const url = HF.API + '/archivo/exportar/json' + (proyecto ? '?proyecto_id=' + proyecto : '');
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + HF.TOKEN } });
    if (!res.ok) throw new Error('Error al exportar');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tareas-archivadas.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function abrirModalConfigArchivo() {
  try {
    const data = await api('/archivo/config');
    const cfg = {};
    for (const row of data.config) cfg[row.clave] = row.valor;

    const body = `
      <div class="form-group">
        <label>Archivar tareas completadas después de (meses)</label>
        <input type="number" id="cfg-meses-archivar" value="${esc(cfg.meses_para_archivar)}" min="1" max="120">
      </div>
      <div class="form-group">
        <label>Conservar en archivo (meses) — informativo</label>
        <input type="number" id="cfg-meses-retencion" value="${esc(cfg.meses_retencion)}" min="1" max="120">
      </div>
      <div class="form-group">
        <label><input type="checkbox" id="cfg-habilitado" ${cfg.habilitado === 'true' ? 'checked' : ''}> Archivado automático habilitado</label>
      </div>
      <p style="font-size:12px;color:var(--muted)">El valor de retención es informativo en esta fase; no se eliminan archivos automáticamente.</p>
    `;
    const actions = `
      <button class="btn btn-sm btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-sm btn-primary" onclick="guardarConfigArchivo()">Guardar</button>
    `;
    abrirModal('Configuración de archivo', '', body, actions);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function guardarConfigArchivo() {
  try {
    const body = {
      meses_para_archivar: document.getElementById('cfg-meses-archivar').value,
      meses_retencion: document.getElementById('cfg-meses-retencion').value,
      habilitado: document.getElementById('cfg-habilitado').checked,
    };
    await api('/archivo/config', { method: 'PUT', body: JSON.stringify(body) });
    toast('Configuración guardada', 'success');
    cerrarModal();
    cargarArchivoStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cargarArchivo() {
  await Promise.all([cargarProyectosArchivo(), cargarArchivoStats(), cargarTodosLosUsuarios()]);

  const proyecto = document.getElementById('archivo-filtro-proyecto')?.value || '';
  const desde = document.getElementById('archivo-filtro-desde')?.value || '';
  const hasta = document.getElementById('archivo-filtro-hasta')?.value || '';
  const q = document.getElementById('archivo-filtro-busqueda')?.value || '';

  const params = new URLSearchParams();
  if (proyecto) params.set('proyecto_id', proyecto);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (q) params.set('q', q);
  params.set('page', _archivoPage);
  params.set('limit', _archivoLimit);

  try {
    const data = await api('/archivo?' + params.toString());
    _archivoData = data.archivadas || [];
    _archivoTotal = data.total || 0;

    const ids = _archivoData
      .flatMap(a => [a.asignado_a, a.archivada_por])
      .filter(Boolean)
      .map(Number);
    await cargarNombresUsuarios([...new Set(ids)]);

    renderArchivo();
    renderArchivoPagination();
    const countEl = document.getElementById('archivo-count');
    if (countEl) countEl.textContent = `${_archivoTotal} tarea(s)`;
  } catch (err) {
    document.getElementById('archivo-tbody').innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Error al cargar archivo</td></tr>`;
  }
}
