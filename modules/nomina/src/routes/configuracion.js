const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = process.cwd();
const UPDATER_LOG = path.join(APP_DIR, 'logs', 'updater.log');

function logUpdater(msg) {
  const logLine = `[${new Date().toISOString()}] ${msg}`;
  console.log('[UPDATER]', logLine);
  try {
    const logsDir = path.join(APP_DIR, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(UPDATER_LOG, logLine + '\n');
  } catch (e) { console.log('[UPDATER] error writing log:', e.message); }
  return logLine;
}

function getUpdaterLog() {
  try {
    if (fs.existsSync(UPDATER_LOG)) {
      const lines = fs.readFileSync(UPDATER_LOG, 'utf8').split('\n').filter(l => l.trim()).slice(-100);
      return lines.join('\n') || 'Sin registros';
    }
  } catch (e) { console.log('[UPDATER] error reading log:', e.message); }
  return 'Sin registros';
}

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
    const campos = ['smtp_host','smtp_puerto','smtp_tls','smtp_usuario','smtp_password','smtp_remitente','reset_asunto','reset_cuerpo','smtp_heredar','launcher_url'];
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
      await enviarCorreo(req.usuario.email, 'Prueba SMTP — Horix',
        `Hola ${req.usuario.nombre},\n\nEsta es una prueba de conexión SMTP desde Horix.\n\nSi recibes este mensaje, la configuración es correcta ✓\n\nSaludos,\nEquipo HORIX`);
      res.json({ ok: true });
    } catch (e) {
      console.error('Error prueba SMTP:', e.message);
      res.status(500).json({ error: 'Error de conexión SMTP. Verifica la configuración.' });
    }
  });

  // ── UPDATER ──

  router.get('/updater/status', soloAdmin, async (req, res) => {
    try {
      const gitBranch = execSync('git branch --show-current 2>/dev/null || echo "-"', { cwd: APP_DIR }).toString().trim();
      const gitCommit = execSync('git rev-parse --short HEAD 2>/dev/null || echo "-"', { cwd: APP_DIR }).toString().trim();
      const gitRemote = execSync('git remote get-url origin 2>/dev/null || echo "-"', { cwd: APP_DIR }).toString().trim();
      const lastUpdate = fs.existsSync(path.join(APP_DIR, '.last-update'))
        ? fs.readFileSync(path.join(APP_DIR, '.last-update'), 'utf8').trim() : null;
      res.json({ ok: true, branch: gitBranch, commit: gitCommit, remote: gitRemote, lastUpdate, updaterLog: getUpdaterLog() });
    } catch (err) { res.json({ ok: false, error: err.message }); }
  });

  router.post('/updater/check', soloAdmin, async (req, res) => {
    try {
      logUpdater('Verificando actualizaciones...');
      execSync('git fetch origin --prune', { cwd: APP_DIR, stdio: 'pipe' });
      const currentCommit = execSync('git rev-parse --short HEAD', { cwd: APP_DIR }).toString().trim();
      const remoteCommit = execSync('git rev-parse --short origin/main', { cwd: APP_DIR }).toString().trim();
      logUpdater(`Local: ${currentCommit} | Remote: ${remoteCommit}`);
      const behind = currentCommit !== remoteCommit ? 1 : 0;
      let changes = [];
      if (behind > 0) { logUpdater(`Nueva versión disponible: ${remoteCommit}`); changes = [remoteCommit]; }
      else { logUpdater('Sistema actualizado'); }
      res.json({ ok: true, hasUpdates: behind > 0, commitsBehind: behind, currentCommit, remoteCommit, changes });
    } catch (err) { logUpdater(`Error verificando: ${err.message}`); res.json({ ok: false, error: err.message }); }
  });

  router.post('/updater/update', soloAdmin, async (req, res) => {
    let branch = req.body?.branch || 'main';
    const allowedBranches = ['main', 'master', 'release'];
    if (!allowedBranches.includes(branch)) branch = 'main';
    try {
      logUpdater('INICIANDO ACTUALIZACION (rama: ' + branch + ')');
      logUpdater('Fetch y reset a origin/' + branch + '...');
      execSync('git fetch origin && git reset --hard origin/' + branch, { cwd: APP_DIR, stdio: 'pipe' });
      logUpdater('Reset hard completado');
      logUpdater('Instalando dependencias...');
      try { await asyncExec('npm install --production'); logUpdater('Dependencias instaladas'); } catch (e) { logUpdater('npm install: ' + e.message); }
      try { execSync('npm run migrate', { cwd: APP_DIR, stdio: 'pipe' }); logUpdater('Migraciones ejecutadas'); } catch (e) { logUpdater('Migraciones: ' + e.message); }
      const newCommit = execSync('git rev-parse --short HEAD', { cwd: APP_DIR }).toString().trim();
      logUpdater('ACTUALIZACION COMPLETADA - Commit: ' + newCommit);
      fs.writeFileSync(path.join(APP_DIR, '.last-update'), new Date().toISOString());
      res.json({ ok: true, message: 'Actualización completada', newCommit });
    } catch (err) { logUpdater('ERROR: ' + err.message); res.json({ ok: false, error: err.message }); }
  });

  router.post('/updater/restart', soloAdmin, async (req, res) => {
    try {
      logUpdater('Reiniciando servicio...');
      execSync('pm2 restart horix', { cwd: APP_DIR, stdio: 'pipe' });
      logUpdater('Servicio reiniciado');
      res.json({ ok: true, message: 'Servicio reiniciado' });
    } catch (err) { logUpdater('ERROR restart: ' + err.message); res.json({ ok: false, error: err.message }); }
  });

  router.get('/updater/logs', soloAdmin, (req, res) => {
    res.json({ log: getUpdaterLog() });
  });

  return router;
};
