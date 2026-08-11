// dashboard.js - Dashboard module

const _charts = {};
const _nomCollapsed = {};
let _chartJsLoaded = false;

function setGridSize(size) {
  const grid = document.getElementById('dash-grid');
  if (!grid) return;
  grid.classList.remove('sz-s', 'sz-m', 'sz-l');
  grid.classList.add('sz-' + size);
  document.querySelectorAll('.sz-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.sz-btn[onclick*="'${size}'"]`);
  if (btn) btn.classList.add('active');
  Object.values(_charts).forEach(c => { try { c.resize(); } catch {} });
}

function initGridSize() {
  const grid = document.getElementById('dash-grid');
  if (!grid) return;
  grid.classList.remove('sz-s', 'sz-m', 'sz-l');
  grid.classList.add('sz-m');
  document.querySelectorAll('.sz-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.sz-btn[onclick*="'m'"]`);
  if (btn) btn.classList.add('active');
}

async function cargarChartJs() {
  if (_chartJsLoaded) return;
  if (typeof Chart !== 'undefined') { _chartJsLoaded = true; return; }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.integrity = 'sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD';
    s.crossOrigin = 'anonymous';
    s.onload = () => { _chartJsLoaded = true; resolve(); };
    s.onerror = () => { _chartJsLoaded = false; reject(new Error('Failed to load Chart.js')); };
    document.head.appendChild(s);
  });
}

function destruirCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch {} });
  Object.keys(_charts).forEach(k => delete _charts[k]);
}

// Create or update Chart.js instance
function crearOActualizar(id, config) {
  if (!config.options) config.options = {};
  if (_charts[id]) {
    _charts[id].data = config.data;
    _charts[id].options = config.options;
    _charts[id].update();
  } else {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const parent = ctx.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        ctx.style.width = rect.width + 'px';
        ctx.style.height = rect.height + 'px';
      }
    }
    _charts[id] = new Chart(ctx, config);
    requestAnimationFrame(() => {
      setTimeout(() => { try { _charts[id]?.resize(); } catch {} }, 300);
    });
  }
}

let _dashData = null;

