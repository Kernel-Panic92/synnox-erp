import express from 'express';
import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..', '..');
const UPDATER_LOG = path.join(APP_DIR, 'logs', 'updater.log');

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

function logUpdater(msg) {
  const logLine = `[${new Date().toISOString()}] ${msg}`;
  console.log('[UPDATER]', logLine);
  try {
    const logsDir = path.join(APP_DIR, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(UPDATER_LOG, logLine + '\n');
  } catch {}
  return logLine;
}

function getUpdaterLog() {
  try {
    if (fs.existsSync(UPDATER_LOG)) {
      return fs.readFileSync(UPDATER_LOG, 'utf8').split('\n').filter(l => l.trim()).slice(-100).join('\n') || 'Sin registros';
    }
  } catch {}
  return 'Sin registros';
}

function asyncExec(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: APP_DIR, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(err.message));
      else resolve(stdout);
    });
  });
}

router.get('/status', soloAdmin, async (req, res) => {
  try {
    const gitBranch = execSync('git branch --show-current 2>/dev/null || echo "-"', { cwd: APP_DIR }).toString().trim();
    const gitCommit = execSync('git rev-parse --short HEAD 2>/dev/null || echo "-"', { cwd: APP_DIR }).toString().trim();
    const gitRemote = execSync('git remote get-url origin 2>/dev/null || echo "-"', { cwd: APP_DIR }).toString().trim();
    const lastUpdate = fs.existsSync(path.join(APP_DIR, '.last-update'))
      ? fs.readFileSync(path.join(APP_DIR, '.last-update'), 'utf8').trim() : null;
    res.json({ ok: true, branch: gitBranch, commit: gitCommit, remote: gitRemote, lastUpdate, updaterLog: getUpdaterLog() });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

function obtenerRama() {
  try { return execSync('git branch --show-current', { cwd: APP_DIR }).toString().trim(); } catch { return 'master'; }
}

router.post('/check', soloAdmin, async (req, res) => {
  try {
    const branch = obtenerRama();
    logUpdater('Verificando actualizaciones...');
    execSync('git fetch origin --prune', { cwd: APP_DIR, stdio: 'pipe' });
    const currentCommit = execSync('git rev-parse --short HEAD', { cwd: APP_DIR }).toString().trim();
    const remoteCommit = execSync(`git rev-parse --short origin/${branch}`, { cwd: APP_DIR }).toString().trim();
    logUpdater(`Local: ${currentCommit} | Remote: ${remoteCommit} (rama: ${branch})`);
    const behind = currentCommit !== remoteCommit ? 1 : 0;
    let changes = [];
    if (behind > 0) {
      logUpdater(`Nueva versión disponible: ${remoteCommit}`);
      try {
        const logOut = execSync(`git log --oneline HEAD..origin/${branch}`, { cwd: APP_DIR, stdio: 'pipe' }).toString().trim();
        changes = logOut ? logOut.split('\n') : [remoteCommit];
      } catch { changes = [remoteCommit]; }
    } else { logUpdater('Sistema actualizado'); }
    res.json({ ok: true, hasUpdates: behind > 0, commitsBehind: behind, currentCommit, remoteCommit, changes });
  } catch (err) { logUpdater(`Error verificando: ${err.message}`); res.json({ ok: false, error: err.message }); }
});

router.post('/update', soloAdmin, async (req, res) => {
  const branch = obtenerRama();
  try {
    logUpdater('========================================');
    logUpdater('INICIANDO ACTUALIZACION (rama: ' + branch + ')');
    logUpdater('========================================');
    logUpdater('Fetch y reset a origin/' + branch + '...');
    execSync('git fetch origin && git reset --hard origin/' + branch, { cwd: APP_DIR, stdio: 'pipe' });
    logUpdater('Reset hard completado');
    logUpdater('Instalando dependencias...');
    try { await asyncExec('npm install --production'); logUpdater('Dependencias instaladas'); } catch (e) { logUpdater('npm install: ' + e.message); }
    logUpdater('Ejecutando migraciones...');
    try { execSync('npm run db:migrate', { cwd: APP_DIR, stdio: 'pipe' }); logUpdater('Migraciones ejecutadas'); } catch (e) { logUpdater('Migraciones: ' + e.message); }
    const newCommit = execSync('git rev-parse --short HEAD', { cwd: APP_DIR }).toString().trim();
    logUpdater('========================================');
    logUpdater('ACTUALIZACION COMPLETADA - Commit: ' + newCommit);
    logUpdater('========================================');
    fs.writeFileSync(path.join(APP_DIR, '.last-update'), new Date().toISOString());
    res.json({ ok: true, message: 'Actualización completada', newCommit });
  } catch (err) { logUpdater('ERROR: ' + err.message); res.json({ ok: false, error: err.message }); }
});

router.post('/restart', soloAdmin, async (req, res) => {
  try {
    logUpdater('Reiniciando servicio...');
    execSync('sudo pm2 restart logistics', { cwd: APP_DIR, stdio: 'pipe' });
    logUpdater('Servicio reiniciado');
    res.json({ ok: true, message: 'Servicio reiniciado' });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

router.get('/logs', soloAdmin, (req, res) => {
  res.json({ log: getUpdaterLog() });
});

export default router;
