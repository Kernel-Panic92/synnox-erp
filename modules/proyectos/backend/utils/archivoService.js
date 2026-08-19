/**
 * Servicio de archivo de tareas y proyectos completados.
 *
 * Centraliza la lógica de migración para que tanto el job automático
 * como el endpoint manual ejecuten exactamente el mismo código, con
 * las mismas garantías de bloqueo, transacción y auditoría.
 */

const ADVISORY_LOCK_KEY = "tareas_archivo";

async function withAdvisoryLock(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [
      ADVISORY_LOCK_KEY,
    ]);
    return await callback(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [
        ADVISORY_LOCK_KEY,
      ]);
    } catch (e) {
      // ignorar errores de unlock
    }
    client.release();
  }
}

async function getConfig(client) {
  const res = await client.query(
    "SELECT clave, valor FROM projects.archivo_config"
  );
  const config = {};
  for (const row of res.rows) config[row.clave] = row.valor;
  return {
    habilitado: config.habilitado === "true",
    mesesParaArchivar: parseInt(config.meses_para_archivar) || 3,
    mesesRetencion: parseInt(config.meses_retencion) || 24,
    habilitadoProyectos: config.habilitado_proyectos !== "false",
    mesesParaArchivarProyectos: parseInt(config.meses_para_archivar_proyectos) || 3,
  };
}

function buildSnapshots(tarea, comentarios, evidencias) {
  const tareaSnapshot = {
    id: tarea.id,
    proyecto_id: tarea.proyecto_id,
    titulo: tarea.titulo,
    descripcion: tarea.descripcion,
    tipo: tarea.tipo,
    prioridad: tarea.prioridad,
    estado: tarea.estado,
    columna: tarea.columna,
    asignado_a: tarea.asignado_a,
    reportero: tarea.reportero,
    fecha_limite: tarea.fecha_limite,
    estimacion_horas: tarea.estimacion_horas,
    horas_invertidas: tarea.horas_invertidas,
    orden: tarea.orden,
    estado_aprobacion: tarea.estado_aprobacion,
    aprobado_por: tarea.aprobado_por,
    aprobado_en: tarea.aprobado_en,
    motivo_rechazo: tarea.motivo_rechazo,
    created_at: tarea.created_at,
    updated_at: tarea.updated_at,
    completada_en: tarea.completada_en,
  };

  return {
    tareaSnapshot: JSON.stringify(tareaSnapshot),
    comentariosSnapshot: JSON.stringify(comentarios),
    evidenciasSnapshot: JSON.stringify(evidencias),
  };
}

/**
 * Archiva un lote de tareas completadas que cumplan la antigüedad configurada.
 *
 * Garantías:
 * - Advisory lock: evita ejecuciones concurrentes (manual + automático).
 * - FOR UPDATE SKIP LOCKED: evita que dos procesos archiven la misma tarea.
 * - UNIQUE(tarea_id_original): red de seguridad adicional.
 * - Cada tarea se archiva en su propia transacción: si falla una, las demás continúan.
 * - Los archivos físicos de evidencia NO se eliminan; solo se migra metadata.
 *
 * @param {import('pg').Pool} pool
 * @param {Object} opts
 * @param {number} [opts.ejecutadoPor] - usuario_id; null para job automático
 * @param {string} [opts.tipo='automatico'] - 'automatico' | 'manual'
 * @param {number} [opts.batchSize=50] - tamaño del lote
 * @returns {Promise<Object>} resumen de la ejecución
 */
