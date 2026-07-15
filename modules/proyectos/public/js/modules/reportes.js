async function cargarReportes() {
  try {
    const data = await api('/dashboard');
    const estados = data.estados || [];
    const porAsignado = data.porAsignado || [];

    const pendiente = estados.find(e => e.estado === 'pendiente')?.count || 0;
    const enProgreso = estados.find(e => e.estado === 'en_progreso')?.count || 0;
    const revision = estados.find(e => e.estado === 'revision')?.count || 0;
    const completada = estados.find(e => e.estado === 'completada')?.count || 0;
    const total = estados.reduce((s, e) => s + parseInt(e.count), 0);

    document.getElementById('rpt-estados').innerHTML = `
      <div class="card stat-card"><div class="num">${total}</div><div class="lbl">Total Tareas</div></div>
      <div class="card stat-card"><div class="num" style="color:#fdcb6e">${pendiente}</div><div class="lbl">Pendientes (${total > 0 ? Math.round((pendiente/total)*100) : 0}%)</div></div>
      <div class="card stat-card"><div class="num" style="color:var(--accent)">${enProgreso}</div><div class="lbl">En Progreso (${total > 0 ? Math.round((enProgreso/total)*100) : 0}%)</div></div>
      <div class="card stat-card"><div class="num" style="color:#a29bfe">${revision}</div><div class="lbl">En Revision</div></div>
      <div class="card stat-card"><div class="num" style="color:#00b894">${completada}</div><div class="lbl">Completadas (${total > 0 ? Math.round((completada/total)*100) : 0}%)</div></div>
    `;

    const ids = porAsignado.map(r => r.asignado_a).filter(Boolean);
    await cargarNombresUsuarios(ids);

    document.getElementById('rpt-asignado').innerHTML = porAsignado.map(r => {
      const pct = total > 0 ? Math.round((parseInt(r.total) / total) * 100) : 0;
      return `
        <tr>
          <td><span class="nombre-asignado">&#x1F464; ${esc(nombreUsuario(r.asignado_a))}</span></td>
          <td><strong>${r.total}</strong> <span style="color:var(--muted)">(${pct}%)</span></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--muted);padding:20px">No hay datos</td></tr>';
  } catch (err) {
    document.getElementById('rpt-estados').innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--muted)">Error al cargar reportes</div>';
  }
}
