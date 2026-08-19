import {
  ejecutarMigracion,
  getUltimaEjecucionAutomatica,
  getUltimaEjecucionProyectos,
  archivarProyecto,
} from './archivoService.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // revisar cada 6 horas
const MIN_DAYS_BETWEEN_RUNS = 28; // mínimo 28 días entre ejecuciones automáticas

export function startArchivarJob(pool) {
  if (!pool) {
    console.error('[archivar-job] Pool no proporcionado; job no iniciado');
    return;
  }

  async function checkTareas() {
    try {
      const ultima = await getUltimaEjecucionAutomatica(pool);
      if (ultima) {
        const diasDesde =
          (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24);
        if (diasDesde < MIN_DAYS_BETWEEN_RUNS) {
          return;
        }
      }

      console.log('[archivar-job] Iniciando archivado automático de tareas');
      const resultado = await ejecutarMigracion(pool, {
        ejecutadoPor: null,
        tipo: 'automatico',
        batchSize: 50,
      });
      console.log('[archivar-job] Archivado de tareas finalizado:', resultado);
    } catch (err) {
      console.error('[archivar-job] Error en archivado de tareas:', err);
    }
  }

  async function checkProyectos() {
    try {
      const ultima = await getUltimaEjecucionProyectos(pool);
      if (ultima) {
        const diasDesde =
          (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24);
        if (diasDesde < MIN_DAYS_BETWEEN_RUNS) {
          return;
        }
      }

      // Verificar si el archivado de proyectos está habilitado
      const configRes = await pool.query(
        `SELECT valor FROM projects.archivo_config WHERE clave = 'habilitado_proyectos'`
      );
      const habilitado = configRes.rows[0]?.valor !== 'false';
      if (!habilitado) return;

      // Obtener meses de config
      const mesesRes = await pool.query(
        `SELECT valor FROM projects.archivo_config WHERE clave = 'meses_para_archivar_proyectos'`
      );
      const meses = parseInt(mesesRes.rows[0]?.valor) || 3;

      // Buscar proyectos completados + aprobados listos para archivar
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
         ORDER BY p.aprobado_en ASC
         LIMIT 10`,
        [meses]
      );

      if (proyectosRes.rows.length === 0) return;

      console.log(`[archivar-job] Iniciando archivado automático de ${proyectosRes.rows.length} proyecto(s)`);
      let exitosos = 0;
      let fallidos = 0;

      for (const proy of proyectosRes.rows) {
        try {
          await archivarProyecto(pool, {
            proyectoId: proy.id,
            ejecutadoPor: null,
            tipo: 'proyecto',
          });
          exitosos++;
        } catch (err) {
          fallidos++;
          console.error(`[archivar-job] Error archivando proyecto ${proy.id}:`, err.message);
        }
      }

      console.log(`[archivar-job] Archivado de proyectos finalizado: ${exitosos} exitosos, ${fallidos} fallidos`);
    } catch (err) {
      console.error('[archivar-job] Error en archivado de proyectos:', err);
    }
  }

  async function check() {
    await checkTareas();
    await checkProyectos();
  }

  // Ejecutar una primera comprobación al iniciar, pero sin bloquear el arranque
  check().catch(() => {});

  setInterval(check, CHECK_INTERVAL_MS);
}
