import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import pool from '../config/db.js';
import { enviarCorreo } from '../utils/email.js';

const router = express.Router();

router.post('/cambiar-password', async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!req.usuario) return res.status(401).json({ error: 'Token requerido' });
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
    if (nueva.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    const result = await pool.query('SELECT password_hash FROM logistics.usuarios WHERE email=$1', [req.usuario.email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado en logistics' });
    const ok = await bcrypt.compare(actual, result.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const hash = await bcrypt.hash(nueva, 12);
    await pool.query('UPDATE logistics.usuarios SET password_hash=$1 WHERE email=$2', [hash, req.usuario.email]);
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error en cambiar-password:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  try {
    const userResult = await pool.query('SELECT id, nombre, email FROM logistics.usuarios WHERE email=$1 AND activo=true', [email.toLowerCase().trim()]);
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      await pool.query('DELETE FROM logistics.tokens_reset WHERE usuario_id=$1', [user.id]);
      const token = crypto.randomBytes(48).toString('hex');
      const expira = new Date(Date.now() + 30 * 60 * 1000);
      await pool.query('INSERT INTO logistics.tokens_reset (token, usuario_id, expira) VALUES ($1, $2, $3)', [token, user.id, expira]);
      try {
        const cfgResult = await pool.query("SELECT clave, valor FROM logistics.configuracion WHERE clave IN ('app_url','reset_asunto','reset_cuerpo')");
        const cfg = {};
        for (const row of cfgResult.rows) cfg[row.clave] = row.valor;
        const baseUrl = cfg.app_url || `${req.protocol}://${req.get('host')}`;
        const enlace = `${baseUrl}/reset-password.html?token=${token}`;
        const asunto = cfg.reset_asunto || 'Recuperación de contraseña';
        let cuerpo = cfg.reset_cuerpo || 'Hola {nombre},\n\n{enlace}';
        cuerpo = cuerpo.replace(/{nombre}/g, user.nombre).replace(/{enlace}/g, enlace).replace(/{empresa}/g, 'Vitamar');
        await enviarCorreo(user.email, asunto, cuerpo);
      } catch (mailErr) {
        console.error('Error enviando correo de recuperación:', mailErr);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en forgot-password:', err);
    res.json({ ok: true });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  try {
    const result = await pool.query(
      'SELECT * FROM logistics.tokens_reset WHERE token=$1 AND expira > NOW() AND usado=false',
      [token]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'El enlace es inválido o ya expiró' });
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE logistics.usuarios SET password_hash=$1 WHERE id=$2', [hash, result.rows[0].usuario_id]);
    await pool.query('UPDATE logistics.tokens_reset SET usado=true WHERE token=$1', [token]);
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error en reset-password:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export { router as default };
