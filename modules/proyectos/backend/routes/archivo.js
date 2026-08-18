import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import {
  ejecutarMigracion,
  reactivarTareaArchivada,
  archivarProyecto,
  reactivarProyectoArchivado,
} from '../utils/archivoService.js';

const router = express.Router();

function esAdminGerente(req) {
  return req.user?.rol === 'admin' || req.user?.rol === 'gerente';
}

function soloAdminGerente(req, res, next) {
  if (esAdminGerente(req)) return next();
  return res.status(403).json({ error: 'Requiere rol admin o gerente' });
}

// Listar tareas archivadas (paginado + filtros)
router.get('/', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const {
      proyecto_id,
      q,
      desde,
      hasta,
      page,
      limit,
    } = req.query;

    const params = [];
    const conditions = [];
    let idx = 1;

    if (proyecto_id) {
      params.push(proyecto_id);
      conditions.push(`proyecto_id_original = $${idx++}`);
    }
    if (desde) {
      params.push(desde);
      conditions.push(`archivada_en >= $${idx++}`);
    }
    if (hasta) {
      params.push(hasta);
      conditions.push(`archivada_en < ($${idx++}::timestamptz + INTERVAL '1 day')`);
    }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      conditions.push(`tarea_snapshot->>'titulo' ILIKE $${idx++}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM projects.tareas_archivadas ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const pg = parseInt(page) || 1;
    const lim = Math.min(parseInt(limit) || 20, 100);
    const offset = (pg - 1) * lim;

    const result = await pool.query(
      `
      SELECT id, tarea_id_original, proyecto_id_original, proyecto_nombre,
             tarea_snapshot->>'titulo' AS titulo,
             tarea_snapshot->>'estado' AS estado,
             tarea_snapshot->>'prioridad' AS prioridad,
             tarea_snapshot->>'asignado_a' AS asignado_a,
             completada_en, archivada_en, archivada_por,
             restaurada_como_id, restaurada_en
      FROM projects.tareas_archivadas
      ${where}
      ORDER BY archivada_en DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `,
      [...params, lim, offset]
    );

    res.json({ exitosa: true, total, page: pg, limit: lim, archivadas: result.rows });
  } catch (err) {
    console.error('[archivo] Error listando:', err);
    res.status(500).json({ error: err.message });
  }
});

// Estadísticas del archivo
router.get('/stats', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const totalRes = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE restaurada_como_id IS NOT NULL) AS restauradas,
              pg_size_pretty(pg_total_relation_size('projects.tareas_archivadas')) AS espacio
       FROM projects.tareas_archivadas`
    );
    const ultimaRes = await pool.query(
      `SELECT ejecutado_en, tareas_archivadas, tareas_fallidas, tipo
       FROM projects.archivo_log
       ORDER BY ejecutado_en DESC
       LIMIT 1`
    );
    const configRes = await pool.query(
      `SELECT clave, valor FROM projects.archivo_config WHERE clave IN ('meses_para_archivar', 'meses_retencion', 'habilitado')`
    );
    const config = {};
    for (const row of configRes.rows) config[row.clave] = row.valor;

    res.json({
      exitosa: true,
      stats: totalRes.rows[0],
      ultimaEjecucion: ultimaRes.rows[0] || null,
      config,
    });
  } catch (err) {
    console.error('[archivo] Error stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Leer configuración
router.get('/config', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT clave, valor, descripcion FROM projects.archivo_config ORDER BY clave`
    );
    res.json({ exitosa: true, config: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar configuración (admin/gerente)
router.put(
  '/config',
  requirePermiso('ver', 'proyectos'),
  soloAdminGerente,
  async (req, res) => {
    try {
      const { meses_para_archivar, meses_retencion, habilitado } = req.body;
      const updates = [];

      if (meses_para_archivar !== undefined) {
        const v = parseInt(meses_para_archivar);
        if (isNaN(v) || v < 1) {
          return res.status(400).json({ error: 'meses_para_archivar inválido' });
        }
        updates.push(pool.query(
          `UPDATE projects.archivo_config SET valor = $1, updated_at = NOW() WHERE clave = 'meses_para_archivar'`,
          [String(v)]
        ));
      }
      if (meses_retencion !== undefined) {
        const v = parseInt(meses_retencion);
        if (isNaN(v) || v < 1) {
          return res.status(400).json({ error: 'meses_retencion inválido' });
        }
        updates.push(pool.query(
          `UPDATE projects.archivo_config SET valor = $1, updated_at = NOW() WHERE clave = 'meses_retencion'`,
          [String(v)]
        ));
      }
      if (habilitado !== undefined) {
        updates.push(pool.query(
          `UPDATE projects.archivo_config SET valor = $1, updated_at = NOW() WHERE clave = 'habilitado'`,
          [String(!!habilitado)]
        ));
      }

      await Promise.all(updates);
      res.json({ exitosa: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Exportar archivadas como JSON (debe ir antes de /:id)
router.get(
  '/exportar/json',
  requirePermiso('ver', 'proyectos'),
  async (req, res) => {
    try {
      const { proyecto_id } = req.query;
      let where = '';
      const params = [];
      if (proyecto_id) {
        where = 'WHERE proyecto_id_original = $1';
        params.push(proyecto_id);
      }
      const result = await pool.query(
        `SELECT id, tarea_id_original, proyecto_id_original, proyecto_nombre,
                tarea_snapshot, comentarios_snapshot, evidencias_snapshot,
                archivada_en, completada_en
         FROM projects.tareas_archivadas
         ${where}
         ORDER BY archivada_en DESC`,
        params
      );
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="tareas-archivadas.json"'
      );
      res.json({ exitosa: true, count: result.rows.length, data: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Detalle de una tarea archivada
router.get('/:id', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM projects.tareas_archivadas WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tarea archivada no encontrada' });
    }
    const row = result.rows[0];
    res.json({
      exitosa: true,
      archivada: {
        ...row,
        tarea_snapshot: row.tarea_snapshot,
        comentarios_snapshot: row.comentarios_snapshot,
        evidencias_snapshot: row.evidencias_snapshot,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ejecutar migración manual (admin/gerente)
router.post(
  '/migrar',
  requirePermiso('ver', 'proyectos'),
  soloAdminGerente,
  async (req, res) => {
    try {
      const resultado = await ejecutarMigracion(pool, {
        ejecutadoPor: req.user.id,
        tipo: 'manual',
        batchSize: parseInt(req.body.batchSize) || 50,
      });
      res.json({ exitosa: true, resultado });
    } catch (err) {
      console.error('[archivo] Error en migración manual:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Reactivar tarea archivada (admin/gerente)
router.post(
  '/:id/reactivar',
  requirePermiso('ver', 'proyectos'),
  soloAdminGerente,
  async (req, res) => {
    try {
      const { nuevaTareaId } = await reactivarTareaArchivada(
        pool,
        req.params.id,
        req.user.id
      );
      res.json({ exitosa: true, nueva_tarea_id: nuevaTareaId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Endpoints de Proyectos Archivados ─────────────────────────

// Listar proyectos archivados (paginado + filtros)
router.get('/proyectos', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const { q, desde, hasta, page, limit } = req.query;

    const params = [];
    const conditions = [];
    let idx = 1;

    if (desde) {
      params.push(desde);
      conditions.push(`archivada_en >= $${idx++}`);
    }
    if (hasta) {
      params.push(hasta);
      conditions.push(`archivada_en < ($${idx++}::timestamptz + INTERVAL '1 day')`);
    }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      conditions.push(`proyecto_snapshot->>'nombre' ILIKE $${idx++}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM projects.proyectos_archivadas ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const pg = parseInt(page) || 1;
    const lim = Math.min(parseInt(limit) || 20, 100);
    const offset = (pg - 1) * lim;

    const result = await pool.query(
      `
      SELECT id, proyecto_id_original,
             proyecto_snapshot->>'nombre' AS nombre,
             proyecto_snapshot->>'estado' AS estado,
             proyecto_snapshot->>'prioridad' AS prioridad,
             proyecto_snapshot->>'asignado_a' AS asignado_a,
             jsonb_array_length(tareas_activas_snapshot) AS tareas_activas,
             jsonb_array_length(tareas_archivadas_refs) AS tareas_en_archivo,
             completado_en, archivada_en, archivada_por,
             restaurada_como_id, restaurada_en
      FROM projects.proyectos_archivadas
      ${where}
      ORDER BY archivada_en DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `,
      [...params, lim, offset]
    );

    res.json({ exitosa: true, total, page: pg, limit: lim, archivados: result.rows });
  } catch (err) {
    console.error('[archivo] Error listando proyectos:', err);
    res.status(500).json({ error: err.message });
  }
});

