const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

function validarPassword(p) {
  const errores = [];
  if (!p || p.length < 8)              errores.push('Mínimo 8 caracteres');
  if (!/[A-Z]/.test(p))                errores.push('Al menos una mayúscula');
  if (!/[0-9]/.test(p))                errores.push('Al menos un número');
  if (!/[!@#$%^&*(),.?":{}|<>_\-+=]/.test(p)) errores.push('Al menos un carácter especial');
  return errores;
}

function generateToken() {
  return crypto.randomBytes(48).toString('hex');
}

let smtpService = null;
function getSmtpService() {
  if (!smtpService) smtpService = require('../services/smtp.service');
  return smtpService;
}

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.area_id, u.activo,
              u.cambio_password, u.creado, u.actualizado, a.nombre AS area_nombre
       FROM usuarios u LEFT JOIN areas a ON a.id = u.area_id
       WHERE u.email = $1`,
      [req.usuario.email]
    );
    if (rows.length === 0) {
      const rolesValidos = ['admin','contador','tesorero','comprador','auditor'];
      const rol = rolesValidos.includes(req.usuario.rol) ? req.usuario.rol : 'comprador';
      const randomPass = crypto.randomBytes(32).toString('hex');
      const hash = bcrypt.hashSync(randomPass, 12);
      const { rows: newUser } = await db.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (email) DO UPDATE SET nombre = $1, rol = $4
         RETURNING id, nombre, email, rol, activo, creado, actualizado`,
        [req.usuario.nombre, req.usuario.email, hash, rol]
      );
      return res.json(newUser[0]);
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/cambiar-password', authMiddleware, async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
    const errores = validarPassword(nueva);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });
    const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE email = $1', [req.usuario.email]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!bcrypt.compareSync(actual, rows[0].password_hash)) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const hash = bcrypt.hashSync(nueva, 12);
    await db.query('UPDATE usuarios SET password_hash = $1, actualizado = NOW() WHERE email = $2', [hash, req.usuario.email]);
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[auth/cambiar-password]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/cambio-forzado', authMiddleware, async (req, res) => {
  try {
    const { nueva } = req.body;
    if (!nueva) return res.status(400).json({ error: 'Nueva contraseña requerida' });
    const errores = validarPassword(nueva);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });
    const hash = bcrypt.hashSync(nueva, 12);
    await db.query('UPDATE usuarios SET password_hash = $1, cambio_password = FALSE, actualizado = NOW() WHERE email = $2', [hash, req.usuario.email]);
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[auth/cambio-forzado]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  try {
    const { rows } = await db.query('SELECT id, nombre, email FROM usuarios WHERE email = $1 AND activo = TRUE', [email.toLowerCase().trim()]);
    if (rows.length > 0) {
      const user = rows[0];
      await db.query("DELETE FROM tokens_recuperacion WHERE usuario_id = $1", [user.id]);
      const token = generateToken();
      const expira = new Date(Date.now() + 30 * 60 * 1000);
      await db.query('INSERT INTO tokens_recuperacion (token, usuario_id, expira) VALUES ($1, $2, $3)', [token, user.id, expira]);
      try {
        const { rows: cfg } = await db.query("SELECT clave, valor FROM configuracion WHERE clave IN ('app_url','smtp_from','reset_asunto','reset_cuerpo')");
        const config = {};
        for (const r of cfg) config[r.clave] = r.valor;
        const baseUrl = config.app_url || (req.protocol + '://' + req.get('host'));
        const enlace = baseUrl + '/reset-password.html?token=' + token;
        const asunto = config.reset_asunto || 'Recuperación de contraseña';
        let cuerpo = config.reset_cuerpo || 'Hola {nombre},\n\nUtiliza este enlace para restablecer tu contraseña:\n\n{enlace}\n\nEste enlace expira en 30 minutos.\n\nSi no solicitaste este cambio, ignora este mensaje.';
        cuerpo = cuerpo.replace(/{nombre}/g, user.nombre).replace(/{enlace}/g, enlace).replace(/{empresa}/g, config.smtp_from || 'DocFlow');
        const smtp = getSmtpService();
        if (smtp && smtp.enviarCorreo) await smtp.enviarCorreo(user.email, asunto, cuerpo);
      } catch (mailErr) {
        console.error('[forgot-password] Error enviando correo:', mailErr.message);
      }
    }
    res.json({ ok: true, mensaje: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
  } catch (err) {
    console.error('[forgot-password]', err);
    res.json({ ok: true, mensaje: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  const errores = validarPassword(password);
  if (errores.length) return res.status(400).json({ error: errores.join('. ') });
  try {
    const { rows } = await db.query('SELECT * FROM tokens_recuperacion WHERE token = $1 AND expira > NOW() AND usado = FALSE', [token]);
    if (!rows.length) return res.status(400).json({ error: 'El enlace es inválido o ya expiró' });
    const hash = bcrypt.hashSync(password, 12);
    await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, rows[0].usuario_id]);
    await db.query('UPDATE tokens_recuperacion SET usado = TRUE WHERE token = $1', [token]);
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  res.json({ ok: true, mensaje: 'Sesión cerrada' });
});

module.exports = router;
