# CLAUDE.md — Archi AR

Working guide for AI sessions in this repo. Written 21 Sep 2026.

## What this is
WebAR presentation platform for architects: upload a model from Rhino, generate a
printed marker, share an AR experience with a client by QR code. No native app.

## Stack (locked)
Vite + React 18 + TS + Tailwind + shadcn/Radix ·
8th Wall engine binary 1.0.0 — the engine for **every** mode (Tabletop/Wall: QR image
target + SLAM, auto lock, `WorldLockScene.tsx`; Spatial: being moved, see below) ·
MindAR.js 1.2.5 — **parked and archived, switched off** (`src/lib/arEngines.ts`) · three 0.170 (PINNED — see .npmrc) ·
Supabase (DB, storage, edge functions, RLS) · Netlify hosting · Simply.com DNS.

## Rules
- **8th Wall is the engine in all modes; MindAR is off (decision 17 Nov 2026).**
  `MINDAR_ENABLED = false` in `src/lib/arEngines.ts` guards every MindAR entry point:
  the Spatial viewer (production shows `SpatialInTesting`; the 8th Wall lab site
  redirects to `/lab/spatial/:shareId`), the `.mind` compile at generation, the
  compiler preload, the placement validator and "Revert to MindAR". `index.html` no
  longer preloads MindAR. During the test phase MindAR must never be called —
  `arEngines.test.ts` enforces it. Never flip the flag back; MindAR is archived on
  branch `archive/mindar` (archived, not deleted). Plan: Notion page "Decision: 8th
  Wall is the primary engine in all modes, MindAR is archived · 17 Nov 2026".
- **"Spatial" is a UI label only.** Never rename `mode === "multipoint"` in code,
  DB values, identifiers, filenames or imports. The rename is frontend copy.
- **GLB is the only model format** across Tabletop, Wall and Spatial. USDZ was
  dropped Sep 2026 — file size.
- **Rhino exports Z-up, Three.js is Y-up.** The -90 deg X rotation must be applied
  *before* bounding-box calculation, never after.
- **Read the working tree, not the Claude project's GitHub sync.** That sync
  serves a stale `main` and has already produced one wrong diagnosis.
- **Work lands on `main`** — commit and push directly; no feature branch unless the
  change is large. Branching gets revisited when database-structure work starts.
- Do git writes and clean builds natively (Desktop Commander / local terminal),
  not through a sandbox mount.
- **No secrets in tracked files.** Client env is `VITE_*` publishable values only;
  real values live in Netlify, `.env.local` locally, `.env.example` in git.
- **8th Wall licence:** the engine binary is Niantic Spatial's "Distributed Engine
  Binary" licence, not MIT. Keep the on-screen attribution + licence link in
  `WorldLockViewer.tsx`. §1.2 restricts paid products whose value derives
  substantially from the engine — accepted risk (Helgi, 23 Sep 2026); it now covers
  paid Spatial too. Contact Niantic Spatial once Spatial on 8th Wall has been tested
  and works (Helgi, est. Q1 2027), and before selling it. Never modify or rehost altered builds.
- **Tabletop/Wall have one engine.** The MindAR fallback was removed on 16 Nov 2026
  (image tracking + gyro hold cannot keep a model on the QR once the phone moves).
  If 8th Wall can't start, the client sees `AREngineUnavailable` — do not add a
  silent second engine back. Tabletop/Wall generation no longer compiles a `.mind`.
- One tap is the floor. `getUserMedia` and native AR both require user activation;
  zero-tap is not achievable in a browser.

## Deploy
`main` -> Netlify -> ar.felles.dk. PRs get deploy previews.
Build config is in `netlify.toml`, install flags in `.npmrc` — both in git, so
local, CI and Netlify agree. Nothing important lives only in a hosting dashboard.

## Backend
Dedicated Supabase project `archi-ar` / `njrytsladmfhbttsitmn` (eu-central-1). The
app has read it since the 22 Sep 2026 cut-over; the previous hosted project
(`hjaqqfuebfpxpbyldcso`) is no longer used. `MIGRATION.md` is kept as the
historical cut-over runbook and as a reference for rebuilding the backend.

## Documentation
Code-adjacent `.md` stays in the repo (this file, `MIGRATION.md`, READMEs).
Reading material — audits, decision docs, session notes — goes to Notion, which is
the source of truth for documentation.

Project hub: [Archi AR - Project (Notion)](https://app.notion.com/p/2c03395b0b4981c1ae68c6753ec21aae). Update its top block (status,
links, latest session) at the end of a working session.

## Database migrations
The Supabase GitHub integration is connected: everything in `supabase/migrations/` is
applied to `njrytsladmfhbttsitmn` on push to `main`. Two rules follow from that:

- **The folder must mirror the applied ledger.** Filenames are `<version>_<name>.sql` and
  the versions must match `supabase_migrations.schema_migrations` exactly. A file whose
  version is not in the ledger will be applied on the next push.
- **Never add a migration dated before the latest applied one.** `db push` treats it as
  missing and tries to run it out of order.

The 13 legacy migrations (Feb–Jul 2026, written against the previous hosted project)
are archived in `migrations/legacy-archive/`, deliberately outside `supabase/`. Nine
contain unguarded `CREATE` statements and would fail against the current schema. Do not
move them back.

`migrations/external/` holds the standalone init scripts from `MIGRATION.md` and is not
read by the integration.

## Local environment gotcha
`NODE_ENV=production` is exported in the shell on this machine. With it set, `npm
install` **silently omits every devDependency** — no vite, no tsc, no vitest — and
the failure looks like `sh: tsc: command not found`. Run installs and builds with
`unset NODE_ENV` (or `NODE_ENV=development`). Netlify and GitHub Actions install
dev dependencies normally, so this is a local-only trap.