export async function ejecutarMigracion(pool, opts = {}) {
  const { ejecutadoPor = null, tipo = "automatico", batchSize = 50 } = opts;
  const inicio = Date.now();

  return withAdvisoryLock(pool, async (lockClient) => {
    const config = await getConfig(lockClient);
    if (tipo === "automatico" && !config.habilitado) {
      return {
        exitosas: 0,
        fallidas: 0,
        omitidas: 0,
        motivo: "archivo_automatico_deshabilitado",
      };
    }

    const detalles = { procesados: [], errores: [] };
    let exitosas = 0;
    let fallidas = 0;
    let bytesAntes = 0;
    let bytesDespues = 0;

    while (true) {
    const batchClient = await pool.connect();
    let batch = [];
    try {
      await batchClient.query("BEGIN");
      const res = await batchClient.query(
        `
          SELECT t.*,
                 (SELECT p.nombre FROM projects.proyectos p WHERE p.id = t.proyecto_id) AS proyecto_nombre
          FROM projects.tareas t
          WHERE t.estado = 'completada'
            AND t.completada_en < NOW() - INTERVAL '1 month' * $1
            AND NOT EXISTS (
              SELECT 1 FROM projects.tareas_archivadas a
              WHERE a.tarea_id_original = t.id
            )
          ORDER BY t.completada_en ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        `,
        [config.mesesParaArchivar, batchSize]
      );
      batch = res.rows;
      await batchClient.query("COMMIT");
    } catch (e) {
      await batchClient.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      batchClient.release();
    }

      if (batch.length === 0) break;

      for (const tarea of batch) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // Re-verificar que no fue archivada concurrentemente
          const exists = await client.query(
            "SELECT 1 FROM projects.tareas_archivadas WHERE tarea_id_original = $1 FOR UPDATE",
            [tarea.id]
          );
          if (exists.rows.length > 0) {
            await client.query("COMMIT");
            detalles.procesados.push({ id: tarea.id, accion: "ya_archivada" });
            continue;
          }

          const comRes = await client.query(
            "SELECT id, tarea_id, usuario_id, contenido, created_at FROM projects.comentarios WHERE tarea_id = $1 ORDER BY created_at ASC",
            [tarea.id]
          );
          const evRes = await client.query(
            "SELECT id, tarea_id, usuario_id, descripcion, archivo_nombre, archivo_path, archivo_tipo, archivo_tamanio, created_at FROM projects.evidencias WHERE tarea_id = $1 ORDER BY created_at ASC",
            [tarea.id]
          );

          const { tareaSnapshot, comentariosSnapshot, evidenciasSnapshot } =
            buildSnapshots(tarea, comRes.rows, evRes.rows);

          bytesAntes += Buffer.byteLength(tareaSnapshot, "utf8");
          bytesAntes += Buffer.byteLength(comentariosSnapshot, "utf8");
          bytesAntes += Buffer.byteLength(evidenciasSnapshot, "utf8");

          await client.query(
            `
            INSERT INTO projects.tareas_archivadas
              (tarea_id_original, proyecto_id_original, proyecto_nombre,
               tarea_snapshot, comentarios_snapshot, evidencias_snapshot,
               completada_en, archivada_por, meses_retencion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
            [
              tarea.id,
              tarea.proyecto_id,
              tarea.proyecto_nombre,
              tareaSnapshot,
              comentariosSnapshot,
              evidenciasSnapshot,
              tarea.completada_en,
              ejecutadoPor,
              config.mesesRetencion,
            ]
          );

          await client.query("DELETE FROM projects.tareas WHERE id = $1", [
            tarea.id,
          ]);

          bytesDespues += Buffer.byteLength(tareaSnapshot, "utf8");
          bytesDespues += Buffer.byteLength(comentariosSnapshot, "utf8");
          bytesDespues += Buffer.byteLength(evidenciasSnapshot, "utf8");

          await client.query("COMMIT");
          exitosas++;
          detalles.procesados.push({ id: tarea.id, accion: "archivada" });
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          fallidas++;
          detalles.errores.push({ id: tarea.id, error: err.message });
          console.error(`[archivo] Error archivando tarea ${tarea.id}:`, err);
        } finally {
          client.release();
        }
      }
    }

    const duracionMs = Date.now() - inicio;

    await pool.query(
      `
      INSERT INTO projects.archivo_log
        (ejecutado_por, tipo, tareas_archivadas, tareas_fallidas,
         bytes_antes, bytes_despues, duracion_ms, detalles)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
        ejecutadoPor,
        tipo,
        exitosas,
        fallidas,
        bytesAntes,
        bytesDespues,
        duracionMs,
        JSON.stringify(detalles),
      ]
    );

    return {
      exitosas,
      fallidas,
      bytesAntes,
      bytesDespues,
      duracionMs,
      tipo,
    };
  });
}