// Estadísticas de proyectos archivados
router.get('/proyectos/stats', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const totalRes = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE restaurada_como_id IS NOT NULL) AS restauradas,
              pg_size_pretty(pg_total_relation_size('projects.proyectos_archivadas')) AS espacio
       FROM projects.proyectos_archivadas`
    );
    const ultimaRes = await pool.query(
      `SELECT ejecutado_en, tareas_archivadas, tipo
       FROM projects.archivo_log
       WHERE tipo = 'proyecto'
       ORDER BY ejecutado_en DESC
       LIMIT 1`
    );
    const configRes = await pool.query(
      `SELECT clave, valor FROM projects.archivo_config WHERE clave IN ('meses_para_archivar_proyectos', 'habilitado_proyectos')`
    );
    const config = {};
    for (const row of configRes.rows) config[row.clave] = row.valor;

    res.json({
      exitosa: true,
      stats: totalRes.rows[0],
      ultimaEjecucion: ultimaRes.rows[0] || null,
      config,
    });
  } catch (err) {
    console.error('[archivo] Error stats proyectos:', err);
    res.status(500).json({ error: err.message });
  }
});

// Detalle de un proyecto archivado
router.get('/proyectos/:id', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM projects.proyectos_archivadas WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proyecto archivado no encontrado' });
    }
    const row = result.rows[0];
    res.json({
      exitosa: true,
      archivado: {
        ...row,
        proyecto_snapshot: row.proyecto_snapshot,
        tareas_activas_snapshot: row.tareas_activas_snapshot,
        tareas_archivadas_refs: row.tareas_archivadas_refs,
        miembros_snapshot: row.miembros_snapshot,
        actas_snapshot: row.actas_snapshot,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Migrar proyectos manualmente (admin/gerente)
router.post(
  '/proyectos/migrar',
  requirePermiso('ver', 'proyectos'),
  soloAdminGerente,
  async (req, res) => {
    try {
      // Buscar proyectos listos para archivar
      const configRes = await pool.query(
        `SELECT valor FROM projects.archivo_config WHERE clave = 'meses_para_archivar_proyectos'`
      );
      const meses = parseInt(configRes.rows[0]?.valor) || 3;

      const proyectosRes = await pool.query(
        `SELECT p.id
         FROM projects.proyectos p
         WHERE p.estado = 'completado'
           AND p.estado_aprobacion = 'aprobada'
           AND p.aprobado_en < NOW() - INTERVAL '1 month' * $1
           AND NOT EXISTS (
             SELECT 1 FROM projects.proyectos_archivadas pa
             WHERE pa.proyecto_id_original = p.id
           )
         ORDER BY p.aprobado_en ASC`,
        [meses]
      );

      let exitosos = 0;
      let fallidos = 0;
      const errores = [];

      for (const proy of proyectosRes.rows) {
        try {
          await archivarProyecto(pool, {
            proyectoId: proy.id,
            ejecutadoPor: req.user.id,
            tipo: 'manual',
          });
          exitosos++;
        } catch (err) {
          fallidos++;
          errores.push({ id: proy.id, error: err.message });
        }
      }

      res.json({
        exitosa: true,
        resultado: { exitosos, fallidos, errores, total: proyectosRes.rows.length },
      });
    } catch (err) {
      console.error('[archivo] Error en migración manual de proyectos:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Reactivar proyecto archivado (admin/gerente)
router.post(
  '/proyectos/:id/reactivar',
  requirePermiso('ver', 'proyectos'),
  soloAdminGerente,
  async (req, res) => {
    try {
      const { restaurarTareasArchivadas = false } = req.body || {};
      const resultado = await reactivarProyectoArchivado(
        pool,
        req.params.id,
        req.user.id,
        { restaurarTareasArchivadas }
      );
      res.json({ exitosa: true, ...resultado });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

export default router;
