// helpers.js - Shared utility functions
// Extracted from public/app.js

const COLS=['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#F97316','#06B6D4','#84CC16'];
const PASOS=[{id:'recepcion',l:'Recepción',d:'Sistema recibe'},{id:'revision',l:'Revisión',d:'Asigna CC'},{id:'aprobacion',l:'Aprobación',d:'Responsable'},{id:'causacion',l:'Causación',d:'Tesorería'},{id:'pagada',l:'Pagada',d:'Archivada'}];
const EORD=['recibida','revision','aprobada','causada','pagada'];
const EM={recibida:{l:'Recibida',c:'#60A5FA'},revision:{l:'En revisión',c:'#FBBF24'},aprobada:{l:'Aprobada',c:'#34D399'},causada:{l:'Causada',c:'#A78BFA'},rechazada:{l:'Rechazada',c:'#F87171'},pagada:{l:'Pagada',c:'#6EE7B7'}};

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function fmt(v){return '$'+Math.round(parseFloat(v)||0).toLocaleString('es-CO')}
function fdate(d){if(!d)return'—';return new Date(d).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}
function fdatetime(d){if(!d)return'—';const dt=new Date(d);return dt.toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})+' '+dt.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}
function bdg(e){const m=EM[e]||{l:e,c:'#888'};return`<span class="badge b-${e}">${m.l}</span>`}
function ctag(c,n){if(!n)return'<span style="color:var(--muted)">—</span>';return`<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${c||'#888'};flex-shrink:0"></span>${esc(n)}</span>`}

function toast(msg,type='info'){
  const t=$('toast');
  t.className=`toast ${type} show`;
  t.innerHTML=`<span>${type==='success'?'✓':type==='error'?'✗':'ℹ'}</span> ${esc(msg)}`;
  setTimeout(()=>t.classList.remove('show'),4000);
}

function toggleTheme(){
  S.theme=S.theme==='dark'?'light':'dark';
  document.body.className=S.theme;
  localStorage.setItem('synnox_theme',S.theme);
  const tb=$('theme-btn');if(tb)tb.textContent=S.theme==='dark'?'🌙':'☀️';
}

function toggleSidebar(){$('sidebar').classList.toggle('open');document.querySelector('.sidebar-overlay')?.classList.toggle('show')}
function closeSidebar(){$('sidebar').classList.remove('open');document.querySelector('.sidebar-overlay')?.classList.remove('show')}

function toggleSidebarCollapse(){
  const s=$('sidebar');
  s.classList.toggle('collapsed');
  localStorage.setItem('sidebar_collapsed', s.classList.contains('collapsed'));
  const btn = s.querySelector('.sidebar-toggle');
  if(btn) btn.textContent = s.classList.contains('collapsed') ? '▶' : '◀';
}

function formatBytes(b){
  if(b===0)return'0 B';
  const k=1024,sizes=['B','KB','MB','GB'];
  const i=Math.floor(Math.log(b)/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+sizes[i];
}

function confirmModal(msg, title = 'Confirmar'){
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = `
      <div data-confirm="1" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:32px;width:340px;text-align:center;flex-shrink:0">
        <div style="width:64px;height:64px;margin:0 auto 16px;background:rgba(239,68,68,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center">
          <span style="font-size:28px">🗑️</span>
        </div>
        <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text)">${esc(title)}</h3>
        <p style="font-size:14px;color:var(--muted);margin-bottom:24px;line-height:1.5">${esc(msg)}</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn" style="background:var(--surface2);color:var(--text);min-width:100px" onclick="this.closest('[data-confirm]').parentElement.remove();window._confirmResolve(false)">Cancelar</button>
          <button class="btn btn-danger" style="min-width:100px" onclick="this.closest('[data-confirm]').parentElement.remove();window._confirmResolve(true)">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    window._confirmResolve = resolve;
  });
}
