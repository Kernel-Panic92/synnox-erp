async function cargarDashboard() {
  try {
    const data = await api('/dashboard');
    const estados = data.estados || [];
    const recientes = data.recientes || [];
    const porAsignado = data.porAsignado || [];

    const pendiente = estados.find(e => e.estado === 'pendiente')?.count || 0;
    const enProgreso = estados.find(e => e.estado === 'en_progreso')?.count || 0;
    const revision = estados.find(e => e.estado === 'revision')?.count || 0;
    const completada = estados.find(e => e.estado === 'completada')?.count || 0;
    const total = estados.reduce((s, e) => s + parseInt(e.count), 0);

    document.getElementById('dash-stats').innerHTML = `
      <div class="card stat-card"><div class="num">${total}</div><div class="lbl">Total Tareas</div></div>
      <div class="card stat-card"><div class="num" style="color:var(--warning)">${pendiente}</div><div class="lbl">Pendientes</div></div>
      <div class="card stat-card"><div class="num" style="color:var(--accent)">${enProgreso}</div><div class="lbl">En Progreso</div></div>
      <div class="card stat-card"><div class="num">${revision}</div><div class="lbl">En Revision</div></div>
      <div class="card stat-card"><div class="num" style="color:var(--success)">${completada}</div><div class="lbl">Completadas</div></div>
    `;

    const canvas = document.getElementById('chart-estados');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const w = canvas.parentElement.clientWidth - 40;
      canvas.width = Math.min(w, 400);
      canvas.height = 200;
      const cx = canvas.width / 2;
      const cy = 100;
      const r = 80;
      const values = [pendiente, enProgreso, revision, completada].filter(v => v > 0);
      const colors = ['#fdcb6e', '#6c5ce7', '#a29bfe', '#00b894'];
      const sum = values.reduce((a, b) => a + b, 0);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (sum > 0) {
        let start = -Math.PI / 2;
        values.forEach((v, i) => {
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
        ctx.fillStyle = '#2a3045';
        ctx.fill();
      }

      const legends = [
        { label: 'Pendiente', color: '#fdcb6e', val: pendiente },
        { label: 'En Progreso', color: '#6c5ce7', val: enProgreso },
        { label: 'Revision', color: '#a29bfe', val: revision },
        { label: 'Completada', color: '#00b894', val: completada }
      ];
      legends.forEach((l, i) => {
        const y = 15 + i * 18;
        ctx.fillStyle = l.color;
        ctx.fillRect(canvas.width - 140, y, 12, 12);
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#e8ecf5';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${l.label} (${l.val})`, canvas.width - 124, y + 11);
      });
    }

    const idsAsignados = recientes.map(r => r.asignado_a).filter(Boolean);
    await cargarNombresUsuarios(idsAsignados);

    document.getElementById('dash-recientes').innerHTML = recientes.map(t => `
      <tr>
        <td><strong>${esc(t.titulo)}</strong></td>
        <td><span style="font-size:12px;color:var(--muted)">${esc(t.proyecto_nombre || '—')}</span></td>
        <td>${badgeEstado(t.estado)}</td>
        <td>${badgePrioridad(t.prioridad)}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">No hay tareas recientes</td></tr>';
  } catch (err) {
    document.getElementById('dash-stats').innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px">Error al cargar dashboard</div>';
  }
}
