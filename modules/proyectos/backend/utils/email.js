import nodemailer from 'nodemailer';

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';
const APP_NAME = process.env.APP_NAME || 'SynnoxERP Proyectos';
const _domain = process.env.COMPANY_DOMAIN || 'localhost';
const BASE_URL = process.env.BASE_URL || (_domain !== 'localhost' ? `https://${_domain}/proyectos` : 'http://localhost:3101');

let _smtpConfig = null;
let _smtpConfigTs = 0;
let _launcherBaseUrl = null;
const SMTP_CACHE_TTL = 60000;

async function getSmtpConfig() {
  const now = Date.now();
  if (_smtpConfig && (now - _smtpConfigTs) < SMTP_CACHE_TTL) return _smtpConfig;

  try {
    const res = await fetch(`${LAUNCHER_URL}/api/smtp/internal`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const c = data.config;
      _smtpConfig = {
        host: c.smtp_host || '',
        port: parseInt(c.smtp_port || '587'),
        secure: c.smtp_secure === 'true',
        user: c.smtp_user || '',
        pass: c.smtp_pass || '',
        from: c.smtp_from || 'smtp@localhost',
        fromName: c.smtp_from_name || APP_NAME
      };
      if (data.baseUrl) _launcherBaseUrl = data.baseUrl;
      _smtpConfigTs = now;
      return _smtpConfig;
    }
  } catch (e) {
    console.warn('[email] Launcher SMTP no disponible:', e.message);
  }
  return null;
}

export function getLauncherBaseUrl() {
  return _launcherBaseUrl;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseTemplate(title, subtitle, content) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><title>${esc(title)}</title>
<style>@media only screen and (max-width:620px){.c{width:100%!important;padding:20px 15px!important}.t{font-size:22px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;min-height:100vh;">
<tr><td align="center" style="padding:20px 10px;">
<table class="c" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e0e4ea;max-width:100%;">
<tr><td style="padding:0;background:#2563eb;border-radius:12px 12px 0 0;height:4px"></td></tr>
<tr><td style="padding:30px 25px;color:#2c3e50;font-size:15px;line-height:1.7;">
<h1 class="t" style="color:#2563eb;font-size:26px;margin:0 0 6px;font-weight:700;">${esc(title)}</h1>
<p style="color:#6b7a8f;font-size:13px;margin:0 0 20px;">${esc(subtitle)}</p>
${content}
<div style="margin-top:25px;padding-top:18px;border-top:1px solid #e0e4ea;text-align:center;">
<a href="${BASE_URL}" style="color:#2563eb;text-decoration:none;font-size:13px;">${esc(APP_NAME)}</a>
</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

let _transporter = null;
async function getTransporter() {
  if (_transporter) return _transporter;
  const cfg = await getSmtpConfig();
  if (!cfg || !cfg.host) return null;
  _transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    connectionTimeout: 5000, greetingTimeout: 5000
  });
  return _transporter;
}

export async function enviarCorreo(para, asunto, htmlBody, textBody) {
  const transporter = await getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado, email no enviado:', asunto);
    return false;
  }
  const cfg = await getSmtpConfig();
  await transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.from}>`,
    to: para, subject: asunto, text: textBody || '', html: htmlBody
  });
  return true;
}

export function templateAprobacionTarea({ tarea, accion, motivo, aprobador }) {
  const color = accion === 'aprobada' ? '#10b981' : '#ef4444';
  const icono = accion === 'aprobada' ? '✅' : '❌';
  const texto = accion === 'aprobada'
    ? `La tarea <strong>${esc(tarea.titulo)}</strong> ha sido aprobada y marcada como completada.`
    : `La tarea <strong>${esc(tarea.titulo)}</strong> ha sido rechazada y devuelve a en progreso.`;
  const motivoHtml = motivo ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:12px 0;font-size:14px;"><strong>Motivo del rechazo:</strong><br/>${esc(motivo)}</div>` : '';
  return baseTemplate(
    `${icono} Tarea ${accion}`,
    `Proyecto: ${esc(tarea.proyecto_nombre || 'Sin proyecto')}`,
    `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">
      <div style="font-size:14px;color:#475569;">${texto}</div>
      ${motivoHtml}
      <div style="margin-top:12px;font-size:13px;color:#64748b;">
        <strong>Asignado a:</strong> ${esc(tarea.asignado_nombre || 'Sin asignar')}<br/>
        <strong>Prioridad:</strong> ${esc(tarea.prioridad)}<br/>
        <strong>Aprobado por:</strong> ${esc(aprobador || '—')}
      </div>
    </div>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver tarea</a>`
  );
}

export function templateAprobacionProyecto({ proyecto, accion, aprobador }) {
  const color = accion === 'aprobada' ? '#10b981' : '#ef4444';
  const icono = accion === 'aprobada' ? '✅' : '❌';
  return baseTemplate(
    `${icono} Proyecto ${accion}`,
    `Gestión de Proyectos`,
    `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">
      <div style="font-size:14px;color:#475569;">El proyecto <strong>${esc(proyecto.nombre)}</strong> ha sido ${accion}.</div>
      <div style="margin-top:12px;font-size:13px;color:#64748b;">
        <strong>Aprobado por:</strong> ${esc(aprobador || '—')}
      </div>
    </div>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver proyecto</a>`
  );
}

export function templateTareaEnRevision({ tarea }) {
  return baseTemplate(
    '📋 Tarea enviada a revisión',
    `Proyecto: ${esc(tarea.proyecto_nombre || 'Sin proyecto')}`,
    `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">
      <div style="font-size:14px;color:#475569;">La tarea <strong>${esc(tarea.titulo)}</strong> ha sido enviada a revisión para aprobación.</div>
      <div style="margin-top:12px;font-size:13px;color:#64748b;">
        <strong>Asignado a:</strong> ${esc(tarea.asignado_nombre || 'Sin asignar')}<br/>
        <strong>Prioridad:</strong> ${esc(tarea.prioridad)}
      </div>
    </div>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Revisar tarea</a>`
  );
}

