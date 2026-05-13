# Archi AR — External Supabase Migration Runbook

**Target:** dedicated Supabase project `njrytsladmfhbttsitmn` (eu-central-1)
**Source:** Lovable Cloud project `hjaqqfuebfpxpbyldcso`
**Created:** May 12, 2026 (companion to the Notion migration guide and Performance Audit)

This runbook is for a **future manual cut-over** off Lovable Cloud. It cannot be
executed from inside the Lovable editor because Lovable manages `.env`,
`src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, and
the `project_id` line in `supabase/config.toml` and will revert any changes to
those files. The cut-over has to happen after the project is ejected (or run on
a fork hosted outside Lovable).

---

## 0. Prerequisites

- Supabase CLI installed and logged in: `supabase login`
- Access token + service-role key for project ref `njrytsladmfhbttsitmn`
  (service-role key is needed to curl-test edge functions post-deploy)
- The repo checked out **outside Lovable** (or a copy you can edit freely)
- **Node 18+** (for `supabase gen types`)
- **Postgres 15+ client tools** (`pg_dump`, `psql`) — only required if you do the optional data migration in §5
- DNS / domain admin access if redirect URLs or custom domain need updating
- A backup of any production data on the old project that needs to be migrated

---

## 1. Run the combined SQL migration

The file `migrations/external/0001_init.sql` is a single idempotent script
covering Migrations 1–10 from the Notion guide PLUS the deltas that landed
after it was written:

| Delta | Source | Why it matters |
|---|---|---|
| `projects.original_model_url` | Phase 5 | Preserves the user's upload while `model_url` points at the optimized GLB |
| `optimize-model` edge function in deploy list | Phase 5 | Runs Draco compression on every GLB upload |
| Both storage buckets PRIVATE | Final security posture | Public viewers only ever get signed URLs from `get-public-project` |
| Owner-scoped `select` on `project-models` | Hardening | Replaces the early `Public can view models` policy |

Apply it:

```bash
# Option A — via psql (recommended for one-shot apply)
psql "postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" \
  -f migrations/external/0001_init.sql

# Option B — via Supabase SQL editor
# Paste the contents of migrations/external/0001_init.sql and run.
```

Then apply the post-init hardening (indexes + extension cleanup):

```bash
psql "postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" \
  -f migrations/external/0002_post_init.sql
```

Verify in the dashboard:

- `public.profiles` and `public.projects` exist with the columns listed in the SQL header
- RLS is enabled on both tables
- Both `project-models` and `project-assets` buckets exist and are **private**
- Triggers `update_*_updated_at`, `validate_project_mode_trigger`, and `on_auth_user_created` exist
- Indexes `idx_projects_user_id`, `idx_projects_share_link`, `idx_projects_status` exist on `public.projects` (from `0002_post_init.sql`)
- Auto-created unique index `projects_share_link_key` is present (used by `get-public-project`)

---

## 2. Deploy edge functions (4 — not 3)

The original Notion guide listed three functions. Deploy **all four** that exist in this repo:

```bash
supabase functions deploy get-public-project --project-ref njrytsladmfhbttsitmn
supabase functions deploy optimize-model     --project-ref njrytsladmfhbttsitmn
supabase functions deploy export-user-data   --project-ref njrytsladmfhbttsitmn
supabase functions deploy delete-user-data   --project-ref njrytsladmfhbttsitmn
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected
by the Supabase runtime — no manual secret configuration needed.

Sanity-check `optimize-model` in particular: it pulls `@gltf-transform/*` and
`draco3dgltf` from npm at cold-start. First invocation will be ~5–10 s slower.

### 2.5. Edge function JWT settings — **most likely cut-over breakage**

Before deploying, ensure `supabase/config.toml` on the ejected copy contains:

```toml
[functions.get-public-project]
verify_jwt = false
```

Without this, every public AR share link returns 401 because the viewer is
unauthenticated by design. The other three functions (`optimize-model`,
`export-user-data`, `delete-user-data`) keep the default (JWT verified) — they
all validate the caller in code via `auth.getClaims()`.

---

## 3. Configure auth on the new project

In the Supabase dashboard for `njrytsladmfhbttsitmn`:

1. **Authentication → Providers**
   - Enable **Email**
   - Enable **Confirm email** (users must verify before sign-in)
2. **Authentication → URL Configuration**
   - Set **Site URL** to your deployment URL (e.g. `https://archi-ar.lovable.app` or your custom domain)
   - Add `https://archi-ar.lovable.app/**` and your custom domain wildcard to the **Redirect URLs** allowlist
