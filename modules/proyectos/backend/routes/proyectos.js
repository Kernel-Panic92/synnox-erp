import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { notificar, getProyectoCompleto, getEmailBaseUrl } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { templateAsignacion, templateCambioEstado } = require('../../../../framework/email-templates');

const router = express.Router();

router.get('/', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');

    // Verificar si la tabla de miembros existe
    let hasMiembrosTable = false;
    try {
      await pool.query('SELECT 1 FROM projects.proyecto_miembros LIMIT 1');
      hasMiembrosTable = true;
    } catch {}

    let result;
    if (soloPropios) {
      if (hasMiembrosTable) {
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
             OR p.id IN (SELECT proyecto_id FROM projects.proyecto_miembros WHERE usuario_id = $1)
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
          WHERE p.asignado_a = $1
          GROUP BY p.id
          ORDER BY p.created_at DESC
        `, [req.user.id]);
      }
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

    const proyectoIds = result.rows.map(p => p.id);
    let miembrosMap = {};
    if (proyectoIds.length && hasMiembrosTable) {
      try {
        const miembrosResult = await pool.query(
          `SELECT pm.proyecto_id, pm.usuario_id, pm.rol
           FROM projects.proyecto_miembros pm
           WHERE pm.proyecto_id = ANY($1)`,
          [proyectoIds]
        );
        for (const m of miembrosResult.rows) {
          if (!miembrosMap[m.proyecto_id]) miembrosMap[m.proyecto_id] = [];
          miembrosMap[m.proyecto_id].push({ usuario_id: m.usuario_id, rol: m.rol });
        }
      } catch {}
    }

    const proyectos = result.rows.map(p => ({
      ...p,
      miembros: miembrosMap[p.id] || []
    }));

    res.json({ exitosa: true, proyectos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const permisos = req.user?.modulos_permisos?.proyectos || [];
    const soloPropios = permisos.includes('ver_propios');

    let hasMiembrosTable = false;
    try {
      await pool.query('SELECT 1 FROM projects.proyecto_miembros LIMIT 1');
      hasMiembrosTable = true;
    } catch {}

    let result;
    if (soloPropios) {
      if (hasMiembrosTable) {
        result = await pool.query(
          `SELECT p.*,
            COUNT(t.id) FILTER (WHERE t.estado = 'pendiente')   AS tareas_pendientes,
            COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') AS tareas_en_progreso,
            COUNT(t.id) FILTER (WHERE t.estado = 'revision')    AS tareas_revision,
            COUNT(t.id) FILTER (WHERE t.estado = 'completada')  AS tareas_completadas,
            COUNT(t.id) AS total_tareas
          FROM projects.proyectos p
          LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
          WHERE p.id = $1 AND (p.asignado_a = $2
             OR p.id IN (SELECT proyecto_id FROM projects.proyecto_miembros WHERE usuario_id = $2))
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
          WHERE p.id = $1 AND p.asignado_a = $2
          GROUP BY p.id`,
          [req.params.id, req.user.id]
        );
      }
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

    let miembros = [];
    if (hasMiembrosTable) {
      try {
        const miembrosResult = await pool.query(
          `SELECT pm.usuario_id, pm.rol FROM projects.proyecto_miembros pm WHERE pm.proyecto_id = $1`,
          [req.params.id]
        );
        miembros = miembrosResult.rows;
      } catch {}
    }
    const proyecto = { ...result.rows[0], miembros };

    res.json({ exitosa: true, proyecto });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermiso('crear', 'proyectos'), async (req, res) => {
  try {
    const { nombre, descripcion, fecha_limite, centro_id, asignado_a, prioridad, miembros } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const result = await pool.query(
      `INSERT INTO projects.proyectos (nombre, descripcion, fecha_limite, centro_id, asignado_a, prioridad)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre, descripcion || '', fecha_limite || null, centro_id || null, asignado_a || null, prioridad || 'media']
    );

    const proyectoId = result.rows[0].id;

    // Crear al asignado como lider del proyecto
    if (asignado_a) {
      await pool.query(
        `INSERT INTO projects.proyecto_miembros (proyecto_id, usuario_id, rol)
         VALUES ($1, $2, 'lider')
         ON CONFLICT (proyecto_id, usuario_id) DO NOTHING`,
        [proyectoId, asignado_a]
      );
    }

    // Insert additional members if provided
    if (Array.isArray(miembros) && miembros.length > 0) {
      for (const m of miembros) {
        if (m.usuario_id) {
          await pool.query(
            `INSERT INTO projects.proyecto_miembros (proyecto_id, usuario_id, rol)
             VALUES ($1, $2, $3)
             ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = $3`,
            [proyectoId, m.usuario_id, m.rol || 'miembro']
          );
        }
      }
    }

    // Notificar al asignado
    if (asignado_a) {
      try {
        const proyecto = await getProyectoCompleto(pool, proyectoId);
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
            emailHtml: templateAsignacion({ entidad: 'proyecto', nombre, asignador: req.user.nombre, descripcion, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
            enviarCorreo
          });
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    // Notify new members (not the assigned user who was already notified)
    if (Array.isArray(miembros) && miembros.length > 0) {
      try {
        for (const m of miembros) {
          if (m.usuario_id && m.usuario_id !== asignado_a) {
            notificar({
              usuario_id: m.usuario_id,
              modulo: 'proyectos',
              tipo: 'proyecto_miembro',
              titulo: 'Agregado a proyecto',
              mensaje: `Fuiste agregado al proyecto "${nombre}" como ${m.rol || 'miembro'}`,
              url: '/proyectos/#proyectos',
              email: null,
              emailAsunto: `[Proyectos] Agregado a proyecto: ${nombre}`,
              emailHtml: templateAsignacion({ entidad: 'proyecto', nombre, asignador: req.user.nombre, descripcion, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
              enviarCorreo
            });
          }
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
    const { nombre, descripcion, estado, fecha_limite, centro_id, asignado_a, prioridad } = req.body;

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
           prioridad = COALESCE($7, prioridad),
           updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [nombre || null, descripcion || null, estado || null, fecha_limite || null, centro_id !== undefined ? centro_id : null, asignado_a !== undefined ? asignado_a : null, prioridad || null, req.params.id]
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
            emailHtml: templateAsignacion({ entidad: 'proyecto', nombre: proyectoNombre, asignador: req.user.nombre, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
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
          emailHtml: templateCambioEstado({ entidad: 'proyecto', nombre: proyectoNombre, estadoAnterior: oldEstado, estadoNuevo: newEstado, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
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
