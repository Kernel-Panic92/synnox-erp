function esc(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toISOString().split('T')[0];
}

function toast(mensaje, tipo = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + tipo;
  el.textContent = mensaje;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 4000);
}

function abrirModal(title, bodyHtml, actionsHtml) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <div class="modal-title">${esc(title)}</div>
    ${bodyHtml}
    ${actionsHtml ? '<div class="modal-actions">' + actionsHtml + '</div>' : ''}
  `;
  overlay.classList.add('show');
}

function cerrarModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  document.getElementById('modal-detalle').classList.remove('show');
}

function confirmarModal(title, message) {
  return new Promise(resolve => {
    abrirModal(title, `<p>${esc(message)}</p>`,
      '<button class="btn btn-sm btn-secondary" onclick="cerrarModal();resolveModal(false)">Cancelar</button>' +
      '<button class="btn btn-sm btn-danger" onclick="cerrarModal();resolveModal(true)">Confirmar</button>'
    );
    window.resolveModal = (val) => {
      delete window.resolveModal;
      resolve(val);
    };
  });
}

function badgeEstado(estado) {
  const map = { pendiente: 'badge-muted', en_progreso: 'badge-info', revision: 'badge-warning', completada: 'badge-success' };
  const labels = { pendiente: 'Pendiente', en_progreso: 'En progreso', revision: 'Revision', completada: 'Completada' };
  return `<span class="badge ${map[estado] || 'badge-muted'}">${labels[estado] || estado}</span>`;
}

function badgePrioridad(p) {
  const cls = { baja: 'badge-muted', media: 'badge-info', alta: 'badge-warning', critica: 'badge-danger' };
  const labels = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Critica' };
  return `<span class="badge ${cls[p] || 'badge-muted'}">${labels[p] || p}</span>`;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarModal();
});
