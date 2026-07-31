import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { notificar, getTareaCompleta, BASE_URL } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { templateAsignacion, templateCambioEstado } = require('../../../../framework/email-templates');

const router = express.Router();

const COLUMNA_A_ESTADO = {
  pendiente: 'pendiente',
  en_progreso: 'en_progreso',
  revision: 'revision',
  completada: 'completada'
};

router.get('/', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const { proyecto_id, estado, asignado_a, prioridad, columna, q, page, limit } = req.query;
    const params = [];
    const conditions = [];
    let idx = 1;

    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');
    if (soloPropios) {
      params.push(req.user.id);
      conditions.push(`t.asignado_a = $${idx++}`);
    }

    if (proyecto_id) { params.push(proyecto_id); conditions.push(`t.proyecto_id = $${idx++}`); }
    if (estado) { params.push(estado); conditions.push(`t.estado = $${idx++}`); }
    if (asignado_a) { params.push(asignado_a); conditions.push(`t.asignado_a = $${idx++}`); }
    if (prioridad) { params.push(prioridad); conditions.push(`t.prioridad = $${idx++}`); }
    if (columna) { params.push(columna); conditions.push(`t.columna = $${idx++}`); }
    if (q) { params.push('%' + q + '%'); conditions.push(`(t.titulo ILIKE $${idx} OR t.descripcion ILIKE $${idx})`); idx++; }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM projects.tareas t ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const pg = parseInt(page) || 1;
    const lim = parseInt(limit) || 50;
    const offset = (pg - 1) * lim;

    const result = await pool.query(
      `SELECT t.*, p.nombre AS proyecto_nombre
       FROM projects.tareas t
       LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
       ${where}
       ORDER BY t.orden ASC, t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, lim, offset]
    );

    res.json({ exitosa: true, total, page: pg, limit: lim, tareas: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');
    const query = soloPropios
      ? `SELECT t.*, p.nombre AS proyecto_nombre FROM projects.tareas t LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id WHERE t.id = $1 AND t.asignado_a = $2`
      : `SELECT t.*, p.nombre AS proyecto_nombre FROM projects.tareas t LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id WHERE t.id = $1`;
    const params = soloPropios ? [req.params.id, req.user.id] : [req.params.id];
    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermiso('crear_tarea', 'proyectos'), async (req, res) => {
  try {
    const { proyecto_id, titulo, descripcion, tipo, prioridad, asignado_a, reportero, fecha_limite, estimacion_horas, columna } = req.body;
    if (!titulo) return res.status(400).json({ error: 'El título es requerido' });
    const col = columna || 'pendiente';
    const est = COLUMNA_A_ESTADO[col] || 'pendiente';
    const result = await pool.query(
      `INSERT INTO projects.tareas (proyecto_id, titulo, descripcion, tipo, prioridad, estado, columna, asignado_a, reportero, fecha_limite, estimacion_horas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [proyecto_id || null, titulo, descripcion || '', tipo || 'tarea', prioridad || 'media', est, col, asignado_a || null, reportero || null, fecha_limite || null, estimacion_horas || null]
    );

    // Notificar al asignado (in-app + email)
    if (asignado_a) {
      try {
        const tarea = await getTareaCompleta(pool, result.rows[0].id);
        if (tarea) {
          notificar({
            usuario_id: asignado_a,
            modulo: 'proyectos',
            tipo: 'tarea_asignada',
            titulo: 'Tarea asignada',
            mensaje: `Se te asignó la tarea "${titulo}"`,
            url: '/proyectos/#tareas',
            email: tarea.asignado_email,
            emailAsunto: `[Proyectos] Tarea asignada: ${titulo}`,
            emailHtml: templateAsignacion({ entidad: 'tarea', nombre: titulo, asignador: req.user.nombre, descripcion, prioridad, fechaLimite: fecha_limite, url: `${BASE_URL}/#tareas`, module: 'proyectos', baseUrl: BASE_URL }),
            enviarCorreo
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.status(201).json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/reordenar', requirePermiso('editar_tarea', 'proyectos'), async (req, res) => {
  try {
    const { tarea_id, columna, orden } = req.body;
    if (!tarea_id || !columna) return res.status(400).json({ error: 'tarea_id y columna requeridos' });

    const esAdminGerente = req.user?.rol === 'admin' || req.user?.rol === 'gerente';

    if (columna === 'completada' && !esAdminGerente) {
      return res.status(403).json({ error: 'Solo admin/gerente pueden marcar tareas como completadas' });
    }

    if (!esAdminGerente) {
      const check = await pool.query('SELECT estado FROM projects.tareas WHERE id = $1', [tarea_id]);
      if (check.rows.length > 0 && check.rows[0].estado === 'revision') {
        return res.status(403).json({ error: 'No se pueden mover tareas en estado de revisión' });
      }
    }

    // Obtener tarea antes del update para detectar cambio de estado
    const tareaAntes = await pool.query('SELECT estado, asignado_a FROM projects.tareas WHERE id = $1', [tarea_id]);
    const estadoAnterior = tareaAntes.rows[0]?.estado;
    const asignado = tareaAntes.rows[0]?.asignado_a;

    const est = COLUMNA_A_ESTADO[columna] || 'pendiente';
    const resetAprobacion = columna !== 'completada' ? `, estado_aprobacion = 'pendiente', aprobado_por = NULL, aprobado_en = NULL, motivo_rechazo = NULL` : '';
    const result = await pool.query(
      `UPDATE projects.tareas SET columna = $1, estado = $2, orden = COALESCE($3, orden)${resetAprobacion}, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [columna, est, orden || 0, tarea_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });

    // Notificar cambio de estado (solo si realmente cambió)
    if (asignado && estadoAnterior !== est) {
      try {
        const tarea = await getTareaCompleta(pool, tarea_id);
        if (tarea) {
          notificar({
            usuario_id: asignado,
            modulo: 'proyectos',
            tipo: 'cambio_estado',
            titulo: 'Tarea movida',
            mensaje: `"${tarea.titulo}" movida a ${est.replace('_', ' ')}`,
            url: '/proyectos/#tablero',
            email: tarea.asignado_email,
            emailAsunto: `[Proyectos] Tarea movida: ${tarea.titulo}`,
            emailHtml: templateCambioEstado({ entidad: 'tarea', nombre: tarea.titulo, estadoAnterior: estadoAnterior.replace('_', ' '), estadoNuevo: est.replace('_', ' '), url: `${BASE_URL}/#tablero`, module: 'proyectos', baseUrl: BASE_URL }),
            enviarCorreo
          });
          // Notificar al reportero si es diferente
          if (tarea.reportero && tarea.reportero !== asignado) {
            notificar({
              usuario_id: tarea.reportero,
              modulo: 'proyectos',
              tipo: 'cambio_estado',
              titulo: 'Tarea movida',
              mensaje: `"${tarea.titulo}" movida a ${est.replace('_', ' ')}`,
              url: '/proyectos/#tablero',
              email: tarea.reportero_email,
              emailAsunto: `[Proyectos] Tarea movida: ${tarea.titulo}`,
              emailHtml: templateCambioEstado({ entidad: 'tarea', nombre: tarea.titulo, estadoAnterior: estadoAnterior.replace('_', ' '), estadoNuevo: est.replace('_', ' '), url: `${BASE_URL}/#tablero`, module: 'proyectos', baseUrl: BASE_URL }),
              enviarCorreo
            });
          }
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, tarea: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermiso('editar_tarea', 'proyectos'), async (req, res) => {
  try {
    const { titulo, descripcion, tipo, prioridad, estado, columna, asignado_a, fecha_limite, estimacion_horas, horas_invertidas } = req.body;

    const esAdminGerente = req.user?.rol === 'admin' || req.user?.rol === 'gerente';

    if ((estado === 'completada' || columna === 'completada') && !esAdminGerente) {
      return res.status(403).json({ error: 'Solo admin/gerente pueden marcar tareas como completadas' });
    }

    if (!esAdminGerente) {
      const check = await pool.query('SELECT estado FROM projects.tareas WHERE id = $1', [req.params.id]);
      if (check.rows.length > 0 && check.rows[0].estado === 'revision') {
        return res.status(403).json({ error: 'No se pueden editar tareas en estado de revisión' });
      }
    }

    // Obtener tarea antes del update para detectar cambios
    const tareaAntes = await pool.query('SELECT estado, asignado_a, titulo FROM projects.tareas WHERE id = $1', [req.params.id]);
    const oldEstado = tareaAntes.rows[0]?.estado;
    const oldAsignado = tareaAntes.rows[0]?.asignado_a;
    const tareaTitulo = titulo || tareaAntes.rows[0]?.titulo;

    const updates = [];
    const params = [];
    let idx = 1;

    if (titulo !== undefined) { updates.push(`titulo = $${idx++}`); params.push(titulo); }
    if (descripcion !== undefined) { updates.push(`descripcion = $${idx++}`); params.push(descripcion); }
    if (tipo !== undefined) { updates.push(`tipo = $${idx++}`); params.push(tipo); }
    if (prioridad !== undefined) { updates.push(`prioridad = $${idx++}`); params.push(prioridad); }
    if (columna !== undefined) {
      updates.push(`columna = $${idx++}`); params.push(columna);
      const est = COLUMNA_A_ESTADO[columna];
      if (est) { updates.push(`estado = $${idx++}`); params.push(est); }
      if (columna !== 'completada') {
        updates.push(`estado_aprobacion = 'pendiente'`);
        updates.push(`aprobado_por = NULL`);
        updates.push(`aprobado_en = NULL`);
        updates.push(`motivo_rechazo = NULL`);
      }
    } else if (estado !== undefined) {
      updates.push(`estado = $${idx++}`); params.push(estado);
      if (estado !== 'completada') {
        updates.push(`estado_aprobacion = 'pendiente'`);
        updates.push(`aprobado_por = NULL`);
        updates.push(`aprobado_en = NULL`);
        updates.push(`motivo_rechazo = NULL`);
      }
    }
    if (asignado_a !== undefined) { updates.push(`asignado_a = $${idx++}`); params.push(asignado_a); }
    if (fecha_limite !== undefined) { updates.push(`fecha_limite = $${idx++}`); params.push(fecha_limite); }
    if (estimacion_horas !== undefined) { updates.push(`estimacion_horas = $${idx++}`); params.push(estimacion_horas); }
    if (horas_invertidas !== undefined) { updates.push(`horas_invertidas = $${idx++}`); params.push(horas_invertidas); }

    if (updates.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE projects.tareas SET ${updates.join(', ')} WHERE id = $${idx++} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });

    const tareaActualizada = result.rows[0];

    // Notificar re-asignación
    if (asignado_a !== undefined && asignado_a && asignado_a !== oldAsignado) {
      try {
        const tarea = await getTareaCompleta(pool, req.params.id);
        if (tarea) {
          notificar({
            usuario_id: asignado_a,
            modulo: 'proyectos',
            tipo: 'tarea_asignada',
            titulo: 'Tarea re-asignada',
            mensaje: `Se te re-asignó la tarea "${tareaTitulo}"`,
            url: '/proyectos/#tareas',
            email: tarea.asignado_email,
            emailAsunto: `[Proyectos] Tarea re-asignada: ${tareaTitulo}`,
            emailHtml: templateAsignacion({ entidad: 'tarea', nombre: tareaTitulo, asignador: req.user.nombre, url: `${BASE_URL}/#tareas`, module: 'proyectos', baseUrl: BASE_URL }),
            enviarCorreo
          });
          // Notificar al reportero
          if (tarea.reportero && tarea.reportero !== req.user.id) {
            notificar({
              usuario_id: tarea.reportero,
              modulo: 'proyectos',
              tipo: 'tarea_asignada',
              titulo: 'Tarea re-asignada',
              mensaje: `"${tareaTitulo}" fue re-asignada por ${req.user.nombre}`,
              url: '/proyectos/#tareas',
              email: tarea.reportero_email,
              emailAsunto: `[Proyectos] Tarea re-asignada: ${tareaTitulo}`,
              emailHtml: templateAsignacion({ entidad: 'tarea', nombre: tareaTitulo, asignador: req.user.nombre, url: `${BASE_URL}/#tareas`, module: 'proyectos', baseUrl: BASE_URL }),
              enviarCorreo
            });
          }
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    // Notificar cambio de estado
    const newEstado = columna ? (COLUMNA_A_ESTADO[columna] || oldEstado) : (estado || oldEstado);
    if (newEstado && oldEstado !== newEstado && oldAsignado) {
      try {
        const tarea = await getTareaCompleta(pool, req.params.id);
        notificar({
          usuario_id: oldAsignado,
          modulo: 'proyectos',
          tipo: 'cambio_estado',
          titulo: 'Estado de tarea cambiado',
          mensaje: `"${tareaTitulo}" cambió de ${oldEstado.replace('_', ' ')} a ${newEstado.replace('_', ' ')}`,
          url: '/proyectos/#tareas',
          email: tarea?.asignado_email,
          emailAsunto: `[Proyectos] Estado cambiado: ${tareaTitulo}`,
          emailHtml: templateCambioEstado({ entidad: 'tarea', nombre: tareaTitulo, estadoAnterior: oldEstado.replace('_', ' '), estadoNuevo: newEstado.replace('_', ' '), url: `${BASE_URL}/#tareas`, module: 'proyectos', baseUrl: BASE_URL }),
          enviarCorreo
        });
        // Notificar al reportero si es diferente
        if (tarea?.reportero && tarea.reportero !== req.user.id && tarea.reportero !== oldAsignado) {
          notificar({
            usuario_id: tarea.reportero,
            modulo: 'proyectos',
            tipo: 'cambio_estado',
            titulo: 'Estado de tarea cambiado',
            mensaje: `"${tareaTitulo}" cambió de ${oldEstado.replace('_', ' ')} a ${newEstado.replace('_', ' ')}`,
            url: '/proyectos/#tareas',
            email: tarea.reportero_email,
            emailAsunto: `[Proyectos] Estado cambiado: ${tareaTitulo}`,
            emailHtml: templateCambioEstado({ entidad: 'tarea', nombre: tareaTitulo, estadoAnterior: oldEstado.replace('_', ' '), estadoNuevo: newEstado.replace('_', ' '), url: `${BASE_URL}/#tareas`, module: 'proyectos', baseUrl: BASE_URL }),
            enviarCorreo
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    // Notificar edición al reportero (si cambió titulo, descripcion, prioridad, etc.)
    const editFields = ['titulo', 'descripcion', 'prioridad', 'fecha_limite', 'estimacion_horas'];
    const wasEdited = editFields.some(f => req.body[f] !== undefined && req.body[f] !== tareaActualizada[f]);
    if (wasEdited && oldAsignado && oldAsignado !== req.user.id) {
      try {
        const tarea = await getTareaCompleta(pool, req.params.id);
        if (tarea?.reportero && tarea.reportero !== req.user.id) {
          notificar({
            usuario_id: tarea.reportero,
            modulo: 'proyectos',
            tipo: 'cambio_estado',
            titulo: 'Tarea editada',
            mensaje: `"${tareaTitulo}" fue editada por ${req.user.nombre}`,
            url: '/proyectos/#tareas',
            email: tarea.reportero_email,
            emailAsunto: `[Proyectos] Tarea editada: ${tareaTitulo}`,
            emailHtml: templateCambioEstado({ entidad: 'tarea', nombre: tareaTitulo, estadoAnterior: 'anterior', estadoNuevo: 'editada', url: `${BASE_URL}/#tareas`, module: 'proyectos', baseUrl: BASE_URL }),
            enviarCorreo
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, tarea: tareaActualizada });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermiso('eliminar_tarea', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects.tareas WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ exitosa: true, mensaje: 'Tarea eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
