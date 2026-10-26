ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS audit_logs_timeline_idx ON public.audit_logs(created_at DESC, id DESC);

