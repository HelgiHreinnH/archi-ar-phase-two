-- Bring the dedicated archi-ar project in line with what the app actually reads.
-- Four columns existed in the Lovable Cloud schema (and in migrations/external/0001_init.sql)
-- but were never applied here. get-public-project selects three of them by name, so every
-- public /view/:shareId request would error without them.

alter table public.projects
  add column if not exists original_model_url text,          -- Phase 5: untouched upload, while model_url points at the optimised GLB
  add column if not exists usdz_model_url     text,          -- legacy iOS path; USDZ dropped Sep 2026 but still selected by get-public-project
  add column if not exists tracking_file_url  text,          -- 8th Wall .wtc target, when tracking_format says so
  add column if not exists tracking_format    text not null default 'mindar-mind';

-- Wall shipped Sep 2026 as a first-class mode alongside Tabletop and Spatial
-- (Spatial being the UI label for the internal 'multipoint' value). The existing
-- trigger rejected it, so any Wall project would fail on insert.
create or replace function public.validate_project_mode()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.mode not in ('tabletop', 'wall', 'multipoint') then
    raise exception 'Invalid mode: %. Must be tabletop, wall or multipoint.', new.mode;
  end if;
  return new;
end;
$function$;
