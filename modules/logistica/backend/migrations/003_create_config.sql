CREATE TABLE IF NOT EXISTS logistics.configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logistics.auditoria_accesos (
  id SERIAL PRIMARY KEY,
  usuario_id INT,
  email VARCHAR(255),
  ip VARCHAR(50),
  user_agent TEXT,
  tipo VARCHAR(20) NOT NULL DEFAULT 'exito',
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Config por defecto
INSERT INTO logistics.configuracion (clave, valor) VALUES
  ('smtp_host', ''),
  ('smtp_puerto', '587'),
  ('smtp_tls', '1'),
  ('smtp_usuario', ''),
  ('smtp_password', ''),
  ('smtp_remitente', ''),
  ('backup_auto', '0'),
  ('backup_dir', '~/backups/logistics'),
  ('backup_max', '14'),
  ('widetech_url', 'https://web1ws.shareservice.co'),
  ('widetech_user', ''),
  ('widetech_password', ''),
  ('widetech_lang', '1'),
  ('widetech_rate_limit', '25')
ON CONFLICT (clave) DO NOTHING;
