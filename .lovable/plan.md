## Goal

Restructure the AR layer so Tabletop and Multipoint are two fully independent trees that share only Supabase, auth, projects, storage, and QR. This unlocks shipping Tabletop now without multipoint risk, and lets Multipoint be rebuilt cleanly later (Railway compiler, Rhino plugin). After the split, apply the "Ship Tabletop Now" fixes from the roadmap and put Multipoint behind a Coming Soon state.

The plan is sequenced so each step is independently shippable. No DB schema or migration changes.

---

## Phase 1 — Hard split (architectural, no behavior change)

Target structure:

```text
src/components/ar/
  shared/                    ← used by both trees
    ARLanding.tsx
    ARPermission.tsx
    ModelUnavailableRecovery.tsx
  tabletop/
    TabletopViewer.tsx       ← was ModelViewerScene.tsx, USDZ + ar-status only
  multipoint/
    MultipointViewer.tsx     ← was MindARScene.tsx
    ARDetection.tsx          ← multipoint-only scan UI
  ARRouter.tsx               ← reads project.mode, picks one tree
```

Steps:
1. Create the three subdirectories and move existing files (no logic edits in the move commit). Update imports across `ARViewer.tsx`, wizard, dashboard.
2. Rename `ARViewer.tsx` to act as `ARRouter.tsx` semantics: it keeps the public `/view/:shareId` route and project-fetch responsibility, but delegates rendering to `TabletopViewer` or `MultipointViewer` based on `project.mode`. Neither viewer imports the other.
3. Delete `XR8Scene.tsx` and `public/assets/xr8/` (dead code per audit §13). Confirm nothing references it (`rg -n "XR8|xr8"`).
4. Split hooks: keep `useTabletopGeneration.ts` in `hooks/` (already isolated), keep `useMultipointGeneration.ts` likewise. Confirm no cross-imports.
5. Verify build, then smoke-test both modes in preview.

Deliverable: identical behavior, but each tree can now be edited in isolation.

---

## Phase 2 — Ship Tabletop fixes

Apply only to the `tabletop/` tree and shared infra:
- `ModelViewer3D.tsx` — confirm USDZ early-return is live (already done in last sessions; verify after move).
- `get-public-project/index.ts` — for the **tabletop** model URL and USDZ URL, replace `createSignedUrl` with `getPublicUrl` (bucket is public). Keep multipoint paths on signed URLs for now since multipoint is being gated.
- Storage upload in `ModelUploader.tsx` and `UsdzCompanionUploader.tsx` — add `cacheControl: '31536000, immutable'` and content-hashed filenames.
- `TabletopViewer.tsx` — add a Three.js dispose pass on unmount (geometries, materials, textures, renderer).
- Replace the 2-second `setTimeout` in tabletop `launchAR()` with a real readiness signal (model-viewer `load` event + camera ready).

---

## Phase 3 — Gate Multipoint with Coming Soon

In `NewProject.tsx`:
- Keep the Multipoint mode card visible with its description.
- Replace the CTA with a disabled button labelled "Coming soon — Rhino integration launching Q3 2026".
- Add a small waitlist link (mailto or simple form, decided with user before build).
- Existing multipoint projects in the dashboard remain viewable/editable so we don't break current users; only **new** multipoint creation is blocked.

---

## Phase 4 — Out of scope for this plan (tracked, not built now)

Roadmapped but not part of this execution:
- Railway `.mind` compilation microservice
- Rhino plugin v1.0
- Paddle credit/payment system
- Migration off Lovable Cloud to dedicated Supabase project
- IndexedDB signed-URL cache
- Coordinate round-trip push from McNeel folder
- Test suite

These each warrant their own plan once Tabletop is live.

---

## Verification per phase

- Phase 1: `bun run build` clean, `/view/:shareId` loads for one tabletop and one multipoint project, no console errors, no XR8 imports remain.
- Phase 2: tabletop QR opens AR on iOS Safari without 403s; repeat load is visibly faster; mobile heap stays flat across multiple AR opens.
- Phase 3: `/dashboard/experiences/new` shows Multipoint disabled; existing multipoint projects still render.

---

## Open questions before building

1. For the Multipoint "Coming Soon" gate — waitlist mailto, simple Supabase table, or just a static message?
2. Should existing multipoint projects keep working in the AR viewer, or also show "Coming soon" to clients? (Recommendation: keep working for existing ones, block only new creation.)
3. Confirm we keep `ARViewer.tsx` as the route file and add `ARRouter` logic inside it, vs renaming the file (rename touches `App.tsx` route import only).
