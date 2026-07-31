const $=id=>document.getElementById(id);

const BASE = window.BASE || '';

let _sessionExpiredShown = false;

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

function showSessionExpiredModal() {
  if (_sessionExpiredShown) return;
  _sessionExpiredShown = true;
  stopSyncPoll?.();
  const overlay = document.createElement('div');
  overlay.id = 'session-expired-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:400px;text-align:center">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">Sesión expirada</div>
    <div style="color:var(--muted);margin-bottom:20px">Tu sesión ha expirado. Inicia sesión nuevamente para continuar.</div>
    <button class="btn btn-primary" onclick="window.location.href='/'">Volver al inicio</button>
  </div>`;
  document.body.appendChild(overlay);
}

async function api(m,p,b,isF){
  const o={method:m,headers:{}};
  if(b&&!isF){o.headers['Content-Type']='application/json';o.body=JSON.stringify(b)}
  else if(isF)o.body=b;
  const url=m==='GET'?`${BASE}/api${p}${p.includes('?')?'&':'?'}_t=${Date.now()}`:`${BASE}/api${p}`;
  let r=await fetch(url,o);

  // Auto-refresh on 401
  if (r.status === 401) {
    const newToken = await refreshToken();
    if (newToken) {
      o.headers['Authorization'] = 'Bearer ' + newToken;
      r = await fetch(url, o);
    }
    if (r.status === 401) {
      showSessionExpiredModal();
      throw new Error('Sesión expirada');
    }
  }

  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
  return j;
}

const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);
