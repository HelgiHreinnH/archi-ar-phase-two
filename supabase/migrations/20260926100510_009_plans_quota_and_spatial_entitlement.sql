-- 009 · Free vs paid tiers (26 Sep 2026)
-- Free: Tabletop + Wall, capped at free_model_cap() projects per user.
-- Paid: Spatial (DB value `multipoint`, never renamed) needs profiles.plan = 'paid'
-- or projects.paid_at set. No payments yet: entitlements are set by an admin
-- (SQL editor / service role). Clients can never grant themselves either.

ALTER TABLE public.profiles
  ADD COLUMN plan text NOT NULL DEFAULT 'free'
  CONSTRAINT profiles_plan_check CHECK (plan IN ('free', 'paid'));

ALTER TABLE public.projects
  ADD COLUMN paid_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.plan IS 'free | paid. Admin-set only (guard trigger). paid = Spatial + no Tabletop/Wall cap.';
COMMENT ON COLUMN public.projects.paid_at IS 'Spatial entitlement for this project. Admin-set only (guard trigger); later set by the Paddle webhook.';

-- Single source of truth for the free cap. Mirrored in src/lib/plans.ts (FREE_MODEL_CAP).
CREATE OR REPLACE FUNCTION public.free_model_cap()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 3 $$;

-- True when the statement comes from a signed-in or anonymous client (PostgREST),
-- false for postgres / service_role (SQL editor, MCP, future webhook).
CREATE OR REPLACE FUNCTION public.is_client_role()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_user IN ('authenticated', 'anon')
$$;

-- ── Guard: clients cannot change their own entitlements ─────────────────
CREATE OR REPLACE FUNCTION public.guard_profile_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_client_role() THEN
    IF TG_OP = 'INSERT' AND NEW.plan IS DISTINCT FROM 'free' THEN
      RAISE EXCEPTION 'ENTITLEMENT_READ_ONLY: plan can only be changed by Archi AR'
        USING ERRCODE = 'P0001';
    ELSIF TG_OP = 'UPDATE' AND NEW.plan IS DISTINCT FROM OLD.plan THEN
      RAISE EXCEPTION 'ENTITLEMENT_READ_ONLY: plan can only be changed by Archi AR'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_profile_plan
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_plan();

-- ── Enforce: Spatial entitlement + free Tabletop/Wall cap ───────────────
CREATE OR REPLACE FUNCTION public.enforce_project_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  owner_plan text;
  single_qr_count integer;
BEGIN
  IF NOT public.is_client_role() THEN
    RETURN NEW;
  END IF;

  -- paid_at is admin-only.
  IF (TG_OP = 'INSERT' AND NEW.paid_at IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'ENTITLEMENT_READ_ONLY: paid_at can only be set by Archi AR'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT plan INTO owner_plan FROM public.profiles WHERE user_id = NEW.user_id;
  owner_plan := COALESCE(owner_plan, 'free');

  -- Spatial: creating one, switching a project to it, or activating one.
  IF NEW.mode = 'multipoint' AND (
       TG_OP = 'INSERT'
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
     ) THEN
    IF NEW.paid_at IS NULL AND owner_plan <> 'paid' THEN
      RAISE EXCEPTION 'SPATIAL_REQUIRES_PAID: Spatial experiences are part of the paid plan'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Free cap on Tabletop/Wall: new project, or an existing one switched into these modes.
  IF owner_plan = 'free' AND NEW.mode IN ('tabletop', 'wall') AND (
       TG_OP = 'INSERT' OR OLD.mode NOT IN ('tabletop', 'wall')
     ) THEN
    -- Serialise per user so two parallel inserts can't both slip under the cap.
    PERFORM pg_advisory_xact_lock(hashtextextended('project_cap:' || NEW.user_id::text, 0));
    SELECT count(*) INTO single_qr_count
      FROM public.projects
     WHERE user_id = NEW.user_id
       AND mode IN ('tabletop', 'wall')
       AND id <> NEW.id;
    IF single_qr_count >= public.free_model_cap() THEN
      RAISE EXCEPTION 'FREE_MODEL_CAP_REACHED: free plan allows % Tabletop/Wall models', public.free_model_cap()
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_project_plan
  BEFORE INSERT OR UPDATE OF mode, status, paid_at, user_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_plan();

-- Trigger/helper functions are not an API surface.
REVOKE EXECUTE ON FUNCTION public.guard_profile_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_project_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.free_model_cap() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_client_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_model_cap() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_role() TO authenticated;
