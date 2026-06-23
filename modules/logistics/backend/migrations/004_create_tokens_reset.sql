CREATE TABLE IF NOT EXISTS logistics.tokens_reset (
  id SERIAL PRIMARY KEY,
  token VARCHAR(96) NOT NULL UNIQUE,
  usuario_id INT NOT NULL REFERENCES logistics.usuarios(id),
  expira TIMESTAMP NOT NULL,
  usado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO logistics.configuracion (clave, valor) VALUES
  ('reset_asunto', 'Recuperación de contraseña - Horix Logistics'),
  ('reset_cuerpo', 'Hola {nombre},\n\nRecibimos una solicitud para restablecer tu contraseña. Haz clic en el siguiente enlace para crear una nueva contraseña:\n\n{enlace}\n\nSi no solicitaste este cambio, ignora este correo.\n\nSaludos,\nEquipo Horix Logistics'),
  ('app_url', '')
ON CONFLICT (clave) DO NOTHING;
