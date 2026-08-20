const BASE = window.BASE || '';
const API = BASE;

let sesion = null;
let empleados = [], nominas = [], registros = [], usuarios = [], centros = [], tipos = [];
let editEmpId = null, editUsrId = null;
let _empMap = new Map();

function rebuildEmpMap() {
  _empMap = new Map(empleados.map(e => [e.id, e]));
}

async function refreshToken() {
  try {
    const token = localStorage.getItem('platform_jwt');
    if (!token) return null;
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.jwt) { localStorage.setItem('platform_jwt', data.jwt); return data.jwt; }
    }
  } catch {}
  return null;
}

const api = async (method, path, body = undefined) => {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  let res = await fetch(API + path, opts);

  // Auto-refresh on 401
  if (res.status === 401 && path !== '/api/auth/me') {
    const newToken = await refreshToken();
    if (newToken) {
      opts.headers['Authorization'] = 'Bearer ' + newToken;
      res = await fetch(API + path, opts);
    }
    if (res.status === 401) {
      // Still 401 after refresh — redirect to launcher
      localStorage.removeItem('he_logged_in');
      sesion = null;
      window.location.href = '/';
    }
  } else if (res.status === 403 && path === '/api/auth/me') {
    // Handled by app.js init - don't redirect here
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
