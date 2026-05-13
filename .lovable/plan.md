# Migration hardening — patches for the external Supabase cut-over

Two file changes only. No app code touched, no Lovable Cloud tables modified.

## 1. New file: `migrations/external/0002_post_init.sql`

Idempotent follow-up to `0001_init.sql`, run on the new project right after the initial migration.

Contents:

- **Indexes** for the dashboard's hot queries
  - `CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);`
  - `CREATE INDEX IF NOT EXISTS idx_projects_share_link ON public.projects(share_link) WHERE share_link IS NOT NULL;` (partial — most rows are null)
  - `CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);`
- **Drop the unused extension** to keep the surface clean
  - `DROP EXTENSION IF EXISTS "uuid-ossp";` (everything uses `gen_random_uuid()`)
- **Header comment** explaining: this file exists because `0001_init.sql` was written before these gaps were caught in review; future projects should fold these into `0001`.

## 2. Revise `MIGRATION.md`

Targeted edits, not a rewrite:

### §0 Prerequisites — add
- Node 18+ (for `supabase gen types`)
- Postgres 15+ client tools (`pg_dump`, `psql`) for the optional data migration
- Service-role key for the new project (needed to curl-test edge functions post-deploy)
- DNS / domain admin access if redirect URLs change

### §1 — add
- Run `0002_post_init.sql` immediately after `0001_init.sql`
- Verification line: confirm `projects_share_link_key` (auto unique index) and the three `idx_projects_*` indexes exist

### New §2.5 "Edge function JWT settings" — **the most likely cut-over breakage**
Before deploying, ensure `supabase/config.toml` on the ejected copy contains:
```toml
[functions.get-public-project]
verify_jwt = false
```
Without this, the public AR viewer will get 401s on every share link. Note that `optimize-model`, `export-user-data`, and `delete-user-data` keep the default (JWT verified) since they validate the caller in code.

### §3 Auth — expand
- Configure custom SMTP before any production traffic (Supabase shared SMTP has a low daily cap and poor deliverability)
- Enable leaked-password protection (HIBP) and set min password length ≥ 8
- Confirm default JWT expiry / refresh-token rotation are acceptable
- Default rate limits are fine; document where to find them

### New §3.5 "Storage CORS"
- Verify both buckets allow `GET` from `*` (or explicitly allowlist app origins). AR loads will fail silently if this is tightened.

### §5 Data migration — clarify
- Step 1: after importing auth users, trigger a bulk password-reset email (passwords cannot be moved)
- Step 3: re-upload storage objects with `--cache-control "31536000, immutable"` so they pick up the Track A CDN posture; copied objects keep their old (default) headers otherwise

### §6 Smoke test — add
- Tail edge function logs and confirm `optimize-model` prints `originalSize → optimizedSize (Nx)` on a fresh upload (catches a silently-failing cold-start npm pull)

### §7 Rollback — add
- One sentence: any data created on the new project between cut-over and rollback is lost; capture a `pg_dump` before flipping env vars back

### Note in the file map
- Add `migrations/external/0002_post_init.sql` to the list

## Out of scope
- No changes to the live Lovable Cloud DB or `supabase/config.toml` in this repo (Lovable manages it; the `verify_jwt` block only applies on the ejected copy targeting the new project).
- No app code touched.
- No data migration executed — runbook only.
