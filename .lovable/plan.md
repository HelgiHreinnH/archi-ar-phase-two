# Multi-Point AR — Fix & Polish Plan

Based on the May 2 Platform Assessment and a fresh code audit, three of the four "blocking bugs" listed in Notion are **already fixed in the codebase** (GLTFLoader CDN URL, `.mind` wiring in `useMultipointGeneration`, gyro quaternion + screen orientation correction). What remains is **Fix 3 (model URL delivery for QR clients)** plus a set of robustness gaps that surface once a real client-facing session runs end-to-end.

This plan addresses those remaining issues and adds the small UX/observability work needed before an architect takes the system to a real site.

---

## 1. Model URL delivery for QR clients (Fix 3, adapted)

The Notion doc recommends swapping `createSignedUrl` for `getPublicUrl`. That cannot be applied directly — the storage buckets are **private by design** (per the project's storage security memory) and must stay that way. The actual problem is the **15-minute signed-URL TTL** in `get-public-project`: a client who scans the QR, walks to the space, and starts AR 16 minutes later sees a silent 400/403 on the model fetch.

**Changes:**
- `supabase/functions/get-public-project/index.ts`
  - Bump `SIGNED_URL_EXPIRY` from `900` (15 min) to `7200` (2 hours) for model + mind + tracking + marker assets. Long enough for a full client walkthrough; short enough to remain a credential.
  - Add explicit `error` field to the response when `model_url` is set but signing failed, so the viewer can show a real error instead of a blank screen.
  - Tighten the `catch` block: log `err.message` to function logs (currently swallowed) so we can diagnose 500s.

- `src/pages/ARViewer.tsx`
  - Show a clear "Model unavailable — please refresh the page" error if `publicModelUrl` is null after load (currently falls into a generic "Preparing 3D model…" spinner forever for multipoint and a blank for the model-viewer branch).
  - When the QR landing page is open for a long time (e.g. >90 min), re-invoke `get-public-project` on `launchAR()` to refresh signed URLs before entering AR. Use react-query's `refetch()`.

## 2. Edge function hardening

The "Invalid share link format" error from earlier in this thread shows the edge function is being called with non-UUID `shareId`s in some flows.

- `src/pages/ARViewer.tsx` already gates on the UUID regex before calling — keep that.
- In the edge function, return a `200` with `{ project: null, reason: 'invalid' }` instead of `400` for malformed IDs, so react-query doesn't treat it as a network error and retry-loop. Surface "Experience Not Found" UI either way.
- Add a structured response shape: `{ project, urls: { model, mind, tracking, qr, markers } }` rather than spreading signed URLs over the project record. Cleaner client code and easier to extend in Phase 3.

## 3. `.mind` verification gate in generation

The generation hook now compiles and uploads the `.mind` file, but never verifies it can actually be re-fetched and parsed before flipping `status: active`. A failed upload silently activates a dead project.

- `src/hooks/useMultipointGeneration.ts`
  - After uploading `targets.mind`, fetch a signed URL and `HEAD` the file to confirm it's reachable.
  - Optionally also verify byte-length > some sane minimum (>1KB).
  - Only then run the `status: 'active'` update. On failure, surface a toast and leave the project in `draft`.

## 4. Gyro robustness — DeviceMotion fallback

The current `arGyro.ts` listens only to `deviceorientation`. On some Android browsers (and in iframe previews) `deviceorientation` never fires while `devicemotion` does. The walk-around then degrades to "no rotation compensation at all" with no warning.

- `src/lib/arGyro.ts`
  - In `createGyroListener`, if no `deviceorientation` event arrives within 1500 ms, attach a `devicemotion` listener and integrate `rotationRate` to derive a synthetic alpha/beta/gamma. Mark the source on `hasGyroRef` so callers can warn.
- `src/components/ar/MindARScene.tsx`
  - If neither source produces data within 3 s of locking, show a one-time toast: "Gyroscope unavailable — model may drift if you walk around."

## 5. N-marker UX polish

The marker status UI (per the marker memory) supports up to 6 with badges and >6 with a progress bar, but the **detection guidance text** is fixed-string. When 7+ markers are configured, the user has no idea which physical marker to scan next.

- `src/components/ar/ARDetection.tsx`
  - When >6 markers, surface the **next un-detected marker by index + colour swatch** in the bottom guidance area: "Scan marker #4 (orange) next".
  - Include a "Skip — I have at least 3" button once ≥3 markers are detected, so triangulation can start without forcing the architect to walk to every single one. (Procrustes already works on the best 3 of N.)

## 6. Observability for first end-to-end test (Action Item #6)

Helgi's first end-to-end test is the key Phase-2 milestone. Make it diagnosable.

- Add lightweight console-tagged logs (`[ar-flow]`, `[ar-detect]`, `[ar-lock]`) at every state transition in `MindARScene` and `ARViewer`, gated by a `?debug=1` URL param so production sessions stay quiet.
- When `?debug=1` is set, render a tiny floating panel showing: detected markers, locked state, current gyro source, signed-URL expiry countdown.

## 7. Out of scope for this pass

- **Phase 3 — server-side `.mind` compilation via 8th Wall `image-target-cli`.** Recorded in the AR Engine memory; tracked in the Notion roadmap; needs its own planning round once the open-source XR Engine license FAQ has been read.
- **Phase 4 — XR8 World Effects SLAM walk-around.** XR8Scene scaffolding is already in the repo behind the `tracking_format = '8thwall-wtc'` switch. No code changes here until Helgi self-hosts the engine binaries.
- **Tabletop "Activate AR / camera" bug** referenced earlier — still awaiting clarification on which exact button labels are involved; not bundled into this multi-point plan.

---

## Technical summary (for reference)

```text
File                                        Change
------------------------------------------  -----------------------------------------
supabase/functions/get-public-project/      TTL → 2h, structured response, log errors
src/pages/ARViewer.tsx                       Refetch URLs on launchAR, error UI
src/hooks/useMultipointGeneration.ts         Verify .mind reachability before activate
src/lib/arGyro.ts                            DeviceMotion fallback path
src/components/ar/MindARScene.tsx            Gyro-missing toast, debug logs
src/components/ar/ARDetection.tsx            N-marker next-marker hint, "Skip" CTA
```

No database migrations, no new dependencies, no new edge functions. All changes are additive within the existing multipoint pipeline.
