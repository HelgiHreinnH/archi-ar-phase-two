-- =============================================================================
-- Archi AR — combined initial migration for a NEW dedicated Supabase project.
--
-- Target project ref: njrytsladmfhbttsitmn  (eu-central-1)
-- Source of truth:    Lovable Cloud project hjaqqfuebfpxpbyldcso, May 12, 2026
--
-- This file consolidates Migrations 1–10 from the Notion migration guide
-- PLUS deltas that landed after the guide was written:
--   • projects.original_model_url  (Phase 5 — preserves user upload while
--     model_url points at the optimized GLB)
--   • Final RLS posture: both buckets PRIVATE, owner-scoped on all CRUD,
--     public read happens only via signed URLs minted by edge functions.
--
-- Run this once on the new project (SQL editor or `supabase db push`).
-- It is idempotent on table/policy/bucket creation but assumes a clean DB.
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Shared trigger function ───────────────────────────────────────────────────
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- profiles
-- =============================================================================
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade unique not null,
  full_name   text,
  company     text,
  logo_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can delete own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = user_id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = user_id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = user_id);
create policy "Users can delete own profile"
  on public.profiles for delete using (auth.uid() = user_id);

drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- ── Auto-create profile row on signup ────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- projects
--
-- Includes every column present in production as of May 12, 2026, including
-- Phase 5's original_model_url and the tracking_format / tracking_file_url
-- columns added after the original migration guide was drafted.
-- =============================================================================
create table if not exists public.projects (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade not null,
  name                text not null,
  client_name         text,
  location            text,
  description         text,

  -- Storage
  model_url           text,                              -- optimized GLB path
  original_model_url  text,                              -- Phase 5: untouched upload
  mind_file_url       text,
  marker_image_urls   jsonb default '{}',
  qr_code_url         text,
  tracking_file_url   text,
  tracking_format     text not null default 'mindar-mind',

  -- Mode / display
  mode                text not null default 'multipoint',
  scale               text default '1:1',
  qr_size             text default 'medium',
  initial_rotation    integer default 0,

  -- Sharing
  marker_data         jsonb default '{}',
  share_link          uuid unique,
  status              text not null default 'draft',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.projects enable row level security;

-- ── Helper: ownership check for storage RLS ──────────────────────────────────
create or replace function public.is_project_owner(_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.projects
    where id = _project_id and user_id = auth.uid()
  );
$$;

drop policy if exists "Owners can view own projects"   on public.projects;
drop policy if exists "Owners can insert projects"     on public.projects;
drop policy if exists "Owners can update own projects" on public.projects;
drop policy if exists "Owners can delete own projects" on public.projects;

create policy "Owners can view own projects"
  on public.projects for select using (user_id = auth.uid());
create policy "Owners can insert projects"
  on public.projects for insert with check (auth.uid() = user_id);
create policy "Owners can update own projects"
  on public.projects for update using (user_id = auth.uid());
create policy "Owners can delete own projects"
  on public.projects for delete using (user_id = auth.uid());

drop trigger if exists update_projects_updated_at on public.projects;
create trigger update_projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at_column();

-- ── Mode validation (no CHECK constraint — keep it mutable) ──────────────────
create or replace function public.validate_project_mode()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.mode not in ('tabletop', 'multipoint') then
    raise exception 'Invalid mode: %. Must be tabletop or multipoint.', new.mode;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_project_mode_trigger on public.projects;
create trigger validate_project_mode_trigger
  before insert or update on public.projects
  for each row execute function public.validate_project_mode();

-- =============================================================================
-- Storage buckets
--
-- Final security model:
--   • Both buckets PRIVATE.
--   • Owners get full CRUD via RLS that joins back to projects.user_id.
--   • Public viewers only ever see signed URLs minted by edge functions
--     (get-public-project), never direct bucket access.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('project-models', 'project-models', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do update set public = false;

-- ── project-models policies ──────────────────────────────────────────────────
drop policy if exists "Owners can upload models"        on storage.objects;
drop policy if exists "Owners can update models"        on storage.objects;
drop policy if exists "Owners can delete models"        on storage.objects;
drop policy if exists "Owners can view own models"      on storage.objects;
drop policy if exists "Public can view models"          on storage.objects;

create policy "Owners can upload models"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-models' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "Owners can update models"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-models' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "Owners can delete models"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-models' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "Owners can view own models"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-models' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

-- ── project-assets policies ──────────────────────────────────────────────────
drop policy if exists "Owners can upload project assets" on storage.objects;
drop policy if exists "Owners can update project assets" on storage.objects;
drop policy if exists "Owners can delete project assets" on storage.objects;
drop policy if exists "Owners can view own project assets" on storage.objects;
drop policy if exists "Public can view assets"            on storage.objects;

create policy "Owners can upload project assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-assets' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "Owners can update project assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-assets' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "Owners can delete project assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-assets' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "Owners can view own project assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-assets' and
    public.is_project_owner(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- Done. Edge functions (deploy separately):
--   • get-public-project
--   • optimize-model        ← Phase 5, missing from the original migration guide
--   • export-user-data
--   • delete-user-data
-- =============================================================================
