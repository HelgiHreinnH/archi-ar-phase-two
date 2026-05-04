# Phase 5 — Off-thread parsing & GLB compression

Two independent sub-phases. Ship 5.2 first (biggest absolute win — typically 5–10× model size reduction), then 5.1 (smoothness during placement).

---

## 5.2 — Automatic GLB compression at upload time (priority)

**Goal:** Every uploaded GLB is automatically optimized server-side. Typical 8–15 MB models become 1.5–3 MB. The viewer code path stays unchanged — projects just point at the optimized file.

### New edge function: `optimize-model`

Path: `supabase/functions/optimize-model/index.ts`. Standard Lovable Cloud setup (manual CORS, JWT validated in code, uses service-role key for storage writes).

Inputs (POST JSON):
- `projectId: string`
- `inputPath: string` — the storage path the client just uploaded to (e.g. `${projectId}/model.glb`)

Flow:
1. Validate JWT, confirm `auth.uid()` owns the project (`is_project_owner` RPC already exists).
2. Download the original from `project-models` via service role.
3. Run through `gltf-transform` pipeline:
   - `dedup()` + `prune()` + `weld()` (geometry cleanup, removes unused nodes/textures/materials)
   - `resample()` (animation cleanup if present)
   - `draco({ method: 'edgebreaker' })` for geometry compression
   - `textureCompress({ targetFormat: 'webp', quality: 80, resize: [2048, 2048] })` — WebP is well-supported by Three.js's GLTFLoader and avoids the KTX2/Basis worker setup. Resizing caps oversized textures to 2K.
4. Upload to `${projectId}/optimized.glb` in the same `project-models` bucket (`upsert: true`).
5. Update `projects.model_url = '${projectId}/optimized.glb'` and a new `projects.original_model_url` (preserved for re-runs / debugging).
6. Return `{ ok: true, optimizedPath, originalSize, optimizedSize, ratio }`.
7. On any failure: leave `model_url` pointing at the original, return `{ ok: false, error }` so the client surfaces it but keeps the project usable.

Dependencies (npm specifiers, edge-runtime safe):
- `npm:@gltf-transform/core`
- `npm:@gltf-transform/extensions`
- `npm:@gltf-transform/functions`
- `npm:draco3dgltf` (Draco encoder)
- `npm:sharp` for `textureCompress` — verify this loads in Deno edge-runtime; if not, fall back to `textureCompress` with the built-in encoder or skip texture compression and rely on Draco-only (still ~3–5× saving on geometry-heavy models).

### DB migration
- Add nullable column `projects.original_model_url text`.

### Client wiring
- `src/components/ModelUploader.tsx`: after the existing storage upload + `projects.update({ model_url })`, immediately call `supabase.functions.invoke('optimize-model', { body: { projectId, inputPath: filePath } })`.
- New UI state in the uploader between "uploaded" and "done": **"Optimizing model… (this can take 30–60s)"** with a spinner, replacing the current immediate success toast.
- On success: show "Optimized: 12.3 MB → 2.1 MB (5.8× smaller)" toast.
- On failure: show "Optimization skipped — using original" toast (non-blocking) and proceed normally.
- Same call wired into `src/components/wizard/StepModel.tsx` (whichever path is in active use; both call `ModelUploader`).
- Don't run optimization for `.usdz` (Apple-native, leave untouched).

### Cache implications
The `projects.updated_at` field auto-bumps when we write the new `model_url`, which naturally invalidates the Phase 4 IndexedDB cache for any user who previously loaded the unoptimized version. No extra work needed.

---

## 5.1 — Off-thread GLTF parsing (smaller win, ships after 5.2)

**Goal:** Keep camera tracking smooth during the parse-and-place transition. Today, parsing a 5 MB GLB blocks the main thread for 200–600 ms on mid-range Android.

### Changes
- `public/assets/three/jsm/loaders/DRACOLoader.js` — self-host alongside the existing GLTFLoader (Phase 2 pattern).
- `public/assets/three/jsm/libs/draco/` — host the Draco decoder WASM + JS files (`draco_decoder.wasm`, `draco_wasm_wrapper.js`, plus the JS fallback). These ship with three.js.
- `src/components/ar/XR8Scene.tsx` and `src/components/ar/MindARScene.tsx`:
  - Dynamically import `DRACOLoader`, configure with `setDecoderPath('/assets/three/jsm/libs/draco/')` and `setWorkerLimit(2)`.
  - Attach to the existing GLTFLoader via `loader.setDRACOLoader(dracoLoader)`.
  - Switch from `loader.load(url, onLoad)` to `loader.parseAsync(arrayBuffer, '')` so parsing yields properly between chunks. Keep the existing prefetched-buffer code path from Phase 1.
- No API changes for the rest of the AR pipeline — `onLoad` semantics are preserved.

### Why this matters with 5.2
After 5.2 every model arrives Draco-encoded, so DRACOLoader is no longer optional — it's required for the viewer to render the optimized GLBs. 5.1 must ship in the same release as 5.2 (or immediately after) for backward compatibility, otherwise old optimized models will fail to load.

**Sequencing:** ship 5.1 (decoder hosted + wired) first as a no-op for current models, then ship 5.2 to start producing Draco GLBs. This avoids any window where new GLBs exist that the viewer can't decode.

---

## Validation
- Upload a known-large GLB (10+ MB) through the wizard → confirm "Optimizing…" UI → check `projects` table for `optimized.glb` path and bytes saved.
- Open the experience on mobile → tracking initializes, model renders identically to original.
- Republish → IDB cache key changes → fresh download of the new optimized file.
- Phase 1.4 progress bar still reports correct byte totals against the optimized file.

## Out of scope
- KTX2/Basis textures (deferred — needs Basis transcoder worker; WebP gets us most of the way).
- Reprocessing existing already-uploaded models (one-time backfill script could be added later if needed).
- LOD generation.

## Files touched
- New: `supabase/functions/optimize-model/index.ts`
- New: `public/assets/three/jsm/loaders/DRACOLoader.js`
- New: `public/assets/three/jsm/libs/draco/*` (decoder assets)
- Migration: add `projects.original_model_url`
- Edited: `src/components/ModelUploader.tsx`, `src/components/ar/XR8Scene.tsx`, `src/components/ar/MindARScene.tsx`, `.lovable/plan.md`
