-- =============================================================================
-- Archi AR — post-init hardening for the external Supabase project.
--
-- Run this immediately after migrations/external/0001_init.sql on the new
-- project (ref: njrytsladmfhbttsitmn).
--
-- Why this exists as a separate file:
--   0001_init.sql was authored before a review pass caught these gaps. For any
--   future fresh project, fold these statements into 0001 and delete this file.
--
-- This script is idempotent — safe to re-run.
-- =============================================================================

-- ── Indexes for hot dashboard queries ────────────────────────────────────────
-- Most-frequent query: "list my projects" (projects.user_id = auth.uid()).
create index if not exists idx_projects_user_id
  on public.projects (user_id);

-- Public AR viewer lookup goes via share_link. Partial index keeps it tiny —
-- the vast majority of rows have NULL share_link (drafts).
create index if not exists idx_projects_share_link
  on public.projects (share_link)
  where share_link is not null;

-- Status filtering on the dashboard ("draft" vs "published").
create index if not exists idx_projects_status
  on public.projects (status);

-- ── Drop unused extension ────────────────────────────────────────────────────
-- 0001_init.sql created uuid-ossp but every default uses gen_random_uuid()
-- (built into pgcrypto / Postgres 15+). Removing it shrinks the attack surface.
drop extension if exists "uuid-ossp";

-- =============================================================================
-- Verify in the dashboard:
--   • Indexes idx_projects_user_id, idx_projects_share_link, idx_projects_status
--     all exist on public.projects
--   • Auto-created unique index projects_share_link_key still present
--   • uuid-ossp no longer listed under Database → Extensions
-- =============================================================================
