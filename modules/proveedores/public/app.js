// ─── STATE ───────────────────────────────────────────────────────────────────
const S={
  usuario:JSON.parse(localStorage.getItem('vd_u')||'null'),
  view:'dashboard',
  areas:[],
  cats:[],
  theme:localStorage.getItem('synnox_theme')||'light'
};
const NAV=[
  {id:'dashboard',l:'Dashboard',i:'📊',s:'p'},
  {id:'facturas',l:'Facturas',i:'📄',s:'p',perm:'ver'},
  {id:'pendientes',l:'Pendientes',i:'⏰',s:'p',perm:'ver'},
  {id:'porpagar',l:'Por Pagar',i:'💳',s:'f',perm:'pagar'},
  {id:'causacion',l:'Causación',i:'📥',s:'f',perm:'causar'},
  {id:'categorias',l:'Categorías',i:'🏷️',s:'c',perm:'editar'},
  {id:'centros',l:'Centros de operación',i:'🏢',s:'c',perm:'ver'},
  {id:'configuracion',l:'Configuración',i:'⚙️',s:'c',perm:'configurar'},
  {id:'backup',l:'Backup',i:'💾',s:'c',perm:'configurar'},
  {id:'audit',l:'Auditoría',i:'🔒',s:'c',perm:'auditar'}
];
const SECS=[{id:'p',l:'Principal'},{id:'f',l:'Flujo'},{id:'c',l:'Config'}];

// ─── ROUTING ─────────────────────────────────────────────────────────────────
function getPageFromHash(){
  const hash=location.hash.slice(1);
  if(!hash)return localStorage.getItem('vd_last_page')||'dashboard';
  return NAV.find(n=>n.id===hash)?hash:'dashboard';
}
function savePage(v){localStorage.setItem('vd_last_page',v)}

// ─── SIDEBAR HOME ────────────────────────────────────────────────────────────
function injectSidebarHome(){
  const footer=document.querySelector('.sidebar-footer');
  if(!footer||footer.querySelector('.sidebar-home'))return;
  const a=document.createElement('a');
  a.href='/';a.className='sidebar-home';
  a.innerHTML='<span class="icon">🏠</span> <span>Home</span>';
  const btn=footer.querySelector('.btn-logout');
  if(btn){footer.insertBefore(a,btn);const s=document.createElement('div');s.className='sidebar-separator';footer.insertBefore(s,btn);}
  else footer.prepend(a);
}

function goNav(v){closeSidebar();goTo(v)}
function setNav(id){
  document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
  const e=$(`nv-${id}`);if(e)e.classList.add('active');
  const T={'dashboard':'Dashboard','facturas':'Facturas','pendientes':'Pendientes','aprobaciones':'Aprobaciones','causacion':'Causación','categorias':'Categorías','backup':'Backup'};
  $('content').parentElement.querySelector('.page-title')?.remove();
  $('content').parentElement.querySelector('.page-sub')?.remove();
}
async function goTo(v){
  destruirCharts();
  S.view=v;setNav(v);
  savePage(v);
  history.pushState(null,'','#'+v);
  const el=$('content');el.innerHTML='<div class="empty">Cargando…</div>';
  try{
    if(v==='dashboard')await rDash();
    else if(v==='facturas')await rFacturas();
    else if(v==='pendientes')await rPend();
    else if(v==='causacion')await rCaus();
    else if(v==='porpagar')await rPorPagar();
    else if(v==='categorias')await rCats();
    else if(v==='centros')await rCentros();
    else if(v==='backup')await rBackup();
    else if(v==='configuracion')await rConfig();
    else if(v==='audit')await rAudit();
    else el.innerHTML='<div class="empty">Módulo en construcción</div>';
  }catch(ex){el.innerHTML=`<div class="empty" style="color:var(--danger)">${ex.message}</div>`}
}
window.addEventListener('popstate',()=>{
  const v=getPageFromHash();
  if(v!==S.view)goTo(v);
});

// ─── CENTROS DE OPERACIÓN (sincronizados desde Launcher) ───────────────────
let _centrosCache = [];
let _centrosCacheTs = 0;
const CENTROS_CACHE_TTL = 30000; // 30 segundos
let _centrosPromise = null;

