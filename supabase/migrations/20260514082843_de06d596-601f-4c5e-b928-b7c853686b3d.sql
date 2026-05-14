
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS usdz_model_url text;

CREATE TABLE IF NOT EXISTS public.ar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ar_events_project_id_created_at_idx
  ON public.ar_events(project_id, created_at DESC);

ALTER TABLE public.ar_events ENABLE ROW LEVEL SECURITY;

-- Anyone (public viewers) can insert events. We constrain event_type loosely
-- via a CHECK to prevent garbage rows.
ALTER TABLE public.ar_events
  ADD CONSTRAINT ar_events_event_type_chk
  CHECK (event_type IN ('ios_glb_blocked', 'ar_launched', 'ar_failed'));

CREATE POLICY "Anyone can log AR events"
  ON public.ar_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Project owners can view their AR events"
  ON public.ar_events
  FOR SELECT
  TO authenticated
  USING (public.is_project_owner(project_id));
