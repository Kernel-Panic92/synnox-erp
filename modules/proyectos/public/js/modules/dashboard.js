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

    if (!recientes.length) {
      document.getElementById('dash-recientes').innerHTML = '<tr><td colspan="4" class="empty-state" style="padding:32px"><div class="icon">&#x1F4CB;</div><p>Crea tu primera tarea para verla aqui</p></td></tr>';
    } else {
      document.getElementById('dash-recientes').innerHTML = recientes.map(t => `
        <tr>
          <td><strong>${esc(t.titulo)}</strong></td>
          <td><span style="font-size:12px;color:var(--muted)">${esc(t.proyecto_nombre || '—')}</span></td>
          <td>${badgeEstado(t.estado)} ${t.estado === 'revision' ? badgeAprobacion(t.estado_aprobacion) : ''}</td>
          <td>${badgePrioridad(t.prioridad)}</td>
        </tr>
      `).join('');
    }

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
