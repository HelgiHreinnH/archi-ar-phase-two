
# Full AR Codebase Review: Stability & Correctness Audit

This is a complete walkthrough of every file that touches the AR experience — from the user scanning a QR code to the 3D model appearing in the room. Issues found are categorised by severity: **Critical** (will break the experience), **Warning** (risk of breakage under edge cases), and **Info** (minor improvements).

---

## 1. Entry Point: Routing (`src/App.tsx`)

**Status: Stable**

The public AR route is:
```
/view/:shareId  →  ARViewer
```
This is correct and completely unauthenticated — no auth wrapper around it. The route is clean.

---

## 2. Data Loading: ARViewer (`src/pages/ARViewer.tsx`)

**Issues found: 2**

### 2a. WARNING — `signedModelUrl` may still be `undefined` when `ARDetection` mounts

The signed URL query has `enabled: !!project?.model_url && viewState === "detecting"`. This means the query only fires when you enter the "detecting" state. However, `ARDetection` mounts immediately at that same render, and `MindARScene` also mounts immediately. The `modelUrl` prop passed to `ARDetection` (and then to `MindARScene`) will be `undefined` for the first render tick while the query runs.

`MindARScene` handles `modelUrl` being null/undefined by skipping the GLB load (`if (i === 0 && modelUrl)`), so the model never loads even if the URL resolves later — because `MindARScene`'s `useEffect` only runs once on mount. The result is: the AR scene starts with no model, and the model never appears.