async function loadCentros() {
  const age = Date.now() - _centrosCacheTs;
  if (_centrosCache.length && age < CENTROS_CACHE_TTL) return _centrosCache;
  if (_centrosPromise) return _centrosPromise;
  _centrosPromise = (async () => {
    try {
      const centros = await api('GET', '/centros');
      if (centros) { _centrosCache = centros; _centrosCacheTs = Date.now(); }
    } catch {}
    _centrosPromise = null;
    return _centrosCache;
  })();
  return _centrosCache.length ? _centrosCache : _centrosPromise;
}

async function rCentros(){
  const centros=await api('GET','/centros');
  $('content').innerHTML=`
    <div class="page-header"><div><div class="page-title">Centros de Operación</div><div class="page-sub">Sincronizados desde el Launcher — CRUD gestionado allí</div></div><button class="btn btn-primary" onclick="syncCentros()">🔄 Sincronizar desde Launcher</button></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px" id="centros-grid">
      ${centros.length?centros.map(c=>`<div class="tbl" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div style="font-weight:700;font-size:16px">${esc(c.nombre)}</div>
          <span class="badge ${c.activo?'b-aprobada':'b-rechazada'}">${c.activo?'Activo':'Inactivo'}</span>
        </div>
        ${c.codigo?`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">📍 ${esc(c.codigo)}</div>`:''}
        ${c.direccion?`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">🏠 ${esc(c.direccion)}</div>`:''}
        ${c.telefono?`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">📞 ${esc(c.telefono)}</div>`:''}
        ${c.email?`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">✉️ ${esc(c.email)}</div>`:''}
        ${c.descripcion?`<div style="font-size:12px;color:var(--text);margin-top:8px;border-top:1px solid var(--border);padding-top:8px">${esc(c.descripcion)}</div>`:''}
      </div>`).join(''):'<div class="empty" style="grid-column:1/-1">No hay centros registrados. Sincroniza desde el Launcher.</div>'}
    </div>
  `;
}

async function syncCentros(){
  try{
    const r=await api('POST','/centros/sync');
    toast(`Sincronizados: ${r.created} nuevos, ${r.updated} actualizados, ${r.unchanged} sin cambios`,'success');
    rCentros();
  }catch(e){toast(e.message,'error')}
}

async function cambiarCat(facturaId,catId){
  try{
    await api('PATCH',`/facturas/${facturaId}/categoria`,{categoria_id:catId});
    toast('Categoría actualizada','success');
    abrirF(facturaId);
  }catch(e){toast(e.message,'error')}
}

// ─── INIT ───────────────────────────────────────────────────────────────────
fetchUserAndShowApp();
setInterval(refreshBadges,60000);

