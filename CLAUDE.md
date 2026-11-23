# CLAUDE.md — Archi AR

Working guide for AI sessions in this repo. Written 21 Sep 2026.

## What this is
WebAR presentation platform for architects: upload a model from Rhino, generate a
printed marker, share an AR experience with a client by QR code. No native app.

## Stack (locked)
Vite + React 18 + TS + Tailwind + shadcn/Radix ·
8th Wall engine binary 1.0.0 — the engine for **every** mode (Tabletop/Wall: QR image
target + SLAM, auto lock, `WorldLockScene.tsx`; Spatial: every marker an image
target inside SLAM, survey + fit, manual lock, `SpatialWorldViewer.tsx`) ·
three 0.170 (PINNED — see .npmrc) ·
Supabase (DB, storage, edge functions, RLS) · Netlify hosting · Simply.com DNS.

## Rules
- **8th Wall is the only engine; MindAR is archived (decision 17 Nov 2026, phase 3
  18 Nov).** The MindAR code left `src/` for `archive/mindar/` (readable copy, not
  built — see its README) and the `mind-ar` dependency is gone. The working MindAR
  system is on branch `archive/mindar` (archived, not deleted). `arEngines.test.ts`
  fails if MindAR comes back into `src/`, `package.json` or `index.html` — bringing it
  back is a documented product decision, not a code change. Spatial runs on
  `SpatialWorldViewer.tsx` + `src/lib/spatial/adapter8thWall.ts`; generation uploads
  the marker PNGs as the 8th Wall targets and writes `tracking_format = 8thwall-image`
  (no `.mind`). `projects.mind_file_url` stays in the schema for old rows. Plan: Notion
  page "Decision: 8th Wall is the primary engine in all modes, MindAR is archived ·
  17 Nov 2026".
- **"Spatial" is a UI label only.** Never rename `mode === "multipoint"` in code,
  DB values, identifiers, filenames or imports. The rename is frontend copy.
- **Spatial marker design is LOCKED (v11, 18 Nov 2026).** Black/white organic circle,
  Ø180 mm (`SPATIAL_MARKER_MM` in `src/lib/spatial/design.ts`, = image-target
  `physicalWidthInMeters`), thin black rim, pattern generated deterministically per
  point index (seeded noise → marching squares → vector path; no colour, no text). The
  printed sheet and the 8th Wall target come from the same SVG, so they match. A4
  sheet (`sheets.ts`): "POINT n" top left and logo top right on one centre line, circle
  centred between sheet top and cut line, model name bottom left above the cut line,
  then X/Y/Z, origin row, placement steps, round QR. The old coloured dial disc (v7,
  Ø150 mm) is retired: its markers were too alike and rotationally symmetric for 8th
  Wall (ZNCC 0.89 vs ≤0.33 now). Changing the look needs a documented decision.
- **Spatial marker names (contract D11, 20 Nov 2026).** `parseGlbMarkers` reads
  `marker_A`…`marker_T` and `marker_1`…`marker_20` (`MARKER_LETTERS`). The Rhino plugin
  mirrors the letters as `PARSER_LETTERS` in `archiar_core.py` and fails its Test for any
  other name, so change both together. Contract: Notion "Spatial system contract".
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

## Spatial contract
Cross-system rules for Spatial (Rhino plugin · GLB · import · SLAM fit · camera) live in
Notion: [Spatial system contract](https://app.notion.com/p/41d3395b0b498138bfafdb40359a3e1e).
Change that page first, then the code. Shared values (marker letters A–T, sheet
210/297/180/105) are in `contracts/spatial-contract.json` (+ `src/lib/spatial/contract.ts`);
the plugin keeps a copy. Markers read from a GLB are read-only (D18); Lock needs 3 markers
and rms ≤ `LOCK_MAX_RMS_MM` (D9, `lockGuard.ts`); `n`/`up` from extras never enter the fit (D8).

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
