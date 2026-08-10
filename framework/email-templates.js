'use strict';

/**
 * Email templates compartidos para todos los módulos.
 * Cada módulo pasa su color y nombre; el framework genera HTML consistente.
 */

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MODULE_DEFAULTS = {
  proyectos:   { color: '#2563eb', name: 'Proyectos' },
  nomina:      { color: '#10b981', name: 'Nómina' },
  proveedores: { color: '#7c3aed', name: 'Proveedores' },
  logistica:   { color: '#f59e0b', name: 'Logística' },
  launcher:    { color: '#6b7280', name: 'SynnoxERP' },
};

/**
 * Template base para todos los emails.
 * @param {string} title     — Título principal (h1)
 * @param {string} subtitle  — Subtítulo debajo del título
 * @param {string} content   — HTML del cuerpo
 * @param {object} [opts]    — Opciones: { color, moduleName, baseUrl }
 */
function baseTemplate(title, subtitle, content, opts = {}) {
  const mod = MODULE_DEFAULTS[opts.module] || {};
  const color = opts.color || mod.color || '#2563eb';
  const moduleName = opts.moduleName || mod.name || 'SynnoxERP';
  const baseUrl = opts.baseUrl || '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><title>${esc(title)}</title>
<style>@media only screen and (max-width:620px){.c{width:100%!important;padding:20px 15px!important}.t{font-size:22px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;min-height:100vh;">
<tr><td align="center" style="padding:20px 10px;">
<table class="c" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e0e4ea;max-width:100%;">
<tr><td style="padding:0;background:${color};border-radius:12px 12px 0 0;height:4px"></td></tr>
<tr><td style="padding:30px 25px;color:#2c3e50;font-size:15px;line-height:1.7;">
<h1 class="t" style="color:${color};font-size:26px;margin:0 0 6px;font-weight:700;">${esc(title)}</h1>
<p style="color:#6b7a8f;font-size:13px;margin:0 0 20px;">${esc(subtitle)}</p>
${content}
<div style="margin-top:25px;padding-top:18px;border-top:1px solid #e0e4ea;text-align:center;">
${baseUrl ? `<a href="${baseUrl}" style="color:${color};text-decoration:none;font-size:13px;">${esc(moduleName)}</a>` : `<span style="color:#6b7a8f;font-size:13px;">${esc(moduleName)}</span>`}
</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * Card reutilizable para agrupar contenido.
 */
function card(inner) {
  return `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;border:1px solid #e2e8f0;">${inner}</div>`;
}

/**
 * Botón CTA.
 */
function button(text, url, color) {
  return `<a href="${url}" style="display:inline-block;background:${color || '#2563eb'};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">${esc(text)}</a>`;
}

/**
 * Detalles en formato clave: valor.
 */
function detalles(items) {
  return Object.entries(items).filter(([, v]) => v != null && v !== '').map(([k, v]) =>
    `<strong>${esc(k)}:</strong> ${esc(v)}`
  ).join('<br/>');
}

// ─── Templates genéricos ────────────────────────────────────────────

/**
 * Notificación de aprobación o rechazo.
 */
function templateAprobacion({ entidad, nombre, accion, motivo, aprobador, detallesExtra, url, module, baseUrl }) {
  const mod = MODULE_DEFAULTS[module] || {};
  const color = accion === 'aprobada' || accion === 'aprobado' ? '#10b981' : '#ef4444';
  const icono = accion === 'aprobada' || accion === 'aprobado' ? '✅' : '❌';
  const accionTxt = accion === 'aprobada' || accion === 'aprobado' ? 'aprobado(a)' : 'rechazado(a)';
  const texto = `La ${entidad} <strong>${esc(nombre)}</strong> ha sido ${accionTxt}.`;
  const motivoHtml = motivo ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:12px 0;font-size:14px;"><strong>Motivo del rechazo:</strong><br/>${esc(motivo)}</div>` : '';
  const detallesHtml = detallesExtra ? `<div style="margin-top:12px;font-size:13px;color:#64748b;">${detalles(detallesExtra)}</div>` : '';

  return baseTemplate(
    `${icono} ${entidad.charAt(0).toUpperCase() + entidad.slice(1)} ${accionTxt}`,
    '',
    card(`<div style="font-size:14px;color:#475569;">${texto}</div>${motivoHtml}${detallesHtml}${aprobador ? `<div style="margin-top:8px;font-size:13px;color:#64748b;"><strong>Aprobado por:</strong> ${esc(aprobador)}</div>` : ''}`) +
    (url ? button(`Ver ${entidad}`, url, mod.color) : ''),
    { module, baseUrl }
  );
}

/**
 * Notificación de asignación.
 */
function templateAsignacion({ entidad, nombre, asignador, descripcion, prioridad, fechaLimite, url, module, baseUrl }) {
  const mod = MODULE_DEFAULTS[module] || {};
  const ent = entidad.toLowerCase();
  const esFemenino = ent === 'tarea' || ent === 'historia';
  const article = esFemenino ? 'la' : 'el';
  const titleWord = esFemenino ? 'Asignada' : 'Asignado';
  return baseTemplate(
    `📋 ${entidad.charAt(0).toUpperCase() + entidad.slice(1)} ${titleWord}`,
    '',
    card(
      `<div style="font-size:14px;color:#475569;">Se te ha asignado ${article} ${entidad} <strong>${esc(nombre)}</strong>.</div>` +
      `<div style="margin-top:12px;font-size:13px;color:#64748b;">${detalles({
        'Descripción': descripcion ? (descripcion.length > 200 ? descripcion.slice(0, 200) + '...' : descripcion) : null,
        'Prioridad': prioridad,
        'Fecha límite': fechaLimite,
        'Asignado por': asignador,
      })}</div>`
    ) +
    (url ? button(`Ver ${entidad}`, url, mod.color) : ''),
    { module, baseUrl }
  );
}

/**
 * Notificación de cambio de estado.
 */
function templateCambioEstado({ entidad, nombre, estadoAnterior, estadoNuevo, url, module, baseUrl }) {
  const mod = MODULE_DEFAULTS[module] || {};
  const ent = entidad.toLowerCase();
  const article = (ent === 'tarea' || ent === 'historia') ? 'La' : 'El';
  return baseTemplate(
    `🔄 ${entidad.charAt(0).toUpperCase() + entidad.slice(1)} movida`,
    '',
    card(
      `<div style="font-size:14px;color:#475569;">${article} ${entidad} <strong>${esc(nombre)}</strong> cambió de <strong>${esc(estadoAnterior)}</strong> a <strong>${esc(estadoNuevo)}</strong>.</div>`
    ) +
    (url ? button(`Ver ${entidad}`, url, mod.color) : ''),
    { module, baseUrl }
  );
}

/**
 * Notificación de nuevo comentario.
 */
function templateNuevoComentario({ entidad, nombre, autor, comentario, url, module, baseUrl }) {
  const mod = MODULE_DEFAULTS[module] || {};
  return baseTemplate(
    `💬 Nuevo comentario`,
    `${entidad.charAt(0).toUpperCase() + entidad.slice(1)}: ${esc(nombre)}`,
    card(
      `<div style="font-size:14px;color:#475569;"><strong>${esc(autor)}</strong> ha comentado:</div>` +
      `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-top:8px;font-size:14px;color:#334155;font-style:italic;">"${esc(comentario).substring(0, 300)}${comentario.length > 300 ? '...' : ''}"</div>`
    ) +
    (url ? button(`Ver ${entidad}`, url, mod.color) : ''),
    { module, baseUrl }
  );
}

/**
 * Notificación genérica (para eventos sin template específico).
 */
function templateGenerico({ titulo, mensaje, detallesExtra, url, botonTexto, module, baseUrl }) {
  const mod = MODULE_DEFAULTS[module] || {};
  const detallesHtml = detallesExtra ? card(`<div style="font-size:13px;color:#64748b;">${detalles(detallesExtra)}</div>`) : '';
  return baseTemplate(
    titulo,
    '',
    card(`<div style="font-size:14px;color:#475569;">${mensaje}</div>`) +
    detallesHtml +
    (url ? button(botonTexto || 'Ver más', url, mod.color) : ''),
    { module, baseUrl }
  );
}

/**
 * Alerta de vencimiento (lista de items).
 */
function templateAlerta({ titulo, subtitulo, items, url, botonTexto, module, baseUrl }) {
  const mod = MODULE_DEFAULTS[module] || {};
  const rows = items.map(t => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;">${esc(t.nombre)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#64748b;">${esc(t.detalle || '—')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#ef4444;font-weight:600;">${esc(t.fecha || 'Sin fecha')}</td>
    </tr>
  `).join('');

  return baseTemplate(
    titulo,
    subtitulo || '',
    `<p style="font-size:14px;color:#475569;margin:0 0 12px;">Se han detectado ${items.length} elemento(s):</p>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:12px 0;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Nombre</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Detalle</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Fecha</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>` +
    (url ? button(botonTexto || 'Ver', url, mod.color) : ''),
    { module, baseUrl }
  );
}

module.exports = {
  baseTemplate,
  card,
  button,
  detalles,
  esc,
  MODULE_DEFAULTS,
  templateAprobacion,
  templateAsignacion,
  templateCambioEstado,
  templateNuevoComentario,
  templateGenerico,
  templateAlerta,
};
