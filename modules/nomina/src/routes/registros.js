const express = require('express');

module.exports = function createRegistrosRouter({
  db, uid, BASE_URL, APP_NAME,
  getConfig, enviarCorreo, rolTienePermiso, tienePermiso,
  middlewares
}) {
  const router = express.Router();
  const { todosRoles, adminRrhh, adminRrhhOp, podeEditar, podeAprobar, autenticar, requierePermiso } = middlewares;

  async function crearNotificacion(usuarioId, tipo, titulo, mensaje, url) {
    try {
      await fetch('http://127.0.0.1:3002/api/notificaciones/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: usuarioId, modulo: 'nomina', tipo, titulo, mensaje, url: url || '/nomina/' })
      });
    } catch {}
  }

  function permEfectivo(usuario) {
    if (tienePermiso(usuario, 'ver_todos')) return 'todos';
    if (tienePermiso(usuario, 'ver_sede')) return 'sede';
    if (tienePermiso(usuario, 'ver_propios')) return 'propios';
    return 'propios';
  }

  // ── GET / ──
  router.get('/', todosRoles, (req, res) => {
    const u = req.usuario;
    const base = `
      SELECT r.*, COALESCE(u.nombre, '') AS nombreCreador, COALESCE(ua.nombre, '') AS aprobadorNombre
      FROM registros r
      LEFT JOIN usuarios u ON r.creadoPor = u.id
      LEFT JOIN usuarios ua ON r.aprobadoPor = ua.id
    `;
    const efectivo = permEfectivo(u);
    if (efectivo === 'todos') {
      if (req.query.sede) {
        return res.json(db.prepare(base + ` JOIN empleados e ON r.empleadoId = e.id WHERE e.sede = ? ORDER BY r.fecha DESC`).all(req.query.sede));
      }
      return res.json(db.prepare(base + ' ORDER BY r.fecha DESC').all());
    }
    if (efectivo === 'sede') {
      return res.json(db.prepare(base + ' JOIN empleados e ON r.empleadoId = e.id WHERE e.sede = ? ORDER BY r.fecha DESC').all(u.sede));
    }
    res.json(db.prepare(base + ' WHERE r.creadoPor = ? ORDER BY r.fecha DESC').all(u.id));
  });

  // ── GET /search ──
  router.get('/search', todosRoles, (req, res) => {
    try {
      const u = req.usuario;
      const { buscar, tipo, sede, empleadoId, nominaId, estado, sort, order, page, limit } = req.query;
      const conditions = []; const params = [];

      const efectivo = permEfectivo(u);
      if (efectivo === 'sede') { conditions.push("e.sede = ?"); params.push(u.sede); }
      else if (efectivo === 'propios') { conditions.push("r.creadoPor = ?"); params.push(u.id); }

      if (buscar) { conditions.push("e.nombre LIKE ?"); params.push('%' + buscar + '%'); }
      if (tipo) { conditions.push("r.tipo = ?"); params.push(tipo); }
      if (sede) { conditions.push("r.sede = ?"); params.push(sede); }
      if (empleadoId) { conditions.push("r.empleadoId = ?"); params.push(empleadoId); }
      if (nominaId) { conditions.push("r.nominaId = ?"); params.push(nominaId); }
      if (estado) { conditions.push("r.estado = ?"); params.push(estado); }

      const wc = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const sortMap = { fecha: 'r.fecha', creado: 'r.creado', horas: 'r.horas', nombre: 'e.nombre' };
      const sortCol = sortMap[sort] || 'r.fecha';
      const sortDir = order === 'asc' ? 'ASC' : 'DESC';
      const { total } = db.prepare('SELECT COUNT(*) as total FROM registros r JOIN empleados e ON r.empleadoId = e.id' + wc).get(...params);
      const pageNum = Math.max(0, parseInt(page) || 0);
      const limitNum = Math.min(Math.max(1, parseInt(limit) || 100), 500);
      const offset = pageNum * limitNum;

      const rows = db.prepare(`
        SELECT r.*, COALESCE(u.nombre, '') AS nombreCreador, COALESCE(ua.nombre, '') AS aprobadorNombre, e.nombre AS empleadoNombre
        FROM registros r JOIN empleados e ON r.empleadoId = e.id
        LEFT JOIN usuarios u ON r.creadoPor = u.id LEFT JOIN usuarios ua ON r.aprobadoPor = ua.id
        ${wc} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);
      res.json({ rows, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    } catch (e) {
      console.error('Error en /api/registros/search:', e);
      res.status(500).json({ error: 'Error al buscar registros' });
    }
  });

  // ── GET /reportes ──
  router.get('/reportes', todosRoles, (req, res) => {
    try {
      const u = req.usuario;
      const { empleadoId, nominaId, sede, tipo, estado, vinculo, fechaDesde, fechaHasta, sort, order, page, limit } = req.query;
      const conditions = []; const params = [];

      const efectivo = permEfectivo(u);
      if (efectivo === 'sede') { conditions.push("e.sede = ?"); params.push(u.sede); }
      else if (efectivo === 'propios') { conditions.push("r.creadoPor = ?"); params.push(u.id); }

      if (empleadoId) { conditions.push("r.empleadoId = ?"); params.push(empleadoId); }
      if (nominaId) { conditions.push("r.nominaId = ?"); params.push(nominaId); }
      if (sede) { conditions.push("e.sede = ?"); params.push(sede); }
      if (tipo) { conditions.push("r.tipo = ?"); params.push(tipo); }
      if (estado) { conditions.push("r.estado = ?"); params.push(estado); }
      if (vinculo) { conditions.push("e.tipo_vinculacion = ?"); params.push(vinculo); }
      if (fechaDesde) { conditions.push("r.fecha >= ?"); params.push(fechaDesde); }
      if (fechaHasta) { conditions.push("r.fecha <= ?"); params.push(fechaHasta); }

      const wc = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const fc = 'FROM registros r JOIN empleados e ON r.empleadoId = e.id';

      const summary = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN r.estado != 'rechazado' THEN r.horas ELSE 0 END), 0) AS totalHoras,
        COALESCE(SUM(CASE WHEN r.estado != 'rechazado' AND t.es_valor = 1 THEN r.transporte ELSE 0 END), 0) AS totalTransporte,
        COALESCE(SUM(CASE WHEN r.estado = 'aprobado' THEN 1 ELSE 0 END), 0) AS aprobados,
        COALESCE(SUM(CASE WHEN r.estado = 'rechazado' THEN 1 ELSE 0 END), 0) AS rechazados,
        COALESCE(SUM(CASE WHEN r.estado = 'pendiente' THEN 1 ELSE 0 END), 0) AS pendientes
        ${fc} LEFT JOIN tipos t ON r.tipo = t.id ${wc}`).get(...params);

      const { total } = db.prepare('SELECT COUNT(*) as total ' + fc + wc).get(...params);
      const sortMap = { fecha: 'r.fecha', creado: 'r.creado', horas: 'r.horas', nombre: 'e.nombre' };
      const sortCol = sortMap[sort] || 'r.fecha';
      const sortDir = order === 'asc' ? 'ASC' : 'DESC';
      const pageNum = Math.max(0, parseInt(page) || 0);
      const limitNum = Math.min(Math.max(1, parseInt(limit) || 100), 500);
      const offset = pageNum * limitNum;

      const rows = db.prepare(`
        SELECT r.*, e.nombre AS empleadoNombre, COALESCE(u.nombre, '') AS nombreCreador
        ${fc} LEFT JOIN usuarios u ON r.creadoPor = u.id
        ${wc} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);
      res.json({ rows, total, summary, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    } catch (e) {
      console.error('Error en /api/registros/reportes:', e);
      res.status(500).json({ error: 'Error al generar reporte' });
    }
  });

  // ── GET /:id ──
  router.get('/:id', todosRoles, (req, res) => {
    try {
      const reg = db.prepare(`
        SELECT r.*, COALESCE(u.nombre, '') AS nombreCreador, COALESCE(ua.nombre, '') AS aprobadorNombre, e.nombre AS empleadoNombre
        FROM registros r
        JOIN empleados e ON r.empleadoId = e.id
        LEFT JOIN usuarios u ON r.creadoPor = u.id
        LEFT JOIN usuarios ua ON r.aprobadoPor = ua.id
        WHERE r.id = ?
      `).get(req.params.id);
      if (!reg) return res.status(404).json({ error: 'Registro no encontrado' });
      const u = req.usuario;
      const efectivo = permEfectivo(u);
      if (efectivo === 'sede' && reg.sede !== u.sede) return res.status(403).json({ error: 'No tienes acceso' });
      if (efectivo === 'propios' && reg.creadoPor !== u.id) return res.status(403).json({ error: 'No tienes acceso' });
      res.json(reg);
    } catch (e) {
      console.error('Error en GET /api/registros/:id:', e);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // ── POST / ──
  router.post('/', autenticar([]), requierePermiso('registros'), (req, res) => {
    try {
      const { empleadoId, nominaId, fecha, horas, tipo, concepto, aprobador = '', motivo, observaciones, transporte } = req.body;
      if (!empleadoId) return res.status(400).json({ error: 'Empleado requerido' });
      if (!nominaId) return res.status(400).json({ error: 'Período de nómina requerido' });
      if (!db.prepare('SELECT id FROM nominas WHERE id = ?').get(nominaId)) return res.status(400).json({ error: 'Período de nómina inválido' });
      const tipoRow = tipo ? db.prepare('SELECT es_valor FROM tipos WHERE id=? AND activo=1').get(tipo) : null;
      const esValor = tipoRow ? tipoRow.es_valor === 1 : false;
      if (!tipoRow && tipo) return res.status(400).json({ error: 'El tipo de hora extra no es válido o está inactivo.' });
      const hs = parseFloat(horas||0);
      if (!esValor) {
        if (isNaN(hs) || hs <= 0) return res.status(400).json({ error: 'Las horas deben ser un número positivo' });
        if (hs > 12) return res.status(400).json({ error: 'Las horas no pueden superar 12 en un registro' });
      }
      const hoy = new Date().toISOString().split('T')[0];
      if (fecha > hoy) return res.status(400).json({ error: 'La fecha no puede ser futura.' });
      if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo es obligatorio.' });
      if (transporte !== undefined && (isNaN(parseFloat(transporte)) || parseFloat(transporte) < 0)) return res.status(400).json({ error: 'El valor de transporte debe ser un número positivo' });
      const u = req.usuario;
      const emp = db.prepare('SELECT sede, activo FROM empleados WHERE id = ?').get(empleadoId);
      if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });
      if (emp.activo !== 1) return res.status(400).json({ error: 'No se pueden registrar novedades a un empleado inactivo' });
      if (!tienePermiso(u, 'ver_todos')) {
        if (tienePermiso(u, 'ver_sede')) { if (emp.sede !== u.sede) return res.status(403).json({ error: 'No puedes registrar horas para empleados de otra sede.' }); }
        else { const asignados = db.prepare('SELECT empleadoId FROM usuario_empleados WHERE usuarioId = ?').all(u.id).map(r => r.empleadoId); if (!asignados.includes(empleadoId)) return res.status(403).json({ error: 'No tienes permiso para registrar horas a este empleado.' }); }
      }
      const sede = emp.sede;
      const id = uid();

      let aprobacion_pendiente = 0;
      const nominaRow = db.prepare('SELECT fecha_limite, fin FROM nominas WHERE id = ?').get(nominaId);
      if (nominaRow && nominaRow.fecha_limite && fecha > nominaRow.fecha_limite) {
        aprobacion_pendiente = 1;
      }

      db.prepare('INSERT INTO registros (id,empleadoId,nominaId,fecha,horas,tipo,aprobador,motivo,creado,concepto,observaciones,transporte,sede,creadoPor,estado,aprobadoPor,fechaAprobado,aprobacion_pendiente) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, empleadoId, nominaId, fecha, hs, tipo, aprobador, motivo, new Date().toISOString(), concepto||'', observaciones||'', parseFloat(transporte||0), sede, req.usuario.id, 'pendiente', '', '', aprobacion_pendiente);

      try {
        const cfg = getConfig();
        const gerentes = db.prepare("SELECT email, id FROM usuarios WHERE rol IN ('gerencia','admin') AND activo = 1").all();
        const empN = db.prepare('SELECT nombre FROM empleados WHERE id = ?').get(empleadoId);
        const tipoRow = db.prepare('SELECT nombre FROM tipos WHERE id = ?').get(tipo);
        const tipoNombre = tipoRow ? tipo + ' ' + tipoRow.nombre : tipo;
        if (gerentes.length && cfg.smtp_host) {
          const enlace = `${BASE_URL}?registro=${id}`;
          const cuerpo = `📢 Nueva hora extra pendiente de aprobación\n\nEmpleado: ${empN?.nombre || '—'}\nSede: ${sede}\nFecha: ${fecha}\nHoras: ${horas}\nTipo: ${tipoNombre}\nAprobador: ${aprobador}\nMotivo: ${motivo}\n\nHaz clic aquí para revisar y aprobar:\n${enlace}\n\n${BASE_URL}`;
          gerentes.forEach(g => enviarCorreo(g.email, `🔔 Nueva hora extra pendiente - ${empN?.nombre || '—'}`, cuerpo));
        }
        // Notificación in-app a gerentes/admins
        for (const g of gerentes) {
          crearNotificacion(g.id, 'registro_creado', 'Hora extra pendiente', `${empN?.nombre || 'Empleado'} registró ${horas}h de ${tipoNombre} el ${fecha}`, '/nomina/');
        }
      } catch (e) { console.error('Error notify gerencia:', e.message); }

      res.json({ id });
    } catch (e) {
      console.error('Error guardando registro:', e.message);
      res.status(500).json({ error: 'Error guardando registro' });
    }
  });

  // ── DELETE /:id ──
  router.delete('/:id', autenticar([]), requierePermiso('eliminar_registros'), (req, res) => {
    const reg = db.prepare('SELECT id FROM registros WHERE id=?').get(req.params.id);
    if (!reg) return res.status(404).json({ error: 'Registro no encontrado' });
    db.prepare('DELETE FROM registros WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── PUT /:id ──
  router.put('/:id', podeEditar, (req, res) => {
    try {
      const reg = db.prepare('SELECT r.estado, r.creadoPor, e.sede FROM registros r JOIN empleados e ON r.empleadoId = e.id WHERE r.id=?').get(req.params.id);
      if (!reg) return res.status(404).json({ error: 'Registro no encontrado' });
      if (reg.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se pueden editar registros pendientes' });
      const u = req.usuario;
      if (!tienePermiso(u, 'ver_todos') && !(tienePermiso(u, 'ver_sede') && reg.sede === u.sede) && !(tienePermiso(u, 'ver_propios') && reg.creadoPor === u.id)) {
        return res.status(403).json({ error: 'No tienes permiso para editar este registro' });
      }
      const { empleadoId, nominaId, fecha, horas, tipo, aprobador = '', motivo, observaciones, transporte } = req.body;
      const tipoRow = tipo ? db.prepare('SELECT es_valor FROM tipos WHERE id=? AND activo=1').get(tipo) : null;
      const esValor = tipoRow ? tipoRow.es_valor === 1 : false;
      if (!tipoRow && tipo) return res.status(400).json({ error: 'El tipo de hora extra no es válido o está inactivo.' });
      const hs = parseFloat(horas||0);
      if (!esValor) {
        if (isNaN(hs) || hs <= 0) return res.status(400).json({ error: 'Las horas deben ser un número positivo' });
        if (hs > 12) return res.status(400).json({ error: 'Las horas no pueden superar 12 en un registro' });
      }
      const transp = parseFloat(transporte||0);
      if (isNaN(transp) || transp < 0) return res.status(400).json({ error: 'El valor de transporte no es válido' });
      if (!db.prepare('SELECT id FROM nominas WHERE id = ?').get(nominaId)) return res.status(400).json({ error: 'Período de nómina inválido' });
      const emp = db.prepare('SELECT sede, activo FROM empleados WHERE id = ?').get(empleadoId);
      if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });
      if (emp.activo !== 1) return res.status(400).json({ error: 'No se pueden registrar novedades a un empleado inactivo' });
      const hoy = new Date().toISOString().split('T')[0];
      if (fecha > hoy) return res.status(400).json({ error: 'La fecha no puede ser futura.' });
      if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo es obligatorio.' });
      const sede = emp ? emp.sede : 'Principal';
      db.prepare('UPDATE registros SET empleadoId=?, nominaId=?, fecha=?, horas=?, tipo=?, aprobador=?, motivo=?, observaciones=?, transporte=?, sede=? WHERE id=?')
        .run(empleadoId, nominaId, fecha, hs, tipo, aprobador, motivo, observaciones||'', transp, sede, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      console.error('Error editando registro:', e.message);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ── POST /:id/revertir ──
  router.post('/:id/revertir', autenticar([]), requierePermiso('revertir'), (req, res) => {
    try {
      const reg = db.prepare('SELECT estado FROM registros WHERE id=?').get(req.params.id);
      if (!reg) return res.status(404).json({ error: 'Registro no encontrado' });
      if (reg.estado === 'pendiente') return res.status(400).json({ error: 'El registro ya está pendiente' });
      db.prepare('UPDATE registros SET estado=?, aprobadoPor=?, fechaAprobado=? WHERE id=?').run('pendiente', '', '', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      console.error('Error revirtiendo registro:', e.message);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ── POST /:id/aprobar ──
  router.post('/:id/aprobar', podeAprobar, async (req, res) => {
    const { aprobar, observaciones } = req.body;
    const estado = aprobar ? 'aprobado' : 'rechazado';

    try {
      const reg = db.prepare('SELECT r.estado, r.creadoPor, e.sede FROM registros r JOIN empleados e ON r.empleadoId = e.id WHERE r.id = ?').get(req.params.id);
      if (!reg) return res.status(404).json({ error: 'Registro no encontrado' });
      if (reg.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se pueden aprobar/rechazar registros pendientes' });
      const u = req.usuario;
      if (!tienePermiso(u, 'ver_todos') && !(tienePermiso(u, 'ver_sede') && reg.sede === u.sede) && !(tienePermiso(u, 'ver_propios') && reg.creadoPor === u.id)) return res.status(403).json({ error: 'No tienes acceso a este registro' });
      db.prepare('UPDATE registros SET estado = ?, aprobadoPor = ?, fechaAprobado = ?, observaciones = COALESCE(?, observaciones) WHERE id = ?')
        .run(estado, req.usuario.id, new Date().toISOString(), observaciones || '', req.params.id);
    } catch (dbErr) { return res.status(500).json({ error: 'Error actualizando DB' }); }

    try {
      const reg = db.prepare('SELECT r.*, u.email as creadorEmail, u.nombre as creadorNombre, u.id as creadorId FROM registros r JOIN usuarios u ON r.creadoPor = u.id WHERE r.id = ?').get(req.params.id);
      if (reg?.creadorEmail) enviarCorreo(reg.creadorEmail, `Tu hora extra fue ${estado === 'aprobado' ? 'aprobada' : 'rechazada'}`,
        `Hola ${reg.creadorNombre},\n\nTu registro de hora extra ha sido ${estado === 'aprobado' ? 'aprobado' : 'rechazado'}:\n\nFecha: ${reg.fecha}\nHoras: ${reg.horas}\nTipo: ${reg.tipo}\n\n${observaciones ? 'Observaciones: ' + observaciones : ''}\n\nSaludos,\n${APP_NAME || 'Nómina'}`
      ).catch(e => console.error('Notificación email falló:', e.message));
      // Notificación in-app al creador
      if (reg?.creadorId) {
        crearNotificacion(reg.creadorId, estado === 'aprobado' ? 'registro_aprobado' : 'registro_rechazado',
          `Hora extra ${estado === 'aprobado' ? 'aprobada' : 'rechazada'}`,
          `Tu registro del ${reg.fecha} (${reg.horas}h) fue ${estado === 'aprobado' ? 'aprobado' : 'rechazado'}`,
          '/nomina/'
        );
      }
    } catch (e) { console.error('Error preparando notificación:', e.message); }

    res.json({ ok: true, estado });
  });

  // ── POST /batch-aprobar ──
  router.post('/batch-aprobar', podeAprobar, async (req, res) => {
    const { ids, aprobar, observaciones } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Selecciona al menos un registro' });
    const u = req.usuario;
    const estado = aprobar ? 'aprobado' : 'rechazado';
    const ahora = new Date().toISOString();
    const updateStmt = db.prepare("UPDATE registros SET estado = ?, aprobadoPor = ?, fechaAprobado = ? WHERE id = ? AND estado = 'pendiente'");
    let actualizados = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        if (tienePermiso(u, 'ver_todos')) { actualizados += updateStmt.run(estado, req.usuario.id, ahora, id).changes; }
        else if (tienePermiso(u, 'ver_sede')) { const r = db.prepare('SELECT e.sede FROM registros r JOIN empleados e ON r.empleadoId = e.id WHERE r.id = ?').get(id); if (r && r.sede === u.sede) actualizados += updateStmt.run(estado, req.usuario.id, ahora, id).changes; }
        else if (tienePermiso(u, 'ver_propios')) { const r = db.prepare('SELECT creadoPor FROM registros WHERE id = ?').get(id); if (r && r.creadoPor === u.id) actualizados += updateStmt.run(estado, req.usuario.id, ahora, id).changes; }
      }
    });
    try { tx(); } catch (e) { return res.status(500).json({ error: 'Error actualizando DB' }); }
    res.json({ ok: true, estado, total: ids.length, actualizados });
  });

  return router;
};
