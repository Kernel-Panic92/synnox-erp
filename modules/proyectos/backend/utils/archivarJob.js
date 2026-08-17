import { ejecutarMigracion, getUltimaEjecucionAutomatica } from './archivoService.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // revisar cada 6 horas
const MIN_DAYS_BETWEEN_RUNS = 28; // mínimo 28 días entre ejecuciones automáticas

export function startArchivarJob(pool) {
  if (!pool) {
    console.error('[archivar-job] Pool no proporcionado; job no iniciado');
    return;
  }

  async function check() {
    try {
      const ultima = await getUltimaEjecucionAutomatica(pool);
      if (ultima) {
        const diasDesde =
          (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24);
        if (diasDesde < MIN_DAYS_BETWEEN_RUNS) {
          return;
        }
      }

      console.log('[archivar-job] Iniciando migración automática');
      const resultado = await ejecutarMigracion(pool, {
        ejecutadoPor: null,
        tipo: 'automatico',
        batchSize: 50,
      });
      console.log('[archivar-job] Migración automática finalizada:', resultado);
    } catch (err) {
      console.error('[archivar-job] Error en migración automática:', err);
    }
  }

  // Ejecutar una primera comprobación al iniciar, pero sin bloquear el arranque
  check().catch(() => {});

  setInterval(check, CHECK_INTERVAL_MS);
}