export function templateAlertaVencimiento({ tareas, tipo }) {
  const rows = tareas.map(t => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;">${esc(t.titulo)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#64748b;">${esc(t.proyecto_nombre || '—')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#ef4444;font-weight:600;">${t.fecha_limite ? new Date(t.fecha_limite).toLocaleDateString('es-CO') : 'Sin fecha'}</td>
    </tr>
  `).join('');

  return baseTemplate(
    `⚠️ Tareas ${tipo === 'vencidas' ? 'vencidas' : 'próximas a vencer'}`,
    'Alerta automática del sistema',
    `<p style="font-size:14px;color:#475569;margin:0 0 12px;">Se ${tipo === 'vencidas' ? 'han detectado' : 'han detectado'} ${tareas.length} tarea(s) ${tipo === 'vencidas' ? 'vencidas' : 'próximas a vencer'} sin avance significativo:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:12px 0;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Tarea</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Proyecto</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Fecha límite</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver tareas</a>`
  );
}

export function templateResumenSemanal({ proyectos, stats }) {
  return baseTemplate(
    '📊 Resumen semanal de proyectos',
    'Digest automático — SynnoxERP Proyectos',
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0;">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#16a34a;">${stats.completadas || 0}</div>
        <div style="font-size:12px;color:#64748b;">Completadas</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#2563eb;">${stats.en_progreso || 0}</div>
        <div style="font-size:12px;color:#64748b;">En progreso</div>
      </div>
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#ca8a04;">${stats.pendientes || 0}</div>
        <div style="font-size:12px;color:#64748b;">Pendientes</div>
      </div>
    </div>
    ${proyectos.length ? `<p style="font-size:14px;color:#475569;margin:16px 0 8px;"><strong>Proyectos activos:</strong></p>
    <ul style="font-size:14px;color:#475569;padding-left:20px;">${proyectos.map(p => `<li style="margin:4px 0;">${esc(p.nombre)} — <span style="color:#64748b;">${p.total || 0} tareas</span></li>`).join('')}</ul>` : '<p style="font-size:14px;color:#64748b;">No hay proyectos activos este semana.</p>'}
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver dashboard</a>`
  );
}

export function templateTareaAsignada({ tarea, asignador }) {
  return baseTemplate(
    '📋 Tarea asignada',
    `Proyecto: ${esc(tarea.proyecto_nombre || 'Sin proyecto')}`,
    `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">
      <div style="font-size:14px;color:#475569;">Se te ha asignado la tarea <strong>${esc(tarea.titulo)}</strong>.</div>
      <div style="margin-top:12px;font-size:13px;color:#64748b;">
        ${tarea.descripcion ? `<strong>Descripción:</strong> ${esc(tarea.descripcion).substring(0, 200)}${tarea.descripcion.length > 200 ? '...' : ''}<br/>` : ''}
        <strong>Prioridad:</strong> ${esc(tarea.prioridad)}<br/>
        ${tarea.fecha_limite ? `<strong>Fecha límite:</strong> ${new Date(tarea.fecha_limite).toLocaleDateString('es-CO')}<br/>` : ''}
        <strong>Asignado por:</strong> ${esc(asignador || '—')}
      </div>
    </div>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver tarea</a>`
  );
}

export function templateNuevoComentario({ tarea, comentario, autor }) {
  return baseTemplate(
    '💬 Nuevo comentario',
    `Tarea: ${esc(tarea.titulo)}`,
    `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">
      <div style="font-size:14px;color:#475569;"><strong>${esc(autor)}</strong> ha comentado en la tarea:</div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-top:8px;font-size:14px;color:#334155;font-style:italic;">"${esc(comentario.contenido).substring(0, 300)}${comentario.contenido.length > 300 ? '...' : ''}"</div>
      <div style="margin-top:12px;font-size:13px;color:#64748b;">
        <strong>Proyecto:</strong> ${esc(tarea.proyecto_nombre || 'Sin proyecto')}
      </div>
    </div>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver tarea</a>`
  );
}

export function templateProyectoAsignado({ proyecto, asignador }) {
  return baseTemplate(
    '📁 Proyecto asignado',
    'Gestión de Proyectos',
    `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">
      <div style="font-size:14px;color:#475569;">Se te ha asignado el proyecto <strong>${esc(proyecto.nombre)}</strong>.</div>
      ${proyecto.descripcion ? `<div style="margin-top:8px;font-size:13px;color:#64748b;">${esc(proyecto.descripcion).substring(0, 200)}${proyecto.descripcion.length > 200 ? '...' : ''}</div>` : ''}
      <div style="margin-top:12px;font-size:13px;color:#64748b;">
        ${proyecto.fecha_limite ? `<strong>Fecha límite:</strong> ${new Date(proyecto.fecha_limite).toLocaleDateString('es-CO')}<br/>` : ''}
        <strong>Asignado por:</strong> ${esc(asignador || '—')}
      </div>
    </div>
    <a href="${BASE_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Ver proyecto</a>`
  );
}

export function invalidateSmtpCache() {
  _smtpConfig = null;
  _smtpConfigTs = 0;
}

export function getEmailBaseUrl() {
  return _launcherBaseUrl ? `${_launcherBaseUrl}/proyectos` : BASE_URL;
}

export function getEmailModuleOpts() {
  return { module: 'proyectos', baseUrl: getEmailBaseUrl() };
}
