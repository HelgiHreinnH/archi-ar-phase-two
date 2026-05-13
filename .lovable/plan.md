# Codebase Streamlining Plan — May 2026 Audit

Mirrors the audit's Phase A/B/C structure. Each item maps 1:1 to a finding so we can check them off against the Notion doc.

## Phase 0 — Critical (do first, separate commit)

**C-1 · Single Three.js instance**
- `index.html`: change importmap so `"three"` resolves to the self-hosted `/assets/three/three.module.js` (and add `"three/addons/": "/assets/three/jsm/"`), keep `mindar-image-three` on jsdelivr.
- Verify in DevTools Network tab on `/view/:shareId` that only one `three.module.js` is fetched, and that MindAR detection still locks (matrix instanceof checks now align).
- Risk: MindAR is pinned to a Three version range. If detection breaks, fall back to keeping unpkg but pointing the self-hosted scene loaders at the same unpkg URL — i.e. unify in the other direction. Decision criterion: whichever path keeps MindAR working.

## Phase A — Quick wins (one commit, no behavior change)

| # | Change | File |
|---|---|---|
| A2 | Delete stale `<!-- TODO -->` comments; update `meta[name=author]` | `index.html` |
| A3 | Hoist `PUBLIC_PROJECT_CACHE_TTL_MS` to module scope | `src/pages/ARViewer.tsx` |
| A4 | Drop redundant `getSession()` — rely on `INITIAL_SESSION` event | `src/hooks/useAuth.ts` |
| A5 | Inline `onTargetFound`/`onTargetLost` props (drop arrow wrappers) | `src/components/ar/ARDetection.tsx` |
| A6 | Delete unused `MarkerPoint` re-export | `src/lib/generateMarkers.ts` |

Verification: `bun run build` passes, app loads, dashboard + AR viewer smoke-test.

## Phase B — Medium effort (separate commits per item)

- **B1 · Unify toast system.** Migrate `ModelUnavailableRecovery.tsx` from `sonner` to `@/hooks/use-toast`. Remove `<Sonner />` from `App.tsx`. Verify no other `from "sonner"` imports remain (`rg "from \"sonner\""`).
- **B2 · Screenshot button.** Implement real capture via `canvas.toBlob` + download anchor (audit option B). Selector covers both MindAR (`#mindar-ar-container canvas`) and XR8 mounts; fall back to `document.querySelector("canvas")` if neither matches. Toast on success/failure.
- **B3 · Dead export.** Remove `getWarmStream` export from `src/lib/cameraPrewarm.ts` (keep internal singleton; only the prewarm trigger is used).
- **B4 · ARLanding markers UI.** Replace hardcoded A/B/C circles with N indexed circles driven by `project.marker_data?.length`. Reuse the marker color palette from `src/lib/markerTypes.ts`. Keep the >12 fallback (color + index) consistent with the marker visual identity rule.
- **B5 · Production domain.** Update `PUBLISHED_APP_URL` in `src/lib/publicExperienceUrl.ts` to `https://designingforusers.com` (current custom domain). Confirm preview origin detection still routes preview links correctly.

## Phase C — Requires planning

- **C1 · SRI for MindAR compiler CDN.** Compute the sha384 once, pin it in `src/lib/compileMindFile.ts` script tag (or fetch + integrity attr if dynamic). Re-pin whenever we bump `mind-ar` version.
- **C2 · Legacy `/dashboard/projects` routes.** Add the missing `/:id` redirect first (closes the 404 hole). Then once analytics confirm zero traffic for ~30 days, drop all three legacy routes.
- **C3 · Screenshot — covered by B2.** If we choose audit option A (remove the button) instead, C3 is dropped.

## Out of scope (audit §6 — do not touch)

`computeWorldTransform.ts`, `parseGlbMarkers.ts`, MindAR state machine in `MindARScene.tsx`, `arGyro.ts`, `assetCache.ts`, `useMultipointGeneration.ts` HEAD-verify step, `App.tsx` lazy routes, XR8 parallel loader.

## Sequencing & verification

1. Phase 0 alone → manual AR smoke test on mobile (multipoint lock + tabletop placement).
2. Phase A as one commit → build + quick click-through.
3. Phase B items as individual commits so any regression is bisectable.
4. Phase C scheduled after Phase B ships and bakes for a few days.

No DB/migration changes. No edge function changes. Frontend + `index.html` only.
