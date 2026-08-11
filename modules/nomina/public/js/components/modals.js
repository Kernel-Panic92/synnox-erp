// modals.js - Modal management (uses framework's cerrarModal)

function cerrarModal(id) {
  // Call framework's cerrarModal which handles both .show and .open classes
  if (typeof window.cerrarModal === 'function') {
    window.cerrarModal(id);
  } else {
    // Fallback if framework not loaded
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('open', 'show');
      modal.style.display = 'none';
    }
  }
}

function confirmar({ titulo, mensaje, icono = '⚠️', btnTxt = 'Confirmar', onConfirm, obsLabel = null }) {
  const modal = document.getElementById('modal-confirm');
  const tituloEl = document.getElementById('confirm-title');
  const msgEl = document.getElementById('confirm-msg');
  const iconEl = document.getElementById('confirm-icon');
  const btnEl = document.getElementById('confirm-btn');
  
  if (!modal || !tituloEl || !msgEl || !iconEl || !btnEl) return;
  
  tituloEl.textContent = titulo;
  msgEl.textContent = mensaje;
  iconEl.textContent = icono;
  btnEl.innerHTML = btnTxt;
  btnEl.disabled = false;
  
  // Limpiar campo de observaciones anterior
  const oldObs = document.getElementById('confirm-obs-wrap');
  if (oldObs) oldObs.remove();
  if (obsLabel) {
    const wrap = document.createElement('div');
    wrap.id = 'confirm-obs-wrap';
    wrap.style.cssText = 'margin-bottom:16px;text-align:left;';
    wrap.innerHTML = `
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px;">${obsLabel}</div>
      <textarea id="confirm-obs" rows="3" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);font-size:14px;font-family:var(--font-body);resize:vertical;"></textarea>`;
    const footer = document.querySelector('#modal-confirm .modal .modal-footer');
    if (footer) footer.parentNode.insertBefore(wrap, footer);
  }
  
  // Remove previous event listeners
  const newBtn = btnEl.cloneNode(true);
  btnEl.parentNode.replaceChild(newBtn, btnEl);
  
  newBtn.onclick = async () => {
    newBtn.disabled = true;
    newBtn.innerHTML = '<span class="spinner"></span> Procesando...';
    try {
      await onConfirm();
    } catch (e) {
      console.error('Error en confirm:', e);
    }
    cerrarModal('modal-confirm');
  };
  
  modal.classList.add('open');
  modal.style.display = 'flex';
  modal.style.zIndex = '200';
}

function alertar({ titulo, mensaje, icono = '⚠️', btnTxt = 'Aceptar' }) {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-confirm');
    const tituloEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-msg');
    const iconEl = document.getElementById('confirm-icon');
    const btnEl = document.getElementById('confirm-btn');

    if (!modal || !tituloEl || !msgEl || !iconEl || !btnEl) { resolve(); return; }

    tituloEl.textContent = titulo;
    msgEl.textContent = mensaje;
    iconEl.textContent = icono;
    btnEl.innerHTML = btnTxt;
    btnEl.disabled = false;

    const oldObs = document.getElementById('confirm-obs-wrap');
    if (oldObs) oldObs.remove();

    const newBtn = btnEl.cloneNode(true);
    btnEl.parentNode.replaceChild(newBtn, btnEl);

    newBtn.onclick = () => {
      cerrarModal('modal-confirm');
      resolve();
    };

    modal.classList.add('open');
    modal.style.display = 'flex';
    modal.style.zIndex = '200';
  });
}


