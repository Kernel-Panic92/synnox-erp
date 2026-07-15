const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'logs', 'sync-state.json');

let syncState = {
  ultimoSync: null,
  sincronizando: false,
  totalMensajes: 0,
  procesando: 0,
  creadas: 0,
  duplicadas: 0,
  errores: 0,
  mensaje: ''
};

function cargarEstado() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      syncState = JSON.parse(data);
    }
  } catch (e) {
    // Ignorar errores
  }
  return syncState;
}

function guardarEstado() {
  try {
    const logsDir = path.dirname(STATE_FILE);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(syncState, null, 2));
  } catch (e) {
    console.error('[SyncState] Error guardando:', e.message);
  }
}

function iniciarSync(totalMensajes) {
  syncState.sincronizando = true;
  syncState._startedAt = Date.now();
  syncState.totalMensajes = totalMensajes;
  syncState._startTime = Date.now();
  syncState.procesando = 0;
  syncState.creadas = 0;
  syncState.duplicadas = 0;
  syncState.errores = 0;
  syncState.mensaje = `Procesando ${totalMensajes} mensajes...`;
  guardarEstado();
}

function actualizarProgreso(procesando, creadas, duplicadas, errores, mensaje) {
  syncState.procesando = procesando;
  syncState.creadas = creadas;
  syncState.duplicadas = duplicadas;
  syncState.errores = errores;
  syncState.mensaje = mensaje;
  guardarEstado();
}

function terminarSync(creadas, duplicadas, errores) {
  syncState.sincronizando = false;
  syncState.ultimoSync = new Date().toISOString();
  syncState.creadas = creadas;
  syncState.duplicadas = duplicadas;
  syncState.errores = errores;
  syncState.mensaje = `Completado: ${creadas} creadas, ${duplicadas} duplicadas, ${errores} errores`;
  guardarEstado();
}

function obtenerEstado() {
  const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  
  // Auto-reset if stuck: syncing but no progress for too long
  if (syncState.sincronizando && syncState._startedAt) {
    const elapsed = Date.now() - syncState._startedAt;
    const noProgress = syncState.procesando === 0 && syncState.totalMensajes > 0;
    if (noProgress && elapsed > STUCK_TIMEOUT_MS) {
      console.error('[SyncState] Sync stuck — auto-resetting after', Math.round(elapsed/1000), 's with no progress');
      syncState.sincronizando = false;
      syncState.mensaje = 'Sincronización cancelada por timeout (sin progreso por 10 minutos)';
      syncState.errores = syncState.totalMensajes;
      guardarEstado();
    }
  }
  
  // Calculate ETA
  let eta = null;
  if (syncState.sincronizando && syncState._startTime && syncState.procesando > 0 && syncState.totalMensajes > 0) {
    const elapsed = Date.now() - syncState._startTime;
    const perMessage = elapsed / syncState.procesando;
    const remaining = syncState.totalMensajes - syncState.procesando;
    const etaMs = remaining * perMessage;
    eta = new Date(Date.now() + etaMs).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  
  return { ...syncState, eta };
}

function reset() {
  syncState = {
    ultimoSync: null,
    sincronizando: false,
    totalMensajes: 0,
    procesando: 0,
    creadas: 0,
    duplicadas: 0,
    errores: 0,
    mensaje: ''
  };
  guardarEstado();
  console.log('[SyncState] Estado reiniciado manualmente');
}

module.exports = {
  cargarEstado,
  iniciarSync,
  actualizarProgreso,
  terminarSync,
  obtenerEstado,
  reset
};
