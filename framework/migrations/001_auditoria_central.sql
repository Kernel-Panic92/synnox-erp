-- Central audit event store. Application code must only insert rows.
CREATE TABLE IF NOT EXISTS public.auditoria_central (
  id                  BIGSERIAL PRIMARY KEY,
  ocurrido_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recibido_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modulo              TEXT NOT NULL,
  categoria           TEXT NOT NULL,
  accion              TEXT NOT NULL,
  resultado           TEXT NOT NULL,
  actor_id            INTEGER,
  actor_tipo          TEXT NOT NULL DEFAULT 'usuario',
  actor_email         TEXT,
  sesion_id           TEXT,
  ip                  TEXT,
  user_agent          TEXT,
  entidad_tipo        TEXT,
  entidad_id          TEXT,
  resumen             TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  hash_inmutabilidad  TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_central_ocurrido
  ON public.auditoria_central (ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_central_modulo_fecha
  ON public.auditoria_central (modulo, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_central_categoria_accion
  ON public.auditoria_central (categoria, accion, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_central_actor_fecha
  ON public.auditoria_central (actor_id, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_central_ip_fecha
  ON public.auditoria_central (ip, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_central_entidad_fecha
  ON public.auditoria_central (entidad_tipo, entidad_id, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_central_metadata
  ON public.auditoria_central USING GIN (metadata);

CREATE TABLE IF NOT EXISTS public.auditoria_config (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  descripcion TEXT
);

INSERT INTO public.auditoria_config (clave, valor, descripcion) VALUES
  ('retencion_dias', '365', 'Dias de retencion de eventos de auditoria'),
  ('mascarar_ip', 'false', 'Anonimizar el ultimo octeto de IPv4'),
  ('retencion_habilitada', 'true', 'Habilitar purga automatica de eventos')
ON CONFLICT (clave) DO NOTHING;

-- Retention jobs may delete old rows; application sessions may not.
CREATE OR REPLACE FUNCTION public.purgar_auditoria_central(p_dias INTEGER DEFAULT 365)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_eliminadas BIGINT;
BEGIN
  PERFORM set_config('audit.retention_job', 'on', true);
  DELETE FROM public.auditoria_central
   WHERE ocurrido_en < NOW() - make_interval(days => GREATEST(p_dias, 1));
  GET DIAGNOSTICS v_eliminadas = ROW_COUNT;
  RETURN v_eliminadas;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_auditoria_central()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('audit.retention_job', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'auditoria_central es insert-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_auditoria_central_insert_only ON public.auditoria_central;
CREATE TRIGGER trg_auditoria_central_insert_only
  BEFORE UPDATE OR DELETE ON public.auditoria_central
  FOR EACH ROW EXECUTE FUNCTION public.proteger_auditoria_central();
