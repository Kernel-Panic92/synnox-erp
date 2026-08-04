ALTER TABLE projects.tareas ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;
