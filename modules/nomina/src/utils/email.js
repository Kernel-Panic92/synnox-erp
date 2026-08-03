async function obtenerConfigSmtp(getConfig) {
  const cfg = getConfig();
  if (cfg.smtp_heredar === '1' || cfg.smtp_heredar === 'true') {
    try {
      const launcherUrl = (cfg.launcher_url || 'http://localhost:3002').replace(/\/+$/, '');
      const res = await fetch(launcherUrl + '/api/smtp/internal', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Launcher responded ' + res.status);
      const data = await res.json();
      return {
        host: data.config.smtp_host || '',
        port: parseInt(data.config.smtp_port || '587'),
        secure: data.config.smtp_secure === 'true',
        user: data.config.smtp_user || '',
        pass: data.config.smtp_pass || '',
        from: data.config.smtp_from || data.config.smtp_from_name || 'smtp@localhost',
        tls: data.config.smtp_secure === 'true'
      };
    } catch (e) {
      console.warn('[EMAIL] Fallback a config local (launcher no disponible):', e.message);
    }
  }
  return {
    host: cfg.smtp_host || '',
    port: parseInt(cfg.smtp_puerto || '587'),
    secure: cfg.smtp_puerto === '465',
    user: cfg.smtp_usuario || '',
    pass: cfg.smtp_password || '',
    from: cfg.smtp_remitente || cfg.smtp_usuario || 'smtp@localhost',
    tls: cfg.smtp_tls === 'true'
  };
}

module.exports = function({ getConfig, nodemailer, escapeHtml, BASE_URL, APP_NAME }) {
  const fn = async function enviarCorreo(para, asunto, texto, htmlAdicional = '') {
    const smtp = await obtenerConfigSmtp(getConfig);
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: smtp.tls,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
      connectionTimeout: 5000,
      greetingTimeout: 5000
    });

    const trimmed = String(texto).trim();
    const isHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html');

    let html;
    let text;

    if (isHtml) {
      html = trimmed;
      text = trimmed.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    } else {
      const cuerpoHtml = escapeHtml(trimmed).replace(/\n/g, '<br/><br/>');
      html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Nómina - Novedades</title>
<style>
@media only screen and (max-width: 620px) {
  .email-container { width: 100% !important; padding: 20px 15px !important; }
  .email-content { font-size: 15px !important; }
  .email-title { font-size: 24px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;min-height:100vh;">
<tr>
<td align="center" style="padding:20px 10px;">
<table class="email-container" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;border:1px solid #e0e4ea;max-width:100%;">
<tr>
<td align="center" class="email-content" style="padding:30px 25px;color:#2c3e50;font-size:15px;line-height:1.8;text-align:left;">
<h1 class="email-title" style="color:#2563eb;font-size:28px;margin:0 0 8px;font-weight:bold;">${APP_NAME}</h1>
<p style="color:#6b7a8f;font-size:13px;margin:0 0 25px;">Sistema de Control de Novedades</p>
<div>${cuerpoHtml}${htmlAdicional}</div>
<div style="margin-top:25px;padding-top:18px;border-top:1px solid #e0e4ea;text-align:center;">
<a href="${BASE_URL}" style="color:#2563eb;text-decoration:none;font-size:13px;">${APP_NAME}</a>
</div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
      text = trimmed;
    }

    await transporter.sendMail({
      from: smtp.from,
      to: para,
      subject: asunto,
      text,
      html
    });
  };
  return fn;
};