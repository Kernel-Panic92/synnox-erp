const $=id=>document.getElementById(id);

const BASE = window.BASE || '';

function getToken() {
  const c = document.cookie.split('; ').find(r => r.startsWith('launcher_jwt='));
  return c ? c.split('=')[1] : null;
}

async function api(m,p,b,isF){
  const o={method:m,headers:{Authorization:`Bearer ${getToken()}`}};
  if(b&&!isF){o.headers['Content-Type']='application/json';o.body=JSON.stringify(b)}
  else if(isF)o.body=b;
  const url=m==='GET'?`${BASE}/api${p}${p.includes('?')?'&':'?'}_t=${Date.now()}`:`${BASE}/api${p}`;
  const r=await fetch(url,o);
  if (r.status === 401) {
    window.location.href = '/';
    throw new Error('Sesión expirada');
  }
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
  return j;
}

const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);
