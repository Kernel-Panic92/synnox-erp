function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toISOString().split('T')[0];
}

function badgeEstado(estado) {
  const map = { pendiente: 'badge-muted', en_progreso: 'badge-info', revision: 'badge-warning', completada: 'badge-success' };
  const labels = { pendiente: 'Pendiente', en_progreso: 'En progreso', revision: 'Revision', completada: 'Completada' };
  return `<span class="badge ${map[estado] || 'badge-muted'}">${labels[estado] || estado}</span>`;
}

function badgeAprobacion(estado) {
  const map = { pendiente: 'badge-muted', aprobada: 'badge-success', rechazada: 'badge-danger' };
  const labels = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };
  return `<span class="badge ${map[estado] || 'badge-muted'}">${labels[estado] || estado}</span>`;
}

function badgePrioridad(p) {
  const cls = { baja: 'badge-muted', media: 'badge-info', alta: 'badge-warning', critica: 'badge-danger' };
  const labels = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Critica' };
  return `<span class="badge ${cls[p] || 'badge-muted'}">${labels[p] || p}</span>`;
}

function abrirModalDetalle(title, bodyHtml, actionsHtml) {
  document.getElementById('modal-detalle-body').innerHTML = `
    ${title ? '<h3>' + esc(title) + '</h3>' : ''}
    ${bodyHtml}
    ${actionsHtml ? '<div class="modal-actions">' + actionsHtml + '</div>' : ''}
  `;
  document.getElementById('modal-detalle').classList.add('show');
}

function cerrarModalDetalle() {
  document.getElementById('modal-detalle').classList.remove('show');
}

function confirmarModal(title, message) {
  return new Promise(resolve => {
    confirmar({
      titulo: title,
      mensaje: message,
      btnTxt: 'Confirmar',
      onConfirm: () => resolve(true)
    });
    const orig = window._confirmCb;
    window._confirmCb = () => { if (orig) orig(); resolve(true); };
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModal();
    cerrarModalDetalle();
  }
});

document.getElementById('modal-detalle')?.addEventListener('click', function(e) {
  if (e.target === this) cerrarModalDetalle();
});
