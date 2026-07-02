const router = require('express').Router();
const { authMiddleware, requireRol } = require('../middleware/auth');
const syncState = require('../services/sync-state');

router.use(authMiddleware);
syncState.cargarEstado();

router.get('/status', async (req, res) => {
  const estado = syncState.obtenerEstado();
  
  let ultimoSyncFormateado = null;
  let proximaSyncFormateado = null;
  if (estado.ultimoSync) {
    const fecha = new Date(estado.ultimoSync);
    ultimoSyncFormateado = fecha.toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    // Calculate next sync time
    const minutos = parseInt(process.env.IMAP_POLL_MINUTES || '5');
    const proxima = new Date(fecha.getTime() + minutos * 60 * 1000);
    proximaSyncFormateado = proxima.toLocaleString('es-CO', {
      hour: '2-digit', minute: '2-digit'
    });
  }
  
  res.json({
    sincronizando: estado.sincronizando,
    ultimoSync: estado.ultimoSync,
    ultimoSyncFormateado,
    proximaSyncFormateado,
    totalMensajes: estado.totalMensajes,
    procesando: estado.procesando,
    creadas: estado.creadas,
    duplicadas: estado.duplicadas,
    errores: estado.errores,
    mensaje: estado.mensaje,
    eta: estado.eta,
    progreso: estado.totalMensajes > 0 
      ? Math.round((estado.procesando / estado.totalMensajes) * 100) 
      : 0
  });
});

router.post('/', requireRol('admin', 'contador'), (req, res) => {
  if (syncState.obtenerEstado().sincronizando) {
    return res.status(409).json({ error: 'Ya hay una sincronización en progreso' });
  }
  
  try {
    const imapService = require('../services/imap.service');
    if (imapService.pollCorreo) {
      const timeout = setTimeout(() => {
        console.error('[Sync] Timeout after 5 minutes');
        syncState.terminarSync(0, 0, 1);
      }, 5 * 60 * 1000);
      
      imapService.pollCorreo(req.body.rescanAll || false)
        .then(() => clearTimeout(timeout))
        .catch(e => {
          clearTimeout(timeout);
          console.error('[Sync] Error en poll manual:', e.message);
          syncState.terminarSync(0, 0, 1);
        });
    }
    res.json({ ok: true, mensaje: 'Sincronización iniciada (descarga + procesamiento)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process only (no IMAP download)
router.post('/process', requireRol('admin'), async (req, res) => {
  try {
    const imapService = require('../services/imap.service');
    if (imapService.processDownloadedEmails) {
      const resultado = await imapService.processDownloadedEmails();
      res.json({ ok: true, ...resultado });
    } else {
      res.status(500).json({ error: 'Función no disponible' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset sync state (for stuck syncs)
router.post('/reset', requireRol('admin'), (req, res) => {
  syncState.reset();
  res.json({ ok: true, mensaje: 'Estado de sincronización reiniciado' });
});

module.exports = router;
