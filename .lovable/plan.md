# AR Performance Boost — Implementation Plan

Based on the May 2026 brainstorm. Targets the three biggest dead-air moments: button → camera (~4s), blank-cube model load (~6.25s), and AR placement (~12.5s). Phased so each phase ships independently and is measurable.

## Phase 1 — Quick wins (highest ROI, ~1 session)

**1.1 Parallel XR8 script loading**
`src/components/ar/XR8Scene.tsx` `loadXR8Engine()` currently awaits the three scripts sequentially (1MB + 5.3MB + 132KB). Switch to `Promise.all([...])`. The browser preserves execution order automatically. Expected saving: 2–4s on 4G.

**1.2 Preload + preconnect on landing**
In `src/components/ar/ARLanding.tsx`, inject `<link rel="preload" as="script">` for `/assets/xr8/xr8.js`, `/assets/xr8/xr-slam.js`, `/assets/xr8/xrextras.js` and `<link rel="preconnect">` for `unpkg.com`, `cdn.jsdelivr.net` on mount. Downloads start during the 2–4s the user reads the landing page.

**1.3 DNS-prefetch in index.html**
Add `dns-prefetch`/`preconnect` tags for unpkg, jsDelivr, ga.jspm.io in `<head>`.

**1.4 Real GLB download progress**
Replace the `fetch().arrayBuffer()` in `ARDetection.tsx` (and the equivalent in `ARViewer`/scenes) with a `ReadableStream` reader using `Content-Length`. Surface a real `<Progress>` bar in the "Loading 3D model…" state instead of the static cube. Same load time, much better perceived speed.

**1.5 Cap renderer pixel ratio**
In `XR8Scene.tsx` and `MindARScene.tsx`, enforce `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`. One-line fix that halves GPU fill on 3× Retina iPhones.

**1.6 Lock camera resolution**
Pass explicit `{ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } }` constraints wherever `getUserMedia`/XR8 camera config is invoked, so iOS doesn't pick 4K.

## Phase 2 — Camera pre-warm + asset prefetch parallelism ✅

**2.1 Pre-warm camera during landing** ✅
`src/lib/cameraPrewarm.ts` holds a singleton `MediaStream`. `ARLanding` calls `prewarmCamera()` on mount (silent — only acquires if Permissions API reports `granted`) and again on the Launch AR click as a user-gesture fallback. Stream is released on `pagehide`, not on internal navigation.

**2.2 Prefetch `.mind`/`.wtc` in parallel with GLB** ✅
`ARDetection.tsx` now fires a `cache: "force-cache"` fetch for `imageTargetSrc` alongside the streamed GLB prefetch, so both arrive together.

**2.3 Self-host Three.js + GLTFLoader** ✅
`public/assets/three/three.module.js` + `public/assets/three/jsm/loaders/GLTFLoader.js` (rewrote the bare `from 'three'` import to a relative path). `XR8Scene` and `MindARScene` now load both from same-origin URLs.

## Phase 3 — Bundle & code-splitting ✅

**3.1 Route-level `React.lazy`** ✅
`src/App.tsx` converts every route to `lazy()` with a single `<Suspense>` fallback. The `/view/:shareId` route no longer pulls dashboard, project-detail, settings or wizard code into its initial bundle.

**3.2 Vite manual chunks** ✅
`vite.config.ts` splits `vendor-react`, `vendor-query`, `vendor-supabase`, and a `vendor-radix` cluster into long-lived chunks that survive deploys.

**3.3 Lazy-load `@google/model-viewer`** ✅
Removed the top-level `import "@google/model-viewer"` from `ModelViewerScene.tsx` and `ModelViewer3D.tsx`; both now `import()` it inside a `useEffect` and gate rendering on `customElements.get("model-viewer")`. The multi-point AR path no longer ships ~200KB it never uses.

## Phase 4 — Persistent caching ✅

**4.1 IndexedDB cache for GLB + tracking files** ✅
`src/lib/assetCache.ts` is a tiny IDB wrapper (no external dep) keyed by `shareId + project.updated_at`. `ARDetection.tsx` checks the cache before each prefetch and writes back on success. Repeat visits to the same experience load the GLB with zero network bytes. Republish bumps `updated_at`, naturally invalidating the cache.

**4.2 Signed URL session cache** ✅
`ARViewer.tsx` caches the `get-public-project` response in `sessionStorage` for 10 minutes (well inside the 2h signed-URL window). Internal navigation/refresh skips the edge-fn round-trip. The cache is busted explicitly in the Launch AR refetch path so signed URLs are always fresh at the start of an AR session. The edge function now also returns `updated_at` so the IDB cache key stays stable across reloads.

## Phase 5 — Off-thread parsing & GLB optimization (medium effort)

**5.1 GLTFLoader on a worker thread**
Use `loader.parseAsync` with `DRACOLoader` configured with a worker. Keeps camera tracking smooth during the parse-and-place transition.

**5.2 GLB compression at upload time** (highest single ROI from brainstorm)
New Supabase Edge Function `optimize-model` triggered after upload. Pipes the uploaded GLB through `gltf-transform` (Draco geometry + KTX2 textures + weld + prune). Stores `optimized.glb` next to the original; the project record points to the optimized one. Typical 8–15MB → 1.5–3MB. Loader code stays unchanged.
- Upload UX: show "Optimizing model…" step in `ModelUploader`/wizard while the function runs.
- Fallback: if optimization fails, keep the original.

## Out of scope for this plan
- Cloudflare CDN in front of Supabase Storage (infra change, requires DNS access — flag as a follow-up).
- Service Worker for repeat visitors (revisit after Phase 4 IndexedDB lands; partly redundant).
- LOD-0 proxy mesh streaming (defer until after compression measurements show whether it's still needed).

## Suggested ship order
Phase 1 → Phase 2 → Phase 4 → Phase 3 → Phase 5. (Phases 1, 2, 4 are user-visible perf; 3 is build hygiene; 5 is the biggest absolute win but largest scope.)

## How we'll know it worked
After each phase, re-record the QR → AR flow on the same device/network and compare against the brainstorm's baseline metrics:
- Button tap → camera open (target: <1.5s after Phase 1+2)
- "Loading 3D model…" duration (target: <2s after Phase 5, perceived <1s after Phase 1.4 progress bar)
- Time to model placed (target: <5s end-to-end after all phases)

Want me to start with Phase 1, or bundle Phases 1+2 into the first implementation pass?
