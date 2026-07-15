async function cargarReportes() {
  try {
    const data = await api('/dashboard');
    const estados = data.estados || [];
    const porAsignado = data.porAsignado || [];
    const aprobacion = data.aprobacion || {};

    const pendiente = estados.find(e => e.estado === 'pendiente')?.count || 0;
    const enProgreso = estados.find(e => e.estado === 'en_progreso')?.count || 0;
    const revision = estados.find(e => e.estado === 'revision')?.count || 0;
    const completada = estados.find(e => e.estado === 'completada')?.count || 0;
    const total = estados.reduce((s, e) => s + parseInt(e.count), 0);
    const pendientesAprob = parseInt(aprobacion.pendientes) || 0;

    document.getElementById('rpt-estados').innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Tareas</div><div class="stat-value">${total}</div></div>
      <div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value" style="color:var(--warning)">${pendiente} <span style="font-size:14px;color:var(--muted)">(${total > 0 ? Math.round((pendiente/total)*100) : 0}%)</span></div></div>
      <div class="stat-card"><div class="stat-label">En Progreso</div><div class="stat-value" style="color:var(--accent)">${enProgreso} <span style="font-size:14px;color:var(--muted)">(${total > 0 ? Math.round((enProgreso/total)*100) : 0}%)</span></div></div>
      <div class="stat-card"><div class="stat-label">En Revision</div><div class="stat-value" style="color:var(--accent2)">${revision}</div></div>
      <div class="stat-card"><div class="stat-label">Pend. Aprobacion</div><div class="stat-value" style="color:${pendientesAprob > 0 ? 'var(--warning)' : 'var(--muted)'}">${pendientesAprob}</div></div>
      <div class="stat-card"><div class="stat-label">Completadas</div><div class="stat-value" style="color:var(--success)">${completada} <span style="font-size:14px;color:var(--muted)">(${total > 0 ? Math.round((completada/total)*100) : 0}%)</span></div></div>
    `;

    const ids = porAsignado.map(r => r.asignado_a).filter(Boolean);
    await cargarNombresUsuarios(ids);

    document.getElementById('rpt-asignado').innerHTML = porAsignado.map(r => {
      const pct = total > 0 ? Math.round((parseInt(r.total) / total) * 100) : 0;
      return `
        <tr>
          <td><span class="nombre-asignado">&#x1F464; ${esc(nombreUsuario(r.asignado_a))}</span></td>
          <td><strong>${r.total}</strong></td>
          <td><span style="color:var(--muted)">${pct}% del total</span></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">No hay datos</td></tr>';
  } catch (err) {
    document.getElementById('rpt-estados').innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--muted)">Error al cargar reportes</div>';
  }
}
