// Bootstrap values that used to be defined by inline scripts.
window.BASE = window.location.pathname.replace(/\/[^/]*$/, '').replace(/\/+$/, '') || '';

const fechaRegistro = document.getElementById('reg-fecha');
if (fechaRegistro) fechaRegistro.max = new Date().toISOString().split('T')[0];