async function renderDashboard() {
  await cargarChartJs();
  const isLight = document.body.classList.contains('light');
  const gridColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
  const textColor = isLight ? '#2c3e50' : '#e8ecf5';
  const now = new Date();
  const currentYear = now.getFullYear();

  ['dash-chart-anio', 'dash-tipo-anio', 'dash-sede-anio', 'dash-top-anio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = currentYear;
  });

  const data = _dashData;
  if (!data) return;

  const mesesAnio = [];
  for (let m = 1; m < now.getMonth() + 1; m++)
    mesesAnio.push(currentYear + '-' + String(m).padStart(2, '0'));

  // 1. Hours by Month
  crearOActualizar('chart-mes', {
    type: 'line',
    data: {
      labels: mesesAnio,
      datasets: [{
        label: 'Horas Mensuales',
        data: mesesAnio.map(m => data.porMes[m] || 0),
        borderColor: '#4f8ef7',
        backgroundColor: 'rgba(79,142,247,0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Horas por Mes — ' + currentYear, color: textColor } },
      scales: {
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } },
        x: { grid: { color: gridColor }, ticks: { color: textColor }}
      }
    }
  });

  // 2. Records by Status
  crearOActualizar('chart-tipo', {
    type: 'doughnut',
    data: {
      labels: ['Pendiente', 'Aprobado', 'Rechazado'],
      datasets: [{
        data: [data.porEstado.pendiente || 0, data.porEstado.aprobado || 0, data.porEstado.rechazado || 0],
        backgroundColor: ['#d69e2e', '#2f855a', '#c53030']
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Distribución por Estado — ' + currentYear, color: textColor } }
    }
  });

  // 3. Hours by Sede
  crearOActualizar('chart-sede', {
    type: 'bar',
    data: {
      labels: data.porSede.map(s => s.sede),
      datasets: [{
        label: 'Horas',
        data: data.porSede.map(s => s.total),
        backgroundColor: '#2b6cb0',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: 'Horas por Sede — ' + currentYear, color: textColor } },
      scales: {
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } },
        x: { grid: { color: gridColor }, ticks: { color: textColor }}
      }
    }
  });

  // 4. Top 5 Employees
  crearOActualizar('chart-top', {
    type: 'bar',
    data: {
      labels: data.topEmpleados.map(e => e.nombre),
      datasets: [{
        label: 'Novedades',
        data: data.topEmpleados.map(e => e.total),
        backgroundColor: data.topEmpleados.map(e => empColor(e.nombre)),
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Top 5 Empleados — ' + currentYear, color: textColor }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } },
        y: { grid: { color: gridColor }, ticks: { color: textColor }}
      }
    }
  });

  // 5. Valor COP by Month
  const nombresMesesChart = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const mesesCOP = [];
  for (let i = 1; i <= 12; i++)
    mesesCOP.push(currentYear + '-' + String(i).padStart(2, '0'));

  const elValorcopAnio = document.getElementById('dash-valorcop-anio');
  if (elValorcopAnio) elValorcopAnio.textContent = currentYear;
  crearOActualizar('chart-valorcop', {
    type: 'bar',
    data: {
      labels: mesesCOP.map(m => nombresMesesChart[parseInt(m.split('-')[1]) - 1]),
      datasets: [{
        label: 'Valor COP',
        data: mesesCOP.map(m => data.porMesCOP[m] || 0),
        backgroundColor: '#38a169',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Valor COP ' + currentYear, color: textColor },
        tooltip: { callbacks: { label: ctx => '$' + Number(ctx.raw).toLocaleString('es-CO') } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, callback: v => '$' + Number(v).toLocaleString('es-CO') } },
        x: { grid: { color: gridColor }, ticks: { color: textColor }}
      }
    }
  });

  // 6. Stats — hide widgets where the user has no data
  const s = data.stats;
  const hasData = s.totalHoras > 0;
  const fmtCOP = (v) => '$' + Number(v || 0).toLocaleString('es-CO');
  const statsMap = {
    'dash-total': (s.totalHoras || 0).toFixed(1),
    'dash-mes': (s.horasMes || 0).toFixed(1),
    'dash-anio': (s.horasAnio || 0).toFixed(1),
    'dash-emp': s.empleadosConHoras || 0,
    'dash-pendientes': (s.horasPendientes || 0).toFixed(1),
    'dash-rechazados': s.totalRechazados || 0,
    'dash-registros': s.totalAprobados || 0,
    'dash-valor-mes': fmtCOP(s.valorMes),
    'dash-valor-anio': fmtCOP(s.valorAnio)
  };
  Object.entries(statsMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
  // Sanity: ensure all widget containers are visible (content determines display)

  // Period with most hours
  if (data.mejorMes) {
    const [anio, mesNum] = data.mejorMes.mes.split('-');
    const elPeriodoAnio = document.getElementById('dash-periodo-anio');
    if (elPeriodoAnio) elPeriodoAnio.textContent = anio;
    const elContent = document.getElementById('dash-periodo-content');
    if (elContent) {
      const nombresMeses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      elContent.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:2.5rem;font-weight:700;color:#4f8ef7;">${nombresMeses[parseInt(mesNum)-1]}</div>
          <div style="font-size:1.2rem;color:var(--text-secondary);">${Number(data.mejorMes.total).toFixed(1)} horas aprobadas</div>
        </div>
      `;
    }
  }

  renderUltimosRegistros();
}

function renderUltimosRegistros() {
  const tbody = document.getElementById('dash-table-body');
  if (!tbody) return;
  
  const recientes = [...registros].sort((a, b) => (b.creado || '').localeCompare(a.creado || '')).slice(0, 8);
  
  if (!recientes.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Sin registros aún</div></div></td></tr>';
    return;
  }
  
  tbody.innerHTML = recientes.map(r => {
    const emp = _empMap.get(r.empleadoId);
    const badgeEstado = r.estado === 'aprobado' ? 'success' : r.estado === 'rechazado' ? 'danger' : 'warning';
    const creado = r.creado ? new Date(r.creado).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    return `<tr>
      <td data-label="Empleado">${esc(emp ? emp.nombre : '—')}</td>
      <td data-label="Fecha">${esc(fmt(r.fecha))}</td>
      <td data-label="Creado" style="font-size:12px;color:var(--muted);">${esc(creado)}</td>
      <td data-label="Horas"><strong>${esc(decimalAHoraMinuto(r.horas))}h</strong></td>
      <td data-label="Tipo"><span class="badge badge-${esc(r.tipo)}">${esc(nombreTipo(r.tipo))}</span></td>
      <td data-label="Motivo" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.motivo || '—')}</td>
      <td data-label="Estado"><span class="badge badge-${esc(badgeEstado)}">${esc(r.estado)}</span>${r.aprobacion_pendiente ? ' <span class="badge badge-info" style="font-size:10px;">⏳</span>' : ''}</td>
    </tr>`;
  }).join('');
}

// Reload dashboard data (usa endpoint server-side, no carga todos los registros)
async function reloadDashboardData() {
  try {
    const res = await GET('/api/dashboard/resumen');
    if (res.ok) _dashData = await res.json();
    if (typeof renderDashboard === 'function') await renderDashboard();
  } catch (e) {
    console.error('Error reloading dashboard:', e);
  }
}

// Resize charts on window resize
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    Object.values(_charts).forEach(c => {
      try {
        const canvas = c.canvas;
        if (canvas && canvas.parentElement) {
          const rect = canvas.parentElement.getBoundingClientRect();
          if (rect.width > 0) {
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
          }
        }
        c.resize();
      } catch {}
    });
  }, 250);
});
