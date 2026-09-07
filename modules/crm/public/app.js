let usuario = null;
let _clientesPage = 1;
let clientesLimit = 20;
let _contactosPage = 1;
const _limit = 20;

const BASE = location.pathname.match(/^\/(\w+)\//) ? '/' + RegExp.$1 : '';

async function cargarNombreModulo() {
  const logo = document.querySelector('.logo[data-module-id]');
  const nombreEl = logo?.querySelector('[data-module-name]');
  if (!logo || !nombreEl) return;
  try {
    const token = localStorage.getItem('launcher_jwt');
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch('/api/modulos', { credentials: 'include', headers });
    if (!res.ok) return;
    const modulos = await res.json();
    const modulo = modulos.find(m => m.id === logo.dataset.moduleId);
    if (!modulo?.nombre) return;
    nombreEl.textContent = modulo.nombre;
    document.title = modulo.nombre + ' — SynnoxERP';
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  initFramework({ basePath: BASE, apiPrefix: '/api', themeKey: 'synnox_theme', tokenKey: 'launcher_jwt' });
  cargarNombreModulo();
  init();
});

async function init() {
  try {
    const r = await apiFetch('/auth/me');
    if (!r.ok) return mostrarLogin();
    usuario = r.data || r;
    document.getElementById('user-name').textContent = usuario.nombre || usuario.email;
    document.getElementById('user-role').textContent = usuario.rol || '';
    document.getElementById('sidebar-user-name').textContent = usuario.nombre || '';
    document.getElementById('sidebar-user-role').textContent = usuario.rol || '';
    // Terceros/cliente se gestionan en el ERP SIESA y se sincronizan. El CRM no los crea (ni admin).
    try {
      const v = await fetch(HF.API.replace('/api', '') + '/api/version');
      const vd = await v.json();
      document.getElementById('app-version').textContent = 'v' + (vd.version || '?');
    } catch {}
    navigate('dashboard');
  } catch { mostrarLogin(); }
}

async function apiFetch(path, opts = {}) {
  try {
    const r = await fetch(HF.API + path, { credentials: 'include', ...opts });
    if (r.status === 401) { mostrarLogin(); return { ok: false }; }
    const data = await r.json();
    return { ok: r.ok, data, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

function mostrarLogin() {
  window.location.href = '/';
}

function mostrarLogoutConfirm() {
  confirmar({ titulo: 'Cerrar sesion', mensaje: '¿Cerrar sesion?', icono: '⏻', onConfirm: () => {
    document.cookie.split(';').forEach(c => { document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/'); });
    localStorage.removeItem('launcher_jwt');
    window.location.href = '/';
  }});
}

// ── Navigation ──
const pages = ['dashboard', 'pipeline', 'leads', 'clientes', 'contactos', 'visitas', 'cotizaciones', 'productos', 'inventario', 'importar', 'descuentos', 'admin'];
function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (el) el.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', pipeline: 'Pipeline', leads: 'Clientes Potenciales', clientes: 'Clientes', contactos: 'Contactos', visitas: 'Actividades', cotizaciones: 'Cotizaciones', productos: 'Productos', inventario: 'Inventario', importar: 'Importar SIESA', descuentos: 'Descuentos', admin: 'Admin' };
  document.getElementById('page-title').textContent = titles[page] || 'CRM';
  if (page === 'dashboard') cargarDashboard();
  if (page === 'pipeline') cargarPipeline();
  if (page === 'leads') cargarLeads();
  if (page === 'clientes') cargarClientes();
  if (page === 'contactos') cargarContactos();
  if (page === 'visitas') cargarVisitas();
  if (page === 'cotizaciones') cargarCotizaciones();
  if (page === 'productos') cargarProductos();
  if (page === 'inventario') cargarInventario();
  if (page === 'importar') cargarPaginaImportar();
  if (page === 'descuentos') cargarDescuentos();
  if (page === 'admin') cargarAdmin();
}

// ── Dashboard ──
async function cargarDashboard() {
  try {
    const desde = document.getElementById('dash-desde')?.value || '';
    const hasta = document.getElementById('dash-hasta')?.value || '';
    const qs = new URLSearchParams();
    if (desde) qs.set('desde', desde);
    if (hasta) qs.set('hasta', hasta);
    const q = qs.toString() ? '?' + qs.toString() : '';
    const r = await apiFetch('/dashboard' + q);
    if (!r.ok) return;
    const d = r.data;
    if (!_pipelineVendedorCache.length) cargarVendedoresPipelineFilter();
    renderFunnelChart(d.funnel || [], 'widget-funnel');
    if (!_pipelineVendedorCache.length) await cargarVendedoresPipelineFilter();
    renderTablaVendedores(d.ranking_vendedores || [], 'widget-vendedores');
    renderGraficoSVG(d.tendencia_mensual || [], 'widget-tendencia');
    renderDistribucionCiudades(d.distribucion_ciudades || [], 'widget-ciudades');
  } catch (err) { console.error('Dashboard error:', err); }
}

function dashMesActual() {
  const ahora = new Date();
  const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
  document.getElementById('dash-desde').value = desde.toISOString().slice(0, 10);
  document.getElementById('dash-hasta').value = hasta.toISOString().slice(0, 10);
  cargarDashboard();
}
function dashMesAnterior() {
  const ahora = new Date();
  const desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
  document.getElementById('dash-desde').value = desde.toISOString().slice(0, 10);
  document.getElementById('dash-hasta').value = hasta.toISOString().slice(0, 10);
  cargarDashboard();
}
function limpiarFiltrosDash() {
  document.getElementById('dash-desde').value = '';
  document.getElementById('dash-hasta').value = '';
  cargarDashboard();
}

// ── Dashboard widgets ──
const _ETAPA_LABEL = { lead:'Lead', calificado:'Calificado', propuesta:'Propuesta', negociacion:'Negociación', ganada:'Ganada', perdida:'Perdida' };
function renderFunnelChart(data, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const maxMonto = Math.max(0, ...data.map(e => Number(e.monto) || 0));
  const barColor = (etapa) => etapa === 'perdida' ? '#a0aec0' : 'var(--accent)';
  const html = data.map(item => {
    const pct = maxMonto > 0 ? (Number(item.monto) / maxMonto) * 100 : 0;
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text)">
          <span>${esc(_ETAPA_LABEL[item.etapa] || item.etapa)} (${item.cantidad})</span>
          <span>$${formatMoney(item.monto)}</span>
        </div>
        <div style="background:var(--surface2);border-radius:6px;height:18px;overflow:hidden">
          <div style="width:${pct}%;background:${barColor(item.etapa)};height:100%;transition:width .4s ease;border-radius:6px"></div>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="widget-title">Embudo de ventas</div>${html || '<div style="color:var(--muted);font-size:12px">Sin datos</div>'}`;
}
function renderTablaVendedores(vendedores, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const nombreVendedor = (id) => {
    const cached = _pipelineVendedorCache.find(u => String(u.id) === String(id));
    if (cached?.nombre) return cached.nombre;
    return 'ID ' + id;
  };
  const filas = vendedores.map(v => {
    const ganado = Number(v.monto_ganado) || 0;
    return `
      <tr>
        <td style="padding:9px 8px;font-weight:600">${esc(nombreVendedor(v.vendedor_id))}</td>
        <td style="padding:9px 8px;text-align:center">${v.ops_abiertas}</td>
        <td style="padding:9px 8px;text-align:right;font-weight:600;color:var(--accent)">$${formatMoney(ganado)}</td>
      </tr>`;
  }).join('');
  container.innerHTML = `
    <div class="widget-title">Rendimiento de asesores</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Asesor</th><th style="text-align:center">Ops</th><th style="text-align:right">Ganado</th></tr></thead><tbody>
      ${filas || '<tr><td colspan="3" style="color:var(--muted);text-align:center">Sin datos</td></tr>'}
    </tbody></table></div>`;
}
function renderGraficoSVG(historico, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!historico.length) { container.innerHTML = '<div class="widget-title">Tendencia mensual</div><div style="color:var(--muted);font-size:12px">Sin datos</div>'; return; }
  const maxVenta = Math.max(1, ...historico.map(h => Number(h.monto) || 0));
  const height = 140, width = 360;
  const px = (i) => (historico.length > 1 ? (i / (historico.length - 1)) : 0) * (width - 40) + 20;
  const py = (m) => height - ((Number(m) / maxVenta) * (height - 40) + 20);
  const puntos = historico.map((h, i) => `${px(i)},${py(h.monto)}`).join(' ');
  const mesCorto = (m) => { try { return new Date(m + '-01').toLocaleDateString('es-CO',{month:'short'}); } catch { return m.slice(5); } };
  const line = historico.length > 1 ? `<polyline fill="none" stroke="var(--accent)" stroke-width="3" points="${puntos}"/>` : '';
  container.innerHTML = `
    <div class="widget-title">Tendencia mensual</div>
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;overflow:visible">
      ${line}
      ${historico.map((h, i) => `
        <circle cx="${px(i)}" cy="${py(h.monto)}" r="4" fill="var(--accent)"><title>${h.mes}: $${formatMoney(h.monto)}</title></circle>
        <text x="${px(i)}" y="${height + 14}" font-size="10" fill="var(--muted)" text-anchor="middle">${mesCorto(h.mes)}</text>`).join('')}
    </svg>`;
}
function renderDistribucionCiudades(ciudadesData, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const total = ciudadesData.reduce((a, c) => a + (Number(c.cantidad) || 0), 0);
  const items = ciudadesData.map(c => {
    const pct = total > 0 ? ((Number(c.cantidad) / total) * 100).toFixed(1) : 0;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px dashed var(--border);font-size:12px">
        <span style="color:var(--text);font-weight:500">${esc(c.ciudad)}</span>
        <div>
          <span style="font-weight:bold;color:var(--text);margin-right:8px">${c.cantidad}</span>
          <span style="background:var(--surface2);color:var(--accent);font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600">${pct}%</span>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = `<div class="widget-title">Distribución geográfica</div><div style="max-height:220px;overflow-y:auto;padding-right:4px">${items || '<div style="color:var(--muted);font-size:12px">Sin datos</div>'}</div>`;
}

// ── Pipeline Kanban ──
const ETAPAS = [
  { id: 'lead', label: 'Lead', color: '#6c757d' },
  { id: 'calificado', label: 'Calificado', color: '#17a2b8' },
  { id: 'propuesta', label: 'Propuesta', color: '#ffc107' },
  { id: 'negociacion', label: 'Negociacion', color: '#fd7e14' },
  { id: 'ganada', label: 'Ganada', color: '#00A86B' },
  { id: 'perdida', label: 'Perdida', color: '#dc3545' }
];

async function cargarPipeline() {
  try {
    if(!_pipelineVendedorCache.length){
      // carga async sin bloquear
      cargarVendedoresPipelineFilter();
    }
    const vendedor = document.getElementById('filtro-pipeline-vendedor')?.value || document.getElementById('filtro-pipeline-vendedor-search')?.dataset.selected || '';
    const etapa = document.getElementById('filtro-pipeline-etapa')?.value || '';
    const fuente = document.getElementById('filtro-pipeline-fuente')?.value || '';
    const prioridad = document.getElementById('filtro-pipeline-prioridad')?.value || '';
    const search = document.getElementById('filtro-pipeline-search')?.value?.trim() || '';
    const desde = document.getElementById('filtro-pipeline-desde')?.value || '';
    const hasta = document.getElementById('filtro-pipeline-hasta')?.value || '';
    const params = new URLSearchParams();
    if (vendedor) params.set('vendedor', vendedor);
    if (etapa) params.set('etapa', etapa);
    if (fuente) params.set('fuente', fuente);
    if (prioridad) params.set('prioridad', prioridad);
    if (search) params.set('search', search);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const [r, s] = await Promise.all([
      apiFetch('/oportunidades/pipeline?' + params),
      apiFetch('/oportunidades/stats?' + params)
    ]);
    if (!r.ok) return;
    const { pipeline, stats } = r.data;
    if (s.ok) {
      const d = s.data;
      const chip = (label, total)=> `<span class="kpi-chip">${esc(label)} <b>${total}</b></span>`;
      const etapaBar = (d.por_etapa||[]).map(e=> chip(e.etapa.slice(0,3), e.total)).join('') || '—';
      const fuenteBar = (d.por_fuente||[]).slice(0,4).map(f=> chip(f.fuente, f.total)).join('') || '—';
      const priBar = (d.por_prioridad||[]).map(p=> chip(p.prioridad, p.total)).join('') || '—';
      // Funnel: conversion entre etapas consecutivas (snapshot actual)
      const cntEtapa = {};
      (d.por_etapa||[]).forEach(e=>{ cntEtapa[e.etapa]=parseInt(e.total)||0; });
      const conv = (a,b)=> a>0 ? Math.round(b/a*100) : null;
      const convClass = (v)=> v===null ? 'na' : v>=50 ? 'ok' : v>=30 ? 'warn' : 'bad';
      const funnelRows = [
        ['Lead → Calif', cntEtapa.lead||0, cntEtapa.calificado||0],
        ['Calif → Prop', cntEtapa.calificado||0, cntEtapa.propuesta||0],
        ['Prop → Neg', cntEtapa.propuesta||0, cntEtapa.negociacion||0],
      ].map(([label,a,b])=>{ const v=conv(a,b); return `<div class="funnel-row"><span>${label} (${a}→${b})</span><strong class="${convClass(v)}">${v===null?'—':v+'%'}</strong></div>`; }).join('');
      const funnelTip = `Lead ${cntEtapa.lead||0} → Calificado ${cntEtapa.calificado||0} → Propuesta ${cntEtapa.propuesta||0} → Negociación ${cntEtapa.negociacion||0}`;
      // Perdida por causal: mini-barras
      const motivoLabel = { precio:'Precio', competencia:'Competencia', sin_presupuesto:'Sin ppto', no_responde:'No responde', otro:'Otro', sin_motivo:'Sin motivo' };
      const perds = d.perdida_por_motivo||[];
      const maxPerd = Math.max(1, ...perds.map(p=>parseInt(p.total)||0));
      const perdidaBar = perds.length ? perds.slice(0,4).map(p=>{
        const w = Math.round((parseInt(p.total)||0)/maxPerd*100);
        return `<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted)"><span style="min-width:70px">${esc(motivoLabel[p.motivo]||p.motivo)}</span><span style="flex:1;background:var(--surface2);border-radius:4px;height:8px;overflow:hidden"><span style="display:block;height:100%;width:${w}%;background:var(--danger)"></span></span><span>${p.total}</span></div>`;
      }).join('') : '<span style="font-size:10px;color:var(--muted)">Sin pérdidas</span>';
      document.getElementById('stats-pipeline').innerHTML = `
        <div class="stat-card" title="Total oportunidades bajo filtros activos"><div class="stat-value blue">${d.total || 0}</div><div class="stat-label">Oportunidades</div><div class="kpi-chips">${etapaBar}</div></div>
        <div class="stat-card" title="Suma de montos en etapas abiertas (sin ganada/perdida)"><div class="stat-value orange">$${formatMoney(d.monto_pipeline || 0)}</div><div class="stat-label">Pipeline abierto</div><div class="stat-sub" style="font-size:10px;color:var(--muted)">Ticket $${formatMoney(d.ticket_promedio||0)}</div></div>
        <div class="stat-card" title="Suma de monto × probabilidad / 100 en etapas abiertas"><div class="stat-value purple">$${formatMoney(d.forecast_ponderado || 0)}</div><div class="stat-label">Forecast ponderado</div><div class="stat-sub" style="font-size:10px;color:var(--muted)">monto × prob</div></div>
        <div class="stat-card" title="Ganadas / (ganadas + perdidas)"><div class="stat-value green">${d.win_rate || 0}%</div><div class="stat-label">Win rate</div><div class="stat-sub" style="font-size:10px;color:var(--muted)">${d.ganada||0} ganada · ${d.perdida||0} perdida</div></div>
        <div class="stat-card" style="border-color:${(d.vencidas||0)>0?'var(--danger)':''};${_soloVencidas?'outline:2px solid var(--danger);':''}cursor:pointer" onclick="toggleFiltroVencidas()" title="Clic para resaltar vencidas en el tablero"><div class="stat-value ${ (d.vencidas||0)>0?'red':'green'}">${d.vencidas||0}</div><div class="stat-label">Vencidas ${_soloVencidas?'◉':''}</div><div class="stat-sub" style="font-size:10px;color:var(--muted)">cierre &lt; hoy · clic filtra</div></div>
        <div class="stat-card"><div class="stat-value yellow">${d.ciclo_promedio||0}d</div><div class="stat-label">Ciclo promedio</div><div class="stat-sub" style="font-size:10px;color:var(--muted)">días en pipeline</div></div>
        <div class="stat-card"><div class="stat-value green" style="font-size:14px">${d.top_vendedor ? esc(d.top_vendedor.nombre||('ID '+d.top_vendedor.id)) : '—'}</div><div class="stat-label">Top vendedor</div><div class="stat-sub" style="font-size:10px;color:var(--muted)">${d.top_vendedor? d.top_vendedor.total+' ops · $'+formatMoney(d.top_vendedor.monto) : '—'}</div></div>
        <div class="stat-card" title="Distribución por fuente y prioridad"><div class="stat-label-top">Por fuente / prioridad</div><div class="kpi-chips">${fuenteBar}</div><div class="kpi-chips">${priBar}</div></div>
        <div class="stat-card" title="${funnelTip}"><div class="stat-label-top">Conversión por etapa</div><div style="display:flex;flex-direction:column;gap:2px">${funnelRows}</div></div>
        <div class="stat-card" title="Oportunidades perdidas agrupadas por motivo"><div class="stat-label-top">Pérdida por causal</div><div style="display:flex;flex-direction:column;gap:3px">${perdidaBar}</div></div>
      `;
      aplicarFiltroVencidas();
    }
    const kanban = document.getElementById('pipeline-kanban');
    kanban.innerHTML = ETAPAS.map(etapa => `
      <div class="kanban-col" data-etapa="${etapa.id}" ondragover="allowDrop(event)" ondrop="dropOportunidad(event, '${etapa.id}')" ondragleave="dragLeave(event)">
        <h4>
          <span>${etapa.label}</span>
          <span title="Total: $${formatMoney(stats[etapa.id]?.total || 0)}">
            <span class="total">${formatMoneyShort(stats[etapa.id]?.total || 0)}</span>
            <span class="count">${stats[etapa.id]?.count || 0}</span>
          </span>
        </h4>
        ${(pipeline[etapa.id] || []).map(o => {
          const priColor = { baja:'#6c757d', media:'#17a2b8', alta:'#fd7e14', critica:'#dc3545' }[o.prioridad||'media'] || '#6c757d';
          const hoyISO = new Date().toISOString().slice(0,10);
          const fcISO = o.fecha_cierre_estimada ? String(o.fecha_cierre_estimada).slice(0,10) : '';
          const esVencida = fcISO && fcISO < hoyISO && !['ganada','perdida'].includes(o.etapa);
          return `
          <div class="kanban-card" ${esVencida?'data-vencida="1" style="border-left:3px solid var(--danger)"':''} draggable="true" ondragstart="dragOportunidad(event, '${o.id}')" onclick="editarOportunidad('${o.id}')">
            ${esVencida?'<div style="font-size:10px;color:var(--danger);font-weight:700">⏰ VENCIDA '+esc(fcISO)+'</div>':''}
            <div class="card-title">${esc(o.nombre)}</div>
            <div class="card-cliente">${esc(o.cliente_nombre || o.lead_nombre || '—')}</div>
            <div style="display:flex;gap:4px;margin:4px 0">
              ${o.fuente ? `<span style="font-size:10px;background:var(--surface2);border:1px solid var(--border);padding:1px 6px;border-radius:10px">${esc(o.fuente)}</span>`:''}
              ${o.prioridad ? `<span style="font-size:10px;color:#fff;background:${priColor};padding:1px 6px;border-radius:10px;text-transform:capitalize">${esc(o.prioridad)}</span>`:''}
            </div>
            <div class="card-monto">$${formatMoney(o.monto_esperado || 0)}</div>
            <div class="card-meta">
              <span>${o.probabilidad || 0}%</span>
              <span>${formatDate(o.fecha_cierre_estimada)}</span>
            </div>
          </div>
        `}).join('')}
      </div>
    `).join('');
  } catch (err) { console.error('Pipeline error:', err); }
}

let _pipelineVendedorCache=[], _pipelineVendedorTimer=null;
async function cargarVendedoresPipelineFilter(){
  try{
    let r=await apiFetch('/perfiles-venta/asesores');
    if(!r.ok) r=await apiFetch('/perfiles-venta/usuarios-all');
    if(!r.ok) return;
    let data=r.data.data||r.data||[];
    if(r.data.data && r.data.data[0]?.perfil_id !== undefined){
      const asesores = data.filter(u=> String(u.perfil_id)==='2440');
      if(asesores.length) data = asesores;
    }
    _pipelineVendedorCache=data;
  }catch{}
}
function filtrarPipelineVendedor(q){
  const dropdown=document.getElementById('filtro-pipeline-vendedor-dropdown');
  const hidden=document.getElementById('filtro-pipeline-vendedor');
  const disp=document.getElementById('filtro-pipeline-vendedor-selected');
  const inp=document.getElementById('filtro-pipeline-vendedor-search');
  if(!dropdown || !hidden) return;
  if(disp && disp.style.display!=='none' && q && q.length) return;
  const qq=(q||'').trim().toLowerCase();
  // tiempo real visual
  if(qq && qq.length>=2){
    document.querySelectorAll('.kanban-card').forEach(card=>{
      const txt=(card.textContent||'').toLowerCase();
      card.style.display = txt.includes(qq) ? '' : 'none';
    });
  } else {
    document.querySelectorAll('.kanban-card').forEach(card=> card.style.display='');
  }
  clearTimeout(_pipelineVendedorTimer);
  _pipelineVendedorTimer=setTimeout(()=>{
    let filtered;
    if(!qq){ filtered = _pipelineVendedorCache; }
    else { filtered = _pipelineVendedorCache.filter(u=> u.nombre&&u.nombre.toLowerCase().includes(qq)); }
    if(!_pipelineVendedorCache.length){
      dropdown.innerHTML='<div style="padding:10px;color:var(--muted);font-size:12px">Cargando vendedores...</div>';
      dropdown.style.display='block'; return;
    }
    if(!filtered.length){
      dropdown.innerHTML='<div style="padding:10px;color:var(--muted);font-size:12px">No hay resultados</div><div style="padding:6px 10px;cursor:pointer;color:var(--accent)" onclick="onPipelineVendedorSelect(\'\',\'Todos los vendedores\')">Todos los vendedores</div>';
      dropdown.style.display='block'; return;
    }
    dropdown.innerHTML='<div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border);color:var(--accent)" onclick="onPipelineVendedorSelect(\'\',\'Todos los vendedores\')">Todos los vendedores</div>' + filtered.map(u=> `<div style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'" onclick="onPipelineVendedorSelect('${u.id}','${esc(u.nombre).replace(/'/g,"\\'")}')">${esc(u.nombre)}</div>`).join('');
    dropdown.style.display='block';
  },200);
}
document.addEventListener('click', (e)=>{
  const wrap=document.getElementById('pipeline-vendedor-wrap');
  const dd=document.getElementById('filtro-pipeline-vendedor-dropdown');
  if(wrap && dd && dd.style.display!=='none' && !wrap.contains(e.target)) dd.style.display='none';
  const oWrap=document.getElementById('oportunidad-vendedor-search')?.closest('[style*=\"position:relative\"]') || document.getElementById('oportunidad-vendedor')?.parentElement;
  const oDd=document.getElementById('oportunidad-vendedor');
  // multi-combo ya tiene su handler, no duplicar
});
function onPipelineVendedorSelect(id, nombre){
  const hidden=document.getElementById('filtro-pipeline-vendedor');
  const dropdown=document.getElementById('filtro-pipeline-vendedor-dropdown');
  const disp=document.getElementById('filtro-pipeline-vendedor-selected');
  const inp=document.getElementById('filtro-pipeline-vendedor-search');
  if(id===undefined){
    // compat: llamado desde select legacy
    const sel=document.getElementById('filtro-pipeline-vendedor');
    const opt=sel?.options[sel.selectedIndex];
    if(!opt) return;
    id=opt.value; nombre=opt.textContent;
  }
  // hidden/dropdown ya definidos arriba como hidden/dropdown
  const hidden2=document.getElementById('filtro-pipeline-vendedor');
  const dropdown2=document.getElementById('filtro-pipeline-vendedor-dropdown');
  const inp2=document.getElementById('filtro-pipeline-vendedor-search');
  const disp2b=document.getElementById('filtro-pipeline-vendedor-selected');
  if(!id){
    hidden2.value=''; if(disp2b){ disp2b.style.display='none'; disp2b.textContent=''; }
    if(inp2){ inp2.value=''; inp2.readOnly=false; inp2.placeholder='Filtrar vendedor (asesor)...'; inp2.dataset.selected=''; inp2.onclick=null; }
    if(dropdown2) dropdown2.style.display='none';
  } else {
    hidden2.value=id;
    if(inp2){ inp2.value=nombre; inp2.readOnly=true; inp2.title='Seleccionado — clic para cambiar'; inp2.dataset.selected=id;
      inp2.onclick=()=>{ hidden2.value=''; inp2.value=''; inp2.readOnly=false; inp2.placeholder='Filtrar vendedor (asesor)...'; if(disp2b) disp2b.style.display='none'; if(dropdown2) dropdown2.style.display='none'; inp2.onclick=null; cargarPipeline(); };
    }
    if(disp2b) disp2b.style.display='none';
    if(dropdown2) dropdown2.style.display='none';
  }
  cargarPipeline();
}
let _soloVencidas = false;
function toggleFiltroVencidas(){
  _soloVencidas = !_soloVencidas;
  aplicarFiltroVencidas();
  cargarPipeline();
}
function aplicarFiltroVencidas(){
  document.querySelectorAll('#pipeline-kanban .kanban-card').forEach(card=>{
    if(!_soloVencidas){ card.style.opacity=''; card.style.display=''; return; }
    if(card.dataset.vencida==='1'){ card.style.opacity=''; card.style.display=''; card.style.boxShadow='0 0 0 2px var(--danger)'; }
    else { card.style.opacity='0.25'; card.style.boxShadow=''; }
  });
}
function limpiarFiltrosPipeline() {
  _soloVencidas = false;
  ['filtro-pipeline-vendedor','filtro-pipeline-etapa','filtro-pipeline-fuente','filtro-pipeline-prioridad','filtro-pipeline-search','filtro-pipeline-desde','filtro-pipeline-hasta'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const pvDisp=document.getElementById('filtro-pipeline-vendedor-selected');
  const pvSel=document.getElementById('filtro-pipeline-vendedor');
  const pvInp=document.getElementById('filtro-pipeline-vendedor-search');
  if(pvDisp) pvDisp.style.display='none';
  if(pvSel){ pvSel.style.display='none'; pvSel.value=''; }
  if(pvInp){ pvInp.value=''; pvInp.dataset.selected=''; }
  cargarPipeline();
}

function allowDrop(ev) { ev.preventDefault(); ev.currentTarget.classList.add('drag-over'); }
function dragLeave(ev) { ev.currentTarget.classList.remove('drag-over'); }
function dragOportunidad(ev, id) {
  ev.dataTransfer.setData('text/plain', id);
  ev.target.classList.add('dragging');
}
async function dropOportunidad(ev, etapa) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  const id = ev.dataTransfer.getData('text/plain');
  if (!id) return;
  const r = await apiFetch('/oportunidades/' + id + '/mover', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ etapa })
  });
  if (!r.ok) return toast('Error al mover oportunidad', 'error');
  toast('Oportunidad movida a ' + ETAPAS.find(e => e.id === etapa)?.label, 'success');
  cargarPipeline();
}

let _oportunidadProductos = [];
let _oportunidadProdTimer = null;

