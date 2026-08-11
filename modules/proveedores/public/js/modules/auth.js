function doLogout(){
  localStorage.removeItem('vd_u');
  window.location.href = '/logout';
}
function mostrarLogoutConfirm(){$('modal-logout').classList.add('show')}
function cerrarLogoutConfirm(){$('modal-logout').classList.remove('show')}
function confirmarLogout(){cerrarLogoutConfirm();doLogout()}

async function fetchUserAndShowApp(){
  try{
    const data = await api('GET', '/auth/me');
    S.usuario = data;
    localStorage.setItem('vd_u', JSON.stringify(data));
    showApp();
  }catch(e){
    document.getElementById('app-screen').style.display = 'none';
    document.body.insertAdjacentHTML('beforeend', `<div class="error-splash"><div class="error-splash-card"><div class="error-splash-icon">⚠️</div><div class="error-splash-title">Error al cargar Proveedores</div><div class="error-splash-msg">${e.message || 'No se pudo conectar con el servidor. Verifica tu sesión e intenta de nuevo.'}</div><a href="/" class="error-splash-btn error-splash-btn-primary">🏠 Volver al Launcher</a></div></div>`);
  }
}

function showApp(){
  $('app-screen').classList.add('show');
  document.body.className=S.theme;
  const tb=$('theme-btn');if(tb)tb.textContent=S.theme==='dark'?'🌙':'☀️';
  const nameEl=$('user-name');if(nameEl)nameEl.textContent=S.usuario?.nombre||'—';
  const roleEl=$('user-role');if(roleEl)roleEl.textContent=S.usuario?.perfil_nombre||S.usuario?.rol||'—';
  const badge=$('user-badge');
  if(badge){badge.textContent=S.usuario?.rol||'';}
  // Footer user info
  const footerName=document.getElementById('sidebar-user-name');if(footerName)footerName.textContent=S.usuario?.nombre||'';
  const footerRole=document.getElementById('sidebar-user-role');if(footerRole)footerRole.textContent=S.usuario?.perfil_nombre||S.usuario?.rol||'';
  initFiltros();
  
  fetch('/api/version').then(r=>r.json()).then(d=>{
    const el=document.getElementById('app-version');
    if(el&&d.version)el.textContent='v'+d.version;
    window._appVersion = d.version || '';
  }).catch(()=>{});
  if(S.empresaLogo){
    $('header-logo').innerHTML='<img src="'+S.empresaLogo+'" style="height:32px;border-radius:6px"/>';
  }else if(S.appNombre){
    $('header-logo').innerHTML=S.appNombre.toUpperCase();
  }
  buildNav();
  initNotifications(15000);
  
  // Auto-sync centros from launcher (background, non-blocking)
  api('POST','/centros/sync').catch(()=>{});

  if(localStorage.getItem('sidebar_collapsed')==='true'){
    $('sidebar').classList.add('collapsed');
    const t=$('sidebar').querySelector('.sidebar-toggle');
    if(t)t.textContent='▶';
  }
  
  const v=getPageFromHash();
  goTo(v);
}

function tienePermisoProveedor(perm) {
  if (!S.usuario) return false;
  if (S.usuario.rol === 'admin') return true;
  const permisos = S.usuario.modulos_permisos?.proveedores || [];
  return permisos.includes(perm);
}

function buildNav(){
  let h='';
  for(const sec of SECS){
    const items=NAV.filter(n=>n.s===sec.id&&(!n.perm||tienePermisoProveedor(n.perm)));
    if(!items.length)continue;
    h+=`<div style="font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;padding:10px 24px 4px;margin-top:4px">${sec.l}</div>`;
    for(const n of items)h+=`<button class="nav-item" id="nv-${n.id}" onclick="goNav('${n.id}')" aria-label="${n.l}">${n.i}<span style="flex:1">${n.l}</span>${n.badge?`<span class="badge" style="font-size:10px;padding:2px 6px;background:${n.w?'rgba(251,191,36,.15)':'rgba(79,142,247,.15)'};color:${n.w?'var(--warning)':'var(--accent)'}" id="nb-${n.badge}">0</span>`:''}</button>`;
  }
  $('sidebar-nav').innerHTML=h;
}
