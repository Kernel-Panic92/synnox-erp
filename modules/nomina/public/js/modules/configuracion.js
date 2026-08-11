let cfgTab = 'smtp';

async function rConfig(){
  const tabBar = document.getElementById('cfg-tab-bar');
  const cfgContent = document.getElementById('cfg-content');
  if (!tabBar || !cfgContent) return;

  const tabs = [
    { id: 'smtp', label: '📧 Correo' },
    { id: 'calendario', label: '📅 Calendario' },
    { id: 'backup', label: '💾 Backup' },
    { id: 'seguridad', label: '🛡️ Seguridad' },
    { id: 'auditoria', label: '📋 Auditoría' },
    { id: 'telemetria', label: '📡 Telemetría' }
  ];

  tabBar.innerHTML = tabs.map(t =>
    `<button class="fb${cfgTab === t.id ? ' active' : ''}" onclick="cfgTab='${t.id}';rConfig()">${t.label}</button>`
  ).join('');

  cfgContent.innerHTML = '<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text-sm"></div><div class="skeleton skeleton-text"></div>';
  await renderCfgTab();
}

async function renderCfgTab(){
  const c = document.getElementById('cfg-content');
  if (!c) return;

  if (cfgTab === 'smtp') {
    try {
      const res = await GET('/api/configuracion');
      if (!res.ok) { c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Error cargando configuración</div>'; return; }
      const cfg = await res.json();
      const heredar = cfg.smtp_heredar === '1' || cfg.smtp_heredar === 'true';
      c.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px;">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;">
          <h4 style="margin-bottom:16px;font-family:var(--font-head);">📧 Configuración SMTP</h4>
          <div style="margin-bottom:16px;padding:12px;background:var(--surface2);border-radius:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;text-transform:none;letter-spacing:normal;font-weight:400;">
              <input type="checkbox" id="cfg-heredar" style="width:auto;flex-shrink:0" ${heredar?'checked':''} onchange="toggleHeredarSmtp()">
              Heredar configuración del Launcher
            </label>
            <div id="cfg-launcher-url-wrap" style="margin-top:8px;${heredar?'':'display:none;'}">
              <label style="font-size:12px;color:var(--muted);text-transform:none;letter-spacing:normal;font-weight:400;">URL del Launcher</label>
              <input id="cfg-launcher-url" value="${esc(cfg.launcher_url||'http://localhost:3002')}" placeholder="http://localhost:3002" style="width:100%;padding:7px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;">
            </div>
          </div>

          <div id="cfg-smtp-local" style="${heredar?'opacity:0.5;pointer-events:none;':''}">
            <div class="form-grid">
              <div class="form-group"><label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">Host SMTP</label><input id="cfg-host" value="${esc(cfg.smtp_host||'')}" placeholder="mail.tuempresa.com"></div>
              <div class="form-group"><label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">Puerto</label><input id="cfg-puerto" value="${cfg.smtp_puerto||'587'}" placeholder="587"></div>
              <div class="form-group"><label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">TLS</label><select id="cfg-tls"><option value="true" ${cfg.smtp_tls!=='false'?'selected':''}>Sí</option><option value="false" ${cfg.smtp_tls==='false'?'selected':''}>No</option></select></div>
              <div class="form-group"><label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">Usuario</label><input id="cfg-usuario" value="${esc(cfg.smtp_usuario||'')}"></div>
              <div class="form-group"><label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">Contraseña</label><input type="password" id="cfg-password" value="${cfg.smtp_password?'••••••••':''}"></div>
              <div class="form-group"><label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">Remitente (From)</label><input id="cfg-remitente" value="${esc(cfg.smtp_remitente||'')}" placeholder="noreply@ejemplo.com"></div>
            </div>
          </div>
          <div class="flex" style="margin-top:8px;">
            <button class="btn btn-primary" onclick="guardarSmtp()">✓ Guardar</button>
            <button class="btn btn-secondary" onclick="testSmtp()">✉ Probar</button>
          </div>
          <div id="smtp-msg" style="margin-top:10px;"></div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;">
          <h4 style="margin-bottom:16px;font-family:var(--font-head);">📝 Plantilla de Correo</h4>
          <div class="form-group" style="margin-bottom:16px;"><label>Asunto</label><input id="cfg-asunto" value="${esc(cfg.reset_asunto||'')}" placeholder="Recuperación de contraseña"></div>
          <div class="form-group"><label>Cuerpo del Mensaje</label><textarea id="cfg-cuerpo" style="min-height:180px;" placeholder="Usa {nombre} y {enlace} como variables...">${esc(cfg.reset_cuerpo||'')}</textarea></div>
          <div style="margin-top:10px;padding:10px 12px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--muted);">
            Variables disponibles: <code style="color:var(--accent)">{nombre}</code> — nombre del usuario &nbsp;|&nbsp; <code style="color:var(--accent)">{enlace}</code> — link de reset
          </div>
          <div class="flex" style="margin-top:16px;">
            <button class="btn btn-primary" onclick="guardarSmtp()">✓ Guardar Plantilla</button>
          </div>
        </div>
        </div>`;
    } catch(e) { c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)">Error: ${esc(e.message)}</div>`; }
  }
  else if (cfgTab === 'backup') {
    c.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;">
        <div class="table-wrap" style="padding:28px 32px;">
          <div style="font-family:var(--font-head);font-weight:700;font-size:16px;margin-bottom:6px;">📦 Exportar Backup</div>
          <p style="color:var(--muted);font-size:13px;margin-bottom:24px;line-height:1.6;">
            Descarga un archivo <strong style="color:var(--text)">ZIP</strong> con toda la información del sistema.
            Incluye un <code style="color:var(--accent)">backup.json</code> para restaurar y archivos
            <code style="color:var(--accent)">.csv</code> para abrir en Excel.
          </p>
          <div style="background:var(--surface2);border-radius:10px;padding:16px 18px;margin-bottom:24px;font-size:13px;">
            <div style="font-weight:600;margin-bottom:10px;color:var(--text);">El backup incluye:</div>
            <div style="display:flex;flex-direction:column;gap:6px;color:var(--muted);">
              <span>✓ Empleados</span>
              <span>✓ Registros de novedades</span>
              <span>✓ Períodos de nómina</span>
              <span>✓ Usuarios del sistema</span>
              <span>✓ Configuración SMTP</span>
            </div>
          </div>
          <button class="btn btn-primary" id="btn-descargar-backup" onclick="descargarBackup()" style="width:100%;justify-content:center;padding:13px;">💾 Descargar Backup ZIP</button>
          <div id="backup-ok" style="display:none;margin-top:14px;padding:10px 14px;background:rgba(79,190,150,0.1);border:1px solid rgba(79,190,150,0.3);border-radius:9px;font-size:13px;color:var(--success);">✓ Backup generado y descargado correctamente.</div>
          <div id="ultimo-backup-card" style="margin-top:20px;border:1px solid var(--border);border-radius:12px;padding:16px 18px;display:none;">
            <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">🤖 Último Backup Automático</div>
            <div style="display:flex;flex-direction:column;gap:7px;">
              <div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">📅</span><div><div style="font-size:13px;font-weight:600;color:var(--text);" id="ultimo-bk-fecha">—</div><div style="font-size:11px;color:var(--muted);" id="ultimo-bk-hace">—</div></div></div>
              <div style="display:flex;align-items:center;gap:8px;padding-top:6px;border-top:1px solid var(--border);"><span style="font-size:16px;">📄</span><code style="font-size:11px;color:var(--accent);word-break:break-all;" id="ultimo-bk-archivo">—</code></div>
              <div style="display:flex;gap:16px;padding-top:6px;border-top:1px solid var(--border);"><div style="font-size:12px;color:var(--muted);">Tamaño: <strong style="color:var(--text);" id="ultimo-bk-size">—</strong></div><div style="font-size:12px;color:var(--muted);">Red: <strong id="ultimo-bk-red">—</strong></div></div>
            </div>
          </div>
          <div id="ultimo-backup-none" style="margin-top:16px;font-size:12px;color:var(--muted);text-align:center;padding:12px;background:var(--surface2);border-radius:9px;">🕐 Aún no se ha ejecutado el backup automático</div>
          <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">🚀 Ejecutar Backup Automático</div>
            <p style="color:var(--muted);font-size:12px;margin-bottom:14px;line-height:1.6;">Ejecuta el script de backup del servidor (backup local + copia NAS si está configurado).</p>
            <button class="btn btn-primary" id="btn-ejecutar-backup-script" onclick="ejecutarBackupScript()" style="width:100%;justify-content:center;padding:13px;">▶ Ejecutar Backup Automático</button>
            <div id="bk-script-log" style="display:none;margin-top:14px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;font-size:12px;font-family:monospace;color:var(--text);max-height:200px;overflow-y:auto;white-space:pre-wrap;"></div>
          </div>
        </div>
        <div class="table-wrap" style="padding:28px 32px;">
          <div style="font-family:var(--font-head);font-weight:700;font-size:16px;margin-bottom:6px;">♻️ Restaurar Backup</div>
          <div style="background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);border-radius:10px;padding:14px 16px;margin-bottom:20px;font-size:12px;color:var(--danger);">⚠ Los datos actuales de empleados, registros y nóminas serán reemplazados por los del backup. Tu usuario administrador actual no será afectado.</div>
          <div style="margin-bottom:24px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;"><span>🤖 Backups Automáticos en el Servidor</span><button class="btn btn-secondary btn-sm" onclick="cargarListaBackups()">🔄 Actualizar</button></div>
            <div id="lista-backups-loading" style="text-align:center;padding:16px;"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
            <div id="lista-backups-none" style="display:none;text-align:center;padding:16px;color:var(--muted);font-size:12px;background:var(--surface2);border-radius:9px;">🕐 No hay backups automáticos disponibles en el servidor</div>
            <div id="lista-backups-body" style="display:none;display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;"></div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:20px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:10px;">📂 Restaurar desde Archivo</div>
            <p style="color:var(--muted);font-size:12px;margin-bottom:14px;line-height:1.6;">Sube un <strong style="color:var(--text)">.zip</strong> o <strong style="color:var(--text)">.json</strong> generado por el sistema.</p>
            <div id="restore-drop" onclick="document.getElementById('restore-file').click()"
              style="border:2px dashed var(--border);border-radius:12px;padding:24px;text-align:center;cursor:pointer;margin-bottom:12px;transition:border-color 0.2s;"
              onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'"
              ondragover="event.preventDefault();this.style.borderColor='var(--accent)'" ondragleave="this.style.borderColor='var(--border)'"
              ondrop="handleRestoreDrop(event)">
              <div style="font-size:28px;margin-bottom:6px;">📂</div>
              <div style="font-size:13px;color:var(--muted);">Clic o arrastra tu archivo <strong style="color:var(--text)">.zip</strong> / <strong style="color:var(--text)">.json</strong></div>
              <div id="restore-filename" style="margin-top:6px;font-size:12px;color:var(--accent);display:none;"></div>
            </div>
            <input type="file" id="restore-file" accept=".zip,.json" style="display:none"/>
            <button class="btn btn-danger" id="btn-restaurar" onclick="restaurarBackup()" disabled style="width:100%;justify-content:center;padding:11px;opacity:0.5;">♻️ Restaurar desde Archivo</button>
          </div>
          <div id="restore-ok" style="display:none;margin-top:14px;padding:10px 14px;background:rgba(79,190,150,0.1);border:1px solid rgba(79,190,150,0.3);border-radius:9px;font-size:13px;color:var(--success);"></div>
          <div id="restore-err" style="display:none;margin-top:14px;padding:10px 14px;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:9px;font-size:13px;color:var(--danger);"></div>
        </div>
      </div>`;
    initBackupListeners();
    cargarUltimoBackup();
    cargarListaBackups();
  }
  else if (cfgTab === 'seguridad') {
    c.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:20px;">
        <div class="stat-card"><div class="stat-label">IPs Bloqueadas</div><div class="stat-value" id="sec-bloqueadas" style="color:var(--danger);">—</div></div>
        <div class="stat-card"><div class="stat-label">IPs en Seguimiento</div><div class="stat-value" id="sec-seguimiento" style="color:var(--warning);">—</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px;">
        <div class="table-wrap" style="padding:24px 28px;">
          <div style="font-family:var(--font-head);font-weight:700;font-size:15px;margin-bottom:16px;">⚙️ Configuración del Rate Limiter</div>
          <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
            <div style="display:flex;justify-content:space-between;padding:10px 12px;background:var(--surface2);border-radius:8px;"><span style="color:var(--muted);">Intentos máximos</span><strong id="sec-cfg-intentos">—</strong></div>
            <div style="display:flex;justify-content:space-between;padding:10px 12px;background:var(--surface2);border-radius:8px;"><span style="color:var(--muted);">Ventana de tiempo</span><strong id="sec-cfg-ventana">—</strong></div>
            <div style="display:flex;justify-content:space-between;padding:10px 12px;background:var(--surface2);border-radius:8px;"><span style="color:var(--muted);">Duración del bloqueo</span><strong id="sec-cfg-bloqueo">—</strong></div>
          </div>
          <div style="margin-top:16px;padding:12px 14px;background:rgba(79,142,247,0.06);border:1px solid rgba(79,142,247,0.15);border-radius:9px;font-size:12px;color:var(--muted);line-height:1.6;">💡 El bloqueo es automático y se aplica por IP. Se libera automáticamente al vencer el tiempo, o manualmente desde aquí.</div>
        </div>
        <div class="table-wrap" style="padding:24px 28px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;"><div style="font-family:var(--font-head);font-weight:700;font-size:15px;">🔒 IPs Bloqueadas</div><button class="btn btn-secondary btn-sm" onclick="cargarSeguridadStatus()">🔄 Actualizar</button></div>
          <div id="sec-bloqueadas-loading" style="text-align:center;padding:20px;"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
          <div id="sec-bloqueadas-none" style="display:none;text-align:center;padding:20px;color:var(--success);font-size:13px;">✓ No hay IPs bloqueadas actualmente</div>
          <div id="sec-bloqueadas-body" style="display:none;flex-direction:column;gap:8px;"></div>
          <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px;"><div style="font-family:var(--font-head);font-weight:700;font-size:14px;margin-bottom:12px;">👁 IPs en Seguimiento</div><div id="sec-seguimiento-none" style="display:none;text-align:center;padding:12px;color:var(--muted);font-size:12px;">Sin actividad sospechosa</div><div id="sec-seguimiento-body" style="display:flex;flex-direction:column;gap:6px;"></div></div>
        </div>
      </div>`;
    cargarSeguridadStatus();
  }
  else if (cfgTab === 'auditoria') {
    c.innerHTML = `
      <div class="filters">
        <input type="text" id="aud-buscar" placeholder="🔍 Buscar usuario..." oninput="cargarAuditoria()"/>
        <select id="aud-fil-sesion" onchange="cargarAuditoria()"><option value="">Todos los usuarios</option><option value="activa">Sesión activa</option><option value="inactiva">Sin sesión</option></select>
        <select id="aud-fil-tipo" onchange="cargarAuditoria()"><option value="">Todos los tipos</option><option value="exito">Exitoso</option><option value="fallido">Fallido</option></select>
        <input type="date" id="aud-fil-desde" onchange="cargarAuditoria()"/><span style="align-self:center;color:var(--muted);font-size:13px;">→</span>
        <input type="date" id="aud-fil-hasta" onchange="cargarAuditoria()"/>
        <button class="btn btn-secondary btn-sm" onclick="cargarAuditoria()">🔄 Actualizar</button>
        <button class="btn btn-outline btn-sm" onclick="limpiarFiltrosAuditoria()">🧹 Limpiar</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
        <div class="stat-card"><div class="stat-label">Sesiones Activas</div><div class="stat-value" id="aud-sesiones" style="color:var(--accent);">—</div></div>
        <div class="stat-card"><div class="stat-label">Inicios Exitosos Hoy</div><div class="stat-value" id="aud-exitos-hoy" style="color:var(--success);">—</div></div>
        <div class="stat-card"><div class="stat-label">Intentos Fallidos Hoy</div><div class="stat-value" id="aud-fallidos-hoy" style="color:var(--danger);">—</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px;">
        <div class="table-wrap" style="padding:0;"><div class="table-head"><div class="table-title">👥 Usuarios y Estado de Sesión</div></div><div id="aud-sesiones-body" style="padding:20px 24px;overflow-y:auto;max-height:calc(100vh - 320px);min-height:200px;"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div></div>
        <div class="table-wrap" style="padding:0;"><div class="table-head"><div class="table-title">📜 Historial de Inicios de Sesión</div></div><div id="aud-historial-body" style="padding:20px 24px;overflow-y:auto;max-height:calc(100vh - 320px);min-height:200px;"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div></div>
      </div>`;
    cargarAuditoria();
  }
  else if (cfgTab === 'calendario') {
    try {
      const res = await GET('/api/configuracion');
      if (!res.ok) { c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Error cargando configuración</div>'; return; }
      const cfg = await res.json();
      const habilitado = cfg.calendario_habilitado === '1';
      const diasQuincenal = cfg.calendario_dias_quincenal || '2';
      const diasMensual = cfg.calendario_dias_mensual || '5';
      const diasSemanal = cfg.calendario_dias_semanal || '1';
      c.innerHTML = `
        <div style="max-width:600px;">
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:20px;">
            <h4 style="margin-bottom:16px;font-family:var(--font-head);">📅 Calendario de Nómina</h4>
            <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
              Configura cuántos días antes del fin de período se cierra el registro de novedades.
              Los registros realizados después de la fecha límite serán marcados para aprobación en el próximo período.
            </p>
            <div style="margin-bottom:16px;padding:12px;background:var(--surface2);border-radius:8px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;text-transform:none;letter-spacing:normal;font-weight:400;">
                <input type="checkbox" id="cal-habilitado" style="width:auto;flex-shrink:0" ${habilitado ? 'checked' : ''}>
                Habilitar fechas límite de registro
              </label>
            </div>
            <div id="cal-dias-config" style="${habilitado ? '' : 'opacity:0.4;pointer-events:none;'}">
              <h4 style="margin-bottom:12px;font-family:var(--font-head);font-size:14px;">Días antes del cierre por tipo de período</h4>
              <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                <div class="form-group">
                  <label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">📅 Quincenal</label>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input type="number" id="cal-dias-quincenal" value="${diasQuincenal}" min="0" max="30" style="width:80px;">
                    <span style="font-size:12px;color:var(--muted);">días antes del fin</span>
                  </div>
                </div>
                <div class="form-group">
                  <label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">📆 Mensual</label>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input type="number" id="cal-dias-mensual" value="${diasMensual}" min="0" max="30" style="width:80px;">
                    <span style="font-size:12px;color:var(--muted);">días antes del fin</span>
                  </div>
                </div>
                <div class="form-group">
                  <label style="font-size:13px;text-transform:none;letter-spacing:normal;font-weight:400;">🗓️ Semanal</label>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input type="number" id="cal-dias-semanal" value="${diasSemanal}" min="0" max="7" style="width:80px;">
                    <span style="font-size:12px;color:var(--muted);">días antes del fin</span>
                  </div>
                </div>
              </div>
              <div style="margin-top:12px;padding:10px 12px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--muted);">
                💡 Estos valores se aplican al generar períodos nuevos. Los períodos existentes mantienen sus fechas límite.
              </div>
            </div>
            <div class="flex" style="margin-top:16px;">
              <button class="btn btn-primary" onclick="guardarCalendario()">✓ Guardar</button>
            </div>
            <div id="cal-msg" style="margin-top:10px;"></div>
          </div>
        </div>`;
      document.getElementById('cal-habilitado').addEventListener('change', function() {
        const el = document.getElementById('cal-dias-config');
        if (el) { el.style.opacity = this.checked ? '' : '0.4'; el.style.pointerEvents = this.checked ? '' : 'none'; }
      });
    } catch(e) { c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)">Error: ${esc(e.message)}</div>`; }
  }
  else if (cfgTab === 'telemetria') {
    c.innerHTML = '<div id="diag-content" style="padding:4px 0;"><div style="text-align:center;padding:40px;color:var(--muted);">Cargando telemetría...</div></div>';
    cargarDiagnostico();
  }
}

// ── SMTP ──

function toggleHeredarSmtp() {
  const checked = document.getElementById('cfg-heredar').checked;
  document.getElementById('cfg-launcher-url-wrap').style.display = checked ? '' : 'none';
  const local = document.getElementById('cfg-smtp-local');
  if (local) { local.style.opacity = checked ? '0.5' : ''; local.style.pointerEvents = checked ? 'none' : ''; }
}

async function guardarSmtp() {
  setLoading('btn-guardar-smtp', true);
  try {
    const body = { smtp_heredar: document.getElementById('cfg-heredar').checked ? '1' : '0', launcher_url: document.getElementById('cfg-launcher-url').value.trim() };
    if (body.smtp_heredar !== '1') {
      body.smtp_host = document.getElementById('cfg-host').value.trim();
      body.smtp_puerto = document.getElementById('cfg-puerto').value.trim();
      body.smtp_tls = document.getElementById('cfg-tls').value;
      body.smtp_usuario = document.getElementById('cfg-usuario').value.trim();
      body.smtp_password = document.getElementById('cfg-password').value;
      body.smtp_remitente = document.getElementById('cfg-remitente').value.trim();
      body.reset_asunto = document.getElementById('cfg-asunto').value.trim();
      body.reset_cuerpo = document.getElementById('cfg-cuerpo').value;
    }
    const res = await PUT('/api/configuracion', body);
    if (res.ok) {
      showToast('✓ Configuración guardada.');
      document.getElementById('cfg-password').value = '';
    } else {
      const data = await res.json();
      showToast(data.error || 'Error al guardar', 'error');
    }
  } catch(e) { showToast(e.message, 'error'); }
  setLoading('btn-guardar-smtp', false);
}

async function testSmtp() {
  setLoading('btn-test-smtp', true);
  try {
    const heredar = document.getElementById('cfg-heredar').checked;
    const body = { smtp_heredar: heredar ? '1' : '0', launcher_url: document.getElementById('cfg-launcher-url').value.trim() };
    const res = await POST('/api/configuracion/test', body);
    const data = await res.json();
    if (res.ok) {
      showToast('✓ Correo de prueba enviado a tu cuenta.');
    } else {
      showToast(data.error || 'Error al enviar correo de prueba', 'error');
    }
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
  setLoading('btn-test-smtp', false);
}

// ── CALENDARIO ──

async function guardarCalendario() {
  const msg = document.getElementById('cal-msg');
  try {
    const body = {
      calendario_habilitado: document.getElementById('cal-habilitado').checked ? '1' : '0',
      calendario_dias_quincenal: document.getElementById('cal-dias-quincenal').value,
      calendario_dias_mensual: document.getElementById('cal-dias-mensual').value,
      calendario_dias_semanal: document.getElementById('cal-dias-semanal').value
    };
    const res = await PUT('/api/configuracion', body);
    if (res.ok) {
      msg.innerHTML = '<span style="color:var(--success)">✓ Configuración guardada</span>';
      showToast('Calendario actualizado', 'success');
    } else {
      msg.innerHTML = '<span style="color:var(--danger)">✗ Error al guardar</span>';
    }
  } catch(e) { msg.innerHTML = '<span style="color:var(--danger)">✗ ' + e.message + '</span>'; }
}

// ── BACKUP ──

let _cfgRestoreFile = null;
let _cfgBackupListenerInit = false;

async function cargarUltimoBackup() {
  const card = document.getElementById('ultimo-backup-card');
  const none = document.getElementById('ultimo-backup-none');
  try {
    const res = await GET('/api/backup/ultimo');
    if (!res.ok) { if (card) card.style.display = 'none'; if (none) none.style.display = 'block'; return; }
    const info = await res.json();
    if (!info) { if (card) card.style.display = 'none'; if (none) none.style.display = 'block'; return; }
    const fecha = new Date(info.fecha);
    const fechaStr = fecha.toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const diffMs = Date.now() - fecha.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffH / 24);
    const hace = diffD > 0 ? 'hace ' + diffD + ' día' + (diffD > 1 ? 's' : '') : diffH > 0 ? 'hace ' + diffH + 'h' : 'hace menos de 1h';
    const byId = id => document.getElementById(id);
    if (byId('ultimo-bk-fecha')) byId('ultimo-bk-fecha').textContent = fechaStr;
    if (byId('ultimo-bk-hace')) byId('ultimo-bk-hace').textContent = hace;
    if (byId('ultimo-bk-archivo')) byId('ultimo-bk-archivo').textContent = info.archivo || '—';
    if (byId('ultimo-bk-size')) byId('ultimo-bk-size').textContent = info.tamaño || '—';
    const redEl = byId('ultimo-bk-red');
    if (redEl) { redEl.textContent = info.red === true ? '✓ Copiado' : '✗ Solo local'; redEl.style.color = info.red === true ? 'var(--success)' : 'var(--danger)'; }
    if (card) card.style.display = 'block';
    if (none) none.style.display = 'none';
  } catch (e) {
    if (card) card.style.display = 'none';
    if (none) none.style.display = 'block';
  }
}

async function cargarListaBackups() {
  const loading = document.getElementById('lista-backups-loading');
  const none = document.getElementById('lista-backups-none');
  const body = document.getElementById('lista-backups-body');
  if (!loading || !none || !body) return;
  loading.style.display = 'block'; none.style.display = 'none'; body.style.display = 'none';
  try {
    const res = await GET('/api/backup/lista');
    loading.style.display = 'none';
    if (!res.ok) { none.style.display = 'block'; return; }
    const lista = await res.json();
    if (!lista || !lista.length) { none.style.display = 'block'; return; }
    body.style.display = 'flex';
    body.innerHTML = lista.map(b => {
      const fecha = new Date(b.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
      const tamaño = b.tamaño > 1024 * 1024 ? (b.tamaño / 1024 / 1024).toFixed(1) + ' MB' : (b.tamaño / 1024).toFixed(0) + ' KB';
      return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
        + '<div style="min-width:0;"><div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + esc(b.nombre) + '">📦 ' + esc(b.nombre) + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">📅 ' + esc(fecha) + ' &nbsp;·&nbsp; ' + esc(tamaño) + '</div></div>'
        + '<div style="display:flex;gap:6px;flex-shrink:0;">'
        + '<button class="btn btn-secondary btn-sm bk-btn-download" data-nombre="' + esc(b.nombre) + '" title="Descargar">⬇️</button>'
        + '<button class="btn btn-sm bk-btn-restore" data-nombre="' + esc(b.nombre) + '" title="Restaurar este backup" style="background:rgba(247,97,79,0.1);color:var(--danger);border:1px solid rgba(247,97,79,0.3);">♻️ Restaurar</button>'
        + '</div></div>';
    }).join('');
    body.querySelectorAll('.bk-btn-download').forEach(btn => btn.addEventListener('click', () => descargarBackupAutomatico(btn.dataset.nombre)));
    body.querySelectorAll('.bk-btn-restore').forEach(btn => btn.addEventListener('click', () => restaurarBackupLocal(btn.dataset.nombre)));
  } catch (e) {
    loading.style.display = 'none'; none.style.display = 'block';
    if (none) none.textContent = 'Error cargando backups: ' + e.message;
  }
}

function descargarBackupAutomatico(nombre) {
  const a = document.createElement('a');
  a.href = API + '/api/backup/descargar/' + encodeURIComponent(nombre);
  a.setAttribute('download', nombre);
  fetch(API + '/api/backup/descargar/' + encodeURIComponent(nombre)).then(r => {
    if (!r.ok) { showToast('Error al descargar el backup', 'error'); return; }
    return r.blob();
  }).then(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }).catch(e => showToast('Error: ' + e.message, 'error'));
}

async function restaurarBackupLocal(nombre) {
  confirmar({
    titulo: 'Restaurar Backup',
    mensaje: '¿Restaurar el backup "' + nombre + '"? Los datos actuales serán reemplazados. Tu sesión de administrador no se verá afectada.',
    icono: '🔄',
    btnTxt: 'Restaurar',
    onConfirm: async () => {
      const ok = document.getElementById('restore-ok');
      const err = document.getElementById('restore-err');
      if (ok) ok.style.display = 'none';
      if (err) err.style.display = 'none';
      showToast('Restaurando...', 'info');
      try {
        const res = await POST('/api/backup/restore/local/' + encodeURIComponent(nombre), {});
        const data = await res.json();
        if (!res.ok) {
          if (err) { err.textContent = '✗ ' + (data.error || 'Error al restaurar'); err.style.display = 'block'; }
          showToast('Error en la restauración', 'error');
        } else {
          if (ok) { ok.textContent = '✓ ' + (data.mensaje || 'Restauración completada correctamente'); ok.style.display = 'block'; }
          showToast('Restauración completada', 'success');
          if (typeof enviarTelemetria === 'function') enviarTelemetria('backup_restaurado', { nombre });
        }
      } catch (e) {
        if (err) { err.textContent = '✗ ' + e.message; err.style.display = 'block'; }
        showToast('Error en la restauración', 'error');
      }
    }
  });
}

async function descargarBackup() {
  document.getElementById('btn-descargar-backup').textContent = 'Generando...';
  const backupOk = document.getElementById('backup-ok');
  if (backupOk) backupOk.style.display = 'none';
  try {
    const res = await fetch(API + '/api/backup');
    if (!res.ok) { const j = await res.json(); showToast(j.error || 'Error al generar backup', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'horasextra_backup_' + new Date().toISOString().slice(0, 10) + '.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    if (backupOk) { backupOk.style.display = 'block'; setTimeout(() => backupOk.style.display = 'none', 5000); }
    if (typeof enviarTelemetria === 'function') enviarTelemetria('backup_generado', {});
  } catch (e) { showToast('Error al descargar: ' + e.message, 'error'); }
  document.getElementById('btn-descargar-backup').innerHTML = '💾 Descargar Backup ZIP';
}

async function ejecutarBackupScript() {
  const btn = document.getElementById('btn-ejecutar-backup-script');
  const log = document.getElementById('bk-script-log');
  if (!btn || !log) return;
  btn.disabled = true; btn.textContent = 'Ejecutando...';
  log.style.display = 'block'; log.textContent = 'Ejecutando script de backup...\n';
  try {
    const res = await POST('/api/backup/ejecutar', {});
    const data = await res.json();
    log.textContent += (data.salida || []).join('\n');
    if (data.ok) { log.textContent += '\n\n✅ Backup completado exitosamente'; log.style.borderColor = 'var(--success)'; cargarUltimoBackup(); cargarListaBackups(); }
    else { log.textContent += '\n\n❌ Error: ' + (data.error || 'Falló la ejecución'); log.style.borderColor = 'var(--danger)'; }
  } catch (e) { log.textContent += '\n❌ Error de conexión: ' + e.message; log.style.borderColor = 'var(--danger)'; }
  btn.disabled = false; btn.innerHTML = '▶ Ejecutar Backup Automático'; log.scrollTop = log.scrollHeight;
}

function initBackupListeners() {
  const inp = document.getElementById('restore-file');
  if (!inp) return;
  inp.addEventListener('change', function() {
    if (!this.files || !this.files[0]) return;
    _cfgRestoreFile = this.files[0];
    const fnEl = document.getElementById('restore-filename');
    if (fnEl) { fnEl.textContent = '📄 ' + _cfgRestoreFile.name; fnEl.style.display = 'block'; }
    const btnRestore = document.getElementById('btn-restaurar');
    if (btnRestore) { btnRestore.disabled = false; btnRestore.style.opacity = '1'; }
    ['restore-ok','restore-err'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  });
}

function handleRestoreDrop(e) {
  e.preventDefault();
  const drop = document.getElementById('restore-drop');
  if (drop) drop.style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const inp = document.getElementById('restore-file');
  if (inp) { const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }
}

async function restaurarBackup() {
  if (!_cfgRestoreFile) return;
  confirmar({
    titulo: 'Restaurar Backup',
    mensaje: '¿Estás seguro? Los datos actuales serán reemplazados por los del archivo "' + _cfgRestoreFile.name + '". Esta acción no se puede deshacer.',
    icono: '♻️',
    btnTxt: 'Restaurar',
    onConfirm: async () => {
      const okEl = document.getElementById('restore-ok');
      const errEl = document.getElementById('restore-err');
      if (okEl) okEl.style.display = 'none'; if (errEl) errEl.style.display = 'none';
      try {
        const form = new FormData();
        form.append('backup', _cfgRestoreFile);
        const res = await fetchCSRF(API + '/api/restore', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) { if (errEl) { errEl.textContent = '✗ ' + (json.error || 'Error al restaurar'); errEl.style.display = 'block'; } }
        else {
          if (okEl) { okEl.textContent = '✓ ' + json.mensaje; okEl.style.display = 'block'; }
          if (typeof enviarTelemetria === 'function') enviarTelemetria('backup_restaurado', { archivo: _cfgRestoreFile.name });
          _cfgRestoreFile = null;
          ['restore-file','restore-filename','btn-restaurar'].forEach(id => {
            const el = document.getElementById(id);
            if (id === 'restore-file' && el) el.value = '';
            if (id === 'restore-filename' && el) el.style.display = 'none';
            if (id === 'btn-restaurar' && el) { el.disabled = true; el.style.opacity = '0.5'; }
          });
        }
      } catch (e) { if (errEl) errEl.textContent = '✗ ' + e.message; if (errEl) errEl.style.display = 'block'; }
    }
  });
}

// ── SEGURIDAD ──

async function cargarSeguridadStatus() {
  const loadingEl = document.getElementById('sec-bloqueadas-loading');
  const noneEl = document.getElementById('sec-bloqueadas-none');
  const bodyEl = document.getElementById('sec-bloqueadas-body');
  const seguNoneEl = document.getElementById('sec-seguimiento-none');
  const seguBodyEl = document.getElementById('sec-seguimiento-body');
  if (loadingEl) loadingEl.style.display = 'block';
  if (noneEl) noneEl.style.display = 'none';
  if (bodyEl) bodyEl.style.display = 'none';
  try {
    const res = await GET('/api/auth/ratelimit-status');
    if (!res.ok) return;
    const data = await res.json();
    const byId = id => document.getElementById(id);
    if (byId('sec-bloqueadas')) byId('sec-bloqueadas').textContent = data.totalBloqueadas;
    if (byId('sec-seguimiento')) byId('sec-seguimiento').textContent = data.totalIpsEnSeguimiento;
    if (byId('sec-cfg-intentos')) byId('sec-cfg-intentos').textContent = data.configuracion.maxIntentos + ' intentos';
    if (byId('sec-cfg-ventana')) byId('sec-cfg-ventana').textContent = data.configuracion.ventanaMinutos + ' minutos';
    if (byId('sec-cfg-bloqueo')) byId('sec-cfg-bloqueo').textContent = data.configuracion.bloqueoMinutos + ' minutos';
    if (loadingEl) loadingEl.style.display = 'none';
    if (!data.bloqueadas.length) { if (noneEl) noneEl.style.display = 'block'; }
    else if (bodyEl) {
      bodyEl.style.display = 'flex';
      bodyEl.innerHTML = data.bloqueadas.map(b =>
        '<div style="background:rgba(247,97,79,0.08);border:1px solid rgba(247,97,79,0.2);border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
        + '<div><div style="font-size:13px;font-weight:600;color:var(--text);font-family:monospace;">🔒 ' + esc(b.ip) + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:3px;">' + esc(b.intentos) + ' intentos · Libera: ' + esc(b.bloqueadaHasta) + ' (' + esc(b.minutosRestantes) + ' min)</div></div>'
        + '<button class="btn btn-sm btn-desbloquear-ip" data-ip="' + esc(b.ip) + '" style="background:rgba(79,190,150,0.1);color:var(--success);border:1px solid rgba(79,190,150,0.3);white-space:nowrap;">🔓 Desbloquear</button></div>'
      ).join('');
      bodyEl.querySelectorAll('.btn-desbloquear-ip').forEach(btn => btn.addEventListener('click', () => desbloquearIP(btn.dataset.ip)));
    }
    if (!data.enSeguimiento.length) { if (seguNoneEl) seguNoneEl.style.display = 'block'; if (seguBodyEl) seguBodyEl.innerHTML = ''; }
    else if (seguBodyEl) {
      if (seguNoneEl) seguNoneEl.style.display = 'none';
      seguBodyEl.innerHTML = data.enSeguimiento.map(s => {
        const pct = Math.round((s.intentos / data.configuracion.maxIntentos) * 100);
        const color = pct >= 70 ? 'var(--danger)' : pct >= 40 ? 'var(--warning)' : 'var(--muted)';
        return '<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;"><div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;font-family:monospace;color:var(--text);">' + esc(s.ip) + '</span><span style="font-size:11px;color:' + color + ';">' + esc(s.intentos) + '/' + esc(data.configuracion.maxIntentos) + ' intentos</span></div><div style="background:var(--border);border-radius:4px;height:4px;overflow:hidden;"><div style="height:100%;background:' + color + ';width:' + pct + '%;border-radius:4px;transition:width 0.3s;"></div></div></div>';
      }).join('');
    }
  } catch(e) {
    if (loadingEl) loadingEl.style.display = 'none';
    showToast('Error cargando estado de seguridad: ' + e.message, 'error');
  }
}

async function desbloquearIP(ip) {
  confirmar({
    titulo: 'Desbloquear IP',
    mensaje: '¿Desbloquear la IP ' + ip + '?',
    icono: '🔓',
    btnTxt: 'Desbloquear',
    onConfirm: async () => {
      await DEL('/api/auth/ratelimit-status/' + encodeURIComponent(ip));
      showToast('IP desbloqueada: ' + ip, 'success');
      cargarSeguridadStatus();
    }
  });
}

// ── AUDITORÍA ──

function limpiarFiltrosAuditoria() {
  ['aud-buscar','aud-fil-sesion','aud-fil-tipo','aud-fil-desde','aud-fil-hasta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  cargarAuditoria();
}

async function cargarAuditoria() {
  const sesBody = document.getElementById('aud-sesiones-body');
  const histBody = document.getElementById('aud-historial-body');
  if (sesBody) sesBody.innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>';
  if (histBody) histBody.innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>';

  const buscar = (document.getElementById('aud-buscar')?.value || '').toLowerCase();
  const filSesion = document.getElementById('aud-fil-sesion')?.value || '';
  const tipo = document.getElementById('aud-fil-tipo')?.value || '';
  const desde = document.getElementById('aud-fil-desde')?.value || '';
  const hasta = document.getElementById('aud-fil-hasta')?.value || '';

  const params = new URLSearchParams();
  if (tipo) params.set('tipo', tipo);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const qs = params.toString();

  try {
    const res = await GET('/api/admin/auditoria' + (qs ? '?' + qs : ''));
    if (!res.ok) return;
    const data = await res.json();
    const byId = id => document.getElementById(id);
    if (byId('aud-sesiones')) byId('aud-sesiones').textContent = data.stats.totalSesiones;
    if (byId('aud-exitos-hoy')) byId('aud-exitos-hoy').textContent = data.stats.totalExitosHoy;
    if (byId('aud-fallidos-hoy')) byId('aud-fallidos-hoy').textContent = data.stats.totalFallidosHoy;

    if (sesBody) {
      let usuarios = data.sesiones;
      if (buscar) usuarios = usuarios.filter(u => (u.nombre||'').toLowerCase().includes(buscar) || (u.email||'').toLowerCase().includes(buscar));
      if (filSesion === 'activa') usuarios = usuarios.filter(u => u.enSesion);
      if (filSesion === 'inactiva') usuarios = usuarios.filter(u => !u.enSesion);
      if (!usuarios.length) {
        sesBody.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">' + (buscar ? 'Sin resultados' : 'No hay usuarios registrados') + '</div>';
      } else {
        sesBody.innerHTML = usuarios.map(s => {
          const activa = s.enSesion;
          const creado = s.creado ? new Date(s.creado).toLocaleString('es-CO') : '—';
          const expira = s.expira ? new Date(s.expira).toLocaleString('es-CO') : '—';
          return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;opacity:' + (s.activo ? '1' : '0.5') + ';">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
            + '<span style="font-weight:600;font-size:14px;">' + esc(s.nombre||'—') + '</span>'
            + '<span style="display:flex;align-items:center;gap:8px;">'
            + (activa ? '<button class="btn btn-sm btn-danger" onclick="cerrarSesionAdmin(\'' + esc(s.token) + '\',\'' + esc(s.nombre) + '\')" title="Cerrar sesión" style="font-size:11px;padding:2px 8px;">🔒 Cerrar</button>' : '')
            + '<span style="font-size:11px;background:' + (activa ? 'rgba(79,190,150,0.15)' : 'var(--border)') + ';color:' + (activa ? 'var(--success)' : 'var(--muted)') + ';padding:2px 8px;border-radius:6px;font-weight:600;">' + (activa ? 'Sesión activa' : 'Sin sesión') + '</span>'
            + '</span></div>'
            + '<div style="font-size:12px;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap;">'
            + '<span>' + esc(s.email||'') + '</span>'
            + '<span style="background:var(--surface);padding:0 6px;border-radius:4px;font-size:11px;">' + esc(s.rol||'') + '</span>'
            + (!s.activo ? '<span style="color:var(--danger);font-size:11px;">🚫 Usuario inactivo</span>' : '') + '</div>'
            + '<div style="font-size:11px;color:var(--muted);margin-top:4px;">🕐 Ultimo login: ' + esc(s.ultimoLogin ? new Date(s.ultimoLogin).toLocaleString('es-CO') : '— Nunca') + '</div>'
            + (activa ? '<div style="font-size:12px;color:var(--muted);margin-top:4px;display:flex;gap:16px;flex-wrap:wrap;"><span>🌐 ' + esc(s.ip||'—') + '</span><span title="' + esc(s.ua||'') + '">🖥️ ' + esc((s.ua||'').slice(0, 50) + ((s.ua||'').length > 50 ? '…' : '') || '—') + '</span><span>📅 ' + esc(creado) + '</span><span>⏳ Exp: ' + esc(expira) + '</span></div>' : '')
            + '</div>';
        }).join('');
      }
    }

    if (histBody) {
      if (!data.historial.length) {
        histBody.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Sin registros</div>';
      } else {
        histBody.innerHTML = data.historial.map(h => {
          const ts = new Date(h.timestamp).toLocaleString('es-CO');
          const icon = h.tipo === 'exito' ? '✅' : '❌';
          const color = h.tipo === 'exito' ? 'var(--success)' : 'var(--danger)';
          return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:6px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:13px;font-weight:500;">' + icon + ' ' + esc(h.email||'—') + '</span>'
            + '<span style="font-size:11px;color:' + color + ';font-weight:600;">' + (h.tipo==='exito'?'Exitoso':'Fallido') + '</span></div>'
            + '<div style="font-size:12px;color:var(--muted);margin-top:3px;display:flex;gap:12px;"><span>🌐 ' + esc(h.ip||'—') + '</span><span>📅 ' + esc(ts) + '</span></div></div>';
        }).join('');
      }
    }
  } catch(e) {
    if (sesBody) sesBody.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger);font-size:13px;">Error: ' + esc(e.message) + '</div>';
    if (histBody) histBody.innerHTML = '';
    showToast('Error cargando auditoría: ' + e.message, 'error');
  }
}

async function cerrarSesionAdmin(token, nombre) {
  confirmar({
    titulo: 'Cerrar Sesión', mensaje: '¿Cerrar la sesión de ' + nombre + '?', icono: '🔒', btnTxt: 'Cerrar',
    onConfirm: async () => {
      const res = await DEL('/api/admin/sesiones/' + encodeURIComponent(token));
      if (!res.ok) { showToast('Error al cerrar sesión', 'error'); return; }
      showToast('Sesión de ' + nombre + ' cerrada', 'success');
      cargarAuditoria();
    }
  });
}

// ── PERMISOS ──

let _cfgPermisosData = {};
let _cfgPermRolSeleccionado = '';

const _cfgPERMISOS_DISPONIBLES = {
  'Páginas': ['centros','usuarios','empleados','nominas','registros','configuracion','backup','reportes','siesa','tipos'],
  'Acciones': ['aprobar','editar','revertir','eliminar_registros','eliminar_empleados','eliminar_centros','eliminar_nominas'],
  'Visibilidad': ['ver_todos','ver_sede','ver_propios']
};

const _cfgLABEL_MAP = {
  centros: 'Centros de Operación', usuarios: 'Usuarios', empleados: 'Empleados', nominas: 'Nóminas',
  registros: 'Registros', configuracion: 'Configuración', backup: 'Backup', reportes: 'Reportes',
  siesa: 'Exportar Siesa', tipos: 'Conceptos de Nómina',
  aprobar: 'Aprobar / Rechazar registros', editar: 'Editar registros pendientes',
  revertir: 'Revertir a pendiente', eliminar_registros: 'Eliminar registros',
  eliminar_empleados: 'Eliminar empleados', eliminar_centros: 'Eliminar centros',
  eliminar_nominas: 'Eliminar períodos de nómina',
  ver_todos: 'Ver todos los registros (sin filtro)', ver_sede: 'Ver solo registros de mi sede',
  ver_propios: 'Ver solo mis propios registros'
};

async function cargarPermisos() {
  try {
    const res = await fetchCSRF('/api/permisos');
    if (!res.ok) { showToast('Error al cargar permisos', 'error'); return; }
    _cfgPermisosData = await res.json();
    renderTabsPermisos();
    if (_cfgPermRolSeleccionado && _cfgPermisosData[_cfgPermRolSeleccionado]) renderPermisosRol(_cfgPermRolSeleccionado);
  } catch (e) { showToast('Error al cargar permisos: ' + e.message, 'error'); }
}

function renderTabsPermisos() {
  const tabContainer = document.getElementById('perm-rol-tabs');
  if (!tabContainer) return;
  const roles = Object.keys(_cfgPermisosData).sort();
  tabContainer.innerHTML = roles.map(r => {
    const active = _cfgPermRolSeleccionado === r;
    const esSistema = ['admin','rrhh','gerencia','operador','consulta'].includes(r);
    return '<span class="badge badge-' + r + '" onclick="seleccionarRolPermisos(\'' + r + '\')" style="cursor:pointer;padding:8px 14px;font-size:13px;border-radius:20px;transition:all 0.15s;display:inline-flex;align-items:center;gap:6px;' + (active ? 'outline:2px solid var(--text);outline-offset:2px;' : 'opacity:0.55;') + '">'
      + rolLabel(r)
      + (!esSistema ? '<span class="badge-delete" onclick="event.stopPropagation();eliminarRol(\'' + r + '\')" title="Eliminar rol">×</span>' : '')
      + '</span>';
  }).join('');
}

function abrirModalNuevoRol() {
  const el = document.getElementById('rol-nombre');
  if (el) el.value = '';
  const modal = document.getElementById('modal-rol');
  if (modal) { modal.classList.add('open'); modal.style.display = 'flex'; }
}

async function guardarNuevoRol() {
  const nombre = document.getElementById('rol-nombre').value.trim();
  if (!nombre) { showToast('Ingresa un nombre para el rol', 'error'); return; }
  setLoading('btn-guardar-rol', true);
  try {
    const res = await fetchCSRF('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }) });
    if (!res.ok) { const d = await res.json().catch(()=>({})); showToast(d.error || 'Error al crear rol', 'error'); return; }
    const data = await res.json();
    _cfgPermisosData[data.nombre] = [];
    cerrarModal('modal-rol');
    seleccionarRolPermisos(data.nombre);
    showToast('Rol "' + rolLabel(data.nombre) + '" creado. Asígnale permisos.', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  setLoading('btn-guardar-rol', false);
}

async function eliminarRol(rol) {
  confirmar({
    titulo: 'Eliminar Rol', mensaje: '¿Eliminar el rol "' + rolLabel(rol) + '"? Los usuarios con este rol quedarán sin acceso hasta que se les asigne otro.',
    icono: '⚠️',
    onConfirm: async () => {
      try {
        await DEL('/api/roles/' + rol);
        delete _cfgPermisosData[rol];
        if (_cfgPermRolSeleccionado === rol) _cfgPermRolSeleccionado = '';
        renderTabsPermisos();
        const permLista = document.getElementById('perm-lista');
        if (permLista) permLista.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);">Selecciona un rol para ver y editar sus permisos.</div>';
        const permFooter = document.getElementById('perm-footer');
        if (permFooter) permFooter.style.display = 'none';
        showToast('Rol eliminado.');
      } catch (e) { showToast(e.message, 'error'); await cargarPermisos(); }
    }
  });
}

function seleccionarRolPermisos(rol) {
  _cfgPermRolSeleccionado = rol;
  renderTabsPermisos();
  renderPermisosRol(rol);
}

function renderPermisosRol(rol) {
  const container = document.getElementById('perm-lista');
  const footer = document.getElementById('perm-footer');
  if (!container) return;
  const actuales = _cfgPermisosData[rol] || [];
  let html = '';
  for (const [cat, perms] of Object.entries(_cfgPERMISOS_DISPONIBLES)) {
    html += '<div style="margin-bottom:20px;"><div style="font-weight:700;font-size:14px;color:var(--head);margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.5px;">' + cat + '</div><div style="display:flex;flex-direction:column;gap:6px;">';
    perms.forEach(p => {
      const checked = actuales.includes(p) ? 'checked' : '';
      html += '<label style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--surface2);border-radius:8px;cursor:pointer;font-size:13px;user-select:none;border:1px solid var(--border);transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
        + '<input type="checkbox" data-perm-key="' + p + '" ' + checked + ' style="accent-color:var(--accent);width:18px;height:18px;cursor:pointer;">'
        + '<span>' + (_cfgLABEL_MAP[p] || p) + '</span></label>';
    });
    html += '</div></div>';
  }
  container.innerHTML = html;
  if (footer) footer.style.display = '';
}

async function guardarPermisos() {
  if (!_cfgPermRolSeleccionado) return;
  const checks = document.querySelectorAll('#perm-lista input[data-perm-key]:checked');
  const permisos = Array.from(checks).map(c => c.dataset.permKey);
  try {
    const res = await fetchCSRF('/api/permisos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol: _cfgPermRolSeleccionado, permisos }) });
    if (!res.ok) { const d = await res.json().catch(()=>({})); showToast(d.error || 'Error al guardar', 'error'); return; }
    _cfgPermisosData[_cfgPermRolSeleccionado] = permisos;
    showToast('Permisos de "' + rolLabel(_cfgPermRolSeleccionado) + '" actualizados. Los cambios aplican al próximo inicio de sesión.', 'success');
  } catch (e) { showToast('Error al guardar permisos: ' + e.message, 'error'); }
}