// ─── Version polling (new deploy detection) ──────────────────────────────
let _versionBanner=null;
function _mostrarBannerVersion(msg){
  if(_versionBanner)return;
  _versionBanner=document.createElement('div');
  _versionBanner.id='version-banner';
  _versionBanner.innerHTML=`<span>${msg}</span><button onclick="recargarApp()" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:var(--font-body)">Recargar</button>`;
  Object.assign(_versionBanner.style,{position:'fixed',top:0,left:0,right:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',gap:12,padding:'10px 16px',fontSize:13,fontWeight:500,fontFamily:'var(--font-body)',background:'rgba(79,142,247,.15)',borderBottom:'1px solid var(--accent)',color:'var(--accent)',backdropFilter:'blur(8px)'});
  document.body.appendChild(_versionBanner);
  document.body.style.paddingTop='44px';
}
function recargarApp(){localStorage.removeItem('vd_last_page');location.reload()}
function _pollVersion(){
  fetch(BASE+'/api/version').then(r=>r.json()).then(d=>{
    if(window._appVersion&&d.version&&d.version!==window._appVersion){
      _mostrarBannerVersion('📦 Nueva versión disponible: '+d.version+' (actual: '+window._appVersion+')');
    }
  }).catch(()=>{});
}
setInterval(_pollVersion,60000);

async function cargarConfigGlobal(){
  try{
    const cfg=await api('GET','/configuracion');
    if(cfg.app_nombre?.valor){
      document.title=cfg.app_nombre.valor;
      S.appNombre=cfg.app_nombre.valor;
    }
    if(cfg.empresa_logo?.valor){
      S.empresaLogo=cfg.empresa_logo.valor;
      const logoEl=$('header-logo');
      if(logoEl)logoEl.innerHTML='<img src="'+cfg.empresa_logo.valor+'" style="height:32px;border-radius:6px"/>';
      const loginLogo=$('login-logo-container');
      if(loginLogo)loginLogo.innerHTML='<img src="'+cfg.empresa_logo.valor+'" style="max-height:60px;max-width:200px;border-radius:8px"/>';
    }
    if(cfg.empresa_nombre?.valor){
      S.empresaNombre=cfg.empresa_nombre.valor;
      const loginLogo=$('login-logo-container');
      if(loginLogo&&!S.empresaLogo)loginLogo.innerHTML='<div class="login-logo">'+cfg.empresa_nombre.valor.toUpperCase()+'</div>';
    }
  }catch(e){}
}
cargarConfigGlobal();

async function crearArea(){
  const nombre=$('new-area-nombre')?.value?.trim();
  const jefe_id=$('new-area-jefe')?.value||null;
  const email=$('new-area-email')?.value?.trim();
  if(!nombre){toast('El nombre es requerido','error');return}
  try{
    await api('POST','/areas',{nombre,jefe_id,email});
    toast('Área creada','success');
    closeM();
    rConfig();
  }catch(e){toast(e.message,'error')}
}

async function editarArea(id,nombre,jefe_id,email){
  let users=[];
  try { if(!S.usuarios)S.usuarios=await api('GET','/usuarios'); users=S.usuarios||[]; } catch { users=[]; }
  users=users.filter(u=>u.rol==='jefe'||u.rol==='admin');
  showM('Editar área','<div class=form-grid><div class=field full><label>NOMBRE</label><input type=text id=edit-area-nombre value='+esc(nombre)+'/></div><div class=field><label>JEFE (opcional)</label><select id=edit-area-jefe><option value=>— Sin jefe —</option>'+users.map(u=>'<option value='+u.id+' '+(u.id===jefe_id?'selected':'')+'>'+esc(u.nombre)+'</option>').join('')+'</select></div><div class=field><label>EMAIL</label><input type=email id=edit-area-email value='+esc(email||'')+'/></div></div><div style=display:flex;gap:10px;margin-top:16px><button class=btn btn-danger onclick=eliminarArea(\''+id+'\')>Eliminar</button><button class=btn btn-primary style=margin-left:auto onclick=guardarArea(\''+id+'\')>Guardar</button></div>');
}

async function guardarArea(id){
  const nombre=$('edit-area-nombre')?.value?.trim();
  const jefe_id=$('edit-area-jefe')?.value||null;
  const email=$('edit-area-email')?.value?.trim();
  if(!nombre){toast('El nombre es requerido','error');return}
  try{
    await api('PUT',`/areas/${id}`,{nombre,jefe_id,email});
    toast('Área actualizada','success');
    closeM();
    rConfig();
  }catch(e){toast(e.message,'error')}
}

async function eliminarArea(id){
  if(!await confirmModal('¿Eliminar esta área? Los usuarios quedan sin área asignada.'))return;
  try{
    await api('DELETE',`/areas/${id}`);
    toast('Área eliminada','success');
    closeM();
    rConfig();
  }catch(e){toast(e.message,'error')}
}

// ── Cache Helpers ──
function cacheGet(key, ttlMs) {
  try {
    const c = JSON.parse(localStorage.getItem('sf_' + key) || 'null');
    if (c && c.ts && Date.now() - c.ts < ttlMs) return c.data;
  } catch {}
  return null;
}

function cacheSet(key, data) {
  try { localStorage.setItem('sf_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function cacheCleanAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('sf_'))
    .forEach(k => localStorage.removeItem(k));
}

// ── Notifications ──
let _notifPollTimer = null;
let _notifLastCount = 0;

function mostrarNotificacionBrowser(titulo, mensaje, url) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const notif = new Notification(titulo, { body: mensaje, icon: '/favicon.ico', tag: 'synnox-' + Date.now() });
  notif.onclick = () => { window.focus(); if (url && url !== 'undefined' && url !== 'null') window.location.href = url; notif.close(); };
  setTimeout(() => notif.close(), 8000);
}

function cargarNotificaciones() {
  return fetch('/api/notificaciones/no-leidas')
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) return;
      const b = document.getElementById('notif-count');
      if (b) b.textContent = d.count > 0 ? (d.count > 99 ? '99+' : d.count) : '';
      if (d.count > _notifLastCount && _notifLastCount > 0) {
        fetch('/api/notificaciones')
          .then(r => r.ok ? r.json() : null)
          .then(nd => { if (nd?.notificaciones?.length) mostrarNotificacionBrowser(nd.notificaciones[0].titulo, nd.notificaciones[0].mensaje, nd.notificaciones[0].url); });
      }
      _notifLastCount = d.count;
    })
    .catch(() => {});
}

