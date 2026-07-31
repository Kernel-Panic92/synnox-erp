import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { notificar, getProyectoCompleto } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { templateAsignacion, templateCambioEstado } = require('../../../../framework/email-templates');

const router = express.Router();

router.get('/', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');

    let result;
    if (soloPropios) {
      result = await pool.query(`
        SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        WHERE p.asignado_a = $1
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `, [req.user.id]);
    } else {
      result = await pool.query(`
        SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `);
    }
    res.json({ exitosa: true, proyectos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');

    let result;
    if (soloPropios) {
      result = await pool.query(
        `SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        WHERE p.id = $1 AND p.asignado_a = $2
        GROUP BY p.id`,
        [req.params.id, req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT p.*,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
          COUNT(t.id) AS total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        WHERE p.id = $1
        GROUP BY p.id`,
        [req.params.id]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermiso('crear', 'proyectos'), async (req, res) => {
  try {
    const { nombre, descripcion, fecha_limite, centro_id, asignado_a } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO projects.proyectos (nombre, descripcion, fecha_limite, centro_id, asignado_a)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, descripcion || '', fecha_limite || null, centro_id || null, asignado_a || null]
    );

    // Notificar al asignado
    if (asignado_a) {
      try {
        const proyecto = await getProyectoCompleto(pool, result.rows[0].id);
        if (proyecto) {
          notificar({
            usuario_id: asignado_a,
            modulo: 'proyectos',
            tipo: 'proyecto_asignado',
            titulo: 'Proyecto asignado',
            mensaje: `Se te asignó el proyecto "${nombre}"`,
            url: '/proyectos/#proyectos',
            email: proyecto.asignado_email,
            emailAsunto: `[Proyectos] Proyecto asignado: ${nombre}`,
            emailHtml: templateAsignacion({ entidad: 'proyecto', nombre, asignador: req.user.nombre, descripcion, url: '/proyectos/#proyectos', module: 'proyectos' }),
            enviarCorreo
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.status(201).json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermiso('editar', 'proyectos'), async (req, res) => {
  try {
    const { nombre, descripcion, estado, fecha_limite, centro_id, asignado_a } = req.body;

    // Obtener proyecto antes del update para detectar cambios
    const proyectoAntes = await pool.query('SELECT estado, asignado_a, nombre FROM projects.proyectos WHERE id = $1', [req.params.id]);
    if (proyectoAntes.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const oldEstado = proyectoAntes.rows[0].estado;
    const oldAsignado = proyectoAntes.rows[0].asignado_a;
    const proyectoNombre = nombre || proyectoAntes.rows[0].nombre;

    const result = await pool.query(
      `UPDATE projects.proyectos
       SET nombre = COALESCE($1, nombre),
           descripcion = COALESCE($2, descripcion),
           estado = COALESCE($3, estado),
           fecha_limite = COALESCE($4, fecha_limite),
           centro_id = $5,
           asignado_a = $6,
           updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [nombre || null, descripcion || null, estado || null, fecha_limite || null, centro_id !== undefined ? centro_id : null, asignado_a !== undefined ? asignado_a : null, req.params.id]
    );

    // Notificar re-asignación
    if (asignado_a !== undefined && asignado_a && asignado_a !== oldAsignado) {
      try {
        const proyecto = await getProyectoCompleto(pool, req.params.id);
        if (proyecto) {
          notificar({
            usuario_id: asignado_a,
            modulo: 'proyectos',
            tipo: 'proyecto_asignado',
            titulo: 'Proyecto re-asignado',
            mensaje: `Se te re-asignó el proyecto "${proyectoNombre}"`,
            url: '/proyectos/#proyectos',
            email: proyecto.asignado_email,
            emailAsunto: `[Proyectos] Proyecto re-asignado: ${proyectoNombre}`,
            emailHtml: templateAsignacion({ entidad: 'proyecto', nombre: proyectoNombre, asignador: req.user.nombre, url: '/proyectos/#proyectos', module: 'proyectos' }),
            enviarCorreo
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    // Notificar cambio de estado
    const newEstado = estado || oldEstado;
    if (newEstado && oldEstado !== newEstado && oldAsignado) {
      try {
        const proyecto = await getProyectoCompleto(pool, req.params.id);
        notificar({
          usuario_id: oldAsignado,
          modulo: 'proyectos',
          tipo: 'cambio_estado',
          titulo: 'Estado de proyecto cambiado',
          mensaje: `"${proyectoNombre}" cambió de ${oldEstado} a ${newEstado}`,
          url: '/proyectos/#proyectos',
          email: proyecto?.asignado_email,
          emailAsunto: `[Proyectos] Estado cambiado: ${proyectoNombre}`,
          emailHtml: templateCambioEstado({ entidad: 'proyecto', nombre: proyectoNombre, estadoAnterior: oldEstado, estadoNuevo: newEstado, url: '/proyectos/#proyectos', module: 'proyectos' }),
          enviarCorreo
        });
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, proyecto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermiso('eliminar', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects.proyectos WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ exitosa: true, mensaje: 'Proyecto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
