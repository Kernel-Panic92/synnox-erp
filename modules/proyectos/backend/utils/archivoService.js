/**
 * Servicio de archivo de tareas completadas.
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
          SELECT t.*, p.nombre AS proyecto_nombre
          FROM projects.tareas t
          LEFT JOIN projects.proyectos p ON p.id = t.proyecto_id
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
 * Devuelve la fecha de la última ejecución automática exitosa.
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