3. **Authentication → Policies / Password**
   - Enable **leaked-password protection (HIBP)**
   - Set **minimum password length** ≥ 8
4. **Authentication → SMTP** — **required before production traffic**
   - Configure custom SMTP (SendGrid, Resend, AWS SES, …). Supabase shared SMTP has a low daily cap and poor deliverability and will silently lose confirmation emails under load.
5. **Authentication → Sessions / Tokens**
   - Confirm default JWT expiry (1h) and refresh-token rotation are acceptable for your use case
6. **Authentication → Rate Limits** — defaults are fine; document where they live so on-call knows where to look

### 3.5. Storage CORS

In **Storage → Settings → CORS**, verify both `project-models` and `project-assets`
allow `GET` from `*` (or explicitly allowlist your app + custom-domain origins).
If CORS is tightened without updating the allowlist, AR loads fail silently in
the browser with a `CORS error` in the network tab and no on-screen feedback.

---

## 4. Update the application code

These files **cannot be edited from inside Lovable** — do them in your ejected copy:

### `.env`

```
VITE_SUPABASE_URL=https://njrytsladmfhbttsitmn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnl0c2xhZG1maGJ0dHNpdG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDE0NTcsImV4cCI6MjA5NDE3NzQ1N30.nvuw9jFwoiWeRz-3S0lNMLTpBTmIASTKxyPFuGhfB3w
VITE_SUPABASE_PROJECT_ID=njrytsladmfhbttsitmn
```

### `supabase/config.toml`

```toml
project_id = "njrytsladmfhbttsitmn"
```

### `src/integrations/supabase/types.ts`

Regenerate against the new project:

```bash
supabase gen types typescript --project-id njrytsladmfhbttsitmn > src/integrations/supabase/types.ts
```

### `src/integrations/supabase/client.ts`

No code change needed — it reads from the env vars above. Just confirm it compiles.

---

## 5. (Optional) Migrate existing data

The fresh project starts empty. If you need to bring users + projects + storage objects across:

1. **Auth users** — export from old project Auth → Users → CSV, then `INSERT` into new project. Passwords cannot be moved, so **trigger a bulk password-reset email** immediately after import (Authentication → Users → bulk action, or scripted via the admin API). Without this, users will silently fail to sign in with no guidance.
2. **`public.profiles` + `public.projects`** — `pg_dump --data-only --table=public.profiles --table=public.projects` from old, restore into new.
3. **Storage** — `supabase storage download` from old, then `supabase storage upload` to new, preserving paths (`{projectId}/...`). **Pass `--cache-control "31536000, immutable"` on the upload** so copied objects pick up the Track A CDN posture; otherwise they keep the default short-cache headers and the performance audit gains are lost on migrated data.
4. Re-run signed-URL minting once before announcing the cut-over.

For a development environment, it is acceptable to start clean.

---

## 6. Smoke test

After cut-over, walk through the full happy path against `njrytsladmfhbttsitmn`:

- Sign up → receive confirmation email → confirm → sign in
- Create a new project (Tabletop)
- Upload a GLB; verify `optimize-model` runs and `original_model_url` is populated
- Generate the experience → open share link in another browser → AR loads
- Repeat for a Multi-Point project with 3+ markers
- Settings → Export my data → file downloads
- Settings → Delete my account → cascades cleanly
- Tail edge function logs (`supabase functions logs optimize-model --project-ref njrytsladmfhbttsitmn`) and confirm a fresh GLB upload prints `originalSize → optimizedSize (Nx)`. A silently-failing cold-start npm pull will produce no such line — catch it here, not from a user complaint.

---

## 7. Rollback

If anything breaks, revert the three env vars in step 4 to the old values and
redeploy. The old Lovable project keeps running unchanged at
`https://hjaqqfuebfpxpbyldcso.supabase.co`.

**Caveat:** any data created on the new project between cut-over and rollback
is lost on the flip-back. Capture a `pg_dump` of the new project (and a storage
snapshot if uploads happened) before reverting env vars.

---

## File map

```
migrations/external/0001_init.sql   # Combined schema + RLS + buckets
migrations/external/0002_post_init.sql  # Indexes + extension cleanup (run after 0001)
MIGRATION.md                        # This runbook
supabase/functions/
  get-public-project/index.ts
  optimize-model/index.ts           # Phase 5 — must be deployed
  export-user-data/index.ts
  delete-user-data/index.ts
```
