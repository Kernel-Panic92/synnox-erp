const BASE = window.BASE || '';
const API = BASE;

let sesion = null;
let empleados = [], nominas = [], registros = [], usuarios = [], centros = [], tipos = [];
let editEmpId = null, editUsrId = null;
let _empMap = new Map();

function rebuildEmpMap() {
  _empMap = new Map(empleados.map(e => [e.id, e]));
}

const api = async (method, path, body = undefined) => {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401 && path !== '/api/auth/me') {
    localStorage.removeItem('he_logged_in');
    sesion = null;
    window.location.href = '/';
  } else if (res.status === 403 && path === '/api/auth/me') {
    // Handled by app.js init - don't redirect here
  } else if (res.status >= 400 && res.status !== 404 && res.status !== 403 && !(res.status === 401 && path === '/api/auth/me')) {
    teleError(path, res.status, method);
  }
  return res;
};

const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);

async function refreshRegistros() {
  try {
    const res = await GET('/api/registros');
    if (res.ok) registros = await res.json();
  } catch {}
}