**The fix:** Either pass `signedModelUrl` only once it is resolved (don't switch to "detecting" until the URL is ready), or move the signed URL fetch to start when the project loads (remove the `viewState === "detecting"` condition from `enabled`).

### 2b. INFO — `handleReset` in ARViewer is not wired to ARDetection

`handleReset` exists in `ARViewer` (lines 79–82) and bumps `resetKey`, which remounts `ARDetection`. But it is never passed into `ARDetection` — `ARDetection`'s reset button (`setIsActive(false)`) just resets the UI state, not the AR session. This is intentional (the plan said to keep MindARScene mounted), but it means the `handleReset` function is dead code in `ARViewer`. Low risk but confusing.

### 2c. INFO — Scale parsing is now correct but fragile

```ts
const scaleNum = project.scale
  ? parseFloat(project.scale.split(":")[1]) || 1
  : 1;
```

This correctly extracts `50` from `"1:50"`. However `split(":")[1]` would return `undefined` if the stored value has no colon (e.g. a legacy value of `"20"`). `parseFloat(undefined)` returns `NaN`, and `NaN || 1` returns `1`. So the fallback to `1` works — but silently. Acceptable for now.

---

## 3. AR State Machine: ARDetection (`src/components/ar/ARDetection.tsx`)

**Issues found: 3**

### 3a. CRITICAL — Tabletop "all detected" logic is wrong

```ts
const totalMarkers = isMultipoint ? 3 : 1;
const allDetected = detectedCount === totalMarkers;
```

For tabletop mode (`isMultipoint = false`), `totalMarkers = 1`. The marker state in `ARViewer` initialises as `{ A: "searching", B: "searching", C: "searching" }` — three A/B/C markers. In `ARDetection`, `detectedCount` counts all values that are not `"searching"`. For tabletop, when target index 0 is found, `ARViewer.handleTargetFound` sets `markers.QR = "detected"`. But the initial state also has A, B, C — all "searching". So `detectedCount` counts only QR = 1, and `totalMarkers = 1`, so `allDetected = true`. This part works. **However**, if the user resets (goes back to landing and re-enters detecting), the markers state in `ARViewer` still has `{ A: "searching", B: "searching", C: "searching" }` — the QR key is absent. So the first detection correctly adds `QR: "detected"` and `allDetected` triggers. This is fine.

Actually re-reading more carefully: for tabletop mode, `ARViewer.handleTargetFound` sets `markers.QR` but `ARDetection` also checks `markers["QR"]` in the UI. The initial `ARViewer` state has no `QR` key, so `markers["QR"]` is `undefined` which is treated as "searching" — correct. **This is actually fine.**

### 3b. WARNING — `handleScreenshot` is a stub

The screenshot button in the active phase (line 74–76) shows a toast saying "Image saved to your photo library" but doesn't actually capture anything. If a user taps it, they will be misled into thinking a photo was saved. This should either be implemented or the button removed.

### 3c. INFO — "Reset" in active phase goes back to detection UI but MindAR is still running

The reset button `onClick={() => setIsActive(false)}` takes the user back to the detection UI with the scanning guide. But `worldPlaced` inside `MindARScene` is already `true` and `model.matrixAutoUpdate` is `false`. If the user scans the marker again, `onTargetFound` fires but the world-placement block won't run again (`if (model && !worldPlaced)` is false). So scanning again won't move the model. The UI implies re-scanning is possible, but the model won't actually re-anchor. This could confuse users.

---

## 4. AR Engine: MindARScene (`src/components/ar/MindARScene.tsx`)

**Issues found: 3**

### 4a. CRITICAL — Model URL race condition (related to ARViewer 2a above)

`MindARScene` runs `startAR()` once on mount (via `useEffect` with `[startAR]` dependency). Inside `startAR`, at line 145:

```ts
if (i === 0 && modelUrl) {
  // load GLB
}
```

If `modelUrl` is `null` or `undefined` when the component mounts (because the signed URL hasn't resolved yet), the model load is skipped entirely. There is no retry mechanism. The component will show the camera feed with no model.

**This is the most likely cause of "model never appeared" issues.** The `startAR` callback has `modelUrl` in its dependency array — so in theory, if `modelUrl` changes from null to a real URL, `startAR` gets a new reference, the `useEffect` re-runs, and `startAR` is called again. But calling `startAR` twice would try to create a second `MindARThree` instance on the same container, and the first one is still running. This could crash.

**The real fix:** Don't mount `MindARScene` until `signedModelUrl` is resolved. In `ARViewer`, keep `viewState === "detecting"` for rendering but add a loading state while `signedModelUrl` is pending.

### 4b. WARNING — Two `requestAnimationFrame` frames may not be enough on slow/low-power devices

The world-placement defers by exactly two frames (~32ms at 60fps, but could be 100–200ms on throttled mobile CPUs). On low-end Android devices, MindAR's pose estimation may not have stabilised in two frames. A more robust approach is a 5-frame defer or a short fixed delay (100ms via `setTimeout`).

### 4c. WARNING — `model.matrixAutoUpdate = false` after `decompose` means animations won't play

If the GLB model contains embedded animations (skinned meshes, morph targets), setting `matrixAutoUpdate = false` on the root group won't break them, but any code that later tries to set `model.position` or `model.rotation` won't work without setting `matrixAutoUpdate = true` first. This is acceptable for a static architectural model but worth noting.

### 4d. INFO — CSS style injection uses `document.head.appendChild` but cleanup removes it

The `styleTag` is appended to `document.head` and cleaned up on unmount. This is correct. But if `startAR` throws before `containerRef.current.id = containerId`, the style tag is never created — so no cleanup issue. Cleanup is safe.

### 4e. INFO — `THREE_ESM_URL` and `GLTF_LOADER_URL` version mismatch risk

`THREE_ESM_URL = "https://unpkg.com/three@0.160.0/build/three.module.js"` — explicit version ✓

`GLTF_LOADER_URL = "three/addons/loaders/GLTFLoader.js"` — this resolves via the importmap to `three/addons/`, which also pins to `three@0.160.0` ✓

Both are consistent. Good.

---

## 5. Scale Calculation in MindARScene

**Status: Correct with one note**

```ts
const normalizedScale = (MARKER_SIZE_MM / modelScale) / maxDim;
```

With `MARKER_SIZE_MM = 150` and `modelScale = 1` (1:1):
- A model with `maxDim = 150mm` → `normalizedScale = (150/1) / 150 = 1.0` → 1 MindAR unit → appears same width as the physical marker. **Correct.**
- A model with `maxDim = 800mm` (a chair) → `normalizedScale = 150 / 800 = 0.1875` → appears ~18.75cm wide relative to a 15cm marker. At 1:1, a chair at 800mm should appear about 5.3× wider than the marker. **This is correct physical mapping.**

For `modelScale = 50` (1:50):
- Same chair: `(150/50) / 800 = 3 / 800 = 0.00375` → appears 0.5625mm relative to marker. **Correct — 50× smaller than 1:1.**

The formula is mathematically correct.

**One note:** `FLOAT_ABOVE_MARKER = 0.04` is in MindAR scene units. MindAR scene units are approximately equal to the physical marker width (150mm). So `0.04 units = 0.04 × 150mm = 6mm` of float, not 40mm as described in comments. To float 40mm: `0.04 / 0.15 = 0.267 units`. This is a comment/constant bug — the float is actually only 6mm above the marker, not 40mm.

---

## 6. Generation Pipeline: GenerateExperience (`src/components/GenerateExperience.tsx`)

**Status: Stable, with one concern**

### 6a. INFO — QR code is generated twice

The QR code is generated once during `handleGenerate` for storage upload, and a second time in the "Download QR Code" button handler. This is fine (idempotent), just slightly redundant.

### 6b. INFO — `project.mind_file_url` accessed via `(project as any).mind_file_url`

Line 572: `{(project as any).mind_file_url && ...}` — the `as any` cast suggests TypeScript doesn't know about this field on the `Project` type. This is a types file sync issue. The field is queried correctly in `ARViewer` via the `.select()` string, so the data is there at runtime. Low risk.

---

## 7. Marker Generation (`src/lib/generateMarkers.ts` and `generateTabletopMarker.ts`)

**Status: Stable**

Both files generate 1200×1200 canvas images. The tabletop marker uses a high-contrast geometric pattern (QR-style corners, concentric rings, crosshairs). The multipoint markers use solid-colour backgrounds with large letters. Both meet MindAR's minimum 512×512 requirement and are high-contrast enough for reliable detection.

---

## 8. MindAR Compiler (`src/lib/compileMindFile.ts`)

**Status: Stable**

Uses a module script tag with a `waitForCompiler` poll loop (10s timeout). This is robust. One minor note: if `loadCompilerScript` is called a second time (e.g. re-generating), `window.__MINDAR_COMPILER_LOADED` guard prevents double-loading. Correct.

---

## 9. Landing, Permission, and Active screens

**ARLanding** — Pure UI, no logic issues. Correctly shows scale for tabletop only.

**ARPermission** — Pure UI, two buttons (Cancel → landing, Retry → detecting). Correct.

**ARActiveView** (`src/components/ar/ARActiveView.tsx`) — This file still exists in the codebase but is **no longer used**. The active phase UI was moved inline into `ARDetection`. This is dead code that could cause confusion during future edits.

---

## 10. ImportMap (`index.html`)

**Status: Stable**

Three.js r160 is pinned consistently in both the importmap and the CDN URL in `MindARScene.tsx`. The `es-module-shims` polyfill is loaded async before the importmap (correct order). No issues.

---

## Summary of Issues

| # | File | Severity | Issue |
|---|------|----------|-------|
| 1 | `ARViewer.tsx` | **Critical** | `signedModelUrl` is null when `MindARScene` mounts — model never loads |
| 2 | `MindARScene.tsx` | **Critical** | Linked to #1 — no model URL on mount, no retry, second `startAR` call would crash |
| 3 | `ARDetection.tsx` | **Warning** | Screenshot button is a stub — misleads users |
| 4 | `ARDetection.tsx` | **Warning** | Reset (setIsActive false) re-shows scanning UI but `worldPlaced` prevents re-anchoring |
| 5 | `MindARScene.tsx` | **Warning** | Two RAF frames may not be enough on slow devices — model still locks to screen |
| 6 | `MindARScene.tsx` | **Info** | `FLOAT_ABOVE_MARKER = 0.04` comment says 40mm but actual float is ~6mm |
| 7 | `ARActiveView.tsx` | **Info** | File is dead code — no longer imported anywhere |
| 8 | `ARViewer.tsx` | **Info** | `handleReset` function is dead code |

---

## Proposed Fixes (Prioritised)

**Fix 1 (Critical) — Move signed URL fetch earlier, gate MindARScene on URL readiness**

In `ARViewer.tsx`:
- Remove `viewState === "detecting"` from the signed URL query's `enabled` condition. Let the URL fetch start as soon as the project loads.
- In the "detecting" render, show a brief loading spinner if `signedModelUrl` is still undefined, and only render `<ARDetection>` (which renders `<MindARScene>`) once `signedModelUrl` is available.

```tsx
// Enable signed URL fetch as soon as we have a model_url
enabled: !!project?.model_url,

// In "detecting" case:
case "detecting":
  if (project.model_url && !signedModelUrl) {
    return <LoadingScreen label="Preparing AR model…" />;
  }
  return <ARDetection ... modelUrl={signedModelUrl} ... />;
```

**Fix 2 (Warning) — Increase RAF delay to 5 frames or use setTimeout(100ms)**

In `MindARScene.tsx`, replace the double RAF with a short `setTimeout`:
```ts
anchor.onTargetFound = () => {
  if (model && !worldPlaced) {
    setTimeout(() => {
      if (worldPlaced) return;
      // ... world placement logic
    }, 150); // 150ms gives MindAR pose time to stabilise
  }
};
```

**Fix 3 (Warning) — Reset properly re-anchors or changes button label**

Two options:
- Option A: Change the reset button label to "View Info" or remove it — don't imply re-scanning is possible.
- Option B: Implement true reset — when the reset button is pressed, call `ARViewer.handleReset()` which bumps `resetKey` and remounts the whole `ARDetection`/`MindARScene` stack fresh.

**Fix 4 (Info) — Fix FLOAT_ABOVE_MARKER constant**

Change `FLOAT_ABOVE_MARKER = 0.04` to `FLOAT_ABOVE_MARKER = 0.267` for a true 40mm float. Or rename the constant to `FLOAT_ABOVE_MARKER_UNITS` and add a comment clarifying the unit conversion.

**Fix 5 (Info) — Remove `ARActiveView.tsx` dead code**

Delete `src/components/ar/ARActiveView.tsx` to keep the codebase clean.

**Fix 6 (Info) — Remove dead `handleReset` from ARViewer or wire it up**

Either delete `handleReset` (if reset via remount is not needed) or pass it into `ARDetection` as an `onReset` prop.
