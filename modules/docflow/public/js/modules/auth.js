function doLogout(){
  localStorage.removeItem('vd_t');localStorage.removeItem('vd_u');
  window.location.href = '/';
}
function showLogoutConfirm(){$('logout-modal').classList.add('open')}
function closeLogoutConfirm(){$('logout-modal').classList.remove('open')}
function confirmLogout(){closeLogoutConfirm();doLogout()}

function showForgot(e){e.preventDefault();$('modal-forgot').classList.add('open')}
function closeForgot(){$('modal-forgot').classList.remove('open');$('forgot-email').value='';$('forgot-error').style.display='none';$('forgot-success').style.display='none';$('forgot-form').style.display='block'}
function doForgot(){
  const email=$('forgot-email').value.trim();
  if(!email)return;
  setLoading('btn-forgot',true);
  fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})})
    .then(r=>r.json())
    .then(d=>{
      if(d.ok||d.error===undefined){
        $('forgot-form').style.display='none';
        $('forgot-success').textContent='✓ Enlace enviado a tu correo.';
        $('forgot-success').style.display='block';
        setTimeout(closeForgot,3000);
      }else{
        $('forgot-error').textContent=d.error;
        $('forgot-error').style.display='block';
      }
    }).catch(e=>{
      $('forgot-error').textContent='Error de conexión';
      $('forgot-error').style.display='block';
    }).finally(()=>setLoading('btn-forgot',false));
}

function showChPass(){$('chpass-modal').classList.add('open')}
async function doChangePass(){
  const p1=$('chpass-new').value,p2=$('chpass-confirm').value;
  if(p1!==p2){$('chpass-msg').innerHTML='<span style="color:var(--danger)">Las contraseñas no coinciden</span>';return}
  try{
    await api('POST','/auth/cambio-forzado',{password:p1});
    $('chpass-modal').classList.remove('open');
    toast('Contraseña actualizada','success');
    showApp();
  }catch(e){$('chpass-msg').innerHTML=`<span style="color:var(--danger)">${e.message}</span>`}
}

async function fetchUserAndShowApp(){
  try{
    const data = await api('GET', '/auth/me');
    S.usuario = data;
    localStorage.setItem('vd_u', JSON.stringify(data));
    showApp();
  }catch(e){
    doLogout();
  }
}

function showApp(){
  $('app-screen').classList.add('show');
  document.body.className=S.theme;
  $('theme-btn').textContent=S.theme==='dark'?'🌙':'☀️';
  $('u-name').textContent=S.usuario?.nombre||'—';
  $('u-role').textContent=S.usuario?.rol||'—';
  const rolClass={'admin':'role-admin','contador':'role-contador','tesorero':'role-tesorero','comprador':'role-comprador','auditor':'role-auditor'};
  $('u-badge').className=`role-badge ${rolClass[S.usuario?.rol]||'role-comprador'}`;
  $('u-badge').textContent=S.usuario?.rol||'';
  initFiltros();
  
  fetch('/api/version').then(r=>r.json()).then(d=>{
    const el=document.getElementById('app-version');
    if(el&&d.version)el.textContent='v'+d.version+(d.branch?' ['+d.branch+']':'');
    const cr=document.getElementById('app-copyright');
    if(cr&&d.author)cr.textContent=d.author;
    const repoEl=document.getElementById('app-repo');
    if(repoEl&&d.repo)repoEl.innerHTML='<a href="'+d.repo+'" target="_blank" style="color:var(--accent);text-decoration:none;">GitHub</a>';
    window._appVersion = d.version || '';
    window._appBranch = d.branch || '';
  }).catch(()=>{});
  if(S.empresaLogo){
    $('header-logo').innerHTML='<img src="'+S.empresaLogo+'" style="height:32px;border-radius:6px"/>';
  }else if(S.appNombre){
    $('header-logo').innerHTML=S.appNombre.toUpperCase();
  }
  buildNav();
  
  if(localStorage.getItem('sidebar_collapsed')==='true'){
    $('sidebar').classList.add('collapsed');
    $('sidebar-toggle').textContent='▶';
  }
  
  const v=getPageFromHash();
  goTo(v);
}

function buildNav(){
  let h='';
  for(const sec of SECS){
    const items=NAV.filter(n=>n.s===sec.id&&(!n.roles||n.roles.includes(S.usuario?.rol)));
    if(!items.length)continue;
    h+=`<div style="font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;padding:10px 24px 4px;margin-top:4px">${sec.l}</div>`;
    for(const n of items)h+=`<div class="nav-item" id="nv-${n.id}" onclick="goNav('${n.id}')">${n.i}<span style="flex:1">${n.l}</span>${n.badge?`<span class="badge" style="font-size:10px;padding:2px 6px;background:${n.w?'rgba(251,191,36,.15)':'rgba(79,142,247,.15)'};color:${n.w?'var(--warning)':'var(--accent)'}" id="nb-${n.badge}">0</span>`:''}</div>`;
  }
  $('nav').innerHTML=h;
}
