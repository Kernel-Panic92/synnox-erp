INSERT INTO logistics.configuracion (clave, valor) VALUES
  ('login_max_attempts', '5'),
  ('login_window_minutes', '5'),
  ('login_block_minutes', '30'),
  ('rate_limit_window', '900'),
  ('rate_limit_max', '100'),
  ('fail2ban_enabled', 'false'),
  ('fail2ban_bantime', '3600'),
  ('fail2ban_findtime', '600'),
  ('fail2ban_maxretry', '10')
ON CONFLICT (clave) DO NOTHING;
