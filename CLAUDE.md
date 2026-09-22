# CLAUDE.md — Archi AR

Working guide for AI sessions in this repo. Written 21 Sep 2026, when Lovable was
removed from the toolchain.

## What this is
WebAR presentation platform for architects: upload a model from Rhino, generate a
printed marker, share an AR experience with a client by QR code. No native app.

## Stack (locked)
Vite + React 18 + TS + Tailwind + shadcn/Radix · MindAR.js 1.2.5 (Spatial) ·
Google Model Viewer (Tabletop/Wall) · three 0.170 (PINNED — see .npmrc) ·
Supabase (DB, storage, edge functions, RLS) · Netlify hosting · Simply.com DNS.

## Rules
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
- One tap is the floor. `getUserMedia` and native AR both require user activation;
  zero-tap is not achievable in a browser.

## Deploy
`main` -> Netlify -> designingforusers.com. PRs get deploy previews.
Build config is in `netlify.toml`, install flags in `.npmrc` — both in git, so
local, CI and Netlify agree. Nothing important lives only in a hosting dashboard.

## Backend
Migrating off Lovable Cloud Supabase (`hjaqqfuebfpxpbyldcso`) to the dedicated
project `archi-ar` / `njrytsladmfhbttsitmn` (eu-central-1). `MIGRATION.md` is the
runbook. Until that is done, the app still reads the Lovable-managed instance.

## Documentation
Code-adjacent `.md` stays in the repo (this file, `MIGRATION.md`, READMEs).
Reading material — audits, decision docs, session notes — goes to Notion, which is
the source of truth for documentation.

## Local environment gotcha
`NODE_ENV=production` is exported in the shell on this machine. With it set, `npm
install` **silently omits every devDependency** — no vite, no tsc, no vitest — and
the failure looks like `sh: tsc: command not found`. Run installs and builds with
`unset NODE_ENV` (or `NODE_ENV=development`). Netlify and GitHub Actions install
dev dependencies normally, so this is a local-only trap.
