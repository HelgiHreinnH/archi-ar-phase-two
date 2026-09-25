alter table public.projects
  add column if not exists optimize_model boolean not null default true;

comment on column public.projects.optimize_model is
  'Architect''s upload-flow choice: run the phone optimisation pipeline (join/simplify/meshopt + material fixes) on this project''s GLB, or upload it exactly as exported. Defaults to true for every existing and new row.';