/**
 * Reactiva una tarea archivada creando una copia nueva en la tabla activa.
 * La tarea original en archivo se marca como restaurada y se vincula a la nueva.
 *
 * Garantías:
 * - Transacción única: nunca queda una tarea reactivada sin historial.
 * - Nuevo ID: no se reutiliza tarea_id_original.
 * - Se restauran comentarios y evidencias (metadata); archivos físicos ya existen.
 *
 * @param {import('pg').Pool} pool
 * @param {number} archivoId
 * @param {number} usuarioId - usuario que realiza la reactivación
 * @returns {Promise<Object>} { nuevaTareaId }
 */
export async function reactivarTareaArchivada(pool, archivoId, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const archRes = await client.query(
      `
      SELECT *
      FROM projects.tareas_archivadas
      WHERE id = $1
      FOR UPDATE
    `,
      [archivoId]
    );

    if (archRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("Tarea archivada no encontrada");
    }

    const arch = archRes.rows[0];
    if (arch.restaurada_como_id) {
      await client.query("ROLLBACK");
      throw new Error(
        `La tarea ya fue reactivada como #${arch.restaurada_como_id}`
      );
    }

    const snap = arch.tarea_snapshot;

    const tareaRes = await client.query(
      `
      INSERT INTO projects.tareas
        (proyecto_id, titulo, descripcion, tipo, prioridad, estado, columna,
         asignado_a, reportero, fecha_limite, estimacion_horas, horas_invertidas,
         orden, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'pendiente', 'pendiente',
              $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING id
    `,
      [
        snap.proyecto_id,
        snap.titulo,
        snap.descripcion,
        snap.tipo,
        snap.prioridad,
        snap.asignado_a,
        snap.reportero,
        snap.fecha_limite,
        snap.estimacion_horas,
        snap.horas_invertidas || 0,
        snap.orden || 0,
        snap.created_at || new Date().toISOString(),
      ]
    );

    const nuevaTareaId = tareaRes.rows[0].id;

    for (const c of arch.comentarios_snapshot || []) {
      await client.query(
        `
        INSERT INTO projects.comentarios
          (tarea_id, usuario_id, contenido, created_at)
        VALUES ($1, $2, $3, $4)
      `,
        [nuevaTareaId, c.usuario_id, c.contenido, c.created_at]
      );
    }

    for (const e of arch.evidencias_snapshot || []) {
      await client.query(
        `
        INSERT INTO projects.evidencias
          (tarea_id, usuario_id, descripcion, archivo_nombre, archivo_path,
           archivo_tipo, archivo_tamanio, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          nuevaTareaId,
          e.usuario_id,
          e.descripcion,
          e.archivo_nombre,
          e.archivo_path,
          e.archivo_tipo,
          e.archivo_tamanio,
          e.created_at,
        ]
      );
    }

    await client.query(
      `
      UPDATE projects.tareas_archivadas
      SET restaurada_como_id = $1, restaurada_en = NOW()
      WHERE id = $2
    `,
      [nuevaTareaId, archivoId]
    );

    await client.query("COMMIT");
    return { nuevaTareaId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Devuelve la fecha de la última ejecución automática exitosa (tareas).
 * Se usa para decidir si el job automático debe correr.
 */
export async function getUltimaEjecucionAutomatica(pool) {
  const res = await pool.query(
    `
    SELECT ejecutado_en
    FROM projects.archivo_log
    WHERE tipo = 'automatico' AND tareas_archivadas >= 0
    ORDER BY ejecutado_en DESC
    LIMIT 1
  `
  );
  return res.rows[0]?.ejecutado_en || null;
}

/**
 * Devuelve la fecha de la última ejecución automática exitosa (proyectos).
 */
export async function getUltimaEjecucionProyectos(pool) {
  const res = await pool.query(
    `
    SELECT ejecutado_en
    FROM projects.archivo_log
    WHERE tipo = 'proyecto' AND tareas_archivadas >= 0
    ORDER BY ejecutado_en DESC
    LIMIT 1
  `
  );
  return res.rows[0]?.ejecutado_en || null;
}

// ── Archivo de Proyectos ──────────────────────────────────────

function buildProyectoSnapshots(proyecto, tareasActivas, miembros, actas, tareasArchivadasRefs) {
  const proyectoSnapshot = {
    id: proyecto.id,
    nombre: proyecto.nombre,
    descripcion: proyecto.descripcion,
    estado: proyecto.estado,
    estado_aprobacion: proyecto.estado_aprobacion,
    fecha_limite: proyecto.fecha_limite,
    centro_id: proyecto.centro_id,
    asignado_a: proyecto.asignado_a,
    prioridad: proyecto.prioridad,
    aprobado_por: proyecto.aprobado_por,
    aprobado_en: proyecto.aprobado_en,
    created_at: proyecto.created_at,
    updated_at: proyecto.updated_at,
  };

  return {
    proyectoSnapshot: JSON.stringify(proyectoSnapshot),
    tareasActivasSnapshot: JSON.stringify(tareasActivas),
    tareasArchivadasRefs: JSON.stringify(tareasArchivadasRefs),
    miembrosSnapshot: JSON.stringify(miembros),
    actasSnapshot: JSON.stringify(actas),
  };
}

/**
 * Archiva un proyecto completado/aprobado con snapshot de tareas, miembros y actas.
 *
 * @param {import('pg').Pool} pool
 * @param {Object} opts
 * @param {number} opts.proyectoId
 * @param {number} [opts.ejecutadoPor] - usuario_id; null para job automático
 * @param {string} [opts.tipo='manual'] - 'automatico' | 'manual'
 * @returns {Promise<Object>} resumen
 */
export async function archivarProyecto(pool, opts) {
  const { proyectoId, ejecutadoPor = null, tipo = "manual" } = opts;
  const inicio = Date.now();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verificar que el proyecto existe y está listo para archivar
    const proyRes = await client.query(
      `SELECT * FROM projects.proyectos WHERE id = $1 FOR UPDATE`,
      [proyectoId]
    );
    if (proyRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("Proyecto no encontrado");
    }
    const proyecto = proyRes.rows[0];

    if (proyecto.estado !== "completado" || proyecto.estado_aprobacion !== "aprobada") {
      await client.query("ROLLBACK");
      throw new Error("El proyecto debe estar completado y aprobado para archivarlo");
    }

    // Verificar que no esté ya archivado
    const existsRes = await client.query(
      "SELECT 1 FROM projects.proyectos_archivadas WHERE proyecto_id_original = $1",
      [proyectoId]
    );
    if (existsRes.rows.length > 0) {
      await client.query("ROLLBACK");
      throw new Error("El proyecto ya fue archivado");
    }

    // Obtener tareas activas
    const tareasRes = await client.query(
      `SELECT t.*,
              json_agg(json_build_object(
                'id', c.id, 'usuario_id', c.usuario_id,
                'contenido', c.contenido, 'created_at', c.created_at
              ) ORDER BY c.created_at) FILTER (WHERE c.id IS NOT NULL) AS comentarios,
              json_agg(json_build_object(
                'id', e.id, 'usuario_id', e.usuario_id, 'descripcion', e.descripcion,
                'archivo_nombre', e.archivo_nombre, 'archivo_path', e.archivo_path,
                'archivo_tipo', e.archivo_tipo, 'archivo_tamanio', e.archivo_tamanio,
                'created_at', e.created_at
              ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL) AS evidencias
       FROM projects.tareas t
       LEFT JOIN projects.comentarios c ON c.tarea_id = t.id
       LEFT JOIN projects.evidencias e ON e.tarea_id = t.id
       WHERE t.proyecto_id = $1
       GROUP BY t.id
       ORDER BY t.orden, t.created_at`,
      [proyectoId]
    );
    const tareasActivas = tareasRes.rows.map((t) => ({
      tarea: {
        id: t.id, titulo: t.titulo, descripcion: t.descripcion,
        tipo: t.tipo, prioridad: t.prioridad, estado: t.estado,
        columna: t.columna, asignado_a: t.asignado_a, reportero: t.reportero,
        fecha_limite: t.fecha_limite, estimacion_horas: t.estimacion_horas,
        horas_invertidas: t.horas_invertidas, orden: t.orden,
        estado_aprobacion: t.estado_aprobacion, aprobado_por: t.aprobado_por,
        aprobado_en: t.aprobado_en, motivo_rechazo: t.motivo_rechazo,
        created_at: t.created_at, updated_at: t.updated_at, completada_en: t.completada_en,
      },
      comentarios: t.comentarios || [],
      evidencias: t.evidencias || [],
    }));

    // Referencias a tareas ya archivadas individualmente
    const archRefsRes = await client.query(
      `SELECT id, tarea_id_original, tarea_snapshot->>'titulo' AS titulo
       FROM projects.tareas_archivadas
       WHERE proyecto_id_original = $1 AND restaurada_como_id IS NULL`,
      [proyectoId]
    );
    const tareasArchivadasRefs = archRefsRes.rows;

    // Obtener miembros
    let miembros = [];
    try {
      const miembrosRes = await client.query(
        "SELECT usuario_id, rol FROM projects.proyecto_miembros WHERE proyecto_id = $1",
        [proyectoId]
      );
      miembros = miembrosRes.rows;
    } catch {}

    // Obtener actas
    const actasRes = await client.query(
      "SELECT cerrado_por, observaciones, resumen_ejecutivo, created_at FROM projects.actas_cierre WHERE proyecto_id = $1",
      [proyectoId]
    );

    const snapshots = buildProyectoSnapshots(
      proyecto, tareasActivas, miembros, actasRes.rows, tareasArchivadasRefs
    );

    // Insertar en archivo
    await client.query(
      `
      INSERT INTO projects.proyectos_archivadas
        (proyecto_id_original, proyecto_snapshot, tareas_activas_snapshot,
         tareas_archivadas_refs, miembros_snapshot, actas_snapshot,
         completado_en, archivada_por, meses_retencion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
      [
        proyectoId,
        snapshots.proyectoSnapshot,
        snapshots.tareasActivasSnapshot,
        snapshots.tareasArchivadasRefs,
        snapshots.miembrosSnapshot,
        snapshots.actasSnapshot,
        proyecto.aprobado_en,
        ejecutadoPor,
        24,
      ]
    );

    // Eliminar proyecto (CASCADE elimina tareas activas, miembros, actas)
    await client.query("DELETE FROM projects.proyectos WHERE id = $1", [proyectoId]);

    await client.query("COMMIT");

    const duracionMs = Date.now() - inicio;

    // Log
    await pool.query(
      `
      INSERT INTO projects.archivo_log
        (ejecutado_por, tipo, tareas_archivadas, tareas_fallidas,
         bytes_antes, bytes_despues, duracion_ms, detalles)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
        ejecutadoPor,
        tipo,
        tareasActivas.length,
        0,
        0,
        0,
        duracionMs,
        JSON.stringify({ proyecto_id: proyectoId, tareas: tareasActivas.length, miembros: miembros.length, actas: actasRes.rows.length }),
      ]
    );

    return {
      exitosas: 1,
      fallidas: 0,
      tareasIncluidas: tareasActivas.length,
      tareasArchivadasRefs: tareasArchivadasRefs.length,
      duracionMs,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reactiva un proyecto archivado creando una copia nueva.
 *
 * @param {import('pg').Pool} pool
 * @param {number} archivoId - ID en proyectos_archivadas
 * @param {number} usuarioId - usuario que reactiva
 * @param {Object} [opts]
 * @param {boolean} [opts.restaurarTareasArchivadas=false] - restaurar tareas archivadas individualmente
 * @returns {Promise<Object>} { nuevoProyectoId, tareasRestauradas }
 */
export async function reactivarProyectoArchivado(pool, archivoId, usuarioId, opts = {}) {
  const { restaurarTareasArchivadas = false } = opts;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const archRes = await client.query(
      `SELECT * FROM projects.proyectos_archivadas WHERE id = $1 FOR UPDATE`,
      [archivoId]
    );
    if (archRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("Proyecto archivado no encontrado");
    }
    const arch = archRes.rows[0];
    if (arch.restaurada_como_id) {
      await client.query("ROLLBACK");
      throw new Error(`El proyecto ya fue restaurado como #${arch.restaurada_como_id}`);
    }

    const snap = arch.proyecto_snapshot;

    // 1. Crear nuevo proyecto
    const proyRes = await client.query(
      `
      INSERT INTO projects.proyectos
        (nombre, descripcion, estado, estado_aprobacion, fecha_limite,
         centro_id, asignado_a, prioridad, aprobado_por, aprobado_en, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING id
    `,
      [
        snap.nombre,
        snap.descripcion,
        snap.estado || "activo",
        snap.estado_aprobacion || "pendiente",
        snap.fecha_limite,
        snap.centro_id,
        snap.asignado_a,
        snap.prioridad || "media",
        snap.aprobado_por,
        snap.aprobado_en,
        snap.created_at || new Date().toISOString(),
      ]
    );
    const nuevoProyectoId = proyRes.rows[0].id;

    // 2. Restaurar miembros
    for (const m of arch.miembros_snapshot || []) {
      await client.query(
        `INSERT INTO projects.proyecto_miembros (proyecto_id, usuario_id, rol)
         VALUES ($1, $2, $3)
         ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = $3`,
        [nuevoProyectoId, m.usuario_id, m.rol]
      );
    }

    // 3. Restaurar tareas activas del snapshot
    let tareasRestauradas = 0;
    for (const ta of arch.tareas_activas_snapshot || []) {
      const tarea = ta.tarea;
      const nuevaTareaRes = await client.query(
        `
        INSERT INTO projects.tareas
          (proyecto_id, titulo, descripcion, tipo, prioridad, estado, columna,
           asignado_a, reportero, fecha_limite, estimacion_horas, horas_invertidas,
           orden, estado_aprobacion, aprobado_por, aprobado_en, motivo_rechazo,
           created_at, updated_at, completada_en)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), $19)
        RETURNING id
      `,
        [
          nuevoProyectoId, tarea.titulo, tarea.descripcion, tarea.tipo,
          tarea.prioridad, tarea.estado, tarea.columna,
          tarea.asignado_a, tarea.reportero, tarea.fecha_limite,
          tarea.estimacion_horas, tarea.horas_invertidas || 0,
          tarea.orden || 0, tarea.estado_aprobacion, tarea.aprobado_por,
          tarea.aprobado_en, tarea.motivo_rechazo,
          tarea.created_at || new Date().toISOString(), tarea.completada_en,
        ]
      );
      const nuevaTareaId = nuevaTareaRes.rows[0].id;

      // Restaurar comentarios de la tarea
      for (const c of ta.comentarios || []) {
        await client.query(
          `INSERT INTO projects.comentarios (tarea_id, usuario_id, contenido, created_at)
           VALUES ($1, $2, $3, $4)`,
          [nuevaTareaId, c.usuario_id, c.contenido, c.created_at]
        );
      }

      // Restaurar evidencias de la tarea
      for (const e of ta.evidencias || []) {
        await client.query(
          `INSERT INTO projects.evidencias
            (tarea_id, usuario_id, descripcion, archivo_nombre, archivo_path,
             archivo_tipo, archivo_tamanio, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [nuevaTareaId, e.usuario_id, e.descripcion, e.archivo_nombre,
           e.archivo_path, e.archivo_tipo, e.archivo_tamanio, e.created_at]
        );
      }

      tareasRestauradas++;
    }

    // 4. Restaurar actas de cierre
    for (const a of arch.actas_snapshot || []) {
      await client.query(
        `INSERT INTO projects.actas_cierre (proyecto_id, cerrado_por, observaciones, resumen_ejecutivo, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [nuevoProyectoId, a.cerrado_por, a.observaciones, a.resumen_ejecutivo, a.created_at]
      );
    }

    // 5. Restaurar tareas archivadas individualmente (opcional)
    let tareasArchivadasRestauradas = 0;
    if (restaurarTareasArchivadas) {
      const refsArchRes = await client.query(
        `SELECT * FROM projects.tareas_archivadas
         WHERE proyecto_id_original = $1 AND restaurada_como_id IS NULL`,
        [arch.proyecto_id_original]
      );
      for (const ref of refsArchRes.rows) {
        const tsnap = ref.tarea_snapshot;
        const nuevaTareaRes = await client.query(
          `
          INSERT INTO projects.tareas
            (proyecto_id, titulo, descripcion, tipo, prioridad, estado, columna,
             asignado_a, reportero, fecha_limite, estimacion_horas, horas_invertidas,
             orden, estado_aprobacion, aprobado_por, aprobado_en, motivo_rechazo,
             created_at, updated_at, completada_en)
          VALUES ($1, $2, $3, $4, $5, 'pendiente', 'pendiente',
                  $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), $17)
          RETURNING id
        `,
          [
            nuevoProyectoId, tsnap.titulo, tsnap.descripcion, tsnap.tipo,
            tsnap.prioridad, tsnap.asignado_a, tsnap.reportero,
            tsnap.fecha_limite, tsnap.estimacion_horas,
            tsnap.horas_invertidas || 0, tsnap.orden || 0,
            tsnap.estado_aprobacion, tsnap.aprobado_por, tsnap.aprobado_en,
            tsnap.motivo_rechazo, tsnap.created_at || new Date().toISOString(),
            tsnap.completada_en,
          ]
        );
        const nuevaTareaId = nuevaTareaRes.rows[0].id;

        // Restaurar comentarios
        for (const c of ref.comentarios_snapshot || []) {
          await client.query(
            `INSERT INTO projects.comentarios (tarea_id, usuario_id, contenido, created_at)
             VALUES ($1, $2, $3, $4)`,
            [nuevaTareaId, c.usuario_id, c.contenido, c.created_at]
          );
        }
        // Restaurar evidencias
        for (const e of ref.evidencias_snapshot || []) {
          await client.query(
            `INSERT INTO projects.evidencias
              (tarea_id, usuario_id, descripcion, archivo_nombre, archivo_path,
               archivo_tipo, archivo_tamanio, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [nuevaTareaId, e.usuario_id, e.descripcion, e.archivo_nombre,
             e.archivo_path, e.archivo_tipo, e.archivo_tamanio, e.created_at]
          );
        }

        // Marcar como restaurada en archivo
        await client.query(
          `UPDATE projects.tareas_archivadas
           SET restaurada_como_id = $1, restaurada_en = NOW()
           WHERE id = $2`,
          [nuevaTareaId, ref.id]
        );
        tareasArchivadasRestauradas++;
      }
    }

    // 6. Marcar proyecto como restaurado
    await client.query(
      `UPDATE projects.proyectos_archivadas
       SET restaurada_como_id = $1, restaurada_en = NOW()
       WHERE id = $2`,
      [nuevoProyectoId, archivoId]
    );

    await client.query("COMMIT");
    return { nuevoProyectoId, tareasRestauradas, tareasArchivadasRestauradas };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
