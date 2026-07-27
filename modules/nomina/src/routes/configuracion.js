const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = process.cwd();
function asyncExec(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: APP_DIR, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

module.exports = function createConfiguracionRouter({ db, getConfig, encryptSmtp, enviarCorreo, middlewares }) {
  const router = express.Router();
  const { soloAdmin } = middlewares;

  router.get('/', soloAdmin, (req, res) => {
    const cfg = getConfig();
    res.json({ ...cfg, smtp_password: cfg.smtp_password ? '••••••••' : '' });
  });

  router.put('/', soloAdmin, (req, res) => {
    const campos = ['smtp_host','smtp_puerto','smtp_tls','smtp_usuario','smtp_password','smtp_remitente','reset_asunto','reset_cuerpo','smtp_heredar','launcher_url','calendario_habilitado','calendario_dias_quincenal','calendario_dias_mensual','calendario_dias_semanal'];
    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        if (campo === 'smtp_password' && req.body[campo].includes('•')) continue;
        const valor = campo === 'smtp_password' ? encryptSmtp(req.body[campo]) : req.body[campo];
        db.prepare('INSERT OR REPLACE INTO configuracion VALUES (?,?)').run(campo, valor);
      }
    }
    res.json({ ok: true });
  });

  router.post('/test', soloAdmin, async (req, res) => {
    try {
      const APP_NAME = process.env.APP_NAME || 'Nómina';
      await enviarCorreo(req.usuario.email, `Prueba SMTP — ${APP_NAME}`,
        `Hola ${req.usuario.nombre},\n\nEsta es una prueba de conexión SMTP desde ${APP_NAME}.\n\nSi recibes este mensaje, la configuración es correcta ✓\n\nSaludos,\nEquipo ${APP_NAME}`);
      res.json({ ok: true });
    } catch (e) {
      console.error('Error prueba SMTP:', e.message);
      res.status(500).json({ error: 'Error de conexión SMTP. Verifica la configuración.' });
    }
  });

  return router;
};