async function abrirModalOportunidad(oportunidad = null) {
  document.getElementById('modal-oportunidad-title').textContent = oportunidad ? 'Editar Oportunidad' : 'Nueva Oportunidad';
  document.getElementById('oportunidad-id').value = oportunidad?.id || '';
  document.getElementById('btn-eliminar-oportunidad').style.display = oportunidad?.id ? '' : 'none';
  document.getElementById('oportunidad-nombre').value = oportunidad?.nombre || '';
  document.getElementById('oportunidad-monto').value = oportunidad?.monto_esperado ?? '';
  document.getElementById('oportunidad-probabilidad').value = oportunidad?.probabilidad ?? 10;
  document.getElementById('oportunidad-etapa').value = oportunidad?.etapa || 'lead';
  document.getElementById('oportunidad-fecha').value = oportunidad?.fecha_cierre_estimada ? String(oportunidad.fecha_cierre_estimada).split('T')[0] : '';
  document.getElementById('oportunidad-motivo-perdida').value = oportunidad?.motivo_perdida || '';
  document.getElementById('oportunidad-fuente').value = oportunidad?.fuente || 'otro';
  document.getElementById('oportunidad-prioridad').value = oportunidad?.prioridad || 'media';
  document.getElementById('oportunidad-etapa').onchange = function() {
    document.getElementById('grupo-motivo-perdida').style.display = this.value === 'perdida' ? 'block' : 'none';
  };
  document.getElementById('grupo-motivo-perdida').style.display = (oportunidad?.etapa === 'perdida') ? 'block' : 'none';
  await cargarListasOportunidad(oportunidad?.lista_precios);
  // Cliente/Lead buscables (combobox) — si hay id, precarga el seleccionado
  await setupOportunidadClienteCombobox(oportunidad?.cliente_id);
  await setupOportunidadLeadCombobox(oportunidad?.lead_id);
  await cargarContactosOportunidad(oportunidad?.contacto_id);
  await cargarVendedoresSelect('oportunidad-vendedor', oportunidad?.vendedor_id);
  // Productos
  _oportunidadProductos = [];
  document.getElementById('buscar-oportunidad-producto').value = '';
  document.getElementById('oportunidad-producto-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">Busca un producto del maestro para agregarlo.</p>';
  if (oportunidad?.id) {
    const pr = await apiFetch('/oportunidades/' + oportunidad.id + '/productos');
    if (pr.ok) _oportunidadProductos = pr.data.data || [];
    // solo pisa monto si la suma de productos aporta valor (>0)
    if (_oportunidadProductos.length) {
      const total = _oportunidadProductos.reduce((s,p)=>s+parseFloat(p.cantidad)*parseFloat(p.precio_unitario||p.precio_maestro||0),0);
      if (total > 0) document.getElementById('oportunidad-monto').value = total.toFixed(2);
    }
  }
  renderOportunidadProductos();
  showModal('modal-oportunidad');
}

async function buscarOportunidadProducto() {
  clearTimeout(_oportunidadProdTimer);
  _oportunidadProdTimer = setTimeout(async () => {
    const q = document.getElementById('buscar-oportunidad-producto')?.value;
    if (!q || q.length < 2) { document.getElementById('oportunidad-producto-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">Escribe al menos 2 caracteres.</p>'; return; }
    const lista = document.getElementById('oportunidad-lista-precios')?.value || await getPerfilListaDefault();
    const r = await apiFetch('/productos/buscar?q=' + encodeURIComponent(q) + '&lista=' + encodeURIComponent(lista));
    if (!r.ok) return;
    const data = r.data.data || [];
    if (!data.length) { document.getElementById('oportunidad-producto-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">No hay resultados.</p>'; return; }
    document.getElementById('oportunidad-producto-resultados').innerHTML = data.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
        <div><strong>${esc(p.codigo)}</strong> — ${esc(p.nombre)}<br><span style="font-size:11px;color:var(--muted)">${esc(p.unidad_medida||'UND')} · $${formatMoney(p.precio_unitario||0)}</span></div>
        <button class="btn btn-sm btn-primary btn-action" onclick='agregarProductoOportunidad(${JSON.stringify(p).replace(/"/g,"&quot;")})' title="Agregar" aria-label="Agregar producto ${esc(p.nombre)}">＋</button>
      </div>`).join('');
  }, 300);
}

function agregarProductoOportunidad(p) {
  if (_oportunidadProductos.find(x=>x.producto_id===p.id || x.codigo===p.codigo)) return toast('Producto ya agregado','warning');
  _oportunidadProductos.push({ producto_id: p.id, codigo: p.codigo, producto_nombre: p.nombre, unidad_medida: p.unidad_medida, precio_unitario: p.precio_unitario||0, cantidad: 1 });
  renderOportunidadProductos();
}
function quitarProductoOportunidad(pid) {
  _oportunidadProductos = _oportunidadProductos.filter(x=> (x.producto_id||x.id) !== pid && x.codigo !== pid);
  renderOportunidadProductos();
}
function renderOportunidadProductos() {
  const cont = document.getElementById('oportunidad-productos-lista');
  if (!_oportunidadProductos.length) { cont.innerHTML = '<p style="color:var(--muted);font-size:12px">Sin productos. Agrega desde el buscador.</p>'; document.getElementById('oportunidad-productos-total').textContent=''; return; }
  const total = _oportunidadProductos.reduce((s,p)=>s+parseFloat(p.cantidad||1)*parseFloat(p.precio_unitario||0),0);
  document.getElementById('oportunidad-productos-total').textContent = `${_oportunidadProductos.length} prod · $${formatMoney(total)}`;
  document.getElementById('oportunidad-monto').value = total.toFixed(2);
  cont.innerHTML = _oportunidadProductos.map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
      <div style="flex:1"><strong>${esc(p.codigo||'')}</strong> — ${esc(p.producto_nombre||p.nombre||'')}<br><span style="font-size:11px;color:var(--muted)">Cant: <input type="number" value="${p.cantidad||1}" min="1" step="1" style="width:60px;padding:2px 6px" onchange="actualizarCantOportunidad('${p.producto_id||p.codigo}', this.value)"> · $${formatMoney(p.precio_unitario||0)}</span></div>
      <button class="btn btn-sm btn-danger btn-action" onclick="quitarProductoOportunidad('${p.producto_id||p.codigo}')" title="Quitar" aria-label="Quitar ${esc(p.producto_nombre||p.nombre)}">✕</button>
    </div>`).join('');
}
function actualizarCantOportunidad(pid, val) {
  const it = _oportunidadProductos.find(x=> (x.producto_id||x.codigo)===pid);
  if (it) { it.cantidad = parseFloat(val)||1; renderOportunidadProductos(); }
}

let _oportunidadClienteTimer=null, _oportunidadLeadTimer=null;
async function setupOportunidadClienteCombobox(selectedId){
  const sel=document.getElementById('oportunidad-cliente');
  const inp=document.getElementById('oportunidad-cliente-search');
  const disp=document.getElementById('oportunidad-cliente-selected');
  if(!sel||!inp||!disp) return;
  sel.style.display='none'; sel.innerHTML=''; inp.value=''; inp.readOnly=false; inp.placeholder='Buscar por NIT o nombre...'; disp.style.display='none'; disp.textContent='';
  if(selectedId){
    try{ const r=await apiFetch('/clientes/'+selectedId); if(r.ok){ const c=r.data.data; sel.innerHTML=`<option value="${c.id}" selected>${esc(c.nombre)} — ${esc(c.nit||'')}</option>`; sel.value=c.id; inp.value=`${c.nombre} — ${c.nit||''}`; inp.readOnly=true; disp.style.display='none'; inp.title='Click para cambiar — borra para buscar otro'; inp.onclick=()=>{ if(inp.readOnly){ inp.value=''; inp.readOnly=false; inp.placeholder='Buscar por NIT o nombre...'; sel.value=''; sel.innerHTML=''; document.getElementById('oportunidad-contacto').innerHTML='<option value=\"\">Sin contacto</option>'; } }; } }catch{}
  }
}
async function filtrarOportunidadClientes(q){
  const sel=document.getElementById('oportunidad-cliente');
  const inp=document.getElementById('oportunidad-cliente-search');
  if(inp && inp.readOnly) return;
  const qq=(q||'').trim(); if(!qq || qq.length<2){ sel.style.display='none'; sel.innerHTML=''; return; }
  clearTimeout(_oportunidadClienteTimer); _oportunidadClienteTimer=setTimeout(async()=>{
    const r=await apiFetch('/clientes?search='+encodeURIComponent(qq)+'&limit=20'); if(!r.ok) return;
    const data=r.data.data||[]; if(!data.length){ sel.innerHTML='<option>No hay resultados</option>'; sel.style.display=''; return; }
    sel.innerHTML=data.map(c=> `<option value="${c.id}">${esc(c.nombre)} — ${esc(c.nit||'')}</option>`).join(''); sel.style.display=''; sel.size=Math.min(6,data.length+1);
    sel.onchange=()=> onOportunidadClienteSelect();
  },300);
}
function onOportunidadClienteSelect(){
  const sel=document.getElementById('oportunidad-cliente');
  const inp=document.getElementById('oportunidad-cliente-search');
  const opt=sel.options[sel.selectedIndex]; if(!opt || !opt.value || opt.textContent==='No hay resultados') return;
  inp.value=opt.textContent; inp.readOnly=true; inp.title='Seleccionado — clic para cambiar';
  inp.onclick=()=>{ inp.value=''; inp.readOnly=false; inp.placeholder='Buscar por NIT o nombre...'; sel.value=''; sel.innerHTML=''; sel.style.display='none'; document.getElementById('oportunidad-contacto').innerHTML='<option value=\"\">Sin contacto</option>'; inp.onclick=null; };
  sel.style.display='none';
  // limpiar lead si había
  const leadSel=document.getElementById('oportunidad-lead'); const leadInp=document.getElementById('oportunidad-lead-search');
  if(leadSel.value){ leadSel.value=''; leadSel.innerHTML=''; leadSel.style.display='none'; const ld=document.getElementById('oportunidad-lead-selected'); if(ld) ld.style.display='none'; if(leadInp){ leadInp.value=''; leadInp.readOnly=false; } toast('Cliente seleccionado — lead limpiado','info'); }
  cargarContactosOportunidad(null);
}
async function setupOportunidadLeadCombobox(selectedId){
  const sel=document.getElementById('oportunidad-lead');
  const inp=document.getElementById('oportunidad-lead-search');
  const disp=document.getElementById('oportunidad-lead-selected');
  if(!sel||!inp) return;
  sel.style.display='none'; sel.innerHTML=''; inp.value=''; inp.readOnly=false; inp.placeholder='Buscar lead por NIT o nombre...'; if(disp) disp.style.display='none';
  if(selectedId){
    try{ const r=await apiFetch('/leads?search=&limit=500'); if(r.ok){ const found=(r.data.data||[]).find(l=>String(l.id)===String(selectedId)); if(found){ sel.innerHTML=`<option value="${found.id}" selected>${esc(found.raison_social)} — ${esc(found.numero_identificacion||'')}</option>`; sel.value=found.id; inp.value=`${found.raison_social} — ${found.numero_identificacion||''}`; inp.readOnly=true; if(disp) disp.style.display='none'; inp.title='Seleccionado — clic para cambiar'; inp.onclick=()=>{ inp.value=''; inp.readOnly=false; sel.value=''; sel.innerHTML=''; if(disp) disp.style.display='none'; inp.onclick=null; }; } } }catch{}
  }
}
async function filtrarOportunidadLeads(q){
  const sel=document.getElementById('oportunidad-lead');
  const inp=document.getElementById('oportunidad-lead-search');
  if(inp && inp.readOnly) return;
  const qq=(q||'').trim(); if(!qq || qq.length<2){ sel.style.display='none'; sel.innerHTML=''; return; }
  clearTimeout(_oportunidadLeadTimer); _oportunidadLeadTimer=setTimeout(async()=>{
    const r=await apiFetch('/leads?search='+encodeURIComponent(qq)+'&limit=20'); if(!r.ok) return;
    const data=r.data.data||[]; if(!data.length){ sel.innerHTML='<option>No hay resultados</option>'; sel.style.display=''; return; }
    sel.innerHTML=data.map(l=> `<option value="${l.id}">${esc(l.raison_social)} — ${esc(l.numero_identificacion||'')}</option>`).join(''); sel.style.display=''; sel.size=Math.min(6,data.length+1);
    sel.onchange=()=> onOportunidadLeadSelect();
  },300);
}
function onOportunidadLeadSelect(){
  const sel=document.getElementById('oportunidad-lead');
  const inp=document.getElementById('oportunidad-lead-search');
  const opt=sel.options[sel.selectedIndex]; if(!opt || !opt.value) return;
  inp.value=opt.textContent; inp.readOnly=true; inp.title='Seleccionado — clic para cambiar';
  inp.onclick=()=>{ inp.value=''; inp.readOnly=false; inp.placeholder='Buscar lead por NIT o nombre...'; sel.value=''; sel.innerHTML=''; sel.style.display='none'; inp.onclick=null; };
  sel.style.display='none';
  const cliSel=document.getElementById('oportunidad-cliente'); const cliInp=document.getElementById('oportunidad-cliente-search');
  if(cliSel.value){ cliSel.value=''; cliSel.innerHTML=''; cliSel.style.display='none'; const cd=document.getElementById('oportunidad-cliente-selected'); if(cd) cd.style.display='none'; if(cliInp){ cliInp.value=''; cliInp.readOnly=false; cliInp.onclick=null; } document.getElementById('oportunidad-contacto').innerHTML='<option value=\"\">Sin contacto</option>'; toast('Lead seleccionado — cliente limpiado','info'); }
}
// Legacy stubs por compatibilidad
async function cargarLeadsSelectOportunidad(selectedId){ return setupOportunidadLeadCombobox(selectedId); }
function onClienteOportunidadChange(){ return onOportunidadClienteSelect(); }
function onLeadOportunidadChange(){ return onOportunidadLeadSelect(); }

async function editarOportunidad(id) {
  const r = await apiFetch('/oportunidades/' + id);
  if (!r.ok) return;
  abrirModalOportunidad(r.data.data);
}

async function eliminarOportunidad(id, nombre) {
  confirmar({ titulo: 'Eliminar oportunidad', mensaje: `Eliminar la oportunidad "${nombre}"?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/oportunidades/' + id, { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast('Oportunidad eliminada', 'success');
    cargarPipeline();
  }});
}

async function guardarOportunidad() {
  const id = document.getElementById('oportunidad-id').value;
  const cliSel=document.getElementById('oportunidad-cliente');
  const leadSel=document.getElementById('oportunidad-lead');
  // hidden selects may have value even when display none; search inputs are auxiliary
  const body = {
    nombre: document.getElementById('oportunidad-nombre').value,
    cliente_id: (cliSel && cliSel.value) ? cliSel.value : null,
    lead_id: (leadSel && leadSel.value) ? leadSel.value : null,
    contacto_id: document.getElementById('oportunidad-contacto').value || null,
    monto_esperado: parseFloat(document.getElementById('oportunidad-monto').value) || 0,
    probabilidad: parseInt(document.getElementById('oportunidad-probabilidad').value) || 0,
    etapa: document.getElementById('oportunidad-etapa').value,
    fecha_cierre_estimada: document.getElementById('oportunidad-fecha').value || null,
    vendedor_id: document.getElementById('oportunidad-vendedor').value || usuario?.id,
    motivo_perdida: document.getElementById('oportunidad-etapa').value === 'perdida' ? (document.getElementById('oportunidad-motivo-perdida').value || null) : null,
    fuente: document.getElementById('oportunidad-fuente').value || 'otro',
    prioridad: document.getElementById('oportunidad-prioridad').value || 'media'
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if (!body.cliente_id && !body.lead_id) return toast('Seleccione un cliente o un lead', 'error');
  const r = id
    ? await apiFetch('/oportunidades/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/oportunidades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  const savedId = id || r.data.data.id;
  // Sincronizar productos (maestro) si hay
  try {
    if (_oportunidadProductos.length) {
      for (const p of _oportunidadProductos) {
        const pid = p.producto_id || p.id;
        if (!pid) continue;
        await apiFetch('/oportunidades/' + savedId + '/productos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ producto_id: pid, cantidad: parseFloat(p.cantidad)||1, precio_unitario: parseFloat(p.precio_unitario)||0 }) });
      }
    }
    // Eliminar productos quitados (solo en edición)
    if (id) {
      const cur = await apiFetch('/oportunidades/' + savedId + '/productos');
      if (cur.ok) {
        const keep = new Set(_oportunidadProductos.map(x=> String(x.producto_id||x.codigo)));
        for (const cp of cur.data.data) {
          if (!keep.has(String(cp.producto_id)) && !keep.has(String(cp.codigo))) {
            await apiFetch('/oportunidades/' + savedId + '/productos/' + cp.producto_id, { method: 'DELETE' });
          }
        }
      }
    }
  } catch(e){ console.warn('sync productos oportunidad', e.message); }
  toast(id ? 'Oportunidad actualizada' : 'Oportunidad creada', 'success');
  hideModal('modal-oportunidad');
  cargarPipeline();
}

async function cargarContactosOportunidad(selectedId) {
  const clienteId = document.getElementById('oportunidad-cliente')?.value;
  const sel = document.getElementById('oportunidad-contacto');
  const searchEl = document.getElementById('oportunidad-contacto-search');
  if (searchEl) searchEl.value='';
  sel.innerHTML = '<option value="">Sin contacto</option>';
  if (!clienteId) return;
  const r = await apiFetch('/contactos?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  for (const c of r.data.data || []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre + (c.cargo ? ' — '+c.cargo : '');
    if (selectedId && String(c.id) === String(selectedId)) opt.selected = true;
    sel.appendChild(opt);
  }
}
function filtrarContactoOportunidad(q){
  const sel=document.getElementById('oportunidad-contacto');
  const qq=(q||'').toLowerCase();
  for(const opt of sel.options){
    if(!opt.value) { opt.style.display=''; continue; }
    const txt=(opt.textContent||'').toLowerCase();
    opt.style.display = txt.includes(qq) ? '' : 'none';
  }
}
async function cargarListasOportunidad(selected){
  const sel=document.getElementById('oportunidad-lista-precios');
  if(!sel) return;
  sel.innerHTML='<option value="">Cargando...</option>';
  try{
    const def = selected || await getPerfilListaDefault();
    const r=await apiFetch('/maestros?tipo=lista_precio&_='+Date.now());
    const data=r.ok ? (r.data.data||[]) : [];
    if(!data.length){ sel.innerHTML=`<option value="${esc(def)}" selected>${esc(def)} — GENERAL HORECA</option>`; return; }
    sel.innerHTML=data.map(it=> `<option value="${esc(it.codigo)}" ${String(it.codigo)===String(def)?'selected':''}>${esc(it.codigo)} — ${esc(it.nombre)}</option>`).join('');
    if(selected && !data.find(x=> String(x.codigo)===String(selected))){ sel.innerHTML+=`<option value="${esc(selected)}" selected>${esc(selected)} (actual)</option>`; }
    sel.value=def;
    if(selected) sel.value=selected;
  }catch{ sel.innerHTML='<option value="200" selected>200 — GENERAL HORECA</option>'; }
}

let _vendedorOportunidadTimer=null, _vendedoresOportunidadCache=[];
async function cargarVendedoresSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const esAdmin = ['admin','gerente'].includes(usuario?.rol);
  const isOport = selectId==='oportunidad-vendedor';
  const searchInp = isOport ? document.getElementById('oportunidad-vendedor-search') : null;
  const disp = isOport ? document.getElementById('oportunidad-vendedor-selected') : null;
  if (isOport) {
    sel.style.display='none'; sel.innerHTML='<option value="">Sin asignar</option>';
    if (searchInp) { searchInp.value=''; searchInp.disabled=false; searchInp.placeholder='Buscar vendedor por nombre o email...'; }
    if (disp) { disp.style.display='none'; disp.textContent=''; }
  } else {
    sel.innerHTML = '<option value="">Sin asignar</option>';
  }
  // Vendedor con perfil no-admin: solo sí mismo (combobox deshabilitado)
  if (!esAdmin) {
    if (usuario) {
      const opt = document.createElement('option');
      opt.value = usuario.id; opt.textContent = usuario.nombre;
      opt.selected = true; sel.appendChild(opt);
      sel.value = usuario.id;
      if (isOport) {
        if (disp) { disp.textContent='✓ '+opt.textContent+'  ✕'; disp.style.display=''; disp.title='Solo puedes asignarte a ti mismo'; disp.onclick=null; }
        if (searchInp) { searchInp.value=''; searchInp.disabled=true; searchInp.placeholder='Solo puedes asignarte a ti mismo'; }
        sel.style.display='none';
      } else sel.disabled = true;
    }
    // precargar seleccionado si es otro (edición admin previa)
    if (selectedId && String(selectedId)!==String(usuario?.id)) {
      try{ const r=await apiFetch('/perfiles-venta/usuarios-all'); if(r.ok){ const f=(r.data.data||r.data||[]).find(u=>String(u.id)===String(selectedId)); if(f){ const o=document.createElement('option'); o.value=f.id; o.textContent=f.nombre; o.selected=true; sel.appendChild(o); sel.value=f.id; if(isOport && disp){ disp.textContent='✓ '+o.textContent+'  ✕'; disp.style.display=''; } } } }catch{}
    }
    return;
  }
  // Admin/gerente: solo usuarios con perfil de ventas (asesores) — buscable
  try {
    let r = await apiFetch('/perfiles-venta/asesores');
    if(!r.ok) r = await apiFetch('/perfiles-venta/usuarios-all');
    if (r.ok) {
      const lista = r.data.data || r.data || [];
      _vendedoresOportunidadCache = lista;
      for (const u of lista) {
        const opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.nombre;
        sel.appendChild(opt);
      }
      if (selectedId) {
        const found = lista.find(u=> String(u.id)===String(selectedId));
        if (found) {
          sel.value = selectedId;
          if (isOport && disp) { disp.textContent='✓ '+found.nombre+'  ✕'; disp.style.display=''; disp.onclick=()=>{ sel.value=''; sel.innerHTML='<option value=\"\">Sin asignar</option>'; for(const u of _vendedoresOportunidadCache){ const o=document.createElement('option'); o.value=u.id; o.textContent=u.nombre; sel.appendChild(o);} disp.style.display='none'; if(searchInp) searchInp.value=''; }; }
        } else {
          const opt = document.createElement('option');
          opt.value = selectedId; opt.textContent = 'ID ' + selectedId; opt.selected = true; sel.appendChild(opt); sel.value=selectedId;
          if(isOport && disp){ disp.textContent='✓ ID '+selectedId+'  ✕'; disp.style.display=''; }
        }
      } else if (isOport) {
        // preselecciona al usuario actual si tiene perfil ventas, si no deja vacío
        const me = lista.find(u=> String(u.id)===String(usuario?.id));
        if (me) {
          sel.value = me.id;
          if (disp) { disp.textContent='✓ '+me.nombre+'  ✕'; disp.style.display=''; disp.onclick=()=>{ sel.value=''; disp.style.display='none'; if(searchInp) searchInp.value=''; }; }
        } else {
          sel.value = '';
        }
      }
      // para admin, el select queda oculto hasta que busque
      if (isOport && !selectedId) {
        // mantiene disp si preseleccionado, sino deja buscar
      }
    }
  } catch {}
}
function filtrarVendedorOportunidad(q){
  const sel=document.getElementById('oportunidad-vendedor');
  const inp=document.getElementById('oportunidad-vendedor-search');
  if (!sel || (inp && inp.readOnly)) return;
  const esAdmin=['admin','gerente'].includes(usuario?.rol);
  if (!esAdmin) return;
  const qq=(q||'').trim().toLowerCase();
  if (!qq || qq.length<1) { sel.style.display='none'; return; }
  clearTimeout(_vendedorOportunidadTimer);
  _vendedorOportunidadTimer=setTimeout(()=>{
    const filtered = _vendedoresOportunidadCache.filter(u=> u.nombre && u.nombre.toLowerCase().includes(qq));
    if (!filtered.length) { sel.innerHTML='<option>No hay resultados</option>'; sel.style.display=''; sel.size=3; return; }
    sel.innerHTML=filtered.map(u=> `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
    sel.style.display=''; sel.size=Math.min(6, filtered.length+1);
    sel.onchange=()=> onVendedorOportunidadSelect();
  },200);
}
function onVendedorOportunidadSelect(){
  const sel=document.getElementById('oportunidad-vendedor');
  const disp=document.getElementById('oportunidad-vendedor-selected');
  const inp=document.getElementById('oportunidad-vendedor-search');
  const opt=sel.options[sel.selectedIndex]; if(!opt || !opt.value || opt.textContent==='No hay resultados') return;
  if(disp){ disp.textContent='✓ '+opt.textContent+'  ✕'; disp.style.display=''; disp.title='Click para quitar';
    disp.onclick=()=>{ sel.value=''; sel.innerHTML='<option value=\"\">Sin asignar</option>'; for(const u of _vendedoresOportunidadCache){ const o=document.createElement('option'); o.value=u.id; o.textContent=u.nombre+(u.email?' ('+u.email+')':''); sel.appendChild(o);} disp.style.display='none'; if(inp) inp.value=''; };
  }
  sel.style.display='none'; if(inp) inp.value='';
}

function formatMoney(n) {
  return Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
// Montos compactos para encabezados Kanban (ej. $152,3 M) con valor completo en title
function formatMoneyShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 100000000) {
    const m = (v / 1000000).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    return `$${m} M`;
  }
  return '$' + formatMoney(v);
}

// Lee un campo del extra_data (JSONB del maestro ERP) y lo muestra legible, saltando vacíos
function erpExtra(key, label, e) {
  const v = (e.extra_data && e.extra_data[key]) || e[key];
  if (v === null || v === undefined || v === '') return '';
  return `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">${esc(label)}</div><div>${esc(String(v))}</div></div>`;
}

// Etiqueta legible para el tipo de cliente (badge)
function tipoClienteLabel(t) {
  if (t === 'real') return 'Cliente ERP';
  if (t === 'siesa') return 'SIESA';
  return t || '—';
}
async function cargarClientes() {
  const search = document.getElementById('filtro-cliente-search')?.value || '';
  const tipo = document.getElementById('filtro-cliente-tipo')?.value || '';
  const canal = document.getElementById('filtro-cliente-canal')?.value || '';
  const ciudad = document.getElementById('filtro-cliente-ciudad')?.value || '';
  const colNombre = document.getElementById('filtro-col-nombre')?.value || '';
  const colNit = document.getElementById('filtro-col-nit')?.value || '';
  const colCiudad = document.getElementById('filtro-col-ciudad')?.value || '';
  const params = new URLSearchParams({ page: _clientesPage, limit: clientesLimit });
  if (search) params.set('search', search);
  if (tipo) params.set('tipo', tipo);
  if (canal) params.set('canal', canal);
  if (ciudad) params.set('ciudad', ciudad);
  if (colNombre) params.set('col_nombre', colNombre);
  if (colNit) params.set('col_nit', colNit);
  if (colCiudad) params.set('col_ciudad', colCiudad);
  const r = await apiFetch('/clientes?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-clientes');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(e => {
      const esSiesa = e.origen === 'siesa';
      const editable = !esSiesa || (usuario?.rol === 'admin' || usuario?.rol === 'gerente');
      return `
      <tr>
        <td><input type="checkbox" class="row-check cb-cliente" value="${e.id}" onchange="updateBulkBar()"></td>
        <td><a href="#" onclick="verCliente('${e.id}');return false" style="color:var(--accent)">${esc(e.nombre)}</a>${esSiesa ? ' <span class="badge badge-muted" title="Gestionado en el ERP SIESA">🔒 ERP</span>' : ''}</td>
        <td>${esc(e.nit || '—')}</td>
<td><span class="badge badge-${esc(e.tipo)}">${tipoClienteLabel(e.tipo)}</span></td>
        <td>${esc(e.canal || '—')}</td>
        <td>${esc(e.ciudad || '—')}</td>
        <td>${e.total_contactos || 0}</td>
        <td>${formatDate(e.creado_en)}</td>
        <td>
          ${editable ? `<button class="btn btn-sm btn-secondary" onclick="editarCliente('${e.id}')" title="Editar cliente" aria-label="Editar cliente ${esc(e.nombre)}">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarCliente('${e.id}')" title="Eliminar cliente" aria-label="Eliminar cliente ${esc(e.nombre)}">🗑️</button>` : '<span style="color:var(--muted);font-size:11px" title="Cliente gestionado en el ERP">Solo lectura</span>'}
        </td>
      </tr>
    `;}).join('');
  renderPagination('pag-clientes', r.data.total, _clientesPage, clientesLimit, (p) => { _clientesPage = p; cargarClientes(); });
  // Cargar ciudades para filtro
  const ciudades = [...new Set(data.map(e => e.ciudad).filter(Boolean))];
  const sel = document.getElementById('filtro-cliente-ciudad');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todas las ciudades</option>' + ciudades.map(c => `<option value="${esc(c)}" ${c === actual ? 'selected' : ''}>${esc(c)}</option>`).join('');
  cargarStatsClientes();
}

async function cargarStatsClientes() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-cliente-search')?.value;
    const tipo = document.getElementById('filtro-cliente-tipo')?.value;
    const canal = document.getElementById('filtro-cliente-canal')?.value;
    const ciudad = document.getElementById('filtro-cliente-ciudad')?.value;
    const colNombre = document.getElementById('filtro-col-nombre')?.value;
    const colNit = document.getElementById('filtro-col-nit')?.value;
    const colCiudad = document.getElementById('filtro-col-ciudad')?.value;
    if (search) params.set('search', search);
    if (tipo) params.set('tipo', tipo);
    if (canal) params.set('canal', canal);
    if (ciudad) params.set('ciudad', ciudad);
    if (colNombre) params.set('col_nombre', colNombre);
    if (colNit) params.set('col_nit', colNit);
    if (colCiudad) params.set('col_ciudad', colCiudad);

    const r = await apiFetch('/clientes/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    const topTipo = (d.por_tipo || []).slice(0, 2).map(t => `${esc(t.tipo || 'Sin tipo')}: ${t.total}`).join(' · ') || '—';
    const topCiudad = (d.por_ciudad || []).slice(0, 2).map(c => `${esc(c.ciudad)}: ${c.total}`).join(' · ') || '—';
    document.getElementById('stats-clientes').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Clientes</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px;line-height:1.3">${topTipo}</div><div class="stat-label">Por tipo</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px;line-height:1.3">${topCiudad}</div><div class="stat-label">Top ciudades</div></div>
      <div class="stat-card"><div class="stat-value">${d.recientes?.length || 0}</div><div class="stat-label">Recientes</div></div>
    `;
  } catch {}
}

function limpiarFiltrosClientes() {
  document.getElementById('filtro-cliente-search').value = '';
  document.getElementById('filtro-cliente-tipo').value = '';
  document.getElementById('filtro-cliente-ciudad').value = '';
  document.getElementById('filtro-cliente-canal').value = '';
  document.getElementById('filtro-col-nombre').value = '';
  document.getElementById('filtro-col-nit').value = '';
  document.getElementById('filtro-col-ciudad').value = '';
  clientesLimit = 20;
  document.getElementById('filtro-cliente-limit').value = '20';
  _clientesPage = 1;
  cargarClientes();
}

async function verCliente(id) {
  const r = await apiFetch('/clientes/' + id);
  if (!r.ok) return;
  const e = r.data.data;

  // Fetch sucursales, facturas and cotizaciones
  const [sucR, facR, cotR] = await Promise.all([
    apiFetch('/clientes/' + id + '/sucursales'),
    apiFetch('/clientes/' + id + '/facturas'),
    apiFetch('/cotizaciones?cliente_id=' + id + '&limit=50')
  ]);
  const sucursales = sucR.ok ? (sucR.data.data || []) : [];
  const facturas = facR.ok ? (facR.data.data || []) : [];
  const cotizaciones = cotR.ok ? (cotR.data.data || []) : [];

  document.getElementById('detalle-cliente-title').textContent = e.nombre;
  const esSiesaCliente = e.origen === 'siesa';
  const editableSuc = !esSiesaCliente || (usuario?.rol === 'admin' || usuario?.rol === 'gerente');
  document.getElementById('detalle-cliente-title').innerHTML = `${esc(e.nombre)}${esSiesaCliente ? ' <span class="badge badge-muted" title="Gestionado en el ERP SIESA">🔒 ERP</span>' : ''}`;
  document.getElementById('detalle-cliente-content').innerHTML = `
    <div style="display:flex;gap:12px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap">
      <button class="tab-btn active" onclick="cambiarTabCliente('datos',this)">Datos Basicos</button>
      <button class="tab-btn" onclick="cambiarTabCliente('erp',this)">Datos ERP</button>
      <button class="tab-btn" onclick="cambiarTabCliente('sucursales',this)">Sucursales (${sucursales.length})</button>
      <button class="tab-btn" onclick="cambiarTabCliente('contactos',this)">Contactos (${(e.contactos || []).length})</button>
      <button class="tab-btn" onclick="cambiarTabCliente('cotizaciones',this)">Cotizaciones (${cotizaciones.length})</button>
      <button class="tab-btn" onclick="cambiarTabCliente('facturas',this)">Facturas (${facturas.length})</button>
    </div>

    <div id="tab-cliente-datos">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Razon Social</div><div>${esc(e.nombre)}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Numero de Identificacion</div><div>${esc(e.nit || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Correo Electronico</div><div>${esc(e.email || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Asesor Comercial</div><div>${esc(e.asesor_comercial || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Canal</div><div>${esc(e.canal || '—')}</div></div>
        </div>
        <div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Nombre Establecimiento</div><div>${esc(e.razon_social || e.nombre)}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Telefono</div><div>${esc(e.telefono || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Pagina Web</div><div>${esc(e.website || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Tipo Negocio</div><div>${esc(e.tipo_negocio || '—')}</div></div>
          <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Tipo Cliente</div><div>${tipoClienteLabel(e.tipo)}</div></div>
        </div>
      </div>
      ${e.direccion ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Direccion</div><div>${esc(e.direccion)}</div></div>` : ''}
    </div>

    <div id="tab-cliente-erp" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Código / NIT</div><div>${esc(e.nit || e.codigo_siesa || '—')} ${e.sucursal ? `<small style="color:var(--muted)">· Sucursal ${esc(e.sucursal)}</small>` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Tipo tercero / Región</div><div>${tipoClienteLabel(e.tipo)} ${e.sector ? `· ${esc(e.sector)}` : ''} ${e.region ? `· ${esc(e.region)}` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Lista de precio</div><div>${esc(e.lista_precio_codigo || '—')} ${e.lista_precios ? `<span style="color:var(--muted)">— ${esc(e.lista_precios)}</span>` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Vendedor / Cobrador</div><div>${esc(e.vendedor_codigo || e.vendedor_asignado || '—')} ${e.cobrador ? `· Cobrador ${esc(e.cobrador)}` : ''} ${e.asesor_comercial ? `· Asesor ${esc(e.asesor_comercial)}` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Medio de pago</div><div>${esc(e.medio_pago || '—')} ${e.medio_pago_desc ? `<span style="color:var(--muted)">— ${esc(e.medio_pago_desc)}</span>` : ''} ${e.iva ? `· IVA: ${esc(e.iva)}` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Frecuencia / Fecha ingreso</div><div>${esc(e.frecuencia_entrega || '—')} ${e.fecha_ingreso ? `· ${formatDate(e.fecha_ingreso)}` : ''}</div></div>
          ${erpExtra('nombre_establecimiento','Nombre establecimiento', e)}
          ${erpExtra('contacto','Contacto', e)}
          ${erpExtra('razon_social_vendedor','Razón social vendedor', e)}
        </div>
        <div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Celular / Teléfono</div><div>${esc(e.celular || e.telefono || '—')}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Punto envío / C.O. factura</div><div>${esc(e.punto_envio_desc || '—')} ${e.c_o_factura_desc ? `<span style="color:var(--muted)">· ${esc(e.c_o_factura_desc)}</span>` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Cartera / Antigüedad</div><div>${esc(e.cartera_pendiente || '—')} ${e.antiguedad ? `· ${esc(e.antiguedad)}` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Motivo bloqueo</div><div>${esc(e.motivo_bloqueo_desc || '—')}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Rutas</div><div>${esc(e.ruta_vehiculos || '—')} ${e.ruta_motos ? `· Motos: ${esc(e.ruta_motos)}` : ''}</div></div>
          <div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Sucursal corporativa</div><div>${esc(e.sucursal_corporativa || '—')}</div></div>
          ${erpExtra('codigo_ean','Código EAN', e)}
          ${erpExtra('correo_f_e','Correo F.E.', e)}
          ${erpExtra('estado','Estado', e)}
        </div>
      </div>
    </div>

    <div id="tab-cliente-sucursales" style="display:none">
      ${sucursales.length ? `
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input type="text" id="filtro-sucursal-search" placeholder="Buscar sucursal por codigo, nombre, ciudad o telefono..." style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px" oninput="filtrarSucursales()">
          <span id="sucursal-count" style="font-size:12px;color:var(--muted);align-self:center">${sucursales.length} sucursales</span>
        </div>
        <div class="tbl-wrap tbl-scrollable"><table class="tbl" id="tbl-sucursales-cliente"><thead><tr><th>Codigo</th><th>Nombre</th><th>Direccion</th><th>Ciudad</th><th>Telefono</th><th>EAN</th><th>Principal</th><th></th></tr></thead><tbody>
        ${sucursales.map(s => `<tr style="cursor:pointer" onclick="verSucursal('${s.id}')" data-search="${esc(String(s.codigo||'')+' '+String(s.nombre||'')+' '+String(s.ciudad||'')+' '+String(s.telefono||'')).toLowerCase()}">
          <td><strong>${esc(s.codigo || '—')}</strong></td>
          <td>${esc(s.nombre)}</td>
          <td>${esc(s.direccion || '—')}</td>
          <td>${esc(s.ciudad || '—')}</td>
          <td>${esc(s.telefono || '—')}</td>
          <td>${esc(s.codigo_ean || '—')}</td>
          <td>${s.es_principal ? '<span class="badge badge-aprobada">Principal</span>' : ''}</td>
          <td onclick="event.stopPropagation()">
            ${editableSuc ? `<button class="btn btn-sm btn-secondary btn-action" onclick="editarSucursal('${s.id}','${id}')" title="Editar sucursal" aria-label="Editar sucursal ${esc(s.nombre)}">✏️</button>
            <button class="btn btn-sm btn-danger btn-action" onclick="eliminarSucursal('${s.id}','${id}')" title="Eliminar sucursal" aria-label="Eliminar sucursal ${esc(s.nombre)}">🗑️</button>` : '<span style="color:var(--muted);font-size:11px">Solo lectura</span>'}
          </td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin sucursales</p>'}
      ${editableSuc ? `<button class="btn btn-sm btn-primary" onclick="abrirModalSucursal('${id}')" style="margin-top:8px">+ Nueva Sucursal</button>` : ''}
    </div>

    <div id="tab-cliente-contactos" style="display:none">
      ${(e.contactos || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Cargo</th><th>Email</th><th>Telefono</th></tr></thead><tbody>
        ${e.contactos.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.cargo || '—')}</td><td>${esc(c.email || '—')}</td><td>${esc(c.telefono || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin contactos</p>'}
    </div>

    <div id="tab-cliente-facturas" style="display:none">
      ${facturas.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Numero</th><th>Estado</th><th>Fecha</th><th>Vencimiento</th><th>Valor Total</th></tr></thead><tbody>
        ${facturas.map(f => `<tr>
          <td><strong>${esc(f.numero)}</strong></td>
          <td><span class="badge badge-${f.estado === 'Aprobadas' ? 'aprobada' : 'info'}">${esc(f.estado || '—')}</span></td>
          <td>${formatDate(f.fecha)}</td>
          <td>${formatDate(f.fecha_vencimiento)}</td>
          <td><strong>$${formatMoney(f.valor_total || 0)}</strong></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin facturas registradas. Se sincronizarán cuando tengamos la API del ERP.</p>'}
    </div>

    <div id="tab-cliente-cotizaciones" style="display:none">
      ${cotizaciones.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Numero</th><th>Estado</th><th>Estado ERP</th><th>Total</th><th>Vencimiento</th></tr></thead><tbody>
        ${cotizaciones.map(c => `<tr style="cursor:pointer" onclick="hideModal('modal-detalle-cliente');verCotizacion('${c.id}')">
          <td><a href="#" style="color:var(--accent)">${esc(c.numero)}</a></td>
          <td><span class="badge badge-${c.estado}">${esc(c.estado)}</span></td>
          <td>${esc(c.estado_erp || '—')}</td>
          <td><strong>$${formatMoney(c.valor_total || 0)}</strong></td>
          <td>${formatDate(c.vencimiento)}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin cotizaciones para este cliente.</p>'}
    </div>
  `;
  showModal('modal-detalle-cliente');
}

function cambiarTabCliente(tab, btn) {
  document.querySelectorAll('#modal-detalle-cliente [id^="tab-cliente-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#modal-detalle-cliente .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-cliente-' + tab).style.display = '';
  btn.classList.add('active');
}

// ── Sucursales ──
function filtrarSucursales() {
  const q = (document.getElementById('filtro-sucursal-search')?.value || '').toLowerCase().trim();
  const tbody = document.querySelector('#tbl-sucursales-cliente tbody');
  if (!tbody) return;
  let visible = 0;
  tbody.querySelectorAll('tr').forEach(tr => {
    const show = !q || (tr.dataset.search || '').includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const count = document.getElementById('sucursal-count');
  if (count) count.textContent = `${visible} / ${tbody.querySelectorAll('tr').length} sucursales`;
}

async function verSucursal(id) {
  const r = await apiFetch('/sucursales/' + id);
  if (!r.ok) return toast(r.data?.error || 'Error al cargar sucursal', 'error');
  const s = r.data.data;
  document.getElementById('detalle-sucursal-title').textContent = `Sucursal ${s.codigo || ''}`.trim();
  document.getElementById('detalle-sucursal-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Codigo</div><div><strong>${esc(s.codigo || '—')}</strong></div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Nombre</div><div>${esc(s.nombre || '—')}</div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Código EAN</div><div>${esc(s.codigo_ean || '—')}</div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Direccion</div><div>${esc(s.direccion || '—')}</div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Ciudad / Departamento</div><div>${esc(s.ciudad || '—')} ${s.departamento ? `· ${esc(s.departamento)}` : ''}</div></div>
      </div>
      <div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Telefono</div><div>${esc(s.telefono || '—')}</div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Email</div><div>${esc(s.email || '—')}</div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Contacto</div><div>${esc(s.contacto_nombre || '—')}</div></div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Principal</div><div>${s.es_principal ? '<span class="badge badge-aprobada">Principal</span>' : 'No'}</div></div>
      </div>
    </div>
  `;
  showModal('modal-detalle-sucursal');
}

function abrirModalSucursal(clienteId, sucursal = null) {
  document.getElementById('modal-sucursal-title').textContent = sucursal ? 'Editar Sucursal' : 'Nueva Sucursal';
  document.getElementById('sucursal-id').value = sucursal?.id || '';
  document.getElementById('sucursal-cliente-id').value = clienteId;
  document.getElementById('sucursal-codigo').value = sucursal?.codigo || '';
  document.getElementById('sucursal-nombre').value = sucursal?.nombre || '';
  document.getElementById('sucursal-direccion').value = sucursal?.direccion || '';
  document.getElementById('sucursal-ciudad').value = sucursal?.ciudad || '';
  document.getElementById('sucursal-departamento').value = sucursal?.departamento || '';
  document.getElementById('sucursal-telefono').value = sucursal?.telefono || '';
  document.getElementById('sucursal-email').value = sucursal?.email || '';
  document.getElementById('sucursal-contacto').value = sucursal?.contacto_nombre || '';
  document.getElementById('sucursal-principal').checked = sucursal?.es_principal || false;
  showModal('modal-sucursal');
}

async function editarSucursal(sucursalId, clienteId) {
  const r = await apiFetch('/sucursales/' + sucursalId);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalSucursal(clienteId, r.data.data);
}

async function guardarSucursal() {
  const id = document.getElementById('sucursal-id').value;
  const clienteId = document.getElementById('sucursal-cliente-id').value;
  const body = {
    codigo: document.getElementById('sucursal-codigo').value,
    nombre: document.getElementById('sucursal-nombre').value,
    direccion: document.getElementById('sucursal-direccion').value,
    ciudad: document.getElementById('sucursal-ciudad').value,
    departamento: document.getElementById('sucursal-departamento').value,
    telefono: document.getElementById('sucursal-telefono').value,
    email: document.getElementById('sucursal-email').value,
    contacto_nombre: document.getElementById('sucursal-contacto').value,
    es_principal: document.getElementById('sucursal-principal').checked
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');

  const url = id ? '/sucursales/' + id : '/clientes/' + clienteId + '/sucursales';
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Sucursal actualizada' : 'Sucursal creada', 'success');
  hideModal('modal-sucursal');
  verCliente(clienteId);
}

async function eliminarSucursal(sucursalId, clienteId) {
  confirmar({ titulo: 'Eliminar sucursal', mensaje: 'Eliminar esta sucursal?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/sucursales/' + sucursalId, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Sucursal eliminada', 'success');
    verCliente(clienteId);
  }});
}

function abrirModalCliente(cliente = null) {
  document.getElementById('modal-cliente-title').textContent = cliente ? 'Editar Cliente' : 'Nueva Cliente';
  document.getElementById('cliente-id').value = cliente?.id || '';
  document.getElementById('cliente-nombre').value = cliente?.nombre || '';
  document.getElementById('cliente-nit').value = cliente?.nit || '';
  document.getElementById('cliente-tipo').value = cliente?.tipo || 'potencial';
  document.getElementById('cliente-sector').value = cliente?.sector || '';
  document.getElementById('cliente-direccion').value = cliente?.direccion || '';
  document.getElementById('cliente-ciudad').value = cliente?.ciudad || '';
  document.getElementById('cliente-telefono').value = cliente?.telefono || '';
  document.getElementById('cliente-email').value = cliente?.email || '';
  document.getElementById('cliente-website').value = cliente?.website || '';
  document.getElementById('cliente-notas').value = cliente?.notas || '';
  showModal('modal-cliente');
}

async function editarCliente(id) {
  const r = await apiFetch('/clientes/' + id);
  if (!r.ok) return;
  abrirModalCliente(r.data.data);
}

async function guardarCliente() {
  const id = document.getElementById('cliente-id').value;
  const body = {
    nombre: document.getElementById('cliente-nombre').value,
    nit: document.getElementById('cliente-nit').value || null,
    tipo: document.getElementById('cliente-tipo').value,
    sector: document.getElementById('cliente-sector').value || null,
    direccion: document.getElementById('cliente-direccion').value || null,
    ciudad: document.getElementById('cliente-ciudad').value || null,
    telefono: document.getElementById('cliente-telefono').value || null,
    email: document.getElementById('cliente-email').value || null,
    website: document.getElementById('cliente-website').value || null,
    notas: document.getElementById('cliente-notas').value || null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  const r = id
    ? await apiFetch('/clientes/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Cliente actualizada' : 'Cliente creada', 'success');
  hideModal('modal-cliente');
  cargarClientes();
}

async function eliminarCliente(id) {
  confirmar({ titulo: 'Eliminar', mensaje: '¿Eliminar esta cliente?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/clientes/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Cliente eliminada', 'success');
    cargarClientes();
  }});
}

function bulkDeleteCurrent() {
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  const mode = document.getElementById('bulk-select-mode').value;
  const funcs = { clientes: bulkDeleteClientes, contactos: bulkDeleteContactos, cotizaciones: bulkDeleteCotizaciones, productos: bulkDeleteProductos };

  if (mode === 'all') {
    if (funcs[activePage]) funcs[activePage]();
    else toast('Bulk delete no disponible para esta página', 'error');
    return;
  }

  const checked = document.querySelectorAll('.row-check:checked').length;
  if (!checked) return toast('Selecciona registros o cambia a "Todos los registros"', 'error');

  if (funcs[activePage]) funcs[activePage]();
  else toast('Bulk delete no disponible para esta página', 'error');
}

// Show bulk bar when "all" mode is selected
document.getElementById('bulk-select-mode')?.addEventListener('change', function() {
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (this.value === 'all') {
    bar?.classList.add('visible');
    if (countEl) countEl.textContent = 'Todos';
  } else {
    updateBulkBar();
  }
});

async function bulkDeleteClientes() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];

  if (mode === 'all') {
    // Fetch ALL client IDs
    const r = await apiFetch('/clientes?limit=10000');
    if (!r.ok) return toast('Error al obtener clientes', 'error');
    ids = (r.data.data || []).map(c => c.id);
  } else {
    ids = [...document.querySelectorAll('.cb-cliente:checked')].map(cb => cb.value);
  }

  if (!ids.length) return toast('No hay clientes para eliminar', 'error');

  confirmar({ titulo: 'Eliminar clientes', mensaje: `¿Eliminar ${ids.length} cliente(s)?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/clientes/seleccionados', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminadas} clientes eliminados`, 'success');
    clearSelection();
    cargarClientes();
  }});
}

async function eliminarTodosClientes() {
  confirmar({ titulo: '⚠️ ELIMINAR TODOS', mensaje: '¿Estás seguro? Esto desactivará TODOS los clientes. Solo para testing.', icono: '⚠️', onConfirm: async () => {
    const r = await apiFetch('/clientes/todos', { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} clientes eliminados`, 'success');
    cargarClientes();
  }});
}

// ── Leads ──
let _leadsPage = 1;

async function cargarLeads() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-lead-search')?.value;
    const estado = document.getElementById('filtro-lead-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);
    params.set('page', _leadsPage);
    params.set('limit', _limit);

    const r = await apiFetch('/leads?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-leads');
    const data = r.data.data || [];
    const estadoColors = { nuevo: 'info', contactado: 'warning', calificado: 'potencial', enviado_erp: 'siesa', convertido: 'aprobada', perdido: 'rechazada' };

    tbody.innerHTML = data.map(l => `
      <tr>
        <td><input type="checkbox" class="row-check cb-lead" value="${l.id}" onchange="event.stopPropagation();updateBulkBar()"></td>
        <td><a href="#" onclick="verLead('${l.id}');return false" style="color:var(--accent)">${esc(l.raison_social)}</a></td>
        <td>${esc(l.numero_identificacion || '—')}</td>
        <td>${esc(l.ciudad || '—')}</td>
        <td><span class="badge badge-${estadoColors[l.estado] || 'info'}">${esc(l.estado)}</span>${l.estado === 'convertido' && l.cliente_id ? ` <a href="#" onclick="verCliente('${l.cliente_id}');return false" title="Ver cliente convertido" style="font-size:11px;color:var(--accent);text-decoration:underline">✓ ${esc(l.cliente_nombre || 'ver cliente')}</a>` : ''}</td>
        <td>${esc(l.asesor_comercial || '—')}</td>
        <td>${esc(l.telefono || '—')}</td>
        <td>${esc(l.email || '—')}</td>
        <td>${formatDate(l.creado_en)}</td>
        <td>
          <div class="tbl-actions">
            <button class="btn btn-sm btn-secondary btn-action" onclick="editarLead('${l.id}')" title="Editar lead" aria-label="Editar lead ${esc(l.raison_social)}">✏️</button>
            ${l.estado !== 'convertido' ? `<button class="btn btn-sm btn-primary btn-action" onclick="crearOportunidadDesdeLead('${l.id}','${esc(l.raison_social).replace(/'/g,"\\'")}')" title="Crear oportunidad" aria-label="Crear oportunidad desde ${esc(l.raison_social)}">💼</button>` : ''}
            ${l.estado !== 'convertido' && l.estado !== 'enviado_erp' ? `<button class="btn btn-sm btn-primary btn-action" onclick="enviarLeadERP('${l.id}','${esc(l.raison_social)}')" title="Enviar al ERP (crea prospecto)" aria-label="Enviar lead ${esc(l.raison_social)} al ERP">🚀</button>` : ''}
            ${l.estado === 'enviado_erp' ? `<button class="btn btn-sm btn-success btn-action" onclick="activarLead('${l.id}','${esc(l.raison_social)}')" title="Contabilidad: Activar cliente" aria-label="Activar cliente ${esc(l.raison_social)}">✅</button>` : ''}
            ${l.estado !== 'convertido' ? `<button class="btn btn-sm btn-danger btn-action" onclick="eliminarLead('${l.id}')" title="Eliminar lead" aria-label="Eliminar lead ${esc(l.raison_social)}">🗑️</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');

    renderPagination('pag-leads', r.data.total, _leadsPage, _limit, (p) => { _leadsPage = p; cargarLeads(); });
    cargarStatsLeads();
  } catch (err) { console.error('Error cargar leads:', err); }
}

async function cargarStatsLeads() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-lead-search')?.value;
    const estado = document.getElementById('filtro-lead-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);

    const r = await apiFetch('/leads/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-leads').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value">${d.convertidos || 0}</div><div class="stat-label">Convertidos</div></div>
      <div class="stat-card"><div class="stat-value">${(d.por_estado || []).find(e => e.estado === 'nuevo')?.total || 0}</div><div class="stat-label">Nuevos</div></div>
      <div class="stat-card"><div class="stat-value">${(d.por_estado || []).find(e => e.estado === 'enviado_erp')?.total || 0}</div><div class="stat-label">Enviados ERP</div></div>
    `;
  } catch {}
}

function limpiarFiltrosLeads() {
  document.getElementById('filtro-lead-search').value = '';
  document.getElementById('filtro-lead-estado').value = '';
  _leadsPage = 1;
  cargarLeads();
}

function calcularDV(nit){
  const clean = String(nit||'').replace(/\D/g,'');
  if(!clean) return '';
  let sum=0;
  const len=clean.length;
  const pesos=[3,7,13,17,19,23,29,37,41,43,47,53,59,67,71];
  for(let i=0;i<len;i++){
    const dig = parseInt(clean[len-1-i],10);
    sum += dig * pesos[i % pesos.length];
  }
  const mod = sum % 11;
  return String(mod > 1 ? 11 - mod : mod);
}
let _daneDeptos=[], _daneCiudades=[];
(async()=>{
  try{
    const r=await fetch('./data/colombia.json'); if(!r.ok) throw new Error();
    const j=await r.json();
    _daneDeptos=j.departamentos.map(d=>({codigo:d.codigo_dane, nombre:d.nombre.toUpperCase()}));
    _daneCiudades=[];
    for(const dep of j.departamentos){
      for(const m of dep.municipios) _daneCiudades.push({codigo:m.codigo_dane, nombre:m.nombre.toUpperCase(), depto:dep.codigo_dane});
    }
  }catch{
    _daneDeptos=[
      {codigo:'05',nombre:'ANTIOQUIA'},{codigo:'08',nombre:'ATLANTICO'},{codigo:'11',nombre:'BOGOTA D.C.'},{codigo:'13',nombre:'BOLIVAR'},{codigo:'15',nombre:'BOYACA'},{codigo:'17',nombre:'CALDAS'},{codigo:'18',nombre:'CAQUETA'},{codigo:'19',nombre:'CAUCA'},{codigo:'20',nombre:'CESAR'},{codigo:'23',nombre:'CORDOBA'},{codigo:'25',nombre:'CUNDINAMARCA'},{codigo:'27',nombre:'CHOCO'},{codigo:'41',nombre:'HUILA'},{codigo:'44',nombre:'LA GUAJIRA'},{codigo:'47',nombre:'MAGDALENA'},{codigo:'50',nombre:'META'},{codigo:'52',nombre:'NARINO'},{codigo:'54',nombre:'NORTE DE SANTANDER'},{codigo:'63',nombre:'QUINDIO'},{codigo:'66',nombre:'RISARALDA'},{codigo:'68',nombre:'SANTANDER'},{codigo:'70',nombre:'SUCRE'},{codigo:'73',nombre:'TOLIMA'},{codigo:'76',nombre:'VALLE DEL CAUCA'},{codigo:'81',nombre:'ARAUCA'},{codigo:'85',nombre:'CASANARE'},{codigo:'86',nombre:'PUTUMAYO'},{codigo:'88',nombre:'SAN ANDRES'},{codigo:'91',nombre:'AMAZONAS'},{codigo:'94',nombre:'GUAINIA'},{codigo:'95',nombre:'GUAVIARE'},{codigo:'97',nombre:'VAUPES'},{codigo:'99',nombre:'VICHADA'}
    ];
    _daneCiudades=[
      {codigo:'11001',nombre:'BOGOTA D.C.',depto:'11'},{codigo:'05001',nombre:'MEDELLIN',depto:'05'},{codigo:'76001',nombre:'CALI',depto:'76'},{codigo:'08001',nombre:'BARRANQUILLA',depto:'08'},{codigo:'13001',nombre:'CARTAGENA',depto:'13'},{codigo:'68001',nombre:'BUCARAMANGA',depto:'68'},{codigo:'05360',nombre:'ITAGUI',depto:'05'},{codigo:'05266',nombre:'ENVIGADO',depto:'05'},{codigo:'66001',nombre:'PEREIRA',depto:'66'},{codigo:'73001',nombre:'IBAGUE',depto:'73'},{codigo:'47001',nombre:'SANTA MARTA',depto:'47'},{codigo:'50001',nombre:'VILLAVICENCIO',depto:'50'},{codigo:'54001',nombre:'CUCUTA',depto:'54'},{codigo:'63001',nombre:'ARMENIA',depto:'63'},{codigo:'70001',nombre:'SINCELEJO',depto:'70'},{codigo:'23001',nombre:'MONTERIA',depto:'23'},{codigo:'44001',nombre:'RIOHACHA',depto:'44'},{codigo:'41001',nombre:'NEIVA',depto:'41'},{codigo:'52001',nombre:'PASTO',depto:'52'},{codigo:'81001',nombre:'ARAUCA',depto:'81'}
    ];
  }
})();
let _leadProductos=[], _leadProdTimer=null;
async function abrirModalLead(lead = null) {
  document.getElementById('modal-lead-title').textContent = lead ? 'Editar Lead' : 'Nuevo Lead';
  document.getElementById('lead-id').value = lead?.id || '';
  document.getElementById('lead-razon-social').value = lead?.raison_social || '';
  document.getElementById('lead-nit').value = lead?.numero_identificacion || '';
  document.getElementById('lead-nombre-est').value = lead?.nombre_establecimiento || '';
  // Estado se maneja via oportunidades (pipeline), no editable aquí
  document.getElementById('lead-ciudad').value = lead?.ciudad || '';
  document.getElementById('lead-departamento').value = lead?.departamento || '';
  document.getElementById('lead-direccion').value = lead?.direccion || '';
  document.getElementById('lead-telefono').value = lead?.telefono || '';
  document.getElementById('lead-email').value = lead?.email || '';
  document.getElementById('lead-asesor').value = lead?.asesor_comercial || usuario?.nombre || '';
  document.getElementById('lead-canal').value = lead?.canal || 'otro';
  document.getElementById('lead-tipo-negocio').value = lead?.tipo_negocio || '';
  await cargarListasLead(lead?.lista_precios);
  document.getElementById('lead-notas').value = lead?.notas || '';
  document.getElementById('lead-siesa-tipo').value = lead?.siesa_tipo_identificacion || '31';
  document.getElementById('lead-siesa-dv').value = lead?.siesa_dv || '';
  document.getElementById('lead-siesa-regimen').value = lead?.siesa_regimen || '48';
  document.getElementById('lead-siesa-resp').value = lead?.siesa_responsabilidad_fiscal || 'R-99-PN';
  document.getElementById('lead-siesa-ciiu').value = lead?.siesa_ciiu || '4723';
  // Normalización DIAN: CC no lleva DV, NIT sí; NIT sin espacios, DV sin guiones y autocalculado
  const dvEl = document.getElementById('lead-siesa-dv');
  const tipoEl = document.getElementById('lead-siesa-tipo');
  const nitEl = document.getElementById('lead-nit');
  function toggleDvLead(){
    const esNit = tipoEl.value === '31';
    dvEl.disabled = !esNit;
    dvEl.parentElement.style.opacity = esNit ? '1' : '0.5';
    if(!esNit) dvEl.value='';
    else if(nitEl.value && !dvEl.value) dvEl.value = calcularDV(nitEl.value) || '';
  }
  tipoEl.onchange = toggleDvLead;
  nitEl.oninput = () => {
    let v = nitEl.value.replace(/\D/g,'').slice(0,15);
    if(v !== nitEl.value) nitEl.value = v;
    if(tipoEl.value==='31') dvEl.value = calcularDV(v) || dvEl.value.replace(/\D/g,'').slice(0,1);
  };
  dvEl.oninput = () => { dvEl.value = dvEl.value.replace(/\D/g,'').slice(0,1); };
  toggleDvLead();
  // Google Places via backend proxy (no carga gmaps js en frontend)
  await _initLeadPlacesAutocomplete();
  // guarda lead actual para helpers de depto/ciudad
  window._leadActual = lead;
  // Productos de interés
  _leadProductos = lead?.productos || [];
  document.getElementById('buscar-lead-producto').value='';
  document.getElementById('lead-producto-resultados').innerHTML='<p style="color:var(--muted);font-size:12px">Busca un producto del maestro.</p>';
  renderLeadProductos();
  // Adjuntos (RUT, cert, etc.) — permite pendientes antes de guardar
  _leadAdjuntosPendientes=[];
  const _adjInput = document.getElementById('lead-adjunto-input');
  if(_adjInput){ _adjInput.value=''; _adjInput.disabled=false; }
  const _adjDrop = document.getElementById('lead-adjuntos-drop');
  if(_adjDrop) _adjDrop.style.opacity='1';
  if(lead?.id){ cargarLeadAdjuntos(lead.id); } else {
    _leadAdjuntosCache=[];
    renderLeadAdjuntos();
    document.getElementById('lead-adjuntos-lista').innerHTML='<p style="color:var(--muted);font-size:12px">Puedes adjuntar archivos antes de guardar — se subirán al crear el lead (RUT, cert. bancario, cámara, 20MB c/u, máx 10).</p><div id="lead-adjuntos-pendientes"></div>';
  }
  showModal('modal-lead');
}
let _leadAdjuntosCache=[];
let _leadAdjuntosPendientes=[];
async function cargarLeadAdjuntos(leadId){
  const lista=document.getElementById('lead-adjuntos-lista');
  const cnt=document.getElementById('lead-adjuntos-count');
  if(!lista) return;
  lista.innerHTML='<p style="color:var(--muted);font-size:12px">Cargando adjuntos...</p>';
  try{
    const r=await apiFetch('/leads/'+leadId+'/adjuntos');
    if(!r.ok){ lista.innerHTML=`<p style="color:var(--danger);font-size:12px">${esc(r.data?.error||'Error al cargar')}</p>`; return; }
    _leadAdjuntosCache=r.data.data||[];
    renderLeadAdjuntos();
  }catch(e){ lista.innerHTML=`<p style="color:var(--danger);font-size:12px">${esc(e.message)}</p>`; }
}
function renderLeadAdjuntos(){
  const lista=document.getElementById('lead-adjuntos-lista');
  const cnt=document.getElementById('lead-adjuntos-count');
  if(!lista) return;
  const total = _leadAdjuntosCache.length + _leadAdjuntosPendientes.length;
  if(cnt) cnt.textContent = total + '/10' + (_leadAdjuntosPendientes.length ? ` (${_leadAdjuntosPendientes.length} pendientes)` : '');
  if(!total){
    lista.innerHTML='<p style="color:var(--muted);font-size:12px">Sin adjuntos. Sube RUT, cert. bancario, cámara o cédula (20MB c/u, máx 10). Arrastrar o seleccionar — si es lead nuevo se guardarán al crear.</p>';
    return;
  }
  const pendientesHtml = _leadAdjuntosPendientes.map((p,i)=>{
    const kb=(p.file.size/1024).toFixed(0);
    const tipoLabel={rut:'RUT',cert_bancario:'Cert. bancario',camara_comercio:'Cámara',cedula:'Cédula',otro:'Otro'}[p.tipo]||p.tipo;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px dashed var(--warning);border-radius:8px;margin-bottom:6px;background:rgba(247,212,79,.08)">
      <span style="font-size:18px">⏳</span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(p.file.name)}">${esc(p.file.name)} <small style="color:var(--warning)">· pendiente</small></div><div style="font-size:11px;color:var(--muted)">${tipoLabel} · ${kb} KB · se subirá al guardar</div></div>
      <button class="btn btn-sm btn-danger btn-action" onclick="quitarLeadAdjuntoPendiente(${i})" title="Quitar pendiente">✕</button>
    </div>`;
  }).join('');
  const guardadosHtml = _leadAdjuntosCache.map(a=>{
    const icon=a.mime?.includes('pdf')?'📄':a.mime?.includes('image')?'🖼️':a.mime?.includes('sheet')?'📊':'📎';
    const kb=(a.size/1024).toFixed(0);
    const tipoLabel={rut:'RUT',cert_bancario:'Cert. bancario',camara_comercio:'Cámara',cedula:'Cédula',otro:'Otro'}[a.tipo]||a.tipo;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
      <span style="font-size:18px">${icon}</span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.nombre_original)}">${esc(a.nombre_original)}</div><div style="font-size:11px;color:var(--muted)">${tipoLabel} · ${kb} KB · ${formatDate(a.creado_en)}</div></div>
      <button class="btn btn-sm btn-secondary btn-action" onclick="descargarLeadAdjunto('${a.id}')" title="Descargar" aria-label="Descargar ${esc(a.nombre_original)}">📥</button>
      <button class="btn btn-sm btn-danger btn-action" onclick="eliminarLeadAdjunto('${a.id}')" title="Eliminar" aria-label="Eliminar ${esc(a.nombre_original)}">🗑️</button>
    </div>`;
  }).join('');
  lista.innerHTML = pendientesHtml + guardadosHtml;
}
function quitarLeadAdjuntoPendiente(idx){
  _leadAdjuntosPendientes.splice(idx,1);
  renderLeadAdjuntos();
}
function agregarAdjuntosPendientes(files, tipo){
  const total = _leadAdjuntosCache.length + _leadAdjuntosPendientes.length + files.length;
  if(total > 10) { toast(`Máximo 10 archivos (llevarías ${total})`,'error'); return false; }
  for(const f of files){ if(f.size>20*1024*1024){ toast(`${f.name} supera 20MB`,'error'); return false; } }
  for(const f of files) _leadAdjuntosPendientes.push({ file:f, tipo });
  renderLeadAdjuntos();
  return true;
}
async function subirLeadAdjuntos(){
  const leadId=document.getElementById('lead-id')?.value;
  const input=document.getElementById('lead-adjunto-input');
  const tipo=document.getElementById('lead-adjunto-tipo')?.value||'otro';
  const files=input?.files;
  if(!files||!files.length) return toast('Selecciona al menos un archivo','warning');
  // Si es lead nuevo, guarda como pendientes y no sube aún
  if(!leadId){
    if(agregarAdjuntosPendientes([...files], tipo)){
      input.value='';
      toast(`${files.length} archivo(s) en espera — se subirán al guardar el lead`,'info');
    }
    return;
  }
  if(_leadAdjuntosCache.length + files.length > 10) return toast(`Máximo 10 archivos (ya tienes ${_leadAdjuntosCache.length})`,'error');
  for(const f of files){ if(f.size>20*1024*1024) return toast(`${f.name} supera 20MB`,'error'); }
  const fd=new FormData();
  for(const f of files) fd.append('archivos', f);
  fd.append('tipo', tipo);
  const btn=document.querySelector('button[onclick="subirLeadAdjuntos()"]');
  if(btn){ btn.disabled=true; btn.textContent='Subiendo...'; }
  try{
    const r=await fetch(HF.API+'/leads/'+leadId+'/adjuntos',{ method:'POST', credentials:'include', body: fd });
    const j=await r.json().catch(()=>({}));
    if(!r.ok) return toast(j.error||'Error al subir','error');
    toast(`${j.data.length} archivo(s) subido(s)`, 'success');
    input.value='';
    await cargarLeadAdjuntos(leadId);
  }catch(e){ toast(e.message,'error'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='Subir'; } }
}
function onLeadAdjuntosDrop(e){
  e.preventDefault(); e.currentTarget.style.borderColor='var(--border)';
  const files=e.dataTransfer?.files;
  if(!files?.length) return;
  const tipo=document.getElementById('lead-adjunto-tipo')?.value||'otro';
  const leadId=document.getElementById('lead-id')?.value;
  if(!leadId){
    if(agregarAdjuntosPendientes([...files], tipo)) toast(`${files.length} archivo(s) en espera`,'info');
    return;
  }
  const input=document.getElementById('lead-adjunto-input');
  const dt=new DataTransfer();
  for(const f of files) dt.items.add(f);
  input.files=dt.files;
  subirLeadAdjuntos();
}
async function eliminarLeadAdjunto(adjId){
  const leadId=document.getElementById('lead-id')?.value;
  if(!leadId||!adjId) return;
  confirmar({ titulo:'Eliminar adjunto', mensaje:'¿Eliminar este archivo?', icono:'🗑️', onConfirm: async()=>{
    const r=await apiFetch('/leads/'+leadId+'/adjuntos/'+adjId,{ method:'DELETE' });
    if(!r.ok) return toast(r.data?.error||'Error al eliminar','error');
    toast('Adjunto eliminado','success');
    await cargarLeadAdjuntos(leadId);
  }});
}
async function descargarLeadAdjunto(adjId){
  const leadId=document.getElementById('lead-id')?.value;
  if(!leadId) return;
  // descarga autenticada via fetch blob
  try{
    const r=await fetch(HF.API+'/leads/'+leadId+'/adjuntos/'+adjId+'/descargar',{ credentials:'include' });
    if(!r.ok){ const j=await r.json().catch(()=>({})); return toast(j.error||'Error al descargar','error'); }
    const blob=await r.blob();
    const cd=r.headers.get('Content-Disposition')||'';
    let filename='archivo';
    const m=cd.match(/filename="?([^"]+)"?/); if(m) filename=m[1];
    // fallback al nombre original del cache
    const cached=_leadAdjuntosCache.find(x=>String(x.id)===String(adjId));
    if(cached) filename=cached.nombre_original;
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ toast(e.message,'error'); }
}
let _leadDireccionTimer=null;
let _placesDD=null;
function _posicionarPlacesDD(input){
  if(!_placesDD) return;
  const r=input.getBoundingClientRect();
  _placesDD.style.left=r.left+'px';
  _placesDD.style.top=(r.bottom+2)+'px';
  _placesDD.style.width=r.width+'px';
}
async function initLeadGooglePlaces(){ /* proxy-based, no gmaps js */ }
async function _initLeadPlacesAutocomplete(){
  const input=document.getElementById('lead-direccion');
  if(!input) return;
  // Siempre recrea el dropdown si existía uno viejo con z-index bajo (cache del navegador)
  const old=document.getElementById('lead-direccion-dropdown');
  if(old && old.style.zIndex!=='10000') { old.remove(); _placesDD=null; }
  if(input.dataset.placesBound==='1' && _placesDD) return;
  input.dataset.placesBound='1';
  input.setAttribute('autocomplete','off');
  if(!_placesDD){
    _placesDD=document.createElement('div');
    _placesDD.id='lead-direccion-dropdown';
    _placesDD.style.cssText='display:none;position:fixed;z-index:10000;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;max-height:240px;overflow:auto;box-shadow:0 12px 32px rgba(0,0,0,.30)';
    document.body.appendChild(_placesDD);
    document.addEventListener('click',(e)=>{
      if(!input.parentElement.contains(e.target) && !_placesDD.contains(e.target)) _placesDD.style.display='none';
    });
    const modalContent=input.closest('.modal');
    if(modalContent) modalContent.addEventListener('scroll',()=>{ if(_placesDD.style.display==='block') _posicionarPlacesDD(input); });
    window.addEventListener('scroll',()=>{ if(_placesDD.style.display==='block') _posicionarPlacesDD(input); }, true);
    window.addEventListener('resize',()=>{ if(_placesDD.style.display==='block') _posicionarPlacesDD(input); });
  }
  // helper para debug desde consola: window.testPlaces('Calle 10')
  window.testPlaces = async (qq)=>{
    console.log('[places] testPlaces', qq, 'HF.API', (typeof HF!=='undefined'?HF.API:'HF no definido'));
    const r=await apiFetch('/places/autocomplete?input='+encodeURIComponent(qq||'Calle 10 Medellin'));
    console.log('[places] testPlaces result', r);
    if(r.ok && r.data?.predictions) alert('Predictions: '+r.data.predictions.length+' - '+r.data.predictions[0]?.description);
    else alert('Error: '+JSON.stringify(r.data));
    return r;
  };
  input.addEventListener('input', ()=>{
    const q=input.value.trim();
    console.log('[places] input', q, 'len', q.length);
    if(q.length<3){ _placesDD.style.display='none'; return; }
    clearTimeout(_leadDireccionTimer);
    _leadDireccionTimer=setTimeout(async()=>{
      console.log('[places] fetching', q, 'via', HF.API+'/places/autocomplete');
      try{
        const r=await apiFetch('/places/autocomplete?input='+encodeURIComponent(q));
        console.log('[places] response', r);
        if(r.data?.warning){ console.warn('[places] warning', r.data.warning); _placesDD.innerHTML=`<div style="padding:10px;color:var(--warning);font-size:12px">⚠️ ${esc(r.data.warning)}</div>`; _posicionarPlacesDD(input); _placesDD.style.display='block'; return; }
        if(!r.ok){ _placesDD.innerHTML=`<div style="padding:10px;color:var(--danger);font-size:12px">❌ ${esc(r.data?.error||'Error') } (status ${r.status})</div>`; _posicionarPlacesDD(input); _placesDD.style.display='block'; console.warn('[places] autocomplete no ok', r.data); return; }
        if(!r.data.predictions?.length){ _placesDD.innerHTML=`<div style="padding:10px;color:var(--muted);font-size:12px">Sin resultados para "${esc(q)}"</div>`; _posicionarPlacesDD(input); _placesDD.style.display='block'; setTimeout(()=>_placesDD.style.display='none', 2000); return; }
        _placesDD.innerHTML=r.data.predictions.map(p=> `<div style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px" data-place-id="${p.place_id}" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background='transparent'">${esc(p.description)}</div>`).join('');
        _posicionarPlacesDD(input);
        _placesDD.style.display='block';
        console.log('[places] dropdown visible', r.data.predictions.length, _placesDD.getBoundingClientRect());
        for(const el of _placesDD.children){
          el.addEventListener('click', async()=>{
            const pid=el.dataset.placeId;
            const desc=el.textContent;
            input.value=desc; _placesDD.style.display='none';
            console.log('[places] selected', pid, desc);
            try{
              const dr=await apiFetch('/places/details?place_id='+encodeURIComponent(pid));
              console.log('[places] details', dr);
              if(dr.ok && dr.data.result){
                const place=dr.data.result;
                const comps=place.address_components||[];
                let ciudad='', depto='';
                for(const c of comps){
                  if(c.types.includes('locality')) ciudad=c.long_name;
                  else if(c.types.includes('administrative_area_level_1')) depto=c.long_name;
                  else if(!ciudad && c.types.includes('administrative_area_level_2')) ciudad=c.long_name;
                }
                if(place.formatted_address){
                  // Limpia ciudad/depto/país del string (SIESA 80 chars, evita redundancia)
                  const _parts=place.formatted_address.split(',').map(p=>p.trim()).filter(Boolean);
                  let _clean=place.formatted_address;
                  if(_parts.length>2){
                    const _isGeo=(p)=>{
                      const n=p.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
                      return n==='COLOMBIA'||n==='CO'|| _daneDeptos.some(d=> d.nombre.toUpperCase()===n) || _daneCiudades.some(c=> c.nombre.toUpperCase()===n);
                    };
                    let _keep=[];
                    for(let _i=0;_i<_parts.length;_i++){
                      if(_keep.length<2 && !_isGeo(_parts[_i])) _keep.push(_parts[_i]);
                      else if(_keep.length>=2) break;
                    }
                    if(_keep.length) _clean=_keep.join(', ');
                    else _clean=_parts.slice(0,2).join(', ');
                    if(_clean.length>80) _clean=_clean.slice(0,80).trim().replace(/,+$/,'');
                  } else if(_clean.length>80) _clean=_clean.slice(0,80).trim();
                  input.value=_clean;
                }
                if(ciudad || depto){
                  const depInp=document.getElementById('lead-departamento-search');
                  const ciuInp=document.getElementById('lead-ciudad-search');
                  if(depto && depInp){ depInp.value=depto; filtrarLeadDepto(depto); setTimeout(()=>{ const sel=document.getElementById('lead-departamento'); if(sel && sel.options.length>1){ sel.selectedIndex=1; onLeadDeptoSelect(); } },300); }
                  if(ciudad && ciuInp){ setTimeout(()=>{ ciuInp.value=ciudad; filtrarLeadCiudad(ciudad); setTimeout(()=>{ const sel=document.getElementById('lead-ciudad'); if(sel && sel.options.length>1){ sel.selectedIndex=1; onLeadCiudadSelect(); } },300); },600); }
                }
                input.dataset.place_id=place.place_id||pid;
                input.dataset.lat=place.geometry?.location?.lat||'';
                input.dataset.lng=place.geometry?.location?.lng||'';
                input.dataset.formatted=place.formatted_address||desc;
                window._leadPlace={ place_id: place.place_id||pid, lat: place.geometry?.location?.lat, lng: place.geometry?.location?.lng, formatted: place.formatted_address||desc };
              }
            }catch(e){ console.warn('[places] details error', e.message); }
          });
        }
      }catch(e){ console.warn('Places proxy error', e.message); _placesDD.innerHTML=`<div style="padding:10px;color:var(--danger)">Error: ${esc(e.message)}</div>`; _posicionarPlacesDD(input); _placesDD.style.display='block'; }
    },300);
  });
}
function daneFromLeadCiudad(ciudad, depto){
  const c=(ciudad||'').toUpperCase(), d=(depto||'').toUpperCase();
  const byCity=_daneCiudades.find(x=> x.nombre===c);
  if(byCity) return {ciudad:byCity.codigo, depto:byCity.depto};
  const byDept=_daneDeptos.find(x=> x.nombre===d);
  if(byDept) return {ciudad:byDept.codigo+'001', depto:byDept.codigo};
  return null;
}
async function cargarListasLead(selected){
  const sel=document.getElementById('lead-lista-precios');
  if(!sel) return;
  sel.innerHTML='<option value="">Cargando...</option>';
  try{
    const def = selected || await getPerfilListaDefault();
    const r=await apiFetch('/maestros?tipo=lista_precio&_='+Date.now());
    const data=r.ok ? (r.data.data||[]) : [];
    if(!data.length){ sel.innerHTML=`<option value="${esc(def)}" selected>${esc(def)} — GENERAL HORECA</option>`; return; }
    sel.innerHTML=data.map(it=> `<option value="${esc(it.codigo)}" ${String(it.codigo)===String(def)?'selected':''}>${esc(it.codigo)} — ${esc(it.nombre)}</option>`).join('');
    if(selected && !data.find(x=> String(x.codigo)===String(selected))){ sel.innerHTML+=`<option value="${esc(selected)}" selected>${esc(selected)} (actual)</option>`; }
    sel.value=def; if(selected) sel.value=selected;
  }catch{ sel.innerHTML='<option value="200" selected>200 — GENERAL HORECA</option>'; }
}
function setupLeadDeptoCiudad(lead){
  const depSel=document.getElementById('lead-departamento');
  const depSearch=document.getElementById('lead-departamento-search');
  const depDisp=document.getElementById('lead-departamento-selected');
  const ciuSel=document.getElementById('lead-ciudad');
  const ciuSearch=document.getElementById('lead-ciudad-search');
  const ciuDisp=document.getElementById('lead-ciudad-selected');
  if(!depSel||!ciuSel) return;
  const depVal=lead?.departamento||'';
  const ciuVal=lead?.ciudad||'';
  if(depVal){
    const found=_daneDeptos.find(d=> d.codigo===depVal || d.nombre===depVal.toUpperCase());
    if(found){ depSel.value=found.nombre; depSearch.value=''; if(depDisp){ depDisp.textContent=`✓ ${found.codigo} — ${found.nombre}  ✕`; depDisp.style.display=''; depDisp.onclick=()=>{ depSel.value=''; depDisp.style.display='none'; depSearch.value=''; }; } }
    else { depSearch.value=depVal; depSel.value=depVal; }
  } else { depSel.value=''; if(depDisp) depDisp.style.display='none'; depSearch.value=''; }
  if(ciuVal){
    const found=_daneCiudades.find(c=> c.codigo===ciuVal || c.nombre===ciuVal.toUpperCase());
    if(found){ ciuSel.value=found.nombre; ciuSearch.value=''; if(ciuDisp){ ciuDisp.textContent=`✓ ${found.codigo} — ${found.nombre}  ✕`; ciuDisp.style.display=''; ciuDisp.onclick=()=>{ ciuSel.value=''; ciuDisp.style.display='none'; ciuSearch.value=''; }; } }
    else { ciuSearch.value=ciuVal; ciuSel.value=ciuVal; }
  } else { ciuSel.value=''; if(ciuDisp) ciuDisp.style.display='none'; ciuSearch.value=''; }
}
function filtrarLeadDepto(q){
  const sel=document.getElementById('lead-departamento');
  const disp=document.getElementById('lead-departamento-selected');
  if(disp && disp.style.display!=='none' && q) return;
  const qq=(q||'').trim().toLowerCase();
  if(!qq || qq.length<1){ sel.style.display='none'; return; }
  const filtered=_daneDeptos.filter(d=> d.nombre.toLowerCase().includes(qq) || d.codigo.includes(qq));
  if(!filtered.length){ sel.innerHTML='<option>No hay resultados</option>'; sel.style.display=''; return; }
  sel.innerHTML=filtered.map(d=> `<option value="${d.nombre}">${d.codigo} — ${d.nombre}</option>`).join(''); sel.style.display=''; sel.size=Math.min(6,filtered.length+1);
  sel.onchange=()=> onLeadDeptoSelect();
}
function onLeadDeptoSelect(){
  const sel=document.getElementById('lead-departamento');
  const inp=document.getElementById('lead-departamento-search');
  const opt=sel.options[sel.selectedIndex]; if(!opt||!opt.value) return;
  inp.value=opt.textContent; inp.readOnly=true; inp.title='Seleccionado — clic para cambiar';
  inp.onclick=()=>{ inp.value=''; inp.readOnly=false; sel.value=''; sel.style.display='none'; inp.onclick=null; };
  sel.style.display='none';
  const disp=document.getElementById('lead-departamento-selected'); if(disp) disp.style.display='none';
  // al cambiar depto, limpia ciudad si no pertenece
  const ciuSel=document.getElementById('lead-ciudad'); const ciuInp=document.getElementById('lead-ciudad-search');
  if(ciuSel && ciuSel.value){
    const depCode=_daneDeptos.find(d=> d.nombre===opt.textContent.split(' — ')[1] || d.codigo===opt.value)?.codigo;
    const ciu=_daneCiudades.find(c=> c.codigo===ciuSel.value || c.nombre===ciuSel.value);
    if(ciu && ciu.depto!==depCode){ ciuSel.value=''; const cd=document.getElementById('lead-ciudad-selected'); if(cd) cd.style.display='none'; if(ciuInp){ ciuInp.value=''; ciuInp.readOnly=false; } }
  }
}
function filtrarLeadCiudad(q){
  const sel=document.getElementById('lead-ciudad');
  const disp=document.getElementById('lead-ciudad-selected');
  if(disp && disp.style.display!=='none' && q) return;
  const qq=(q||'').trim().toLowerCase();
  if(!qq || qq.length<1){ sel.style.display='none'; return; }
  const depVal=document.getElementById('lead-departamento')?.value;
  const depCode=_daneDeptos.find(d=> d.nombre===depVal || d.codigo===depVal)?.codigo;
  let filtered=_daneCiudades.filter(c=> (c.nombre && c.nombre.toLowerCase().includes(qq)) || (c.codigo && String(c.codigo).toLowerCase().includes(qq)));
  // si hay depto seleccionado, prioriza sus ciudades arriba pero no oculta las demás
  if(depCode){
    filtered.sort((a,b)=> (String(a.depto)===String(depCode)?0:1) - (String(b.depto)===String(depCode)?0:1));
  }
  if(!filtered.length){ sel.innerHTML='<option>No hay resultados</option>'; sel.style.display=''; return; }
  // muestra máximo 20, con indicador si es de otro depto
  const slice=filtered.slice(0,20);
  sel.innerHTML=slice.map(c=> `<option value="${c.nombre}">${c.codigo} — ${c.nombre}${c.depto!==depCode && depCode ? ` (${c.depto})` : ''}</option>`).join(''); sel.style.display=''; sel.size=Math.min(6,slice.length+1);
  sel.onchange=()=> onLeadCiudadSelect();
}
function onLeadCiudadSelect(){
  const sel=document.getElementById('lead-ciudad');
  const inp=document.getElementById('lead-ciudad-search');
  const opt=sel.options[sel.selectedIndex]; if(!opt||!opt.value) return;
  inp.value=opt.textContent; inp.readOnly=true; inp.title='Seleccionado — clic para cambiar';
  inp.onclick=()=>{ inp.value=''; inp.readOnly=false; sel.value=''; sel.style.display='none'; inp.onclick=null; };
  sel.style.display='none';
  const disp=document.getElementById('lead-ciudad-selected'); if(disp) disp.style.display='none';
}
async function buscarLeadProducto(){
  clearTimeout(_leadProdTimer);
  _leadProdTimer=setTimeout(async()=>{
    const q=document.getElementById('buscar-lead-producto')?.value;
    if(!q||q.length<2){ document.getElementById('lead-producto-resultados').innerHTML='<p style="color:var(--muted);font-size:12px">Escribe al menos 2 caracteres.</p>'; return; }
    const r=await apiFetch('/productos/buscar?q='+encodeURIComponent(q));
    if(!r.ok) return;
    const data=r.data.data||[];
    if(!data.length){ document.getElementById('lead-producto-resultados').innerHTML='<p style="color:var(--muted);font-size:12px">No hay resultados.</p>'; return; }
    document.getElementById('lead-producto-resultados').innerHTML=data.map(p=> `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
        <div><strong>${esc(p.codigo)}</strong> — ${esc(p.nombre)}<br><span style="font-size:11px;color:var(--muted)">${esc(p.unidad_medida||'UND')} · $${formatMoney(p.precio_unitario||0)}</span></div>
        <button class="btn btn-sm btn-primary btn-action" onclick='agregarProductoLead(${JSON.stringify(p).replace(/"/g,"&quot;")})' title="Agregar" aria-label="Agregar ${esc(p.nombre)}">＋</button>
      </div>`).join('');
  },300);
}
function agregarProductoLead(p){
  if(_leadProductos.find(x=>x.codigo===p.codigo)) return toast('Producto ya agregado','warning');
  _leadProductos.push({ codigo:p.codigo, nombre:p.nombre, unidad_medida:p.unidad_medida, precio:p.precio_unitario||0 });
  renderLeadProductos();
}
function quitarProductoLead(codigo){
  _leadProductos=_leadProductos.filter(x=>x.codigo!==codigo);
  renderLeadProductos();
}
function renderLeadProductos(){
  const cont=document.getElementById('lead-productos-lista');
  const total=document.getElementById('lead-productos-total');
  if(!_leadProductos.length){ cont.innerHTML='<p style="color:var(--muted);font-size:12px">Sin productos.</p>'; if(total) total.textContent=''; return; }
  if(total) total.textContent=_leadProductos.length+' prod';
  cont.innerHTML=_leadProductos.map(p=> `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
      <div><strong>${esc(p.codigo)}</strong> — ${esc(p.nombre)}<br><span style="font-size:11px;color:var(--muted)">${esc(p.unidad_medida||'UND')} · $${formatMoney(p.precio||0)}</span></div>
      <button class="btn btn-sm btn-danger btn-action" onclick="quitarProductoLead('${p.codigo}')" title="Quitar">✕</button>
    </div>`).join('');
}

async function editarLead(id) {
  const r = await apiFetch('/leads/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalLead(r.data.data);
}

async function verLead(id) {
  const r = await apiFetch('/leads/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalLead(r.data.data);
}
async function crearOportunidadDesdeLead(leadId, nombre){
  // abre oportunidad precargando lead
  const oportunidad = { lead_id: leadId, nombre: `Oportunidad ${nombre}`.slice(0,120), etapa: 'lead' };
  navigate('pipeline');
  setTimeout(()=> abrirModalOportunidad(oportunidad), 300);
}

async function guardarLead() {
  const id = document.getElementById('lead-id').value;
  const isNew = !id;
  const body = {
    raison_social: document.getElementById('lead-razon-social').value,
    numero_identificacion: document.getElementById('lead-nit').value,
    nombre_establecimiento: document.getElementById('lead-nombre-est').value,
    estado: isNew ? 'nuevo' : undefined,
    ciudad: document.getElementById('lead-ciudad').value,
    departamento: document.getElementById('lead-departamento').value,
    direccion: document.getElementById('lead-direccion').value,
    telefono: document.getElementById('lead-telefono').value,
    email: document.getElementById('lead-email').value,
    asesor_comercial: usuario?.nombre || document.getElementById('lead-asesor').value,
    canal: document.getElementById('lead-canal').value,
    tipo_negocio: document.getElementById('lead-tipo-negocio').value || null,
    lista_precios: document.getElementById('lead-lista-precios').value || null,
    notas: document.getElementById('lead-notas').value + (_leadProductos.length ? `\n[Productos: ${_leadProductos.map(p=>p.codigo).join(', ')}]` : ''),
    latitud: document.getElementById('lead-direccion')?.dataset.lat || null,
    longitud: document.getElementById('lead-direccion')?.dataset.lng || null,
    google_place_id: document.getElementById('lead-direccion')?.dataset.place_id || null,
    direccion_google: document.getElementById('lead-direccion')?.dataset.formatted || null,
    siesa_tipo_identificacion: document.getElementById('lead-siesa-tipo').value,
    siesa_dv: document.getElementById('lead-siesa-dv').value,
    siesa_regimen: document.getElementById('lead-siesa-regimen').value,
    siesa_responsabilidad_fiscal: document.getElementById('lead-siesa-resp').value,
    siesa_ciiu: document.getElementById('lead-siesa-ciiu').value
  };
  if (body.estado === undefined) delete body.estado;
  if (!body.raison_social) return toast('La razon social es obligatoria', 'error');

  const r = id
    ? await apiFetch('/leads/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  const newId = id || r.data.data?.id;
  // Si es creación y hay adjuntos pendientes, súbelos sin perder el hilo
  if(isNew && _leadAdjuntosPendientes.length){
    const pendientes=[..._leadAdjuntosPendientes];
    toast(`Lead creado — subiendo ${pendientes.length} adjunto(s)...`,'info');
    let okCount=0;
    for(const p of pendientes){
      const fd=new FormData();
      fd.append('archivos', p.file);
      fd.append('tipo', p.tipo);
      try{
        const rr=await fetch(HF.API+'/leads/'+newId+'/adjuntos',{ method:'POST', credentials:'include', body: fd });
        const jj=await rr.json().catch(()=>({}));
        if(rr.ok) okCount+= jj.data?.length||1;
        else toast(`Error ${p.file.name}: ${jj.error||rr.status}`,'error');
      }catch(e){ toast(`Error ${p.file.name}: ${e.message}`,'error'); }
    }
    _leadAdjuntosPendientes=[];
    if(okCount) toast(`${okCount} adjunto(s) subido(s)`,'success');
  }
  toast(id ? 'Lead actualizado' : 'Lead creado', 'success');
  hideModal('modal-lead');
  // limpia pendientes por si quedó algo
  _leadAdjuntosPendientes=[];
  cargarLeads();
}

async function eliminarLead(id) {
  confirmar({ titulo: 'Eliminar lead', mensaje: 'Eliminar este lead?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/leads/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Lead eliminado', 'success');
    cargarLeads();
  }});
}

async function enviarLeadERP(id, nombre) {
  confirmar({ titulo: 'Convertir a tercero', mensaje: `Enviar "${nombre}" al ERP para crear tercero?`, icono: '🔄', onConfirm: async () => {
    const r = await apiFetch('/leads/' + id + '/convertir', { method: 'POST' });
    if (!r.ok) return toast(r.data?.error || 'Error al enviar al ERP', 'error');
    toast('Lead enviado a ERP', 'success');
    cargarLeads();
  }});
}

async function marcarConvertido(id, nombre) {
  confirmar({ titulo: 'Confirmar conversion', mensaje: `¿"${nombre}" ya fue creado como tercero en el ERP?`, icono: '✅', onConfirm: async () => {
    const r = await apiFetch('/leads/' + id + '/confirmar', { method: 'PUT' });
    if (!r.ok) return toast(r.data?.error || 'Error al confirmar', 'error');
    toast('Lead convertido en cliente', 'success');
    cargarLeads();
  }});
}
async function activarLead(id, nombre){
  confirmar({ titulo:'Activar cliente', mensaje:`¿Activar cliente prospecto de "${nombre}"? (Contabilidad)`, icono:'✅', onConfirm: async()=>{
    const r=await apiFetch('/leads/'+id+'/activar',{method:'PUT'});
    if(!r.ok) return toast(r.data?.error||'Error al activar','error');
    toast('Cliente activado','success'); cargarLeads(); cargarClientes();
  }});
}

async function reconciliarLeads() {
  confirmar({ titulo: 'Reconciliar leads', mensaje: 'Comparar leads con clientes existentes por NIT?', icono: '🔍', onConfirm: async () => {
    const r = await apiFetch('/leads/reconciliar', { method: 'POST' });
    if (!r.ok) return toast(r.data?.error || 'Error al reconciliar', 'error');
    if (r.data.convertidos === 0) {
      toast('No se encontraron leads que coincidan con clientes existentes', 'info');
    } else {
      toast(`${r.data.convertidos} lead(s) marcado(s) como convertido(s)`, 'success');
    }
    cargarLeads();
  }});
}

// ── Contactos ──
async function cargarContactos() {
  const search = document.getElementById('filtro-contacto-search').value;
  const clienteId = document.getElementById('filtro-contacto-cliente').value;
  const params = new URLSearchParams({ page: _contactosPage, limit: _limit });
  if (search) params.set('search', search);
  if (clienteId) params.set('cliente_id', clienteId);
  const r = await apiFetch('/contactos?' + params);
  if (!r.ok) return;
  const tbody = document.getElementById('tbody-contactos');
  const data = r.data.data || [];
  tbody.innerHTML = data.map(c => `
    <tr>
      <td><input type="checkbox" class="row-check cb-contacto" value="${c.id}" onchange="updateBulkBar()"></td>
      <td>${esc(c.nombre)}</td>
      <td>${esc(c.cliente_nombre || '—')}</td>
      <td>${esc(c.cargo || '—')}</td>
      <td>${esc(c.email || '—')}</td>
      <td>${esc(c.telefono || '—')}</td>
      <td>${c.es_decision_maker ? '✅' : '—'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editarContacto('${c.id}')" title="Editar">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarContacto('${c.id}')" title="Eliminar">🗑️</button>
      </td>
    </tr>
  `).join('');
  renderPagination('pag-contactos', r.data.total, _contactosPage, _limit, (p) => { _contactosPage = p; cargarContactos(); });
  // Cargar clientes en select de filtro
  await cargarClientesSelect('filtro-contacto-cliente', clienteId);
  cargarStatsContactos();
}

async function cargarStatsContactos() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-contacto-search')?.value;
    const clienteId = document.getElementById('filtro-contacto-cliente')?.value;
    if (search) params.set('search', search);
    if (clienteId) params.set('cliente_id', clienteId);

    const r = await apiFetch('/contactos/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-contactos').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Contactos</div></div>
      <div class="stat-card"><div class="stat-value">${d.con_email || 0}</div><div class="stat-label">Con email</div></div>
      <div class="stat-card"><div class="stat-value">${d.con_telefono || 0}</div><div class="stat-label">Con telefono</div></div>
      <div class="stat-card"><div class="stat-value">${d.decision_makers || 0}</div><div class="stat-label">Decision makers</div></div>
    `;
  } catch {}
}

function limpiarFiltrosContactos() {
  document.getElementById('filtro-contacto-search').value = '';
  document.getElementById('filtro-contacto-cliente').value = '';
  _contactosPage = 1;
  cargarContactos();
}

async function cargarClientesSelect(selectId, selectedId) {
  const r = await apiFetch('/clientes?limit=500');
  if (!r.ok) return;
  const sel = document.getElementById(selectId);
  const actual = selectedId || sel.value;
  sel.innerHTML = '<option value="">Todas las clientes</option>' +
    (r.data.data || []).map(e => `<option value="${e.id}" ${e.id === actual ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('');
}

async function abrirModalContacto(contacto = null) {
  document.getElementById('modal-contacto-title').textContent = contacto ? 'Editar Contacto' : 'Nuevo Contacto';
  document.getElementById('contacto-id').value = contacto?.id || '';
  document.getElementById('contacto-nombre').value = contacto?.nombre || '';
  document.getElementById('contacto-cargo').value = contacto?.cargo || '';
  document.getElementById('contacto-email').value = contacto?.email || '';
  document.getElementById('contacto-telefono').value = contacto?.telefono || '';
  document.getElementById('contacto-whatsapp').value = contacto?.whatsapp || '';
  document.getElementById('contacto-decision').value = contacto?.es_decision_maker ? 'true' : 'false';
  document.getElementById('contacto-notas').value = contacto?.notas || '';
  await cargarClientesSelect('contacto-cliente', contacto?.cliente_id);
  showModal('modal-contacto');
}

async function editarContacto(id) {
  const r = await apiFetch('/contactos/' + id);
  if (!r.ok) return;
  abrirModalContacto(r.data.data);
}

async function guardarContacto() {
  const id = document.getElementById('contacto-id').value;
  const body = {
    cliente_id: document.getElementById('contacto-cliente').value,
    nombre: document.getElementById('contacto-nombre').value,
    cargo: document.getElementById('contacto-cargo').value || null,
    email: document.getElementById('contacto-email').value || null,
    telefono: document.getElementById('contacto-telefono').value || null,
    whatsapp: document.getElementById('contacto-whatsapp').value || null,
    es_decision_maker: document.getElementById('contacto-decision').value === 'true',
    notas: document.getElementById('contacto-notas').value || null
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if (!body.cliente_id) return toast('Seleccione un cliente', 'error');
  const r = id
    ? await apiFetch('/contactos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/contactos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Contacto actualizado' : 'Contacto creado', 'success');
  hideModal('modal-contacto');
  cargarContactos();
}

async function eliminarContacto(id) {
  confirmar({ titulo: 'Eliminar', mensaje: '¿Eliminar este contacto?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/contactos/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Contacto eliminado', 'success');
    cargarContactos();
  }});
}

async function bulkDeleteContactos() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];
  if (mode === 'all') {
    const r = await apiFetch('/contactos?limit=10000');
    if (!r.ok) return toast('Error al obtener contactos', 'error');
    ids = (r.data.data || []).map(c => c.id);
  } else {
    ids = [...document.querySelectorAll('.cb-contacto:checked')].map(cb => cb.value);
  }
  if (!ids.length) return toast('No hay contactos para eliminar', 'error');
  confirmar({ titulo: 'Eliminar contactos', mensaje: `¿Eliminar ${ids.length} contacto(s)?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/contactos/seleccionados', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} contactos eliminados`, 'success');
    clearSelection();
    cargarContactos();
  }});
}

// ── Visitas ──
function agruparVisitas(data) {
  const sorted = [...data].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const pares = [];
  const sinPar = [];

  const checkinsPendientes = {};
  for (const v of sorted) {
    const key = `${v.cliente_id || ''}_${v.vendedor_id}`;
    if (v.tipo === 'checkin') {
      checkinsPendientes[key] = v;
    } else if (v.tipo === 'checkout') {
      const checkin = checkinsPendientes[key];
      if (checkin) {
        delete checkinsPendientes[key];
        const inicio = new Date(checkin.fecha);
        const fin = new Date(v.fecha);
        const diffMs = fin - inicio;
        const horas = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        const duracion = horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;
        pares.push({ ...checkin, checkout: v, duracion, duracionMs: diffMs });
      } else {
        sinPar.push({ ...v, checkout: null, duracion: '—', duracionMs: 0 });
      }
    }
  }
  for (const [key, checkin] of Object.entries(checkinsPendientes)) {
    sinPar.push({ ...checkin, checkout: null, duracion: 'En curso', duracionMs: 0 });
  }
  return { pares, sinPar };
}

async function cargarVisitas() {
  const vendedor = document.getElementById('filtro-visitas-vendedor')?.value || '';
  const desde = document.getElementById('filtro-visitas-desde')?.value || '';
  const hasta = document.getElementById('filtro-visitas-hasta')?.value || '';
  const params = new URLSearchParams({ limit: 200 });
  if (vendedor) params.set('vendedor', vendedor);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const r = await apiFetch('/visitas?' + params);
  if (!r.ok) return;
  const data = r.data.data || [];
  const { pares, sinPar } = agruparVisitas(data);

  // Stats
  const duracionTotal = pares.reduce((s, p) => s + p.duracionMs, 0);
  const horasTotal = Math.floor(duracionTotal / 3600000);
  const minsTotal = Math.floor((duracionTotal % 3600000) / 60000);
  const duracionProm = pares.length ? duracionTotal / pares.length : 0;
  const promH = Math.floor(duracionProm / 3600000);
  const promM = Math.floor((duracionProm % 3600000) / 60000);
  const clientesUnicos = new Set(pares.map(p => p.cliente_id).filter(Boolean)).size;

  document.getElementById('visitas-resumen').innerHTML = `
    <div class="stats-row" style="margin-bottom:0">
      <div class="stat-card"><div class="stat-value">${pares.length}</div><div class="stat-label">Visitas</div></div>
      <div class="stat-card"><div class="stat-value">${sinPar.length ? sinPar.filter(v => v.tipo === 'checkin').length : 0}</div><div class="stat-label">En curso</div></div>
      <div class="stat-card"><div class="stat-value">${clientesUnicos}</div><div class="stat-label">Clientes visitados</div></div>
      <div class="stat-card"><div class="stat-value">${horasTotal}h ${minsTotal}m</div><div class="stat-label">Tiempo total</div></div>
      <div class="stat-card"><div class="stat-value">${promH}h ${promM}m</div><div class="stat-label">Promedio por visita</div></div>
    </div>
  `;

  // Agrupar pares por cliente
  const todos = [...pares, ...sinPar];
  const grupos = {};
  for (const v of todos) {
    const key = v.cliente_nombre || 'Sin cliente';
    if (!grupos[key]) grupos[key] = { cliente_id: v.cliente_id, cliente_nombre: v.cliente_nombre, visitas: [] };
    grupos[key].visitas.push(v);
  }

  const container = document.getElementById('visitas-agrupadas');
  const sorted = Object.values(grupos).sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre));

  if (!sorted.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No hay visitas para los filtros seleccionados.</p>';
    return;
  }

  container.innerHTML = sorted.map((g, gi) => {
    const totalVisitas = g.visitas.length;
    return `
      <div class="visita-grupo">
        <div class="visita-grupo-header" onclick="toggleGrupoVisitas(${gi})">
          <span class="visita-grupo-icon" id="visita-icon-${gi}">▶</span>
          <strong>${esc(g.cliente_nombre)}</strong>
          <span style="color:var(--muted);margin-left:8px;font-size:12px">${totalVisitas} visita(s)</span>
        </div>
        <div class="visita-grupo-body" id="visita-body-${gi}" style="display:none">
          <table class="tbl"><thead><tr>
            <th>Llegada</th><th>Salida</th><th>Duracion</th><th>Ubicacion</th><th>Foto</th><th>Notas</th>
          </tr></thead><tbody>
            ${g.visitas.map(v => `
              <tr style="cursor:pointer" onclick="verDetalleVisita(${JSON.stringify({ ...v, checkout: v.checkout || null }).replace(/"/g, '&quot;')})">
                <td>${formatDateTime(v.fecha)}</td>
                <td>${v.checkout ? formatDateTime(v.checkout.fecha) : '<span style="color:var(--warning)">En curso</span>'}</td>
                <td><strong>${v.duracion}</strong></td>
                <td>${v.latitud ? `<a href="https://www.google.com/maps?q=${v.latitud},${v.longitud}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📍 Maps</a>` : '—'}</td>
                <td>${v.evidencia_foto ? `<a href="${v.evidencia_foto}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📷</a>` : '—'}</td>
                <td>${esc(v.notas || '—')}</td>
              </tr>
            `).join('')}
          </tbody></table>
        </div>
      </div>
    `;
  }).join('');
}

function toggleGrupoVisitas(idx) {
  const body = document.getElementById('visita-body-' + idx);
  const icon = document.getElementById('visita-icon-' + idx);
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : '';
  icon.textContent = visible ? '▶' : '▼';
}

function verDetalleVisita(v) {
  const lat = v.latitud ? parseFloat(v.latitud) : null;
  const lng = v.longitud ? parseFloat(v.longitud) : null;
  const hasCoords = lat && lng;

  // Store activity ID for delete
  document.getElementById('modal-detalle-visita').dataset.visitaId = v.id;
  document.getElementById('btn-eliminar-visita').style.display = '';

  document.getElementById('detalle-visita-title').textContent = `Actividad — ${esc(v.asunto || v.cliente_nombre || '')}`;
  document.getElementById('detalle-visita-content').innerHTML = `
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Cliente:</strong> ${esc(v.cliente_nombre || '—')}</div>
      <div><strong>Tipo:</strong> ${esc(v.tipo_actividad || '—')}</div>
    </div>
    ${v.asunto ? `<div style="margin-bottom:12px"><strong>Asunto:</strong> ${esc(v.asunto)}</div>` : ''}
    ${v.descripcion ? `<div style="margin-bottom:12px"><strong>Descripcion:</strong><br>${esc(v.descripcion)}</div>` : ''}
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Inicio:</strong> ${formatDateTime(v.fecha_inicio || v.fecha)}</div>
      <div><strong>Fin:</strong> ${v.fecha_fin ? formatDateTime(v.fecha_fin) : (v.checkout ? formatDateTime(v.checkout.fecha) : '—')}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Estado:</strong> ${esc(v.estado || (v.checkout ? 'realizada' : 'en_proceso'))}</div>
      <div><strong>Recordatorio:</strong> ${esc(v.recordatorio || 'nunca')}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Duracion:</strong> <span style="font-size:16px;font-weight:700;color:var(--accent)">${v.duracion || '—'}</span></div>
      <div><strong>Lugar:</strong> ${esc(v.lugar || '—')}</div>
    </div>
    ${v.propietario_nombre ? `<div style="margin-bottom:12px"><strong>Propietario:</strong> ${esc(v.propietario_nombre || '#' + v.vendedor_id)}</div>` : `<div style="margin-bottom:12px"><strong>Vendedor:</strong> ${esc(v.vendedor_nombre || '#' + v.vendedor_id)}</div>`}
    ${hasCoords ? `
      <div style="margin-bottom:12px">
        <strong>Ubicacion:</strong>
        <div id="visita-map" style="height:250px;border-radius:8px;border:1px solid var(--border);margin-top:6px"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">
          ${lat.toFixed(6)}, ${lng.toFixed(6)} ·
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" style="color:var(--accent)">Abrir en Google Maps</a>
        </div>
      </div>
    ` : ''}
    ${v.evidencia_foto ? `
      <div style="margin-bottom:12px"><strong>Evidencia:</strong><br>
        <a href="${v.evidencia_foto}" target="_blank" rel="noopener"><img src="${v.evidencia_foto}" style="max-width:100%;max-height:300px;border-radius:8px;margin-top:8px;border:1px solid var(--border)"></a>
      </div>
    ` : ''}
    ${v.notas ? `<div style="margin-bottom:12px"><strong>Notas:</strong><br>${esc(v.notas)}</div>` : ''}
  `;
  showModal('modal-detalle-visita');

  if (hasCoords) {
    setTimeout(() => {
      const mapEl = document.getElementById('visita-map');
      if (!mapEl || mapEl._leaflet_id) return;
      const map = L.map(mapEl, { zoomControl: true }).setView([lat, lng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
      }).addTo(map);
      const marker = L.marker([lat, lng]).addTo(map);
      marker.bindPopup(`<strong>${esc(v.cliente_nombre || 'Visita')}</strong><br>${formatDateTime(v.fecha)}`).openPopup();
      setTimeout(() => map.invalidateSize(), 200);
    }, 150);
  }
}

async function eliminarActividad() {
  const id = document.getElementById('modal-detalle-visita').dataset.visitaId;
  if (!id) return;
  confirmar({ titulo: 'Eliminar actividad', mensaje: 'Eliminar esta actividad?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/visitas/' + id, { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast('Actividad eliminada', 'success');
    hideModal('modal-detalle-visita');
    cargarVisitas();
  }});
}

function limpiarFiltrosVisitas() {
  document.getElementById('filtro-visitas-vendedor').value = '';
  document.getElementById('filtro-visitas-desde').value = '';
  document.getElementById('filtro-visitas-hasta').value = '';
  cargarVisitas();
}

let _actClientesCache = [];
let _actClienteTimer = null;

async function cargarActClientesCache() {
  if (_actClientesCache.length) return _actClientesCache;
  const r = await apiFetch('/clientes?limit=1000');
  if (!r.ok) return [];
  const data = r.data.data || r.data || [];
  _actClientesCache = Array.isArray(data) ? data : [];
  return _actClientesCache;
}

async function filtrarActClientes(q) {
  const sel = document.getElementById('act-cliente');
  const inp = document.getElementById('act-cliente-search');
  if (inp && inp.readOnly) return;
  const qq = (q || '').trim();
  if (!qq || qq.length < 2) { sel.style.display = 'none'; sel.innerHTML = ''; return; }
  clearTimeout(_actClienteTimer);
  _actClienteTimer = setTimeout(async () => {
    const r = await apiFetch('/clientes?search=' + encodeURIComponent(qq) + '&limit=20');
    if (!r.ok) return;
    const data = r.data.data || [];
    if (!data.length) { sel.innerHTML = '<option>No hay resultados</option>'; sel.style.display = ''; sel.size = 1; return; }
    sel.innerHTML = data.map(c => `<option value="${c.id}">${esc(c.nombre)} — ${esc(c.nit || '')}</option>`).join('');
    sel.style.display = ''; sel.size = Math.min(6, data.length + 1);
    sel.onchange = () => {
      const opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value || opt.textContent === 'No hay resultados') return;
      inp.value = opt.textContent; inp.readOnly = true; inp.title = 'Seleccionado — clic para cambiar';
      inp.onclick = () => {
        inp.value = ''; inp.readOnly = false; inp.placeholder = 'Buscar por NIT o nombre...';
        sel.value = ''; sel.innerHTML = ''; sel.style.display = 'none'; inp.onclick = null;
      };
      sel.style.display = 'none';
    };
  }, 300);
}

let _actMap = null;

function actualizarActGPSGroup() {
  const tipo = document.getElementById('act-tipo')?.value;
  const estado = document.getElementById('act-estado')?.value;
  const group = document.getElementById('act-gps-group');
  if (!group) return;
  group.style.display = '';
  const necesita = ['reunion', 'visita'].includes(tipo) && (estado === 'en_proceso' || estado === 'realizada');
  const hint = document.querySelector('#act-gps-group label small');
  if (hint) hint.textContent = necesita ? '— auto al guardar (Reunión/Visita)' : '— se capturará al pasar a En Proceso / Realizada (solo Reunión/Visita)';
  setTimeout(() => {
    const mapEl = document.getElementById('act-map');
    if (mapEl && !mapEl._leaflet_id) {
      _actMap = L.map(mapEl, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([4.6, -74.07], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(_actMap);
      setTimeout(() => _actMap.invalidateSize(), 200);
    } else if (_actMap) {
      setTimeout(() => _actMap.invalidateSize(), 150);
    }
  }, 120);
  if (necesita) {
    const coordsEl = document.getElementById('act-coords');
    const textEl = document.getElementById('act-coords-text');
    if ((!coordsEl.dataset.lat || !coordsEl.dataset.lng) && (!textEl || textEl.textContent === '—')) obtenerGPSAct();
  }
}

function setActMapMarker(lat, lng) {
  if (!_actMap) return;
  _actMap.setView([lat, lng], 16);
  _actMap.eachLayer(l => { if (l instanceof L.Marker) _actMap.removeLayer(l); });
  L.marker([lat, lng]).addTo(_actMap);
  setTimeout(() => _actMap.invalidateSize(), 150);
}

function obtenerGPSAct() {
  const el = document.getElementById('act-coords');
  const textEl = document.getElementById('act-coords-text');
  if (!el) return;
  if (!navigator.geolocation) { if (textEl) textEl.textContent = 'GPS no disponible'; return; }
  if (textEl) textEl.textContent = 'Obteniendo GPS...';
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude.toFixed(6);
    const lng = pos.coords.longitude.toFixed(6);
    el.dataset.lat = lat;
    el.dataset.lng = lng;
    el.dataset.precision = String(Math.round(pos.coords.accuracy));
    if (textEl) textEl.textContent = `${lat}, ${lng} · ±${Math.round(pos.coords.accuracy)}m`;
    setActMapMarker(parseFloat(lat), parseFloat(lng));
  }, err => {
    if (textEl) textEl.textContent = 'Error GPS: ' + err.message;
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function obtenerGPSActPromise() {
  return new Promise(resolve => {
    const el = document.getElementById('act-coords');
    const textEl = document.getElementById('act-coords-text');
    if (el && el.dataset.lat && el.dataset.lng) return resolve();
    if (!navigator.geolocation) return resolve();
    navigator.geolocation.getCurrentPosition(pos => {
      if (el) {
        el.dataset.lat = String(pos.coords.latitude.toFixed(6));
        el.dataset.lng = String(pos.coords.longitude.toFixed(6));
        el.dataset.precision = String(Math.round(pos.coords.accuracy));
        if (textEl) textEl.textContent = `${el.dataset.lat}, ${el.dataset.lng} · ±${el.dataset.precision}m`;
        setActMapMarker(parseFloat(el.dataset.lat), parseFloat(el.dataset.lng));
      }
      resolve();
    }, () => resolve(), { enableHighAccuracy: true, timeout: 7000 });
  });
}

async function abrirModalCrearActividad() {
  document.getElementById('act-asunto').value = '';
  document.getElementById('act-descripcion').value = '';
  document.getElementById('act-tipo').value = 'reunion';
  document.getElementById('act-lugar').value = '';
  document.getElementById('act-fecha-inicio').value = '';
  document.getElementById('act-fecha-fin').value = '';
  document.getElementById('act-estado').value = 'no_iniciada';
  document.getElementById('act-recordatorio').value = 'nunca';
  document.getElementById('act-foto').value = '';
  const coordsEl2 = document.getElementById('act-coords');
  coordsEl2.value = ''; coordsEl2.dataset.lat = ''; coordsEl2.dataset.lng = ''; coordsEl2.dataset.precision = '';
  const txt2 = document.getElementById('act-coords-text'); if (txt2) txt2.textContent = '—';
  if (_actMap) { try { _actMap.remove(); } catch {} _actMap = null; const mEl = document.getElementById('act-map'); if (mEl) { mEl._leaflet_id = null; mEl.innerHTML = ''; } }
  const inp = document.getElementById('act-cliente-search');
  const sel = document.getElementById('act-cliente');
  inp.value = ''; inp.readOnly = false; inp.placeholder = 'Buscar por NIT o nombre...'; inp.onclick = null;
  sel.value = ''; sel.innerHTML = ''; sel.style.display = 'none';
  if (!inp.dataset.bound) {
    inp.dataset.bound = '1';
    inp.addEventListener('input', () => filtrarActClientes(inp.value));
  }
  await cargarActClientesCache();
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const fi = document.getElementById('act-fecha-inicio');
  const ff = document.getElementById('act-fecha-fin');
  fi.min = nowLocal; ff.min = nowLocal;
  fi.removeAttribute('max'); ff.removeAttribute('max');
  const tipoEl = document.getElementById('act-tipo');
  const estadoEl = document.getElementById('act-estado');
  tipoEl.onchange = actualizarActGPSGroup;
  estadoEl.onchange = actualizarActGPSGroup;
  actualizarActGPSGroup();
  showModal('modal-crear-actividad');
}

async function guardarActividad() {
  const clienteId = document.getElementById('act-cliente').value;
  const asunto = document.getElementById('act-asunto').value.trim();
  const descripcion = document.getElementById('act-descripcion').value.trim();
  const tipo = document.getElementById('act-tipo').value;
  const estado = document.getElementById('act-estado').value;
  const fechaInicioVal = document.getElementById('act-fecha-inicio').value;
  const fechaFinVal = document.getElementById('act-fecha-fin').value;
  if (!clienteId) return toast('Selecciona un cliente (busca por NIT o nombre y elige)', 'error');
  if (!asunto && !descripcion) return toast('Escribe el nombre de la actividad', 'error');
  const now = new Date(); now.setSeconds(0,0);
  if (fechaInicioVal && new Date(fechaInicioVal) < now) return toast('Fecha inicio no puede ser pasada (anti-fraude)', 'error');
  if (fechaFinVal && new Date(fechaFinVal) < now) return toast('Fecha fin no puede ser pasada (anti-fraude)', 'error');
  if (fechaInicioVal && fechaFinVal && new Date(fechaFinVal) < new Date(fechaInicioVal)) return toast('Fecha fin no puede ser anterior a inicio', 'error');

  const btn = document.getElementById('btn-guardar-actividad');
  const necesitaGPS = ['reunion', 'visita'].includes(tipo) && (estado === 'en_proceso' || estado === 'realizada');
  if (necesitaGPS) {
    const coordsEl = document.getElementById('act-coords');
    if (!coordsEl.dataset.lat) {
      btn.disabled = true; btn.textContent = 'Obteniendo GPS...';
      await obtenerGPSActPromise();
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  }

  const fd = new FormData();
  fd.append('cliente_id', clienteId);
  fd.append('asunto', asunto);
  fd.append('descripcion', descripcion);
  fd.append('tipo_actividad', tipo);
  fd.append('lugar', document.getElementById('act-lugar').value);
  fd.append('fecha_inicio', document.getElementById('act-fecha-inicio').value || '');
  fd.append('fecha_fin', document.getElementById('act-fecha-fin').value || '');
  fd.append('estado', estado);
  fd.append('recordatorio', document.getElementById('act-recordatorio').value);
  const coordsEl = document.getElementById('act-coords');
  if (coordsEl.dataset.lat && coordsEl.dataset.lng) {
    fd.append('latitud', coordsEl.dataset.lat);
    fd.append('longitud', coordsEl.dataset.lng);
    fd.append('precision_gps', coordsEl.dataset.precision || '');
  }
  const foto = document.getElementById('act-foto').files[0];
  if (foto) fd.append('foto', foto);

  btn.disabled = true; btn.textContent = 'Guardando...';
  const r = await fetch(HF.API + '/actividades', { method: 'POST', credentials: 'include', body: fd });
  const data = await r.json().catch(() => ({}));
  btn.disabled = false; btn.textContent = 'Guardar';
  if (!r.ok) return toast(data.error || 'Error al crear', 'error');
  toast(necesitaGPS ? (estado === 'en_proceso' ? 'Check-in registrado' : 'Check-out registrado') : 'Actividad creada', 'success');
  hideModal('modal-crear-actividad');
  cargarVisitas();
}

async function abrirModalVisita(tipo) {
  document.getElementById('modal-visita-title').textContent = tipo === 'checkin' ? 'Check-in' : 'Check-out';
  document.getElementById('visita-tipo').value = tipo;
  document.getElementById('visita-coords').value = 'Obteniendo GPS...';
  document.getElementById('visita-notas').value = '';
  document.getElementById('visita-foto').value = '';
  document.getElementById('visita-asunto').value = '';
  document.getElementById('visita-lugar').value = '';
  document.getElementById('visita-tipo-actividad').value = 'visita';
  document.getElementById('btn-guardar-visita').disabled = true;
  document.getElementById('btn-guardar-visita').textContent = 'Obteniendo GPS...';
  await cargarClientesSelect('visita-cliente', '');
  document.getElementById('visita-cliente').onchange = () => {
    cargarContactosVisita();
    cargarOportunidadesVisita();
  };
  await cargarContactosVisita();
  await cargarOportunidadesVisita();
  showModal('modal-visita');
  obtenerGPSVisita();
}

async function cargarContactosVisita() {
  const clienteId = document.getElementById('visita-cliente')?.value;
  const sel = document.getElementById('visita-contacto');
  sel.innerHTML = '<option value="">Sin contacto</option>';
  if (!clienteId) return;
  const r = await apiFetch('/contactos?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  for (const c of r.data.data || []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre;
    sel.appendChild(opt);
  }
}

async function cargarOportunidadesVisita() {
  const clienteId = document.getElementById('visita-cliente')?.value;
  const sel = document.getElementById('visita-oportunidad');
  sel.innerHTML = '<option value="">Sin oportunidad</option>';
  if (!clienteId) return;
  const r = await apiFetch('/oportunidades?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  for (const o of r.data.data || []) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.nombre;
    sel.appendChild(opt);
  }
}

function obtenerGPSVisita() {
  if (!navigator.geolocation) {
    document.getElementById('visita-coords').value = 'GPS no disponible';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coords = `${pos.coords.latitude},${pos.coords.longitude}`;
      document.getElementById('visita-coords').value = coords;
      document.getElementById('visita-coords').dataset.precision = pos.coords.accuracy;
      document.getElementById('btn-guardar-visita').disabled = false;
      document.getElementById('btn-guardar-visita').textContent = 'Guardar';
    },
    (err) => {
      document.getElementById('visita-coords').value = 'Error GPS: ' + err.message;
      document.getElementById('btn-guardar-visita').disabled = false;
      document.getElementById('btn-guardar-visita').textContent = 'Reintentar GPS';
      document.getElementById('btn-guardar-visita').onclick = () => { obtenerGPSVisita(); };
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

async function guardarVisita() {
  const tipo = document.getElementById('visita-tipo').value;
  const coords = document.getElementById('visita-coords').value;
  if (!coords || coords.includes('Obteniendo') || coords.includes('Error')) {
    return toast('Espera a obtener el GPS', 'warning');
  }
  const [lat, lng] = coords.split(',');
  const clienteId = document.getElementById('visita-cliente').value;
  if (!clienteId) return toast('Selecciona un cliente', 'error');

  const formData = new FormData();
  formData.append('tipo', tipo);
  formData.append('cliente_id', clienteId);
  formData.append('contacto_id', document.getElementById('visita-contacto').value);
  formData.append('oportunidad_id', document.getElementById('visita-oportunidad').value);
  formData.append('latitud', lat.trim());
  formData.append('longitud', lng.trim());
  formData.append('precision_gps', document.getElementById('visita-coords').dataset.precision || '');
  formData.append('notas', document.getElementById('visita-notas').value);
  formData.append('asunto', document.getElementById('visita-asunto').value);
  formData.append('lugar', document.getElementById('visita-lugar').value);
  formData.append('tipo_actividad', document.getElementById('visita-tipo-actividad').value);
  const foto = document.getElementById('visita-foto').files[0];
  if (foto) formData.append('foto', foto);

  const r = await fetch(HF.API + '/visitas/' + tipo, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  const data = await r.json();
  if (!r.ok) return toast(data.error || 'Error al guardar', 'error');
  toast(tipo === 'checkin' ? 'Check-in registrado' : 'Check-out registrado', 'success');
  hideModal('modal-visita');
  cargarVisitas();
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Cotizaciones ──
let _cotizacionesPage = 1;
let _cotizacionItems = [];
let _cotSort = 'creado_en';
let _cotOrder = 'desc';

async function cargarCotizaciones() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-cotizacion-search')?.value;
    const estado = document.getElementById('filtro-cotizacion-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);
    params.set('sort', _cotSort);
    params.set('order', _cotOrder);
    params.set('page', _cotizacionesPage);
    params.set('limit', _limit);

    const r = await apiFetch('/cotizaciones?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-cotizaciones');
    const data = r.data.data || [];
    const erpColors = { '': 'info', 'borrador': 'info', 'enviada': 'warning', 'aprobada': 'success', 'rechazada': 'danger', 'vencida': 'muted', 'convertida': 'success' };
    tbody.innerHTML = data.map(c => {
      const sinCPV = !c.documento_erp;
      const estadoErpHtml = sinCPV
        ? '<span class="badge badge-danger">No enviado</span>'
        : `<span class="badge badge-info">${esc(c.estado_erp)}</span>`;
      const docErpHtml = sinCPV ? '<span style="color:var(--muted)">—</span>' : esc(c.documento_erp);
      return `
      <tr class="${sinCPV ? 'row-no-erp' : ''}">
        <td><input type="checkbox" class="row-check cb-cotizacion" value="${c.id}" onchange="updateBulkBar()"></td>
        <td><a href="#" onclick="verCotizacion('${c.id}');return false" style="color:var(--accent);text-decoration:underline">${esc(c.numero)}</a></td>
        <td>${esc(c.cliente_nombre || '—')}</td>
        <td><span class="badge badge-${c.estado}">${esc(c.estado)}</span></td>
        <td>${c.total_items || 0}</td>
        <td><strong>$${formatMoney(c.valor_total || 0)}</strong></td>
        <td>${formatDate(c.vencimiento)}</td>
        <td>${estadoErpHtml}</td>
        <td>${docErpHtml}</td>
        <td>
          <button class="btn btn-sm btn-secondary btn-action" onclick="editarCotizacion('${c.id}')" title="Editar cotizacion" aria-label="Editar cotizacion ${esc(c.numero)}">✏️</button>
          ${c.estado === 'borrador' ? `<button class="btn btn-sm btn-danger btn-action" onclick="eliminarCotizacion('${c.id}')" title="Eliminar cotizacion" aria-label="Eliminar cotizacion ${esc(c.numero)}">🗑️</button>` : ''}
          ${c.estado === 'borrador' ? `<button class="btn btn-sm btn-primary btn-action" onclick="cambiarEstadoCotizacion('${c.id}','enviada')" title="Enviar cotizacion" aria-label="Enviar cotizacion ${esc(c.numero)}">📤</button>` : ''}
          ${c.estado === 'enviada' ? `<button class="btn btn-sm btn-primary btn-action" onclick="cambiarEstadoCotizacion('${c.id}','aprobada')" title="Aprobar cotizacion" aria-label="Aprobar cotizacion ${esc(c.numero)}">✅</button>` : ''}
          ${sinCPV ? `<button class="btn btn-sm btn-primary btn-action" onclick="enviarCotizacionERP('${c.id}','${esc(c.numero)}')" title="Enviar al ERP" aria-label="Enviar cotizacion ${esc(c.numero)} al ERP">🚀</button>` : ''}
        </td>
      </tr>
    `}).join('');

    renderPagination('pag-cotizaciones', r.data.total, _cotizacionesPage, _limit, (p) => { _cotizacionesPage = p; cargarCotizaciones(); });
    cargarStatsCotizaciones();
  } catch (err) { console.error('Error cargar cotizaciones:', err); }
}

async function cargarStatsCotizaciones() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-cotizacion-search')?.value;
    const estado = document.getElementById('filtro-cotizacion-estado')?.value;
    if (search) params.set('search', search);
    if (estado) params.set('estado', estado);

    const r = await apiFetch('/cotizaciones/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-cotizaciones').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value">$${formatMoney(d.monto_total || 0)}</div><div class="stat-label">Monto total</div></div>
      <div class="stat-card"><div class="stat-value">${d.descuentos_pendientes || 0}</div><div class="stat-label">Desc. pendientes</div></div>
    `;
  } catch {}
}

function sortCotizaciones(col) {
  if (_cotSort === col) _cotOrder = _cotOrder === 'asc' ? 'desc' : 'asc';
  else { _cotSort = col; _cotOrder = 'asc'; }
  // actualizar indicadores
  document.querySelectorAll('[id^="sort-cot-"]').forEach(el => el.textContent = '');
  const ind = document.getElementById('sort-cot-' + col);
  if (ind) ind.textContent = _cotOrder === 'asc' ? '▲' : '▼';
  cargarCotizaciones();
}

function limpiarFiltrosCotizaciones() {
  document.getElementById('filtro-cotizacion-search').value = '';
  document.getElementById('filtro-cotizacion-estado').value = '';
  _cotizacionesPage = 1;
  _cotSort = 'creado_en'; _cotOrder = 'desc';
  document.querySelectorAll('[id^="sort-cot-"]').forEach(el => el.textContent = '');
  cargarCotizaciones();
}

async function abrirModalCotizacion(cotizacion = null) {
  document.getElementById('modal-cotizacion-title').textContent = cotizacion ? 'Editar Cotizacion' : 'Nueva Cotizacion';
  document.getElementById('cotizacion-id').value = cotizacion?.id || '';
  // Consecutivo preview
  const preview = document.getElementById('cotizacion-numero-preview');
  if (cotizacion?.numero) {
    preview.textContent = `Consecutivo: ${cotizacion.numero}`;
    preview.style.display = '';
  } else {
    preview.textContent = 'Generando consecutivo...';
    preview.style.display = '';
    try {
      const r = await apiFetch('/cotizaciones/proximo-numero');
      if (r.ok) preview.textContent = `Consecutivo: ${r.data.numero} (se asignará al guardar)`;
      else preview.style.display = 'none';
    } catch { preview.style.display = 'none'; }
  }
  document.getElementById('cotizacion-validez').value = cotizacion?.validez_dias || 30;
  document.getElementById('cotizacion-descuento').value = 0;
  document.getElementById('cotizacion-notas').value = cotizacion?.notas || '';
  document.getElementById('cotizacion-orden-compra').value = cotizacion?.orden_compra || '';
  document.getElementById('cotizacion-centro-op').value = cotizacion?.centro_operacion || '';
  document.getElementById('cotizacion-bodega').value = cotizacion?.bodega || '';
  document.getElementById('cotizacion-condicion-pago').value = cotizacion?.condicion_pago || '';
  document.getElementById('cotizacion-fecha-entrega').value = cotizacion?.fecha_entrega ? cotizacion.fecha_entrega.split('T')[0] : '';

  // Reset cliente searchable y sucursales
  document.getElementById('cotizacion-cliente-search').value = '';
  document.getElementById('cotizacion-cliente').style.display = 'none';
  document.getElementById('cotizacion-cliente').innerHTML = '';
  document.getElementById('cotizacion-cliente-selected').style.display = 'none';
  document.getElementById('cotizacion-cliente-selected').textContent = '';
  document.getElementById('cotizacion-vendedor-info').style.display = 'none';
  document.getElementById('cotizacion-contacto').innerHTML = '<option value="">Sin contacto</option>';
  document.getElementById('cotizacion-facturar-a').innerHTML = '<option value="">Seleccione sucursal</option>';
  document.getElementById('cotizacion-despachar-a').innerHTML = '<option value="">Seleccione sucursal</option>';
  if (cotizacion?.cliente_id) {
    const rc = await apiFetch('/clientes/' + cotizacion.cliente_id);
    if (rc.ok) {
      const c = rc.data.data;
      const sel = document.getElementById('cotizacion-cliente');
      const inp = document.getElementById('cotizacion-cliente-search');
      sel.innerHTML = `<option value="${c.id}" selected>${esc(c.nombre)} — ${esc(c.nit || '')}</option>`;
      sel.value = c.id;
      inp.value = `${c.nombre} — ${c.nit || ''}`; inp.readOnly = true; inp.title = 'Seleccionado — clic para cambiar';
      inp.onclick = () => { inp.value=''; inp.readOnly=false; inp.placeholder='Buscar por NIT o nombre...'; sel.value=''; sel.innerHTML=''; sel.style.display='none'; document.getElementById('cotizacion-contacto').innerHTML='<option value="">Sin contacto</option>'; document.getElementById('cotizacion-facturar-a').innerHTML='<option value="">Seleccione sucursal</option>'; document.getElementById('cotizacion-despachar-a').innerHTML='<option value="">Seleccione sucursal</option>'; document.getElementById('cotizacion-vendedor-info').style.display='none'; document.getElementById('cotizacion-condicion-pago').value=''; inp.onclick=null; };
      const sd = document.getElementById('cotizacion-cliente-selected'); if(sd) sd.style.display='none';
      await cargarContactosCotizacion(c.id, cotizacion?.contacto_id || null);
      await cargarSucursalesCotizacion(c.id, cotizacion?.facturar_a || null, cotizacion?.despachar_a || null);
      // defaults del cliente
      if (!cotizacion?.centro_operacion && c.c_o_factura_desc) {
        // intenta mapear centro por nombre
        const centroSel = document.getElementById('cotizacion-centro-op');
        const opt = [...centroSel.options].find(o => o.textContent.includes(c.c_o_factura_desc));
        if (opt) centroSel.value = opt.value;
      }
      // lista de precios asignada al cliente (visible)
      {
        let lp = cotizacion?.lista_precios || c.lista_precio_codigo || c.lista_precios;
        if (!lp) lp = await getPerfilListaDefault();
        const def = await getPerfilListaDefault();
        const lpDesc = c.lista_precios && c.lista_precios !== lp ? c.lista_precios : (lp === def ? 'GENERAL HORECA' : '');
        const lpLabel = lpDesc ? `${lp} — ${lpDesc}` : lp;
        document.getElementById('cotizacion-lista-precios').value = lpLabel;
        window._cotizacionListaPrecio = lp;
      }
      {
        const vend = c.razon_social_vendedor || (c.vendedor_codigo ? `Vendedor ${c.vendedor_codigo}` : '');
        const vInfo = document.getElementById('cotizacion-vendedor-info');
        if (vend) { vInfo.textContent = `Vendedor asignado: ${vend} — la venta quedará a su nombre`; vInfo.style.display = ''; }
      }
    }
  }
  // si no hay cliente, default lista del perfil (o 200)
  const defLista = await getPerfilListaDefault();
  if (!cotizacion?.cliente_id && !cotizacion?.lista_precios) {
    document.getElementById('cotizacion-lista-precios').value = defLista + ' — GENERAL HORECA';
    window._cotizacionListaPrecio = defLista;
  } else if (cotizacion?.lista_precios && !document.getElementById('cotizacion-lista-precios').value) {
    document.getElementById('cotizacion-lista-precios').value = cotizacion.lista_precios;
    window._cotizacionListaPrecio = cotizacion.lista_precios;
  }
  await cargarOportunidadesSelect('cotizacion-oportunidad', cotizacion?.oportunidad_id);
  await cargarCentrosCotizacion(cotizacion?.centro_operacion || null);
  await cargarBodegasCotizacion(cotizacion?.bodega || null);

  _cotizacionItems = [];
  if (cotizacion?.id) {
    const r = await apiFetch('/cotizaciones/' + cotizacion.id);
    if (r.ok) {
      _cotizacionItems = r.data.data.items || [];
      document.getElementById('cotizacion-descuento').value = r.data.data.valor_descuento > 0 ? ((r.data.data.valor_descuento / r.data.data.valor_subtotal) * 100).toFixed(2) : 0;
    }
  }
  renderItemsCotizacion();
  cambiarTabCotizacion('datos', document.querySelector('#modal-cotizacion .tab-btn'));
  showModal('modal-cotizacion');
}

function cambiarTabCotizacion(tab, btn) {
  document.querySelectorAll('#modal-cotizacion [id^="tab-cotizacion-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#modal-cotizacion .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-cotizacion-' + tab).style.display = '';
  if (btn) btn.classList.add('active');
}

let _cotClienteTimer = null;
async function filtrarCotizacionClientes(q) {
  const sel = document.getElementById('cotizacion-cliente');
  const inp = document.getElementById('cotizacion-cliente-search');
  if (inp && inp.readOnly) return;
  const qq = (q || '').trim();
  if (!qq || qq.length < 2) { sel.style.display = 'none'; sel.innerHTML = ''; return; }
  clearTimeout(_cotClienteTimer);
  _cotClienteTimer = setTimeout(async () => {
    const r = await apiFetch('/clientes?search=' + encodeURIComponent(qq) + '&limit=20');
    if (!r.ok) return;
    const data = r.data.data || [];
    if (!data.length) { sel.innerHTML = '<option>No hay resultados</option>'; sel.style.display = ''; sel.size=Math.min(6,1); return; }
    sel.innerHTML = data.map(c => `<option value="${c.id}">${esc(c.nombre)} — ${esc(c.nit || '')}</option>`).join('');
    sel.style.display = ''; sel.size=Math.min(6,data.length+1);
    sel.onchange = async () => {
      const opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value || opt.textContent === 'No hay resultados') return;
      inp.value = opt.textContent; inp.readOnly = true; inp.title = 'Seleccionado — clic para cambiar';
      inp.onclick = () => { inp.value=''; inp.readOnly=false; inp.placeholder='Buscar por NIT o nombre...'; sel.value=''; sel.innerHTML=''; sel.style.display='none'; document.getElementById('cotizacion-contacto').innerHTML='<option value="">Sin contacto</option>'; document.getElementById('cotizacion-facturar-a').innerHTML='<option value="">Seleccione sucursal</option>'; document.getElementById('cotizacion-despachar-a').innerHTML='<option value="">Seleccione sucursal</option>'; document.getElementById('cotizacion-vendedor-info').style.display='none'; inp.onclick=null; (async()=>{const d=await getPerfilListaDefault(); document.getElementById('cotizacion-lista-precios').value=d+' — GENERAL HORECA'; window._cotizacionListaPrecio=d;})(); };
      sel.style.display = 'none';
      const sd=document.getElementById('cotizacion-cliente-selected'); if(sd) sd.style.display='none';
      await cargarContactosCotizacion(opt.value);
      await cargarSucursalesCotizacion(opt.value);
      // trae defaults del cliente: condicion pago y lista precios
      try {
        const cr = await apiFetch('/clientes/' + opt.value);
        if (cr.ok) {
          const c = cr.data.data;
          let lp = c.lista_precio_codigo || c.lista_precios;
          if (!lp) lp = await getPerfilListaDefault();
          const lpDesc = c.lista_precios && c.lista_precios !== lp ? c.lista_precios : (lp === (await getPerfilListaDefault()) ? 'GENERAL HORECA' : '');
          // fallback to resolve name if needed
          let lpLabel = lpDesc ? `${lp} — ${lpDesc}` : lp;
          // try to resolve name from maestro cache if desc is just code
          if (!lpDesc || lpDesc === lp) {
            try {
              const cache = window._maestroCache?.['perfil-maestro-lista_precio'];
              const found = cache?.find(x=> String(x.codigo)===String(lp));
              if (found) lpLabel = `${lp} — ${found.nombre}`;
            } catch {}
          }
          document.getElementById('cotizacion-lista-precios').value = lpLabel;
          window._cotizacionListaPrecio = lp;
          let vend = c.razon_social_vendedor || '';
          if (!vend && c.vendedor_codigo) {
            try {
              const vr = await apiFetch('/perfiles-venta/vendedores');
              const vmap = new Map((vr.ok && vr.data.data || vr.data || []).map(v=>[String(v.codigo), v.nombre]));
              const vname = vmap.get(String(c.vendedor_codigo));
              vend = vname ? `${vname} (${c.vendedor_codigo})` : `Vendedor ${c.vendedor_codigo}`;
            } catch { vend = `Vendedor ${c.vendedor_codigo}`; }
          }
          const vInfo = document.getElementById('cotizacion-vendedor-info');
          if (vend) { vInfo.textContent = `Vendedor asignado: ${vend} — la venta quedará a su nombre`; vInfo.style.display = ''; }
          else { vInfo.style.display = 'none'; }
          // Condición de pago desde el maestro del tercero (medio_pago_desc)
          const cond = c.medio_pago_desc || c.medio_pago || c.condicion_pago || '';
          const condEl = document.getElementById('cotizacion-condicion-pago');
          if (condEl) { condEl.value = cond; condEl.placeholder = cond ? cond : 'Ej: CREDITO 30 DIAS, CONTADO'; }
        }
      } catch {}
    };
  }, 300);
}

async function cargarContactosCotizacion(clienteId, selectedId = null) {
  const sel = document.getElementById('cotizacion-contacto');
  sel.innerHTML = '<option value="">Sin contacto</option>';
  if (!clienteId) return;
  const r = await apiFetch('/contactos?cliente_id=' + clienteId + '&limit=100');
  if (!r.ok) return;
  const data = r.data.data || [];
  sel.innerHTML = '<option value="">Sin contacto</option>' + data.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.nombre)}${c.cargo ? ' — '+esc(c.cargo):''}</option>`).join('');
}

async function cargarSucursalesCotizacion(clienteId, facturarVal = null, despacharVal = null) {
  const fSel = document.getElementById('cotizacion-facturar-a');
  const dSel = document.getElementById('cotizacion-despachar-a');
  if (!fSel || !dSel) return;
  fSel.innerHTML = '<option value="">Seleccione sucursal</option>';
  dSel.innerHTML = '<option value="">Seleccione sucursal</option>';
  if (!clienteId) return;
  const r = await apiFetch('/clientes/' + clienteId + '/sucursales');
  if (!r.ok) return;
  const data = r.data.data || [];
  const opts = data.map(s => {
    const label = `${esc(s.codigo)} — ${esc(s.nombre)}${s.es_principal ? ' ★ Principal' : ''} · ${esc(s.ciudad || '')}`;
    return `<option value="${esc(s.codigo)}" data-id="${s.id}">${label}</option>`;
  }).join('');
  fSel.innerHTML = '<option value="">Seleccione sucursal</option>' + opts;
  dSel.innerHTML = '<option value="">Seleccione sucursal</option>' + opts;
  const principal = data.find(s => s.es_principal);
  if (principal) {
    if (!facturarVal) fSel.value = principal.codigo;
    if (!despacharVal) dSel.value = principal.codigo;
  }
  if (facturarVal) fSel.value = facturarVal;
  if (despacharVal) dSel.value = despacharVal;
}

let _perfilListaDefaultCache = null;
let _perfilConfigCache = null;
async function getPerfilConfig(){
  if(_perfilConfigCache) return _perfilConfigCache;
  try {
    const r = await apiFetch('/perfiles-venta/me/config', { cache: 'no-store' });
    if(r.ok) { _perfilConfigCache = r.data.config || {}; return _perfilConfigCache; }
  } catch {}
  _perfilConfigCache = {};
  return _perfilConfigCache;
}
function _filtrarPorPerfil(lista, key, getCodigo){
  const cfg = _perfilConfigCache;
  if(!cfg) return lista;
  const permitidos = cfg[key];
  if(!Array.isArray(permitidos) || !permitidos.length) return lista;
  const set=new Set(permitidos.map(String));
  return lista.filter(it=> set.has(String(getCodigo(it))));
}
async function getPerfilListaDefault() {
  if (_perfilListaDefaultCache) return _perfilListaDefaultCache;
  const cfg = await getPerfilConfig();
  if(cfg.lista_por_defecto){ _perfilListaDefaultCache = String(cfg.lista_por_defecto); return _perfilListaDefaultCache; }
  _perfilListaDefaultCache = '200';
  return _perfilListaDefaultCache;
}

async function cargarCentrosCotizacion(selected) {
  const sel = document.getElementById('cotizacion-centro-op');
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccione centro de operación</option>';
  try {
    await getPerfilConfig();
    const r = await apiFetch('/centros');
    const centros = r.ok ? (r.data || r.data?.data || []) : [];
    // Fallback: la respuesta puede ser array directo o {ok,data}
    const lista = Array.isArray(centros) ? centros : (centros.data || []);
    // Si endpoint devuelve {ok:true,data:[...]} adaptamos
    const items = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : lista);
    // Si sigue vacío, intentar fetch directo a /api/centros (launcher) via HF.API
    let final = items;
    if (!final.length) {
      try { const rr = await fetch(HF.API.replace(/\/crm\/api.*/, '/api/centros'), { credentials:'include' }).then(x=>x.json()); if (Array.isArray(rr)) final = rr; else if (Array.isArray(rr.data)) final = rr.data; } catch {}
    }
    // Filtrar por perfil (SIESA Hub): si el perfil restringe centros, mostrar solo permitidos
    final = _filtrarPorPerfil(final, 'centro_operacion', c=> c.codigo || c.nombre || c);
    if (!final.length) {
      sel.innerHTML = '<option value="">Sin centros configurados</option>';
      if (selected) sel.innerHTML += `<option value="${esc(selected)}" selected>${esc(selected)}</option>`;
      return;
    }
    sel.innerHTML = '<option value="">Seleccione centro de operación</option>' + final.map(c => {
      const codigo = c.codigo || '';
      const nombre = c.nombre || c.descripcion || '';
      const label = codigo && nombre ? `${codigo} — ${nombre}` : (nombre || codigo);
      const val = codigo || nombre;
      return `<option value="${esc(val)}" ${val === selected ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
    if (selected && !final.find(c => (c.codigo||c.nombre||c) === selected)) {
      sel.innerHTML += `<option value="${esc(selected)}" selected>${esc(selected)} (actual)</option>`;
    }
  } catch { sel.innerHTML = '<option value="">Error cargando centros</option>'; }
}

async function cargarBodegasCotizacion(selected) {
  const sel = document.getElementById('cotizacion-bodega');
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccione bodega</option>';
  try {
    await getPerfilConfig();
    let data = [];
    const r = await apiFetch('/inventario/bodegas-all');
    if (r.ok) data = r.data.data || [];
    if (!data.length) {
      const r2 = await apiFetch('/inventario/bodegas');
      if (r2.ok) data = (r2.data.data || []).map(b => ({ codigo: b.bodega, nombre: b.bodega_nombre || '', bodega: b.bodega, bodega_nombre: b.bodega_nombre }));
    }
    // Filtrar por perfil: bodega (pedido) es el que limita creación; si hay filtro, aplicar
    const cfg = _perfilConfigCache || {};
    const permitidas = cfg.bodega?.length ? cfg.bodega : (cfg.bodegas_pedido?.length ? cfg.bodegas_pedido : null);
    if(Array.isArray(permitidas) && permitidas.length) {
      const set=new Set(permitidas.map(String));
      data = data.filter(b=> set.has(String(b.codigo||b.bodega)));
    }
    if (!data.length) {
      if (selected) sel.innerHTML += `<option value="${esc(selected)}" selected>${esc(selected)}</option>`;
      return;
    }
    sel.innerHTML = '<option value="">Seleccione bodega</option>' + data.map(b => {
      const codigo = b.codigo || b.bodega || '';
      const nombre = b.nombre || b.bodega_nombre || '';
      const label = nombre ? `${codigo} — ${nombre}` : codigo;
      return `<option value="${esc(codigo)}" ${codigo === selected ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
    if (selected && !data.find(b => (b.codigo || b.bodega) === selected)) {
      sel.innerHTML += `<option value="${esc(selected)}" selected>${esc(selected)} (actual)</option>`;
    }
  } catch { sel.innerHTML = '<option value="">Error cargando bodegas</option>'; }
}

let _buscarProductoTimer = null;
async function buscarProductosCatalogo() {
  clearTimeout(_buscarProductoTimer);
  _buscarProductoTimer = setTimeout(async () => {
    const q = document.getElementById('buscar-producto-input')?.value;
    if (!q || q.length < 2) { document.getElementById('catalogo-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">Escribe al menos 2 caracteres para buscar.</p>'; return; }
    const lista = (document.getElementById('cotizacion-lista-precios')?.value||'').split(' — ')[0].trim() || window._cotizacionListaPrecio || await getPerfilListaDefault();
    const r = await apiFetch('/productos/buscar?q=' + encodeURIComponent(q) + '&lista=' + encodeURIComponent(lista));
    if (!r.ok) return;
    const data = r.data.data || [];
    if (!data.length) { document.getElementById('catalogo-resultados').innerHTML = '<p style="color:var(--muted);font-size:12px">No se encontraron productos.</p>'; return; }
    document.getElementById('catalogo-resultados').innerHTML = data.map(p => `
      <div class="catalogo-item" onclick="agregarProductoAlCarrito(${JSON.stringify(p).replace(/"/g, '&quot;')})">
        <span class="prod-codigo">${esc(p.codigo)}</span>
        <span class="prod-nombre">${esc(p.nombre)}</span>
        <span style="color:var(--muted);font-size:11px">${esc(p.unidad_medida || 'UND')}</span>
        <span class="prod-precio">$${formatMoney(p.precio_unitario || 0)}</span>
      </div>
    `).join('');
  }, 300);
}

function agregarProductoAlCarrito(producto) {
  _cotizacionItems.push({
    descripcion: producto.nombre,
    referencia: producto.codigo,
    unidad_medida: producto.unidad_medida || 'UND',
    cantidad: 1,
    precio_unitario: producto.precio_unitario || 0,
    descuento_pct: 0
  });
  renderItemsCotizacion();
  toast('Producto agregado al carrito', 'success');
  cambiarTabCotizacion('carrito', document.querySelectorAll('#modal-cotizacion .tab-btn')[2]);
}

function renderItemsCotizacion() {
  const container = document.getElementById('cotizacion-items-list');
  if (!_cotizacionItems.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:12px">Sin items. Busca en el catalogo o agrega manualmente.</p>';
  } else {
    container.innerHTML = `
      <div class="item-row" style="grid-template-columns:60px 1fr 50px 80px 60px 80px 30px;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">
        <div>Ref</div><div>Descripcion</div><div>U.M</div><div>Cant.</div><div>Desc%</div><div>Subtotal</div><div></div>
      </div>
    ` + _cotizacionItems.map((it, i) => {
      const sub = (it.cantidad || 1) * (it.precio_unitario || 0) * (1 - (it.descuento_pct || 0) / 100);
      return `
        <div class="item-row" style="grid-template-columns:60px 1fr 50px 80px 60px 80px 30px">
          <input value="${esc(it.referencia || '')}" onchange="onReferenciaChange(${i}, this.value)" onblur="onReferenciaChange(${i}, this.value)" placeholder="Ref" style="font-size:11px">
          <input value="${esc(it.descripcion)}" onchange="updateItemCotizacion(${i},'descripcion',this.value)" placeholder="Descripcion">
          <input value="${esc(it.unidad_medida || 'UND')}" onchange="updateItemCotizacion(${i},'unidad_medida',this.value)" style="font-size:11px">
          <input type="number" value="${it.cantidad || 1}" min="0.01" step="0.01" onchange="updateItemCotizacion(${i},'cantidad',parseFloat(this.value))">
          <input type="number" value="${it.descuento_pct || 0}" min="0" max="100" step="0.01" onchange="updateItemCotizacion(${i},'descuento_pct',parseFloat(this.value))">
          <div style="font-weight:600;font-size:12px">$${formatMoney(sub)}</div>
          <button class="btn-icon" onclick="eliminarItemCotizacion(${i})">✕</button>
        </div>
      `;
    }).join('');
  }
  actualizarTotalesCotizacion();
}

function agregarItemCotizacion() {
  _cotizacionItems.push({ descripcion: '', cantidad: 1, precio_unitario: 0, descuento_pct: 0 });
  renderItemsCotizacion();
}

function updateItemCotizacion(idx, field, value) {
  _cotizacionItems[idx][field] = value;
  renderItemsCotizacion();
}

async function onReferenciaChange(idx, codigo) {
  const val = (codigo || '').trim();
  _cotizacionItems[idx].referencia = val;
  if (!val || val.length < 2) { renderItemsCotizacion(); return; }
  try {
    const lista = (document.getElementById('cotizacion-lista-precios')?.value||'').split(' — ')[0].trim() || window._cotizacionListaPrecio || await getPerfilListaDefault();
    const r = await apiFetch('/productos/buscar?q=' + encodeURIComponent(val) + '&lista=' + encodeURIComponent(lista));
    if (!r.ok || !r.data.data.length) { renderItemsCotizacion(); return; }
    const exact = r.data.data.find(p => String(p.codigo).toLowerCase() === val.toLowerCase()) || r.data.data[0];
    if (exact) {
      _cotizacionItems[idx].descripcion = exact.nombre;
      _cotizacionItems[idx].unidad_medida = exact.unidad_medida || 'UND';
      _cotizacionItems[idx].precio_unitario = parseFloat(exact.precio_unitario || 0);
      _cotizacionItems[idx].referencia = exact.codigo;
      toast('Producto ' + exact.codigo + ' cargado', 'success');
    }
  } catch {}
  renderItemsCotizacion();
}

function eliminarItemCotizacion(idx) {
  _cotizacionItems.splice(idx, 1);
  renderItemsCotizacion();
}

function actualizarTotalesCotizacion() {
  let subtotal = 0;
  for (const it of _cotizacionItems) {
    const base = (it.cantidad || 1) * (it.precio_unitario || 0);
    subtotal += base * (1 - (it.descuento_pct || 0) / 100);
  }
  const descPct = parseFloat(document.getElementById('cotizacion-descuento')?.value || 0);
  const descuento = subtotal * (descPct / 100);
  const baseDesc = subtotal - descuento;
  const iva = baseDesc * 0.19;
  const total = baseDesc + iva;

  document.getElementById('cotizacion-totales').innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Subtotal:</span><span>$${formatMoney(subtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Descuento (${descPct}%):</span><span>-$${formatMoney(descuento)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>IVA (19%):</span><span>$${formatMoney(iva)}</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;border-top:1px solid var(--border);padding-top:8px;margin-top:8px"><span>Total:</span><span>$${formatMoney(total)}</span></div>
  `;
}

async function guardarCotizacion() {
  const id = document.getElementById('cotizacion-id').value;
  const facturarA = document.getElementById('cotizacion-facturar-a').value || null;
  const despacharA = document.getElementById('cotizacion-despachar-a').value || null;
  if (!facturarA || !despacharA) return toast('Seleccione Facturar a y Despachar a (sucursal)', 'error');
  const body = {
    cliente_id: document.getElementById('cotizacion-cliente').value,
    facturar_a: facturarA,
    despachar_a: despacharA,
    oportunidad_id: document.getElementById('cotizacion-oportunidad').value || null,
    validez_dias: parseInt(document.getElementById('cotizacion-validez').value) || 30,
    notas: document.getElementById('cotizacion-notas').value,
    descuento_pct: parseFloat(document.getElementById('cotizacion-descuento').value) || 0,
    orden_compra: document.getElementById('cotizacion-orden-compra').value || null,
    centro_operacion: document.getElementById('cotizacion-centro-op').value || null,
    bodega: document.getElementById('cotizacion-bodega').value || null,
    condicion_pago: document.getElementById('cotizacion-condicion-pago').value || null,
    fecha_entrega: document.getElementById('cotizacion-fecha-entrega').value || null,
    lista_precios: (document.getElementById('cotizacion-lista-precios').value.split(' — ')[0].trim() || window._cotizacionListaPrecio || await getPerfilListaDefault()),
    items: _cotizacionItems.filter(it => it.descripcion?.trim())
  };

  if (!body.cliente_id) return toast('Seleccione un cliente', 'error');
  if (!body.items.length) return toast('Agregue al menos un item', 'error');

  const r = id
    ? await apiFetch('/cotizaciones/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await apiFetch('/cotizaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Cotizacion actualizada' : 'Cotizacion creada', 'success');
  hideModal('modal-cotizacion');
  cargarCotizaciones();
}

async function editarCotizacion(id) {
  const r = await apiFetch('/cotizaciones/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  abrirModalCotizacion(r.data.data);
}

async function verCotizacion(id) {
  const r = await apiFetch('/cotizaciones/' + id);
  if (!r.ok) return toast('Error al cargar', 'error');
  const c = r.data.data;

  let itemsHtml = '';
  if (c.items?.length) {
    itemsHtml = `
      <h4 style="margin:16px 0 8px">Items</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>#</th><th>Ref</th><th>Descripcion</th><th>U.M</th><th>Cant.</th><th>Precio</th><th>Desc%</th><th>Subtotal</th>
      </tr></thead><tbody>
        ${c.items.map((it, i) => `<tr>
          <td>${i + 1}</td><td>${esc(it.referencia || '—')}</td><td>${esc(it.descripcion)}</td>
          <td>${esc(it.unidad_medida || 'UND')}</td><td>${it.cantidad}</td>
          <td>$${formatMoney(it.precio_unitario)}</td><td>${it.descuento_pct}%</td>
          <td>$${formatMoney(it.subtotal)}</td>
        </tr>`).join('')}
      </tbody></table></div>
    `;
  }

  let descHtml = '';
  if (c.descuentos?.length) {
    descHtml = `
      <h4 style="margin:16px 0 8px">Solicitudes de Descuento</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Tipo</th><th>Valor</th><th>Estado</th><th>Justificacion</th><th>Fecha</th>
      </tr></thead><tbody>
        ${c.descuentos.map(d => `<tr>
          <td>${d.tipo}</td><td>${d.valor_descuento}${d.tipo === 'porcentaje' ? '%' : ''}</td>
          <td><span class="badge badge-${d.estado}">${d.estado}</span></td>
          <td>${esc(d.justificacion || '—')}</td><td>${formatDate(d.creado_en)}</td>
        </tr>`).join('')}
      </tbody></table></div>
    `;
  }

  // Resolver nombres de centro/bodega para mostrar "200 — BOGOTA" en vez de solo "200"
  let centroLabel = esc(c.centro_operacion || '—');
  let bodegaLabel = esc(c.bodega || '—');
  try {
    if (c.centro_operacion) {
      const cr = await apiFetch('/centros');
      const centros = cr.ok ? (Array.isArray(cr.data) ? cr.data : (cr.data.data || [])) : [];
      const cc = centros.find(x => String(x.codigo) === String(c.centro_operacion) || String(x.nombre) === String(c.centro_operacion));
      if (cc) centroLabel = `${esc(cc.codigo)} — ${esc(cc.nombre)}`;
    }
    if (c.bodega) {
      const br = await apiFetch('/inventario/bodegas-all');
      const bodegas = br.ok ? (br.data.data || []) : [];
      const bb = bodegas.find(x => String(x.codigo) === String(c.bodega));
      if (bb) bodegaLabel = `${esc(bb.codigo)} — ${esc(bb.nombre)}`;
    }
  } catch {}

  document.getElementById('detalle-cotizacion-title').textContent = `Cotizacion ${c.numero}`;
  document.getElementById('detalle-cotizacion-content').innerHTML = `
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Cliente:</strong> ${esc(c.cliente_nombre || '—')}</div>
      <div><strong>Estado:</strong> <span class="badge badge-${c.estado}">${c.estado}</span></div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Oportunidad:</strong> ${esc(c.oportunidad_nombre || '—')}</div>
      <div><strong>Vencimiento:</strong> ${formatDate(c.vencimiento)}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Orden de Compra:</strong> ${esc(c.orden_compra || '—')}</div>
      <div><strong>Centro Operacion:</strong> ${centroLabel}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Condicion Pago:</strong> ${esc(c.condicion_pago || '—')}</div>
      <div><strong>Fecha Entrega:</strong> ${formatDate(c.fecha_entrega)}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div><strong>Bodega:</strong> ${bodegaLabel}</div>
      <div><strong>Documento ERP:</strong> ${esc(c.documento_erp || '—')}</div>
    </div>
    ${c.notas ? `<div style="margin-bottom:12px"><strong>Notas:</strong> ${esc(c.notas)}</div>` : ''}
    <div style="padding:12px;background:var(--surface2);border-radius:8px;font-size:13px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Subtotal:</span><span>$${formatMoney(c.valor_subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Descuento:</span><span>-$${formatMoney(c.valor_descuento)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>IVA:</span><span>$${formatMoney(c.valor_iva)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;border-top:1px solid var(--border);padding-top:8px;margin-top:8px"><span>Total:</span><span>$${formatMoney(c.valor_total)}</span></div>
    </div>
    ${itemsHtml}
    ${descHtml}
  `;
  showModal('modal-detalle-cotizacion');
}

async function eliminarCotizacion(id) {
  confirmar({ titulo: 'Eliminar cotizacion', mensaje: 'Eliminar esta cotizacion?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/cotizaciones/' + id, { method: 'DELETE' });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast('Cotizacion eliminada', 'success');
    cargarCotizaciones();
  }});
}

async function bulkDeleteCotizaciones() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];
  if (mode === 'all') {
    const r = await apiFetch('/cotizaciones?limit=10000');
    if (!r.ok) return toast('Error al obtener cotizaciones', 'error');
    ids = (r.data.data || []).map(c => c.id);
  } else {
    ids = [...document.querySelectorAll('.cb-cotizacion:checked')].map(cb => cb.value);
  }
  if (!ids.length) return toast('No hay cotizaciones para eliminar', 'error');
  confirmar({ titulo: 'Eliminar cotizaciones', mensaje: `¿Eliminar ${ids.length} cotizacion(es)? Solo se eliminan las en borrador.`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/cotizaciones/seleccionados', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} cotizaciones eliminadas`, 'success');
    clearSelection();
    cargarCotizaciones();
  }});
}

async function cambiarEstadoCotizacion(id, estado) {
  const r = await apiFetch('/cotizaciones/' + id + '/estado', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado })
  });
  if (!r.ok) return toast(r.data?.error || 'Error al cambiar estado', 'error');
  toast('Estado actualizado a ' + estado, 'success');
  cargarCotizaciones();
}

async function enviarCotizacionERP(id, numero) {
  confirmar({ titulo: 'Enviar al ERP', mensaje: `¿Enviar cotización ${numero} al ERP?`, icono: '🚀', onConfirm: async () => {
    const r = await apiFetch('/cotizaciones/' + id + '/enviar-erp', { method: 'POST' });
    if (!r.ok) return toast(r.data?.error || 'Error al enviar al ERP', 'error');
    toast(r.data?.message || 'Cotización enviada al ERP', 'success');
    cargarCotizaciones();
  }});
}

// ── Descuentos ──
async function cargarDescuentos() {
  try {
    const params = new URLSearchParams();
    const estado = document.getElementById('filtro-descuento-estado')?.value;
    if (estado) params.set('estado', estado);

    const r = await apiFetch('/descuentos?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-descuentos');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(d => `
      <tr>
        <td>${esc(d.cotizacion_numero || '—')}</td>
        <td>${esc(d.cliente_nombre || '—')}</td>
        <td>${esc(d.solicitado_por_nombre || '—')}</td>
        <td>${d.tipo}</td>
        <td>${d.tipo === 'porcentaje' ? d.valor_descuento + '%' : '$' + formatMoney(d.valor_descuento)}</td>
        <td>$${formatMoney(d.monto_original)}</td>
        <td>$${formatMoney(d.monto_final)}</td>
        <td><span class="badge badge-${d.estado}">${d.estado}</span></td>
        <td>${formatDate(d.creado_en)}</td>
        <td>
          ${d.estado === 'pendiente' ? `
            <button class="btn btn-sm btn-primary" onclick="aprobarDescuento('${d.id}')">Aprobar</button>
            <button class="btn btn-sm btn-danger" onclick="rechazarDescuento('${d.id}')">Rechazar</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) { console.error('Error cargar descuentos:', err); }
}

function limpiarFiltrosDescuentos() {
  document.getElementById('filtro-descuento-estado').value = '';
  cargarDescuentos();
}

async function aprobarDescuento(id) {
  confirmar({ titulo: 'Aprobar descuento', mensaje: 'Aprobar esta solicitud de descuento?', icono: '✅', onConfirm: async () => {
    const r = await apiFetch('/descuentos/' + id + '/aprobar', { method: 'PUT' });
    if (!r.ok) return toast(r.data?.error || 'Error al aprobar', 'error');
    toast('Descuento aprobado', 'success');
    cargarDescuentos();
    cargarCotizaciones();
  }});
}

async function rechazarDescuento(id) {
  const motivo = prompt('Motivo del rechazo (opcional):');
  const r = await apiFetch('/descuentos/' + id + '/rechazar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo })
  });
  if (!r.ok) return toast(r.data?.error || 'Error al rechazar', 'error');
  toast('Descuento rechazado', 'success');
  cargarDescuentos();
}

let _oportunidadesCache = [];
async function cargarOportunidadesSelect(selectId, selectedId) {
  try {
    const r = await apiFetch('/oportunidades?limit=500');
    if (!r.ok) return;
    const data = r.data.data || [];
    _oportunidadesCache = data;
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Sin oportunidad</option>' +
      data.map(o => `<option value="${o.id}" ${o.id === selectedId ? 'selected' : ''}>${esc(o.nombre)} — ${esc(o.cliente_nombre || '')}</option>`).join('');
    // cuando se elige oportunidad, traer su cliente y sugerir productos
    if (selectId === 'cotizacion-oportunidad') {
      select.onchange = async () => {
        const oid = select.value;
        if (!oid) return;
        const opp = _oportunidadesCache.find(o => o.id === oid);
        const clienteId = opp?.cliente_id || (await apiFetch('/oportunidades/' + oid).then(x=>x.ok?x.data.data.cliente_id||x.data.cliente_id:null).catch(()=>null));
        if (clienteId) await setClienteCotizacion(clienteId);
        // Sugerir productos de la oportunidad al carrito
        try {
          const pr = await apiFetch('/oportunidades/' + oid + '/productos');
          if (pr.ok && pr.data.data.length) {
            let added = 0;
            for (const op of pr.data.data) {
              if (_cotizacionItems.find(it => it.referencia === op.codigo)) continue;
              _cotizacionItems.push({ descripcion: op.producto_nombre || op.nombre, referencia: op.codigo, unidad_medida: op.unidad_medida || 'UND', cantidad: parseFloat(op.cantidad)||1, precio_unitario: parseFloat(op.precio_unitario||op.precio_maestro||0), descuento_pct: 0 });
              added++;
            }
            if (added) {
              renderItemsCotizacion();
              toast(`${added} producto(s) de la oportunidad agregados. Revisa el carrito.`, 'success');
            }
          }
        } catch {}
      };
    }
  } catch {}
}

async function setClienteCotizacion(clienteId) {
  const sel = document.getElementById('cotizacion-cliente');
  const sd = document.getElementById('cotizacion-cliente-selected');
  const search = document.getElementById('cotizacion-cliente-search');
  const r = await apiFetch('/clientes/' + clienteId);
  if (!r.ok) { toast('Cliente de la oportunidad no encontrado', 'warning'); return; }
  const c = r.data.data;
  sel.innerHTML = `<option value="${c.id}" selected>${esc(c.nombre)} — ${esc(c.nit || '')}</option>`;
  sel.value = c.id;
  sd.textContent = '✓ ' + c.nombre + ' — ' + (c.nit || '') + '  ✕';
  sd.style.display = ''; sd.style.cursor = 'pointer';
  sd.title = 'Click para quitar';
  sd.onclick = () => { sd.style.display='none'; sel.value=''; sel.innerHTML=''; search.value=''; document.getElementById('cotizacion-contacto').innerHTML='<option value="">Sin contacto</option>'; document.getElementById('cotizacion-facturar-a').innerHTML='<option value="">Seleccione sucursal</option>'; document.getElementById('cotizacion-despachar-a').innerHTML='<option value="">Seleccione sucursal</option>'; document.getElementById('cotizacion-vendedor-info').style.display='none'; };
  sel.style.display = 'none';
  search.value = '';
  await cargarContactosCotizacion(c.id);
  await cargarSucursalesCotizacion(c.id);
  {
    let lp = c.lista_precio_codigo || c.lista_precios;
    if (!lp) lp = await getPerfilListaDefault();
    const def = await getPerfilListaDefault();
    const lpDesc = c.lista_precios && c.lista_precios !== lp ? c.lista_precios : (lp === def ? 'GENERAL HORECA' : '');
    document.getElementById('cotizacion-lista-precios').value = lpDesc ? `${lp} — ${lpDesc}` : lp;
    window._cotizacionListaPrecio = lp;
  }
  {
    const vend = c.razon_social_vendedor || (c.vendedor_codigo ? `Vendedor ${c.vendedor_codigo}` : '');
    const vInfo = document.getElementById('cotizacion-vendedor-info');
    if (vend) { vInfo.textContent = `Vendedor asignado: ${vend} — la venta quedará a su nombre`; vInfo.style.display = ''; }
  }
  toast('Cliente cargado desde oportunidad', 'success');
}

// ── Productos ──
let _productosPage = 1;

async function cargarProductos() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-producto-search')?.value;
    const categoria = document.getElementById('filtro-producto-categoria')?.value;
    if (search) params.set('search', search);
    if (categoria) params.set('categoria', categoria);
    params.set('page', _productosPage);
    params.set('limit', 50);

    const r = await apiFetch('/productos?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-productos');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(p => `
      <tr style="cursor:pointer" onclick="verProducto('${p.id}')">
        <td><input type="checkbox" class="row-check cb-producto" value="${p.id}" onchange="event.stopPropagation();updateBulkBar()"></td>
        <td><strong>${esc(p.codigo)}</strong></td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.unidad_medida || 'UND')}</td>
        <td>$${formatMoney(p.precio_unitario || 0)}</td>
        <td>${p.tasa_impuesto || 0}%</td>
        <td>${esc(p.categoria || '—')}</td>
        <td>${esc(p.bodega || '—')}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarProducto('${p.id}')" title="Editar producto" aria-label="Editar producto ${esc(p.nombre)}">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarProducto('${p.id}')" title="Eliminar producto" aria-label="Eliminar producto ${esc(p.nombre)}">🗑️</button>
        </td>
      </tr>
    `).join('');

    renderPagination('pag-productos', r.data.total, _productosPage, 50, (p) => { _productosPage = p; cargarProductos(); });
    cargarStatsProductos();
  } catch (err) { console.error('Error cargar productos:', err); }
}

async function cargarStatsProductos() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-producto-search')?.value;
    const categoria = document.getElementById('filtro-producto-categoria')?.value;
    if (search) params.set('search', search);
    if (categoria) params.set('categoria', categoria);

    const r = await apiFetch('/productos/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    const topCat = (d.por_categoria || []).slice(0, 2).map(c => `${esc(c.categoria || 'Sin categoria')}: ${c.total}`).join(' · ') || '—';
    document.getElementById('stats-productos').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total || 0}</div><div class="stat-label">Productos</div></div>
      <div class="stat-card"><div class="stat-value">${d.con_precio || 0}</div><div class="stat-label">Con precio</div></div>
      <div class="stat-card"><div class="stat-value">${d.sin_categoria || 0}</div><div class="stat-label">Sin categoria</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px;line-height:1.3">${topCat}</div><div class="stat-label">Top categorias</div></div>
    `;
  } catch {}
}

function limpiarFiltrosProductos() {
  document.getElementById('filtro-producto-search').value = '';
  document.getElementById('filtro-producto-categoria').value = '';
  _productosPage = 1;
  cargarProductos();
}

async function abrirModalProducto(producto = null) {
  document.getElementById('modal-producto-title').textContent = producto ? 'Editar Producto' : 'Nuevo Producto';
  document.getElementById('producto-id').value = producto?.id || '';
  document.getElementById('producto-codigo').value = producto?.codigo || '';
  document.getElementById('producto-nombre').value = producto?.nombre || '';
  document.getElementById('producto-descripcion').value = producto?.descripcion || '';
  document.getElementById('producto-unidad').value = producto?.unidad_medida || 'UND';
  document.getElementById('producto-precio').value = producto?.precio_unitario || 0;
  document.getElementById('producto-tasa').value = producto?.tasa_impuesto || 0;
  document.getElementById('producto-categoria').value = producto?.categoria || '';
  document.getElementById('producto-bodega').value = producto?.bodega || '';
  const codigoInput = document.getElementById('producto-codigo');
  codigoInput.readOnly = !!producto;
  codigoInput.title = producto ? 'El codigo de referencia no se puede editar' : '';
  showModal('modal-producto');
}

async function editarProducto(id) {
  const r = await apiFetch('/productos/' + id);
  if (!r.ok) return toast(r.data?.error || 'Producto no encontrado', 'error');
  abrirModalProducto(r.data.data);
}

async function guardarProducto() {
  const id = document.getElementById('producto-id').value;
  const body = {
    codigo: document.getElementById('producto-codigo').value,
    nombre: document.getElementById('producto-nombre').value,
    descripcion: document.getElementById('producto-descripcion').value,
    unidad_medida: document.getElementById('producto-unidad').value,
    precio_unitario: parseFloat(document.getElementById('producto-precio').value) || 0,
    tasa_impuesto: parseFloat(document.getElementById('producto-tasa').value) || 0,
    categoria: document.getElementById('producto-categoria').value,
    bodega: document.getElementById('producto-bodega').value
  };

  if (!body.codigo || !body.nombre) return toast('Codigo y nombre son obligatorios', 'error');

  const url = id ? '/productos/' + id : '/productos';
  const method = id ? 'PUT' : 'POST';
  // codigo es identificador interno, no se envia en edicion
  const payload = id ? (({ codigo, ...rest }) => rest)(body) : body;
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) return toast(r.data?.error || 'Error al guardar', 'error');
  toast(id ? 'Producto actualizado' : 'Producto creado', 'success');
  hideModal('modal-producto');
  cargarProductos();
}

async function eliminarProducto(id) {
  confirmar({ titulo: 'Eliminar producto', mensaje: 'Eliminar este producto?', icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/productos/' + id, { method: 'DELETE' });
    if (!r.ok) return toast('Error al eliminar', 'error');
    toast('Producto eliminado', 'success');
    cargarProductos();
  }});
}

async function verProducto(id) {
  const r = await apiFetch('/productos/' + id);
  if (!r.ok) return toast(r.data?.error || 'Producto no encontrado', 'error');
  const p = r.data.data;

  // Fetch EANs, inventory, prices
  const [eanR, invR, priceR] = await Promise.all([
    apiFetch('/productos/' + id + '/ean'),
    apiFetch('/productos/' + id + '/inventario'),
    apiFetch('/productos/' + id + '/precios')
  ]);
  const eans = eanR.ok ? (eanR.data.data || []) : [];
  const inventario = invR.ok ? (invR.data.data || []) : [];
  const precios = priceR.ok ? (priceR.data.data || []) : [];

  const totalInv = inventario.reduce((s, i) => s + parseFloat(i.existencia || 0), 0);

  document.getElementById('detalle-producto-title').textContent = p.nombre;
  document.getElementById('detalle-producto-content').innerHTML = `
    <!-- Tabs -->
    <div style="display:flex;gap:16px;border-bottom:1px solid var(--border);margin-bottom:16px">
      <button class="tab-btn active" onclick="cambiarTabProducto('info',this)">Informacion Basica</button>
      <button class="tab-btn" onclick="cambiarTabProducto('precios',this)">Precios (${precios.length})</button>
      <button class="tab-btn" onclick="cambiarTabProducto('inventario',this)">Inventario (${inventario.length})</button>
      <button class="tab-btn" onclick="cambiarTabProducto('ean',this)">Codigos de Barras (${eans.length})</button>
    </div>

    <!-- Tab Info Basica -->
    <div id="tab-producto-info">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
        <div><strong>ID Item:</strong> ${esc(p.codigo)}</div>
        <div><strong>Referencia:</strong> ${esc(p.codigo)}</div>
        <div><strong>Descripcion:</strong> ${esc(p.nombre)}</div>
        <div><strong>Unidad:</strong> ${esc(p.unidad_medida || '—')}</div>
        <div><strong>Precio base:</strong> $${formatMoney(p.precio_unitario || 0)}</div>
        <div><strong>Impuesto:</strong> ${p.tasa_impuesto || 0}%</div>
        <div><strong>Categoria:</strong> ${esc(p.categoria || '—')}</div>
        <div><strong>Bodega:</strong> ${esc(p.bodega || '—')}</div>
        <div><strong>Estado:</strong> <span class="badge badge-${p.activo ? 'aprobada' : 'rechazada'}">${p.activo ? 'Activo' : 'Inactivo'}</span></div>
      </div>
      ${p.descripcion ? `<div style="margin-bottom:12px"><strong>Descripcion completa:</strong><br>${esc(p.descripcion)}</div>` : ''}
      ${p.marca ? `<div style="margin-bottom:12px"><strong>Marca:</strong> ${esc(p.marca)}</div>` : ''}
    </div>

    <!-- Tab Precios -->
    <div id="tab-producto-precios" style="display:none">
      ${precios.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Lista de precio</th><th>U.M.</th><th>Moneda</th><th>Precio</th>
      </tr></thead><tbody>
        ${precios.map(pr => `<tr>
          <td>${esc(pr.lista_nombre || '—')}</td>
          <td>${esc(pr.unidad_medida || '—')}</td>
          <td>${esc(pr.moneda || 'COP')}</td>
          <td><strong>$${formatMoney(pr.precio || 0)}</strong></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">No hay precios configurados para este producto</p>'}
    </div>

    <!-- Tab Inventario -->
    <div id="tab-producto-inventario" style="display:none">
      ${inventario.length ? `
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>ID Bodega</th><th>Bodega</th><th>Existencia</th><th>Comprometida</th><th>Disponible</th>
        </tr></thead><tbody>
          ${inventario.map(inv => `<tr>
            <td>${esc(inv.bodega || '—')}</td>
            <td>${esc(inv.bodega || '—')}</td>
            <td>${inv.existencia || 0}</td>
            <td>${inv.comprometida || 0}</td>
            <td><strong>${(parseFloat(inv.existencia || 0) - parseFloat(inv.comprometida || 0))}</strong></td>
          </tr>`).join('')}
        </tbody></table></div>
        <div style="text-align:right;font-weight:600;margin-top:8px">Total: ${totalInv}</div>
      ` : '<p style="color:var(--muted)">No hay datos de inventario para este producto</p>'}
    </div>

    <!-- Tab Codigos de Barras -->
    <div id="tab-producto-ean" style="display:none">
      ${eans.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>GTIN</th><th>Descripcion</th><th>Marca</th><th>U.M.</th><th>Principal</th>
      </tr></thead><tbody>
        ${eans.map(e => `<tr>
          <td><strong>${esc(e.gtin)}</strong></td>
          <td>${esc(e.descripcion || e.gs1_descripcion || '—')}${e.gs1_vinculado ? ' <span class="badge badge-aprobada" title="Verificado en catálogo GS1">GS1 ✓</span>' : ''}</td>
          <td>${esc(e.gs1_marca || '—')}</td>
          <td>${esc(e.unidad_medida || '—')}</td>
          <td>${e.es_principal ? '<span class="badge badge-aprobada">Principal</span>' : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p style="color:var(--muted)">Sin codigos de barras registrados</p>'}
      ${eans.some(e => e.gs1_foto) ? `<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap">${eans.filter(e => e.gs1_foto).slice(0,4).map(e => `<img src="${esc(e.gs1_foto)}" alt="EAN ${esc(e.gtin)}" title="EAN ${esc(e.gtin)}${e.gs1_marca ? ' · ' + esc(e.gs1_marca) : ''}" style="max-width:140px;border-radius:8px;border:1px solid var(--border)">`).join('')}</div>` : ''}
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <label style="font-size:12px;font-weight:600;color:var(--muted)">Vincular EAN del catálogo GS1</label>
        <div style="display:flex;gap:8px;margin-top:6px">
          <input type="text" id="gs1-catalogo-search" placeholder="Buscar por GTIN, descripcion o marca..." style="flex:1;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px" oninput="buscarCatalogoGS1('${p.id}')">
        </div>
        <div id="gs1-catalogo-resultados" style="max-height:160px;overflow-y:auto;margin-top:8px"></div>
      </div>
    </div>

    ${p.foto_url ? `<div style="margin-top:16px"><img src="${esc(p.foto_url)}" style="max-width:200px;border-radius:8px;border:1px solid var(--border)"></div>` : ''}
  `;
  showModal('modal-detalle-producto');
}

function cambiarTabProducto(tab, btn) {
  document.querySelectorAll('#modal-detalle-producto [id^="tab-producto-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#modal-detalle-producto .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-producto-' + tab).style.display = '';
  btn.classList.add('active');
}

let _gs1CatalogoTimer = null;
async function buscarCatalogoGS1(productoId) {
  clearTimeout(_gs1CatalogoTimer);
  _gs1CatalogoTimer = setTimeout(async () => {
    const q = document.getElementById('gs1-catalogo-search')?.value;
    const cont = document.getElementById('gs1-catalogo-resultados');
    if (!cont) return;
    if (!q || q.length < 2) { cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Escribe al menos 2 caracteres para buscar en el catálogo GS1.</span>'; return; }
    const r = await apiFetch('/productos/gs1/catalogo/buscar?q=' + encodeURIComponent(q));
    if (!r.ok) return;
    const data = r.data.data || [];
    if (!data.length) { cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Sin resultados en el catálogo GS1.</span>'; return; }
    cont.innerHTML = data.map(g => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
        <div style="flex:1;min-width:0">
          <div><strong>${esc(g.gtin)}</strong> ${g.vinculado ? '<span class="badge badge-aprobada" title="Ya vinculado a un producto">GS1 ✓</span>' : ''}</div>
          <div style="font-size:12px;overflow-wrap:break-word">${esc(g.descripcion || '—')}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(g.marca || '')}${g.categoria_gpc ? ' · ' + esc(g.categoria_gpc) : ''}</div>
        </div>
        ${g.vinculado ? '' : `<button class="btn btn-sm btn-primary btn-action" onclick="vincularGS1('${productoId}','${esc(g.gtin)}')" title="Vincular a este producto" aria-label="Vincular EAN ${esc(g.gtin)} a este producto">＋</button>`}
      </div>`).join('');
  }, 300);
}

async function vincularGS1(productoId, gtin) {
  const r = await apiFetch('/productos/' + productoId + '/gs1/vincular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gtin }) });
  if (!r.ok) return toast(r.data?.error || 'Error al vincular', 'error');
  toast('EAN vinculado al producto', 'success');
  verProducto(productoId);
}

async function bulkDeleteProductos() {
  const mode = document.getElementById('bulk-select-mode').value;
  let ids = [];
  if (mode === 'all') {
    const r = await apiFetch('/productos?limit=10000');
    if (!r.ok) return toast('Error al obtener productos', 'error');
    ids = (r.data.data || []).map(p => p.id);
  } else {
    ids = [...document.querySelectorAll('.cb-producto:checked')].map(cb => cb.value);
  }
  if (!ids.length) return toast('No hay productos para eliminar', 'error');
  confirmar({ titulo: 'Eliminar productos', mensaje: `¿Eliminar ${ids.length} producto(s)?`, icono: '🗑️', onConfirm: async () => {
    const r = await apiFetch('/productos/seleccionados', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) return toast(r.data?.error || 'Error al eliminar', 'error');
    toast(`${r.data.eliminados} productos eliminados`, 'success');
    clearSelection();
    cargarProductos();
  }});
}

// ── Inventario ──
let _invPage = 1;
let _invLimit = 50;

async function cargarInventario() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-inv-search')?.value;
    const bodega = document.getElementById('filtro-inv-bodega')?.value;
    const stock = document.getElementById('filtro-inv-stock')?.value;
    if (search) params.set('search', search);
    if (bodega) params.set('bodega', bodega);
    if (stock) params.set('stock', stock);
    params.set('page', _invPage);
    params.set('limit', _invLimit);

    const r = await apiFetch('/inventario?' + params);
    if (!r.ok) return;

    const tbody = document.getElementById('tbody-inventario');
    const data = r.data.data || [];
    tbody.innerHTML = data.map(inv => {
      const disponible = parseFloat(inv.existencia || 0) - parseFloat(inv.comprometida || 0);
      return `<tr>
        <td><strong>${esc(inv.codigo)}</strong></td>
        <td>${esc(inv.nombre)}</td>
        <td>${esc(inv.bodega)}</td>
        <td>${inv.existencia || 0}</td>
        <td>${inv.comprometida || 0}</td>
        <td><strong style="color:${disponible > 0 ? 'var(--success)' : 'var(--danger)'}">${disponible}</strong></td>
        <td>$${formatMoney(inv.precio || 0)}</td>
        <td>${esc(inv.unidad_medida || '—')}</td>
      </tr>`;
    }).join('');

    renderPagination('pag-inventario', r.data.total, _invPage, _invLimit, (p) => { _invPage = p; cargarInventario(); });
    cargarBodegasSelect();
    cargarStatsInventario();
  } catch (err) { console.error('Error cargar inventario:', err); }
}

async function cargarBodegasSelect() {
  try {
    const r = await apiFetch('/inventario/bodegas');
    if (!r.ok) return;
    const select = document.getElementById('filtro-inv-bodega');
    const current = select?.value || '';
    select.innerHTML = '<option value="">Todas las bodegas</option>' +
      (r.data.data || []).map(b => `<option value="${esc(b.bodega)}" ${b.bodega === current ? 'selected' : ''}>${esc(b.bodega)} (${b.productos} productos, ${b.total_existencia} uds)</option>`).join('');
  } catch {}
}

async function cargarStatsInventario() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filtro-inv-search')?.value;
    const bodega = document.getElementById('filtro-inv-bodega')?.value;
    const stock = document.getElementById('filtro-inv-stock')?.value;
    if (search) params.set('search', search);
    if (bodega) params.set('bodega', bodega);
    if (stock) params.set('stock', stock);

    const r = await apiFetch('/inventario/stats?' + params);
    if (!r.ok) return;
    const d = r.data;
    document.getElementById('stats-inventario').innerHTML = `
      <div class="stat-card"><div class="stat-value">${d.total_registros || 0}</div><div class="stat-label">Registros</div></div>
      <div class="stat-card"><div class="stat-value">${d.bodegas || 0}</div><div class="stat-label">Bodegas</div></div>
      <div class="stat-card"><div class="stat-value">${d.productos_con_stock || 0}</div><div class="stat-label">Con stock</div></div>
      <div class="stat-card"><div class="stat-value">${formatMoney(d.total_existencia || 0)}</div><div class="stat-label">Total unidades</div></div>
    `;
  } catch {}
}

function limpiarFiltrosInventario() {
  document.getElementById('filtro-inv-search').value = '';
  document.getElementById('filtro-inv-bodega').value = '';
  document.getElementById('filtro-inv-stock').value = '';
  _invPage = 1;
  cargarInventario();
}

// ── Importar SIESA ──
let _importarTipos = [];

async function cargarPaginaImportar() {
  const r = await apiFetch('/importar/tipos');
  if (!r.ok) return;
  _importarTipos = r.data.data || [];
  const container = document.getElementById('importar-tipos-container');
  container.innerHTML = _importarTipos.map(t => `
    <div style="display:flex;align-items:center;gap:16px;padding:14px 18px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;background:var(--surface);cursor:pointer" onclick="abrirModalImportar('${t.id}')">
      <span style="font-size:24px">${t.id === 'clientes' ? '🏢' : t.id === 'contactos' ? '👤' : t.id === 'leads' ? '🎯' : t.id === 'cotizaciones' ? '📄' : t.id === 'items' ? '📦' : '📊'}</span>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${esc(t.nombre)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(t.descripcion)}</div>
      </div>
      <span style="font-size:11px;color:var(--muted);background:var(--surface2);padding:4px 10px;border-radius:6px">${t.extensiones.toUpperCase()}</span>
      <span style="color:var(--accent);font-size:20px">→</span>
    </div>
  `).join('');
}

function abrirModalImportar(tipo) {
  document.getElementById('importar-tipo').value = tipo || '';
  cambiarTipoImportacion();
  document.getElementById('importar-archivo').value = '';
  document.getElementById('importar-resultado').innerHTML = '';
  showModal('modal-importar');
}

function cambiarTipoImportacion() {
  const tipo = document.getElementById('importar-tipo').value;
  const tipoInfo = _importarTipos.find(t => t.id === tipo);
  document.getElementById('importar-descripcion').textContent = tipoInfo ? tipoInfo.descripcion : '';
  document.getElementById('btn-ejecutar-importar').disabled = !tipo;
  document.getElementById('importar-archivo').value = '';
  document.getElementById('importar-resultado').innerHTML = '';
  if (tipoInfo) {
    document.getElementById('importar-archivo').accept = tipoInfo.extensiones.split(',').map(e => '.' + e).join(',');
  }

  // Show order hint for initial imports
  const orderHint = document.getElementById('importar-orden-hint');
  const orderText = document.getElementById('importar-orden-texto');
  const orderMap = {
    bodegas: 'Primero ← Después: Items, Inventario',
    items: '← Después: Precios, Inventario, Códigos barras',
    codigos_barra: '← Después: Precios',
    precios: '← Después: Inventario',
    inventario: '← Después: Terceros, Clientes (sucursales)',
    terceros: 'Maestro por NIT (razón social, contacto, dirección) ← Después: Clientes ERP para sucursales + EAN',
    clientes: 'Clientes ERP por sucursal (EAN solo desde sucursal 001 para el tercero) ← Después: Vendedores',
    vendedores: 'Último'
  };
  if (orderMap[tipo]) {
    orderText.textContent = orderMap[tipo];
    orderHint.style.display = '';
  } else {
    orderHint.style.display = 'none';
  }
}

async function ejecutarImportacion() {
  const tipo = document.getElementById('importar-tipo').value;
  const fileInput = document.getElementById('importar-archivo');
  if (!tipo) return toast('Selecciona un tipo', 'error');
  if (!fileInput.files.length) return toast('Selecciona un archivo', 'error');

  const btn = document.getElementById('btn-ejecutar-importar');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  const formData = new FormData();
  formData.append('tipo', tipo);
  formData.append('archivo', fileInput.files[0]);

  const div = document.getElementById('importar-resultado');
  div.innerHTML = `
    <div style="padding:12px;background:var(--surface2);border-radius:8px;font-size:13px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div class="spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div>
        <span id="importar-status">Procesando...</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">
        <div id="importar-progress-bar" style="height:100%;background:var(--accent);width:0%;transition:width .2s"></div>
      </div>
      <div id="importar-progress-text" style="font-size:11px;color:var(--muted);margin-top:4px">0 / 0 registros</div>
    </div>
  `;

  try {
    const response = await fetch(HF.API + '/importar', { method: 'POST', credentials: 'include', body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'progress') {
            const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
            document.getElementById('importar-progress-bar').style.width = pct + '%';
            document.getElementById('importar-progress-text').textContent = `${data.current} / ${data.total} registros (${pct}%)`;
            document.getElementById('importar-status').textContent = `Procesando ${data.current} de ${data.total}...`;
          } else if (data.type === 'done') {
            document.getElementById('importar-progress-bar').style.width = '100%';
            document.getElementById('importar-progress-bar').style.background = 'var(--success)';
            document.getElementById('importar-status').textContent = '✅ Importación completada';
            div.innerHTML = `
              <div style="padding:12px;background:#d4edda;border-radius:8px;font-size:13px">
                <div style="font-weight:600;margin-bottom:8px">✅ Importación completada — ${tipo}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px">
                  ${data.insertados !== undefined ? `<div><strong>${data.insertados}</strong><br><span style="font-size:11px;color:var(--muted)">Insertados</span></div>` : ''}
                  ${data.actualizados !== undefined ? `<div><strong>${data.actualizados}</strong><br><span style="font-size:11px;color:var(--muted)">Actualizados</span></div>` : ''}
                  ${data.sucursales !== undefined ? `<div><strong>${data.sucursales}</strong><br><span style="font-size:11px;color:var(--muted)">Sucursales</span></div>` : ''}
                  ${data.contactos !== undefined ? `<div><strong>${data.contactos}</strong><br><span style="font-size:11px;color:var(--muted)">Contactos</span></div>` : ''}
                  ${data.listas !== undefined ? `<div><strong>${data.listas}</strong><br><span style="font-size:11px;color:var(--muted)">Listas precio</span></div>` : ''}
                  <div><strong>${data.fallidos || 0}</strong><br><span style="font-size:11px;color:var(--muted)">Fallidos</span></div>
                </div>
                ${data.errores?.length ? `<div style="margin-top:8px;font-size:11px;color:var(--muted);max-height:100px;overflow-y:auto">${data.errores.join('<br>')}</div>` : ''}
              </div>
            `;
            toast(`${data.insertados} insertados, ${data.actualizados} actualizados`, 'success');
          }
        } catch {}
      }
    }
  } catch (e) {
    div.innerHTML = `<div style="padding:12px;background:#f8d7da;border-radius:8px;color:#721c24;font-size:13px">❌ Error de red: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar';
  }
}

// ── Utils ──
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); }
function showModal(id) { document.getElementById(id).classList.add('active'); }
function hideModal(id) { document.getElementById(id).classList.remove('active'); if(id==='modal-lead' && typeof _placesDD !=='undefined' && _placesDD) _placesDD.style.display='none'; }

function renderPagination(containerId, total, page, limit, onPage) {
  const container = document.getElementById(containerId);
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:16px">
      <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="event.preventDefault()">Anterior</button>
      <span style="font-size:12px;color:var(--muted)">Pagina ${page} de ${totalPages} (${total} total)</span>
      <button class="btn btn-sm btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="event.preventDefault()">Siguiente</button>
    </div>
  `;
  const btns = container.querySelectorAll('button');
  btns[0].onclick = () => { onPage(page - 1); };
  btns[1].onclick = () => { onPage(page + 1); };
}

function toggleSelectAll(checkbox, tipo) {
  document.querySelectorAll(`.select-${tipo}`).forEach(cb => { cb.checked = checkbox.checked; });
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.querySelector('.sidebar-overlay').classList.toggle('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.querySelector('.sidebar-overlay').classList.remove('open'); }
function toggleSidebarCollapse() { document.getElementById('sidebar').classList.toggle('collapsed'); }

// ── Admin Perfiles Venta ──
const CRM_PERMISOS = ['crear_cotizacion','aprobar_descuento','configurar','siesa_sync','ver_pipeline','editar_pipeline'];
let _perfilesVentaCache=[];

async function cargarAdmin(){
  document.getElementById('btn-volver-admin').style.display='none';
  const misPermisos = await apiFetch('/perfiles-venta/me/mis-permisos');
  const perms = new Set((misPermisos.ok && misPermisos.data?.permisos) || []);
  const esAdmin = usuario?.rol==='admin';
  const puedeConfigurar = esAdmin || perms.has('configurar') || perms.has('siesa_sync');
  const puedeAprobar = esAdmin || perms.has('aprobar_descuento');
  const puedeVerAdmin = esAdmin || puedeConfigurar || puedeAprobar;
  // Ocultar/mostrar Admin en sidebar según permisos
  const navAdmin = document.querySelector('.nav-item[data-page="admin"]');
  if (navAdmin) navAdmin.style.display = puedeVerAdmin ? '' : 'none';
  // Si no tiene acceso, mostrar aviso
  if (!puedeVerAdmin) {
    document.getElementById('admin-cards').innerHTML='<p style="color:var(--muted)">No tienes permisos de administración.</p>';
    adminAbrirInicio();
    return;
  }
  const cards=[
    {icon:'👥',titulo:'Perfiles de Venta',desc:'Crear/editar perfiles y asignar vendedores',seccion:'perfiles',perm:true},
    {icon:'📥',titulo:'Importar SIESA',desc:'Cargar datos desde archivos del ERP/CRM',seccion:'importar',perm:puedeConfigurar},
    {icon:'💰',titulo:'Descuentos pendientes',desc:'Solicitudes por aprobar',seccion:'descuentos',perm:puedeAprobar},
    {icon:'🔄',titulo:'Sincronizar ERP',desc:'SIESA Hub (cuando esté disponible)',seccion:'siesa',perm:puedeConfigurar},
  ];
  document.getElementById('admin-cards').innerHTML=cards.filter(c=>c.perm).map(c=>`
    <div onclick="adminAbrirSeccion('${c.seccion}')" style="border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--surface);cursor:pointer;transition:.15s">
      <div style="font-size:28px">${c.icon}</div>
      <div style="font-weight:600;margin-top:8px">${c.titulo}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${c.desc}</div>
    </div>`).join('');
  adminAbrirInicio();
}
function adminAbrirInicio(){
  document.getElementById('admin-inicio').style.display='';
  document.getElementById('admin-seccion').style.display='none';
  ocultarVolverAdmin();
}
function adminVolver(){ adminAbrirInicio(); }
function mostrarVolverAdmin(texto){
  const b=document.getElementById('btn-volver-admin');
  if(!b) return;
  b.textContent=texto||'← Volver';
  b.style.display='';
  _volverAdminFn = (texto && texto.includes('Admin')) ? function(){ navigate('admin'); } : adminAbrirInicio;
}
function ocultarVolverAdmin(){
  const b=document.getElementById('btn-volver-admin');
  if(b){ b.style.display='none'; b.textContent='← Volver'; }
  _volverAdminFn=null;
}
let _volverAdminFn=null;
function volverDesdeAdmin(){
  const b=document.getElementById('btn-volver-admin');
  if(b) b.style.display='none';
  if(typeof _volverAdminFn==='function'){ _volverAdminFn(); return; }
  navigate('admin');
}
async function adminAbrirSeccion(seccion){
  // Secciones que navegan a una página propia (botón header '← Volver a Admin')
  if(seccion==='importar' || seccion==='descuentos'){
    mostrarVolverAdmin('← Volver a Admin');
    navigate(seccion);
    return;
  }
  // Sub-vistas internas (botón header '← Volver')
  const cont=document.getElementById('admin-seccion');
  document.getElementById('admin-inicio').style.display='none';
  mostrarVolverAdmin('← Volver');
  cont.style.display='';
  if(seccion==='perfiles'){
    cont.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Perfiles de Venta</h3><button class="btn btn-sm btn-primary" onclick="abrirModalPerfilVenta()">+ Nuevo Perfil</button></div><p style="color:var(--muted);font-size:12px">Si un usuario no está asignado a ningún perfil, no podrá crear cotizaciones (solo lectura).</p><div id="perfiles-venta-list" style="display:grid;gap:12px"></div>';
    cargarPerfilesVenta();
  } else if(seccion==='siesa'){
    cont.innerHTML='<h3 style="margin:0 0 12px">SIESA Hub — Mock listo</h3><p style="color:var(--muted);font-size:12px">Mock activo: <code>Enviar al ERP</code> genera <code>CPV-MOCK-xxxxx</code> sin credenciales. Cuando SIESA entregue docs, desactiva mock y guarda URL/OAuth.</p><div style="display:grid;gap:12px;max-width:640px"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="hub-mock"> <span>Mock activo (sin Hub real)</span></label><label style="display:block">Base URL Hub<input type="text" id="hub-base-url" placeholder="https://hub.siesa.com/api" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;margin-top:4px"></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>Client ID<input type="text" id="hub-client-id" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;margin-top:4px"></label><label>Client Secret<input type="password" id="hub-client-secret" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;margin-top:4px"></label></div><div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="guardarHubConfig()">Guardar</button><button class="btn btn-secondary btn-sm" onclick="probarHubSync()">Probar sync</button></div><div id="hub-config-msg" style="font-size:12px;color:var(--muted)"></div><hr style="border:none;border-top:1px solid var(--border)"><h4 style="margin:0">Últimos envíos</h4><div id="hub-envios-list" style="font-size:12px;color:var(--muted)">Cargando...</div></div>';
    cargarHubConfig();
  }
}
async function cargarHubConfig(){
  try{
    const r=await apiFetch('/hub/config'); if(!r.ok) return;
    const cfg=r.data.data||r.data;
    const mockEl=document.getElementById('hub-mock'); if(mockEl) mockEl.checked=cfg.mock_enabled!==false;
    const u=document.getElementById('hub-base-url'); if(u) u.value=cfg.base_url||'';
    const ci=document.getElementById('hub-client-id'); if(ci) ci.value=cfg.client_id||'';
    // secret no se muestra
    const list=document.getElementById('hub-envios-list');
    if(list){
      const er=await apiFetch('/hub/envios'); if(er.ok){
        const rows=er.data.data||[];
        list.innerHTML = rows.length ? rows.slice(0,8).map(e=> `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px"><strong>${esc(e.numero)}</strong> <span style="color:var(--muted)">${esc(e.estado)}</span> ${e.documento_erp?`<span style="color:var(--success)">→ ${esc(e.documento_erp)}</span>`:''} <small style="color:var(--muted)">${new Date(e.creado_en).toLocaleString()}</small>${e.payload?`<details style="margin-top:4px"><summary>payload</summary><pre style="white-space:pre-wrap;font-size:10px;max-height:160px;overflow:auto">${esc(JSON.stringify(e.payload, null, 2).slice(0,1200))}</pre></details>`:''}</div>`).join('') : '<span style="color:var(--muted)">Sin envíos aún — usa 🚀 Enviar al ERP en una cotización</span>';
      }
    }
  }catch{}
}
async function guardarHubConfig(){
  const body={ mock_enabled: document.getElementById('hub-mock')?.checked !== false, base_url: document.getElementById('hub-base-url')?.value.trim()||'', client_id: document.getElementById('hub-client-id')?.value.trim()||'', client_secret: document.getElementById('hub-client-secret')?.value||'' };
  const r=await apiFetch('/hub/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const msg=document.getElementById('hub-config-msg');
  if(!r.ok){ if(msg) msg.textContent=r.data?.error||'Error'; return toast(r.data?.error||'Error','error'); }
  if(msg) msg.textContent='Guardado — mock '+(body.mock_enabled?'activo':'desactivado');
  toast('Hub guardado','success'); cargarHubConfig();
}
async function probarHubSync(){
  const r=await apiFetch('/hub/sync',{method:'POST'});
  const msg=document.getElementById('hub-config-msg'); if(msg) msg.textContent=r.data?.message||r.data?.error||'OK';
  if(r.ok) toast(r.data.message||'Sync mock OK','success'); else toast(r.data?.error||'Error','error');
}
async function cargarPerfilesVenta(){
  const r=await apiFetch('/perfiles-venta');
  if(!r.ok) return toast(r.data?.error||'Error cargando perfiles','error');
  _perfilesVentaCache=r.data.data||[];
  const c=document.getElementById('perfiles-venta-list');
  if(!c) return;
  c.innerHTML=_perfilesVentaCache.map(p=>`
    <div style="border:1px solid var(--border);border-radius:10px;padding:14px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><strong>${esc(p.nombre)}</strong> <span style="color:var(--muted);font-size:12px">(${p.usuarios_count} usuarios)</span><br><span style="color:var(--muted);font-size:12px">${esc(p.descripcion||'')}</span><br><span style="font-size:11px;color:var(--muted)">${(p.permisos||[]).join(', ')||'sin permisos'}</span></div>
        <div style="display:flex;gap:6px;align-items:start">
          <button class="btn btn-sm btn-secondary" onclick="abrirModalPerfilVentaUsuarios(${p.id})">Usuarios</button>
          <button class="btn btn-sm btn-secondary" onclick="abrirModalPerfilVenta(${p.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarPerfilVenta(${p.id})">Eliminar</button>
        </div>
      </div>
    </div>`).join('') || '<p style="color:var(--muted)">Sin perfiles</p>';
}
function cambiarTabPerfil(tab, btn){
  document.querySelectorAll('#modal-perfil-venta [id^="tab-perfil-"]').forEach(el=>el.style.display='none');
  document.querySelectorAll('#modal-perfil-venta .tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-perfil-'+tab).style.display='';
  if(btn) btn.classList.add('active');
}

async function abrirModalPerfilVenta(id){
  const p=id? _perfilesVentaCache.find(x=>x.id===id):null;
  const cfg = p?.config || {};
  document.getElementById('perfil-venta-id').value=p?.id||'';
  document.getElementById('perfil-venta-nombre').value=p?.nombre||'';
  document.getElementById('perfil-venta-desc').value=p?.descripcion||'';
  // Reset tabs
  cambiarTabPerfil('datos', document.querySelector('#modal-perfil-venta .tab-btn'));
  // Permisos
  document.getElementById('perfil-venta-permisos').innerHTML=CRM_PERMISOS.map(perm=>`<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer"><input type="checkbox" value="${perm}" ${(p?.permisos||[]).includes(perm)?'checked':''} style="flex-shrink:0;width:16px;height:16px"> <span>${perm}</span></label>`).join('');
  // Datos básicos — maestros dinámicos
  await Promise.all([
    cargarMaestroChecklist('lista_precio','perfil-maestro-lista_precio', cfg.listas_precio||cfg.lista_precio||[]),
    cargarMaestroChecklist('motivo_venta','perfil-maestro-motivo_venta', cfg.motivos||cfg.motivo_venta||[]),
    cargarMaestroChecklist('tipo_documento','perfil-maestro-tipo_documento', cfg.tipos_documento||cfg.tipo_documento||[]),
    cargarMaestroChecklist('bodega','perfil-maestro-bodega', cfg.bodegas_pedido||cfg.bodega||[]),
    cargarMaestroChecklist('bodega','perfil-maestro-bodega_consulta', cfg.bodegas_consulta||[]),
    cargarMaestroChecklist('centro_operacion','perfil-maestro-centro_operacion', cfg.centros_operacion||cfg.centro_operacion||[]),
    cargarMaestroChecklist('centro_costo','perfil-maestro-centro_costo', cfg.centros_costo||cfg.centro_costo||[]),
    cargarMaestroChecklist('unidad_negocio','perfil-maestro-unidad_negocio', cfg.unidades_negocio||cfg.unidad_negocio||[]),
  ]);
  // Lista por defecto
  try {
    const listaData = window._maestroCache['perfil-maestro-lista_precio'] || [];
    const selDefault = document.getElementById('perfil-lista-default');
    if (selDefault) {
      selDefault.innerHTML = '<option value="">Sin lista por defecto (usa 200 — GENERAL HORECA)</option>' + listaData.map(it=>`<option value="${esc(it.codigo)}" ${String(cfg.lista_por_defecto||'')===String(it.codigo)?'selected':''}>${esc(it.codigo)} — ${esc(it.nombre)}</option>`).join('');
      if (cfg.lista_por_defecto && !listaData.find(x=> String(x.codigo)===String(cfg.lista_por_defecto))) {
        selDefault.innerHTML += `<option value="${esc(cfg.lista_por_defecto)}" selected>${esc(cfg.lista_por_defecto)} (actual)</option>`;
      }
    }
  } catch {}
  // Descuentos
  const d = cfg.descuentos || {};
  document.getElementById('perfil-desc-modalidad').value = d.modalidad || 'CRM';
  document.getElementById('perfil-desc-rango1').value = d.rango1 ?? 1;
  document.getElementById('perfil-desc-rango2').value = d.rango2 ?? 60;
  document.getElementById('perfil-desc-rango3').value = d.rango3 ?? 70;
  document.getElementById('perfil-desc-global').checked = d.permite_global ?? true;
  await Promise.all([
    cargarAprobadoresChecklist('perfil-desc-aprob-supera', d.aprobadores?.supera||[]),
    cargarAprobadoresChecklist('perfil-desc-aprob-r1', d.aprobadores?.r1||[]),
    cargarAprobadoresChecklist('perfil-desc-aprob-r2', d.aprobadores?.r2||[]),
    cargarAprobadoresChecklist('perfil-desc-aprob-r3', d.aprobadores?.r3||[]),
  ]);
  // Márgenes
  const m = cfg.margenes || {};
  document.getElementById('perfil-mg-bruto-pct').checked = m.bruto_pct ?? true;
  document.getElementById('perfil-mg-valor-bruto').checked = m.valor_bruto ?? true;
  document.getElementById('perfil-mg-con-desc-pct').checked = m.con_desc_pct ?? true;
  document.getElementById('perfil-mg-valor-con-desc').checked = m.valor_con_desc ?? true;
  document.getElementById('perfil-mg-utilidad').checked = m.utilidad ?? true;
  document.getElementById('perfil-mg-fila-bruto-pct').checked = m.fila_bruto_pct ?? true;
  document.getElementById('perfil-mg-fila-total-bruto').checked = m.fila_total_bruto ?? true;
  document.getElementById('perfil-mg-fila-total-con-desc').checked = m.fila_total_con_desc ?? true;
  document.getElementById('perfil-mg-fila-margen-con-desc-pct').checked = m.fila_margen_con_desc_pct ?? true;
  document.getElementById('perfil-mg-fila-valor-con-desc').checked = m.fila_valor_con_desc ?? true;
  showModal('modal-perfil-venta');
}

async function cargarMaestroChecklist(tipo, containerId, seleccionados){
  const cont = document.getElementById(containerId);
  if(!cont) return;
  cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Cargando...</span>';
  try {
    let data = [];
    if(tipo === 'centro_operacion'){
      const r = await apiFetch('/centros?_=' + Date.now(), { cache: 'no-store' });
      data = r.ok ? (Array.isArray(r.data)?r.data:(r.data.data||[])) : [];
      data = data.map(c=>({ codigo: c.codigo||c.nombre, nombre: c.nombre }));
    } else {
      const r = await apiFetch('/maestros?tipo=' + tipo + '&_=' + Date.now(), { cache: 'no-store' });
      data = r.ok ? (r.data.data || []) : [];
    }
    if(!data.length){ cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Sin datos</span>'; return; }
    window._maestroCache = window._maestroCache || {};
    window._maestroCache[containerId] = data;
    window._maestroSelected = window._maestroSelected || {};
    window._maestroSelected[containerId] = new Set((seleccionados||[]).map(String));
    cont.innerHTML = `
      <div class="multi-combo" id="${containerId}-combo" onclick="abrirMaestroCombo('${containerId}');document.getElementById('${containerId}-input')?.focus()">
        <div class="multi-combo-tags" id="${containerId}-tags"></div>
        <input type="text" placeholder="Buscar y seleccionar..." class="multi-combo-input" id="${containerId}-input" oninput="filtrarMaestroCombo('${tipo}','${containerId}', this.value)" onfocus="abrirMaestroCombo('${containerId}')" autocomplete="off">
        <div class="multi-combo-dropdown" id="${containerId}-dropdown" style="display:none"></div>
      </div>`;
    renderMaestroTags(containerId, window._maestroSelected[containerId]);
    renderMaestroDropdown(containerId, '', data, window._maestroSelected[containerId]);
    // Cerrar al hacer click fuera
    setTimeout(()=>{
      const combo = document.getElementById(containerId+'-combo');
      const dd = document.getElementById(containerId+'-dropdown');
      if(!combo || combo._outsideHandler) return;
      const handler = (e)=>{ if(!combo.contains(e.target)) dd.style.display='none'; };
      combo._outsideHandler = handler;
      document.addEventListener('click', handler);
      const modal = document.getElementById('modal-perfil-venta')?.querySelector('.modal');
      if(modal) modal.addEventListener('scroll', ()=> dd.style.display='none');
      window.addEventListener('scroll', ()=> dd.style.display='none', true);
    }, 100);
  } catch(e){ console.error('cargarMaestro/Aprobadores', e); cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Error: '+esc(e.message)+'</span>'; }
}
function renderMaestroTags(containerId, selSet){
  const tagsCont = document.getElementById(containerId+'-tags');
  if(!tagsCont) return;
  const data = (window._maestroCache && window._maestroCache[containerId]) || [];
  const selected = data.filter(it=> selSet.has(String(it.codigo)));
  if(!selected.length){ tagsCont.innerHTML = '<span style="color:var(--muted);font-size:11px">Sin selección</span>'; return; }
  tagsCont.innerHTML = selected.map(it=>`<span class="multi-combo-tag">${esc(it.nombre)}<small style="color:var(--muted)"> ${esc(it.codigo)}</small><span class="remove" onclick="event.stopPropagation();toggleMaestroItem('${containerId}','${esc(it.codigo).replace(/'/g,"\\'")}')">×</span></span>`).join('');
}
function renderMaestroDropdown(containerId, filter, data, selSet){
  const dd = document.getElementById(containerId+'-dropdown');
  if(!dd) return;
  const set = selSet || window._maestroSelected[containerId] || new Set();
  const q = (filter||'').toLowerCase();
  const filtered = q ? data.filter(it=> String(it.codigo).toLowerCase().includes(q) || String(it.nombre).toLowerCase().includes(q)) : data;
  if(!filtered.length){ dd.innerHTML = '<div style="padding:8px;color:var(--muted);font-size:12px">Sin resultados</div>'; return; }
  dd.innerHTML = `<div style="display:flex;gap:6px;padding:4px 2px;position:sticky;top:0;background:var(--surface);z-index:1"><button type="button" class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px" onclick="seleccionarTodosMaestro('${containerId}', true)">Todos</button><button type="button" class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px" onclick="seleccionarTodosMaestro('${containerId}', false)">Ninguno</button></div>` + filtered.map(it=>{ const selected = set.has(String(it.codigo)); return `<div onclick="toggleMaestroItem('${containerId}','${esc(it.codigo).replace(/'/g,"\'")}')" style="padding:7px 8px;font-size:12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;${selected?'background:var(--surface2);font-weight:600':''};border-bottom:1px solid var(--border)"><span>${esc(it.nombre)} <small style="color:var(--muted)"> ${esc(it.codigo)}</small></span><span style="color:var(--accent)">${selected?'✓':''}</span></div>`; }).join('');
}
function abrirMaestroCombo(containerId){
  const dd = document.getElementById(containerId+'-dropdown');
  const combo = document.getElementById(containerId+'-combo');
  if(!dd || !combo) return;
  const data = (window._maestroCache && window._maestroCache[containerId]) || [];
  const set = window._maestroSelected[containerId] || new Set();
  const input = document.getElementById(containerId+'-input');
  renderMaestroDropdown(containerId, input ? input.value : '', data, set);
  const rect = combo.getBoundingClientRect();
  dd.style.top = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  dd.style.width = rect.width + 'px';
  dd.style.display = 'block';
}
function filtrarMaestroCombo(tipo, containerId, q){
  const data = (window._maestroCache && window._maestroCache[containerId]) || [];
  const set = window._maestroSelected[containerId] || new Set();
  renderMaestroDropdown(containerId, q, data, set);
  document.getElementById(containerId+'-dropdown').style.display='block';
}
function onMaestroCheckChange(containerId, codigo, checked){
  const set = window._maestroSelected[containerId] || new Set();
  const code = String(codigo).trim();
  if(checked) set.add(code); else set.delete(code);
  window._maestroSelected[containerId] = set;
  renderMaestroTags(containerId, set);
}
function toggleMaestroItem(containerId, codigo){
  const set = window._maestroSelected[containerId] || new Set();
  const code = String(codigo).trim();
  if(set.has(code)) set.delete(code); else set.add(code);
  window._maestroSelected[containerId] = set;
  renderMaestroTags(containerId, set);
  const data = (window._maestroCache && window._maestroCache[containerId]) || [];
  const input = document.getElementById(containerId+'-input');
  renderMaestroDropdown(containerId, input ? input.value : '', data, set);
}
function seleccionarTodosMaestro(containerId, checked){
  const data = (window._maestroCache && window._maestroCache[containerId]) || [];
  const set = new Set();
  if(checked) data.forEach(it=> set.add(String(it.codigo)));
  window._maestroSelected[containerId] = set;
  renderMaestroTags(containerId, set);
  const input = document.getElementById(containerId+'-input');
  renderMaestroDropdown(containerId, input ? input.value : '', data, set);
}

async function cargarAprobadoresChecklist(containerId, seleccionados){
  const cont = document.getElementById(containerId);
  if(!cont) return;
  cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Cargando...</span>';
  try {
    let usuarios = [];
    try{
      const r = await apiFetch('/perfiles-venta/usuarios-all', { cache: 'no-store' });
      if(r.ok) usuarios = r.data.data || r.data || [];
    }catch{}
    if(!usuarios.length){
      try{
        const r = await apiFetch('/perfiles-venta/' + (document.getElementById('perfil-venta-id').value || '0') + '/usuarios', { cache: 'no-store' });
        if(r.ok) usuarios = r.data.usuarios || [];
      }catch{}
    }
    if(!usuarios.length && Array.isArray(_perfilVentaUsuariosCache) && _perfilVentaUsuariosCache.length) usuarios = _perfilVentaUsuariosCache;
    if(!usuarios.length){ cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Sin usuarios</span>'; return; }
    window._maestroCache = window._maestroCache || {};
    window._maestroSelected = window._maestroSelected || {};
    const data = usuarios.map(u=>({ codigo: String(u.id), nombre: u.nombre + (u.email? ' — '+u.email : '') }));
    window._maestroCache[containerId] = data;
    window._maestroSelected[containerId] = new Set((seleccionados||[]).map(String));
    cont.innerHTML = `
      <div class="multi-combo" id="${containerId}-combo" onclick="abrirMaestroCombo('${containerId}');document.getElementById('${containerId}-input')?.focus()">
        <div class="multi-combo-tags" id="${containerId}-tags"></div>
        <input type="text" placeholder="Buscar usuario..." class="multi-combo-input" id="${containerId}-input" oninput="filtrarMaestroCombo('usuario','${containerId}', this.value)" onfocus="abrirMaestroCombo('${containerId}')" autocomplete="off">
        <div class="multi-combo-dropdown" id="${containerId}-dropdown" style="display:none"></div>
      </div>`;
    renderMaestroTags(containerId, window._maestroSelected[containerId]);
    renderMaestroDropdown(containerId, '', data, window._maestroSelected[containerId]);
    setTimeout(()=>{
      const combo = document.getElementById(containerId+'-combo');
      const dd = document.getElementById(containerId+'-dropdown');
      if(!combo || combo._outsideHandler) return;
      const handler = (e)=>{ if(!combo.contains(e.target)) dd.style.display='none'; };
      combo._outsideHandler = handler;
      document.addEventListener('click', handler);
      const modal = document.getElementById('modal-perfil-venta')?.querySelector('.modal');
      if(modal) modal.addEventListener('scroll', ()=> dd.style.display='none');
      window.addEventListener('scroll', ()=> dd.style.display='none', true);
    }, 100);
  } catch(e){ console.error('cargarAprobadores', containerId, e); cont.innerHTML = '<span style="color:var(--muted);font-size:12px">Error: '+esc(e.message)+'</span>'; }
}

function getCheckedValues(containerId){
  if(window._maestroSelected && window._maestroSelected[containerId]) return [...window._maestroSelected[containerId]];
  const cont = document.getElementById(containerId);
  if(!cont) return [];
  return [...cont.querySelectorAll('input:checked')].map(i=>i.value);
}

async function guardarPerfilVenta(){
  const id=document.getElementById('perfil-venta-id').value;
  const nombre=document.getElementById('perfil-venta-nombre').value.trim();
  const descripcion=document.getElementById('perfil-venta-desc').value.trim();
  const permisos=[...document.querySelectorAll('#perfil-venta-permisos input:checked')].map(i=>i.value);
  if(!nombre) return toast('Nombre requerido','error');
  const config = {
    listas_precio: getCheckedValues('perfil-maestro-lista_precio'),
    lista_por_defecto: document.getElementById('perfil-lista-default')?.value || null,
    motivo_venta: getCheckedValues('perfil-maestro-motivo_venta'),
    tipo_documento: getCheckedValues('perfil-maestro-tipo_documento'),
    bodega: getCheckedValues('perfil-maestro-bodega'),
    bodega_consulta: getCheckedValues('perfil-maestro-bodega_consulta'),
    centro_operacion: getCheckedValues('perfil-maestro-centro_operacion'),
    centro_costo: getCheckedValues('perfil-maestro-centro_costo'),
    unidad_negocio: getCheckedValues('perfil-maestro-unidad_negocio'),
    descuentos: {
      modalidad: document.getElementById('perfil-desc-modalidad').value,
      rango1: parseFloat(document.getElementById('perfil-desc-rango1').value)||0,
      rango2: parseFloat(document.getElementById('perfil-desc-rango2').value)||0,
      rango3: parseFloat(document.getElementById('perfil-desc-rango3').value)||0,
      permite_global: document.getElementById('perfil-desc-global').checked,
      aprobadores: {
        supera: getCheckedValues('perfil-desc-aprob-supera'),
        r1: getCheckedValues('perfil-desc-aprob-r1'),
        r2: getCheckedValues('perfil-desc-aprob-r2'),
        r3: getCheckedValues('perfil-desc-aprob-r3'),
      }
    },
    margenes: {
      bruto_pct: document.getElementById('perfil-mg-bruto-pct').checked,
      valor_bruto: document.getElementById('perfil-mg-valor-bruto').checked,
      con_desc_pct: document.getElementById('perfil-mg-con-desc-pct').checked,
      valor_con_desc: document.getElementById('perfil-mg-valor-con-desc').checked,
      utilidad: document.getElementById('perfil-mg-utilidad').checked,
      fila_bruto_pct: document.getElementById('perfil-mg-fila-bruto-pct').checked,
      fila_total_bruto: document.getElementById('perfil-mg-fila-total-bruto').checked,
      fila_total_con_desc: document.getElementById('perfil-mg-fila-total-con-desc').checked,
      fila_margen_con_desc_pct: document.getElementById('perfil-mg-fila-margen-con-desc-pct').checked,
      fila_valor_con_desc: document.getElementById('perfil-mg-fila-valor-con-desc').checked,
    }
  };
  const body = { nombre, descripcion, permisos, config };
  const r=id? await apiFetch('/perfiles-venta/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
             : await apiFetch('/perfiles-venta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) return toast(r.data?.error||'Error','error');
  hideModal('modal-perfil-venta'); cargarPerfilesVenta();
}
async function eliminarPerfilVenta(id){
  confirmar({titulo:'Eliminar perfil',mensaje:'¿Eliminar perfil de venta?',icono:'🗑️',onConfirm: async()=>{
    const r=await apiFetch('/perfiles-venta/'+id,{method:'DELETE'}); if(!r.ok) return toast(r.data?.error||'Error','error');
    toast('Eliminado','success'); cargarPerfilesVenta();
  }});
}
let _perfilVentaUsuariosCache=[];
let _perfilesLauncherCache=[];
let _vendedoresCache=[];
let _asignadosVendedorMap={};
async function abrirModalPerfilVentaUsuarios(id){
  const idEl = document.getElementById('perfil-venta-usuarios-id') || document.getElementById('modal-perfil-venta-usuarios-id');
  if (idEl) idEl.value=id;
  const title=_perfilesVentaCache.find(x=>x.id===id)?.nombre||'';
  const titleEl = document.getElementById('perfil-venta-usuarios-title') || document.getElementById('modal-perfil-venta-usuarios-title');
  if (titleEl) titleEl.textContent='Asignar usuarios — '+title;
  const r=await apiFetch('/perfiles-venta/'+id+'/usuarios'); if(!r.ok) return toast(r.data?.error||'Error','error');
  _perfilVentaUsuariosCache=r.data.usuarios||[];
  _perfilesLauncherCache=r.data.perfiles||[];
  _vendedoresCache=r.data.vendedores||[];
  _asignadosVendedorMap=r.data.asignadosVendedor||{};
  const sel=document.getElementById('perfil-venta-usuarios-perfil-filtro');
  if(sel){
    const cur=sel.value;
    sel.innerHTML='<option value="">Todos los perfiles (Launcher)</option>'+_perfilesLauncherCache.map(p=>`<option value="${p.id}">${esc(p.nombre)}</option>`).join('')+'<option value="__sin">Sin perfil</option>';
    sel.value=cur;
    if(![...sel.options].some(o=>o.value===cur)) sel.value='';
  }
  const asignados=new Set(r.data.asignados||[]);
  const vendOpts = _vendedoresCache.map(v=> `<option value="${esc(v.codigo)}">${esc(v.codigo)} — ${esc(v.nombre)}</option>`).join('');
   document.getElementById('perfil-venta-usuarios-lista').innerHTML=_perfilVentaUsuariosCache.map(u=>{
     const perfilLabel=esc(u.perfil_nombre||u.rol||'');
     const vendSel = _asignadosVendedorMap[String(u.id)] || '';
     const selVend = `<select data-vendedor-for="${u.id}" onclick="event.stopPropagation()" onchange="event.stopPropagation()" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;min-width:132px;max-width:150px;align-self:center;background:var(--surface);color:var(--text)" title="Vendedor SIESA para Hub"><option value="">— Vendedor SIESA —</option>${vendOpts}</select>`;
     // set selected after innerHTML
     return `<label data-perfil-id="${u.perfil_id||''}" data-usuario-id="${u.id}" style="display:flex;gap:8px;align-items:center;padding:8px 8px;border-bottom:1px solid var(--border);cursor:pointer"><input type="checkbox" value="${u.id}" ${asignados.has(u.id)?'checked':''} style="width:16px;height:16px;flex-shrink:0"> <span style="flex:1;min-width:0;overflow:hidden"><strong style="display:block;line-height:1.2;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.nombre)}</strong><span style="color:var(--muted);font-size:11px;word-break:break-all;display:block;line-height:1.3">${esc(u.email||'')}</span><span title="${perfilLabel}" style="display:inline-block;margin-top:3px;font-size:10px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);padding:1px 7px;border-radius:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${perfilLabel}</span></span>${selVend}</label>`;
   }).join('');
  // aplicar selección vendedor
  for(const u of _perfilVentaUsuariosCache){
    const s=document.querySelector(`select[data-vendedor-for="${u.id}"]`);
    if(s && _asignadosVendedorMap[String(u.id)]) s.value=_asignadosVendedorMap[String(u.id)];
  }
  document.getElementById('perfil-venta-usuarios-filtro').value='';
  if(sel) sel.value='';
  showModal('modal-perfil-venta-usuarios');
}
function filtrarPerfilVentaUsuarios(){
  const q=(document.getElementById('perfil-venta-usuarios-filtro')?.value||'').toLowerCase();
  const pf=document.getElementById('perfil-venta-usuarios-perfil-filtro')?.value||'';
  document.querySelectorAll('#perfil-venta-usuarios-lista label').forEach(l=>{
    const txt=l.textContent.toLowerCase().includes(q);
    const pid=l.getAttribute('data-perfil-id')||'';
    let perfilOk=true;
    if(pf==='__sin') perfilOk=!pid;
    else if(pf) perfilOk=pid===pf;
    l.style.display=(txt&&perfilOk)?'flex':'none';
  });
}
function perfilVentaSelTodos(v){
  document.querySelectorAll('#perfil-venta-usuarios-lista input[type=checkbox]').forEach(cb=>{ if(cb.closest('label').style.display!=='none') cb.checked=v; });
}
async function guardarPerfilVentaUsuarios(){
  const id=(document.getElementById('perfil-venta-usuarios-id') || document.getElementById('modal-perfil-venta-usuarios-id'))?.value;
  const checks=[...document.querySelectorAll('#perfil-venta-usuarios-lista input:checked')];
  const asignaciones=checks.map(cb=>{
    const uid=parseInt(cb.value);
    const sel=document.querySelector(`select[data-vendedor-for="${uid}"]`);
    const codigo_vendedor= sel?.value ? sel.value.trim() : null;
    return { usuario_id: uid, codigo_vendedor };
  });
  const usuario_ids=asignaciones.map(a=>a.usuario_id);
  const vendedoresMap={}; for(const a of asignaciones) if(a.codigo_vendedor) vendedoresMap[a.usuario_id]=a.codigo_vendedor;
  const r=await apiFetch('/perfiles-venta/'+id+'/usuarios',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario_ids, asignaciones, vendedoresMap})});
  if(!r.ok) return toast(r.data?.error||'Error','error');
  toast('Asignaciones guardadas','success'); hideModal('modal-perfil-venta-usuarios'); cargarPerfilesVenta();
}
