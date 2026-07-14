import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

router.get('/config', soloAdmin, async (req, res) => {
  try {
    const keys = ['widetech_url','widetech_user','widetech_password','widetech_lang','widetech_rate_limit'];
    const result = await pool.query('SELECT clave, valor FROM logistics.configuracion WHERE clave = ANY($1)', [keys]);
    const cfg = {};
    for (const row of result.rows) cfg[row.clave] = row.valor;
    res.json({ exitosa: true, config: cfg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config', soloAdmin, async (req, res) => {
  try {
    const allowed = ['widetech_url','widetech_user','widetech_password','widetech_lang','widetech_rate_limit'];
    for (const [clave, valor] of Object.entries(req.body)) {
      if (!allowed.includes(clave)) continue;
      if (clave === 'widetech_password' && typeof valor === 'string' && valor.includes('•')) continue;
      await pool.query(
        `INSERT INTO logistics.configuracion (clave, valor, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = CURRENT_TIMESTAMP`,
        [clave, String(valor)]
      );
    }
    res.json({ exitosa: true, mensaje: 'Configuración Widetech guardada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/test', soloAdmin, async (req, res) => {
  try {
    const { url, user, password, lang } = req.body;
    const baseUrl = (url || 'https://web1ws.shareservice.co').replace(/\/+$/, '');
    const loginUrl = baseUrl + '/SpaceApi/rest/LoginUser';
    const body = JSON.stringify({
      strLogin: user || '',
      strPassword: password || '',
      intLang: parseInt(lang || '1')
    });
    const apiRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15000)
    });
    const data = await apiRes.json();
    if (data.Err?.Code === 0 && data.Sign && data.Token) {
      res.json({ exitosa: true, mensaje: 'Conexión exitosa — token obtenido correctamente' });
    } else {
      const code = data.Err?.Code ?? data.Code ?? '?';
      const desc = data.Err?.Desc ?? data.Desc ?? 'Error desconocido';
      res.status(400).json({ error: `Error ${code}: ${desc}` });
    }
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'Tiempo de espera agotado — el servidor Widetech no respondió' });
    }
    res.status(500).json({ error: 'Error de conexión: ' + err.message });
  }
});

export default router;
