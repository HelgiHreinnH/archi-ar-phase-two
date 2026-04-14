

# 8th Wall Migration Plan

## Summary

Migrate the AR engine from MindAR to 8th Wall XR8 to gain SLAM-based world tracking. The model will hold position when markers leave the camera frame, eliminating the gyro-drift problem after 3-5 minutes.

## Pre-Requisite Gate

**iOS SLAM validation must pass before any code is written.** You need to test an 8th Wall SLAM example on a real iPhone in a real room. If the model drifts during a 10-minute walkthrough, the migration rationale changes. This is your go/no-go decision.

## Architecture Decision: .wtc Compilation

The 8th Wall Image Target CLI (`@8thwall/image-target-cli`) is a Node.js tool. It cannot run in the browser or in Supabase Edge Functions (Deno). Two viable approaches:

- **V1 (ship first):** Manual workflow. The wizard generates marker images, the architect downloads them, runs `npx @8thwall/image-target-cli compile` locally, then uploads the `.wtc` file back through a file upload field in the wizard.
- **V2 (production):** A Vercel serverless function that accepts marker images and returns the compiled `.wtc` file. Requires deploying to Vercel.

**Recommendation:** Start with V1 to unblock development and testing. Add V2 later for a seamless UX.

## Implementation Steps

### Step 1 — Database Migration
Add two columns to the `projects` table:
- `tracking_file_url TEXT` — stores the `.wtc` file URL
- `tracking_format TEXT DEFAULT 'mindar-mind'` — routes AR viewer to the correct engine

Update `get-public-project` edge function to select and sign `tracking_file_url`.

### Step 2 — Self-Host 8th Wall Engine
Download XR8 engine binary from `github.com/8thwall/engine` and `xrextras` from `github.com/8thwall/web`. Place in `public/assets/` as static files (not Vite-bundled). These load dynamically only in the AR viewer.

### Step 3 — Create XR8Scene Component
New file: `src/components/ar/XR8Scene.tsx`
- Initialize XR8 pipeline with `XR8.XrController` (SLAM, `scale: 'absolute'`), `XR8.GlTextureRenderer`, `XR8.Threejs`
- Build a custom pipeline module that listens for `reality.imagefound`, `reality.imageupdated`, `reality.imagelost`
- Construct `THREE.Matrix4` from event payloads, feed into existing `computeWorldTransform.ts` (unchanged)
- Retain `arGyro.ts` as secondary smoothing

### Step 4 — Update ARDetection to Route by Engine
Modify `src/components/ar/ARDetection.tsx`:
- Accept `trackingFormat` prop
- If `'8thwall-wtc'` → render `XR8Scene`
- If `'mindar-mind'` (default) → render `MindARScene` (existing, kept as fallback)

### Step 5 — Update ARViewer
Modify `src/pages/ARViewer.tsx`:
- Read `tracking_format` from the project data returned by edge function
- Pass it to `ARDetection`
- **Fix Bug 3:** Remove the tabletop early return that sends to `ModelViewerScene` — route through the AR pipeline instead
- **Fix Bug 1:** Change GLTFLoader bare import to full unpkg URL: `https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js`

### Step 6 — Add .wtc Upload to ExperienceWizard
Modify `src/components/ExperienceWizard.tsx` and create a new wizard sub-step:
- After marker images are generated, show a "Download Marker Images" button
- Add a `.wtc` file upload field
- Upload the file to `project-models/${projectId}/markers.wtc`
- Save URL to `projects.tracking_file_url`, set `tracking_format = '8thwall-wtc'`

### Step 7 — Add Briefing Screen
New loading state in `ARViewer.tsx` between QR scan and camera launch:
- Shows project name, architect name, visual loading indicator
- Replaces the current silent loading gap

### Step 8 — Fix Bug 4 (Model URL Verification)
End-to-end test that `get-public-project` returns a working signed URL for unauthenticated clients. The current implementation uses `createSignedUrl` with service role key, which should work — but needs verification on a real device.

## Files Changed

| File | Action |
|------|--------|
| `src/components/ar/XR8Scene.tsx` | NEW |
| `src/components/ar/ARDetection.tsx` | Add engine routing |
| `src/components/ar/MindARScene.tsx` | Fix GLTFLoader URL (Bug 1), keep as fallback |
| `src/pages/ARViewer.tsx` | Fix tabletop routing (Bug 3), add tracking_format, briefing screen |
| `src/components/ExperienceWizard.tsx` | Add .wtc upload step |
| `supabase/functions/get-public-project/index.ts` | Select + sign tracking_file_url |
| `public/assets/` | 8th Wall engine + xrextras static files |
| 1 DB migration | Add tracking_file_url + tracking_format |

## Files NOT Changed
- `computeWorldTransform.ts` — framework-agnostic math
- `arGyro.ts` — retained as secondary layer
- All dashboard components
- Auth, storage buckets, RLS policies

## What You Need to Provide
1. **iOS SLAM test result** — go/no-go
2. **8th Wall engine files** — download from `github.com/8thwall/engine` and `github.com/8thwall/web`, then upload to the project
3. **Compilation approach choice** — V1 (manual CLI) or V2 (Vercel serverless)

## Estimated Effort
1.5-2.5 days of implementation once prerequisites are resolved.

