-- 010 · TEMPORARY lab isolation for the Spatial engine bake-off (29 Sep 2026).
--
-- One Postgres schema + one private storage bucket per test track:
--   lab_8thwall / lab-8thwall    ← archi-ar-8thwall  (8thwall.designingforusers.com)
--   lab_zappar  / lab-zappar     ← archi-ar-zappar   (zappar.designingforusers.com)
--   lab_immersal / lab-immersal  ← archi-ar-immersal (immersal.designingforusers.com)
-- Each Netlify project sets VITE_LAB_ENGINE, and src/lib/lab.ts routes all
-- test reads/writes to that schema and bucket. public.* and the production
-- buckets are untouched; login (auth) and public.projects stay shared.
--
-- Lives on main because the Supabase GitHub integration only applies main.
-- Dormant for production: nothing in the live app reads these schemas.
-- END OF BAKE-OFF: the winner's tables are recreated in public by a new
-- migration, then a cleanup migration drops all three lab schemas and the
-- lab buckets are emptied and removed. Never merge lab_* into public by hand.

do $$
declare
  eng text;
  sch text;
begin
  foreach eng in array array['8thwall', 'zappar', 'immersal'] loop
    sch := 'lab_' || eng;

    execute format('create schema if not exists %I', sch);
    execute format('grant usage on schema %I to authenticated, service_role', sch);

    -- One row per phone test run (Step 4 protocol).
    execute format($f$
      create table if not exists %I.test_runs (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
        project_id uuid references public.projects(id) on delete set null,
        device text,
        user_agent text,
        time_to_camera_ms integer,
        time_to_lock_ms integer,
        markers_seen integer,
        fit_rms_mm numeric,
        fit_scale numeric,
        checkpoint_errors_mm jsonb,
        drift_errors_mm jsonb,
        tracking_losses integer,
        fps_avg numeric,
        notes text,
        raw jsonb,
        created_at timestamptz not null default now()
      )$f$, sch);

    -- Per-project registration of the marker survey against a provider map
    -- (used by Immersal; created in every lab so adapter code stays identical).
    execute format($f$
      create table if not exists %I.sites (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
        project_id uuid not null references public.projects(id) on delete cascade,
        provider text not null,
        map_id text,
        transform jsonb,
        fit_rms_mm numeric,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (project_id, provider)
      )$f$, sch);

    execute format('alter table %I.test_runs enable row level security', sch);
    execute format('alter table %I.sites enable row level security', sch);
    execute format('grant select, insert, update, delete on all tables in schema %I to authenticated', sch);
    execute format('grant all on all tables in schema %I to service_role', sch);

    -- Owner-only access. No anon access at all.
    execute format('drop policy if exists "Owner manages own test runs" on %I.test_runs', sch);
    execute format($f$create policy "Owner manages own test runs" on %I.test_runs
      for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid())$f$, sch);
    execute format('drop policy if exists "Owner manages own sites" on %I.sites', sch);
    execute format($f$create policy "Owner manages own sites" on %I.sites
      for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid())$f$, sch);

    -- Private bucket per lab; files live under <user_id>/...
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('lab-' || eng, 'lab-' || eng, false, 52428800)
    on conflict (id) do nothing;
  end loop;
end $$;

-- Lab buckets: a signed-in user can only touch files under their own
-- <user_id>/ folder. Public viewers never read lab buckets directly.
drop policy if exists "Lab owners manage own files" on storage.objects;
create policy "Lab owners manage own files"
  on storage.objects for all to authenticated
  using (
    bucket_id in ('lab-8thwall', 'lab-zappar', 'lab-immersal')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('lab-8thwall', 'lab-zappar', 'lab-immersal')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
