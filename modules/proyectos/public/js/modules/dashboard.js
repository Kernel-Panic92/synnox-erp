let _dashRecientes = [];
let _dashFiltroQ = '';
let _dashFiltroEstado = '';
let _dashFiltroPrioridad = '';
let _dashFiltroProyecto = '';
let _dashSortCol = 'updated_at';
let _dashSortDir = 'desc';

async function cargarDashboard() {
  try {
    const data = await api('/dashboard');
    const estados = data.estados || [];
    const recientes = data.recientes || [];
    const porAsignado = data.porAsignado || [];
    const aprobacion = data.aprobacion || {};

    const pendiente = estados.find(e => e.estado === 'pendiente')?.count || 0;
    const enProgreso = estados.find(e => e.estado === 'en_progreso')?.count || 0;
    const revision = estados.find(e => e.estado === 'revision')?.count || 0;
    const completada = estados.find(e => e.estado === 'completada')?.count || 0;
    const total = estados.reduce((s, e) => s + parseInt(e.count), 0);
    const pendientesAprob = parseInt(aprobacion.pendientes) || 0;

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card" style="cursor:pointer" onclick="verTareasEstado('')"><div class="stat-label">Total Tareas</div><div class="stat-value">${total}</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="verTareasEstado('pendiente')"><div class="stat-label">Pendientes</div><div class="stat-value" style="color:var(--warning)">${pendiente}</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="verTareasEstado('en_progreso')"><div class="stat-label">En Progreso</div><div class="stat-value" style="color:var(--accent)">${enProgreso}</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="verTareasEstado('revision')"><div class="stat-label">En Revision</div><div class="stat-value" style="color:var(--accent2)">${revision}</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="verTareasEstado('revision')"><div class="stat-label">Pend. Aprobacion</div><div class="stat-value" style="color:${pendientesAprob > 0 ? 'var(--warning)' : 'var(--muted)'}">${pendientesAprob}</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="verTareasEstado('completada')"><div class="stat-label">Completadas</div><div class="stat-value" style="color:var(--success)">${completada}</div></div>
    `;

    const canvas = document.getElementById('chart-estados');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const card = canvas.parentElement;
      const w = card.clientWidth - 40;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.min(w, 500) * dpr;
      canvas.height = 220 * dpr;
      canvas.style.width = Math.min(w, 500) + 'px';
      canvas.style.height = '220px';
      ctx.scale(dpr, dpr);

      const cw = Math.min(w, 500);
      const ch = 220;
      const cx = cw * 0.35;
      const cy = ch / 2;
      const r = 80;
      const colors = ['#f59e0b', '#7c6df0', '#a78bfa', '#10b981'];
      const sum = total;

      ctx.clearRect(0, 0, cw, ch);

      if (sum > 0) {
        let start = -Math.PI / 2;
        const values = [pendiente, enProgreso, revision, completada];
        values.forEach((v, i) => {
          if (v <= 0) return;
          const slice = (v / sum) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, start, start + slice);
          ctx.fillStyle = colors[i];
          ctx.fill();
          start += slice;
        });
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e2e8f0';
        ctx.fill();
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#64748b';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Sin datos', cx, cy + 4);
        ctx.textAlign = 'start';
      }

      const legends = [
        { label: 'Pendiente', color: '#f59e0b', val: pendiente },
        { label: 'En Progreso', color: '#7c6df0', val: enProgreso },
        { label: 'Revision', color: '#a78bfa', val: revision },
        { label: 'Completada', color: '#10b981', val: completada }
      ];
      const textColor = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#1e293b';
      const lx = cw * 0.62;
      legends.forEach((l, i) => {
        const y = 40 + i * 32;
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.roundRect(lx, y - 2, 16, 16, 3);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.font = '600 12px -apple-system, sans-serif';
        ctx.fillText(l.label, lx + 22, y + 11);
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#64748b';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillText('(' + l.val + ')', lx + 22 + ctx.measureText(l.label).width + 6, y + 11);
      });
    }

    const idsAsignados = recientes.map(r => r.asignado_a).filter(Boolean);
    const idsAsignadosActivos = porAsignado.map(r => r.asignado_a).filter(Boolean);
    await cargarNombresUsuarios([...new Set([...idsAsignados, ...idsAsignadosActivos])]);

    _dashRecientes = recientes;
    await cargarProyectosSelect();
    const proySel = document.getElementById('dash-filtro-proyecto');
    if (proySel && proySel.options.length <= 1) {
      proySel.innerHTML = '<option value="">Todos los proyectos</option>' + _tareasProyectos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    }
    renderDashRecientes();

    if (porAsignado.length) {
      const asignadoHtml = porAsignado.slice(0, 8).map(r => `
        <tr>
          <td>&#x1F464; ${esc(nombreUsuario(r.asignado_a))}</td>
          <td><strong>${r.total}</strong> <span style="color:var(--muted)">pendiente(s)</span></td>
        </tr>
      `).join('');
      document.getElementById('dash-asignado').innerHTML = asignadoHtml;
    } else {
      document.getElementById('dash-asignado').innerHTML = '<tr><td colspan="2" style="color:var(--muted);text-align:center;padding:12px">Sin tareas asignadas</td></tr>';
    }
  } catch (err) {
    document.getElementById('dash-stats').innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px">Error al cargar dashboard</div>';
  }
}

function verTareasEstado(estado) {
  navigate('tareas');
  setTimeout(() => {
    const sel = document.getElementById('filtro-estado');
    if (sel) { sel.value = estado; cargarTareas(); }
  }, 100);
}

function dashAplicarFiltros() {
  _dashFiltroProyecto = document.getElementById('dash-filtro-proyecto')?.value || '';
  _dashFiltroEstado = document.getElementById('dash-filtro-estado')?.value || '';
  _dashFiltroPrioridad = document.getElementById('dash-filtro-prioridad')?.value || '';
  _dashFiltroQ = document.getElementById('dash-filtro-busqueda')?.value?.trim() || '';
  renderDashRecientes();
}

function dashSort(col) {
  if (_dashSortCol === col) {
    _dashSortDir = _dashSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _dashSortCol = col;
    _dashSortDir = 'asc';
  }
  document.querySelectorAll('#dash-recientes-card th[data-sort]').forEach(th => {
    const ind = th.querySelector('.sort-indicator');
    if (th.dataset.sort === _dashSortCol) {
      ind.textContent = _dashSortDir === 'asc' ? ' ▲' : ' ▼';
    } else {
      ind.textContent = '';
    }
  });
  renderDashRecientes();
}

function renderDashRecientes() {
  const tbody = document.getElementById('dash-recientes');

  const filtradas = _dashRecientes.filter(t => {
    if (_dashFiltroProyecto && String(t.proyecto_id) !== String(_dashFiltroProyecto)) return false;
    if (_dashFiltroEstado && t.estado !== _dashFiltroEstado) return false;
    if (_dashFiltroPrioridad && t.prioridad !== _dashFiltroPrioridad) return false;
    if (_dashFiltroQ) {
      const q = _dashFiltroQ.toLowerCase();
      const hay = (t.titulo || '').toLowerCase().includes(q)
        || (t.proyecto_nombre || '').toLowerCase().includes(q)
        || (t.descripcion || '').toLowerCase().includes(q);
      if (!hay) return false;
    }
    return true;
  });

  const dir = _dashSortDir === 'asc' ? 1 : -1;
  filtradas.sort((a, b) => {
    const va = a[_dashSortCol];
    const vb = b[_dashSortCol];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (_dashSortCol === 'fecha_limite') {
      const d1 = new Date(va).getTime();
      const d2 = new Date(vb).getTime();
      return (d1 - d2) * dir;
    }
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  if (!filtradas.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding:32px;text-align:center"><div class="icon">&#x1F4CB;</div><p>No se encontraron tareas recientes</p></td></tr>';
    return;
  }

  tbody.innerHTML = filtradas.map(t => `
    <tr style="cursor:pointer" onclick="abrirModalDetalleTarea(${t.id})">
      <td><a href="#" onclick="event.preventDefault();event.stopPropagation();abrirModalDetalleTarea(${t.id})" style="font-weight:600">${esc(t.titulo)}</a></td>
      <td><span style="font-size:12px;color:var(--muted)">${esc(t.proyecto_nombre || '—')}</span></td>
      <td>${badgeEstado(t.estado)} ${t.estado === 'revision' ? badgeAprobacion(t.estado_aprobacion) : ''}</td>
      <td>${badgePrioridad(t.prioridad)}</td>
      <td style="font-size:12px;color:var(--muted)">${formatDate(t.fecha_limite)}</td>
    </tr>
  `).join('');
}