function toggleNotifDropdown() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  dd.classList.toggle('show');
  if (dd.classList.contains('show')) {
    fetch('/api/notificaciones')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const notifs = d.notificaciones || [];
        const list = dd.querySelector('.notif-list');
        if (!notifs.length) { list.innerHTML = '<div class="notif-empty">Sin notificaciones</div>'; return; }
        const icons = { factura_nueva: '📄', factura_vencida: '⚠️', factura_aprobada: '✅', factura_rechazada: '❌' };
        list.innerHTML = notifs.map(n => {
          const timeAgo = timeSinceNotif(new Date(n.created_at));
          return `<div class="notif-item${n.leida ? '' : ' unread'}" onclick="marcarNotifLeida(${n.id}, '${n.url || ''}')">
            <div class="notif-icon">${icons[n.tipo] || '🔔'}</div>
            <div class="notif-content"><div class="notif-title">${esc(n.titulo)}</div>
            <div class="notif-msg">${esc(n.mensaje)}</div>
            <div class="notif-time">${timeAgo}</div></div></div>`;
        }).join('');
      }).catch(() => {});
  }
}

function marcarNotifLeida(id, url) {
  const dd = document.getElementById('notif-dropdown');
  if (dd) dd.classList.remove('show');
  if (url && url !== 'undefined' && url !== 'null') window.location.href = url;
  fetch('/api/notificaciones/' + id + '/leer', { method: 'DELETE' })
    .then(() => cargarNotificaciones())
    .catch(() => {});
}

function marcarTodasLeidas() {
  fetch('/api/notificaciones/leer-todas', { method: 'DELETE' })
    .then(() => { cargarNotificaciones(); document.getElementById('notif-dropdown')?.classList.remove('show'); })
    .catch(() => {});
}

function activarNotificaciones() {
  if (!('Notification' in window)) return alert('Tu navegador no soporta notificaciones');
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      alert('Notificaciones activadas');
      checkNotifPermission();
      new Notification('Notificaciones activadas', { body: 'Recibirás alertas del sistema', icon: '/favicon.ico' });
    }
  });
}

function checkNotifPermission() {
  const banner = document.getElementById('notif-permission-banner');
  if (!banner) return;
  if (!('Notification' in window) || Notification.permission === 'granted' || Notification.permission === 'denied') {
    banner.style.display = 'none';
  } else {
    banner.style.display = 'block';
  }
}

function timeSinceNotif(date) {
  const s = Math.floor((new Date() - date) / 1000);
  if (s < 60) return 'Ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h';
  return Math.floor(h / 24) + ' d';
}

function initNotifications(pollMs) {
  cargarNotificaciones();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(cargarNotificaciones, pollMs || 60000);
  document.addEventListener('click', e => {
    const dd = document.getElementById('notif-dropdown');
    const bell = document.querySelector('.notif-bell');
    if (dd && !dd.contains(e.target) && !bell?.contains(e.target)) dd.classList.remove('show');
  });
}
