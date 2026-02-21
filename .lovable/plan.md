

# Phase 2A + 2B: Tabletop Orbit Controls and N-Marker Walk-Around

## Phase 2A: Tabletop Touch Orbit Controls

### What it does
After the model locks in tabletop mode, users can orbit, zoom, and rotate the view using touch gestures -- just like navigating a 3D viewport. The camera feed stays visible behind the model.

### How it works
- A secondary Three.js `PerspectiveCamera` ("orbit camera") is created alongside the MindAR camera
- `OrbitControls` from Three.js is imported and attached to this orbit camera
- When `anchorState` transitions to `'locked'` in tabletop mode, orbit controls activate with the locked model's world position as the target
- The render loop switches to use the orbit camera instead of the MindAR camera while locked
- Gyro compensation continues to operate on `model.matrix` independently (no conflict -- gyro moves the model, orbit moves the camera)
- When re-anchoring occurs, orbit controls are disabled and the MindAR camera resumes

### Files changed

**`src/components/ar/MindARScene.tsx`**
- Import `OrbitControls` from Three.js addons CDN
- Create `orbitCamera` (PerspectiveCamera) and `orbitControls` instance during setup
- On tabletop lock: set orbit target to model world position, enable controls, set initial camera position based on model bounding sphere
- Render loop: when locked + tabletop, call `orbitControls.update()` and render with orbit camera; otherwise use MindAR camera as before
- On re-anchor: disable orbit controls, reset to MindAR camera
- Constraints: minimum polar angle 5 degrees (prevent looking from under), enable damping

**`src/components/ar/ARDetection.tsx`**
- Add gesture hint overlay ("Drag to orbit / Pinch to zoom") that appears for 3 seconds after tabletop lock, then fades out
- Accept a new `onModelLocked` callback prop to know when lock happens
- No changes to multi-point UI

---

## Phase 2B: N-Marker Walk-Around Architecture

### What it does
Replaces the hardcoded 3-marker (A/B/C) system with dynamic N-marker support (3--20 markers). Architects name points `marker_1` through `marker_N` in Rhino, and the platform automatically adapts.

### Sprint 1: Pipeline Changes

**`src/lib/parseGlbMarkers.ts` -- Rewrite**
- New return type: `MarkerPoint[]` (array of `{ index, x, y, z, label? }`) sorted by index
- Scan for `marker_1` through `marker_20` (case-insensitive, underscores/hyphens/spaces normalized)
- Legacy support: `marker_a/b/c` silently remapped to index 1/2/3
- Return `null` if fewer than 3 found

**`src/components/MarkerCoordinateEditor.tsx` -- Dynamic N rows**
- Replace `MarkerData { A, B, C }` type with `MarkerPoint[]` array
- Render dynamic list of N marker rows instead of 3 fixed columns
- Extended color palette (12 colors) for marker visual identity
- JSON paste format changes to accept array: `[{ "index": 1, "x": 0, "y": 0, "z": 0 }, ...]`
- Also still accept legacy `{ A, B, C }` JSON format and auto-convert
- Triangle quality metric generalizes to check minimum inter-marker spacing and coverage quality
- Add/remove marker buttons (minimum 3, maximum 20)

**`src/lib/generateMarkers.ts` -- N-marker loop**
- Extend `MARKER_COLORS` from 3 to 12 colors; markers 13+ use color + number pattern
- `generateMarkerCanvas` uses marker index number instead of letter (displays "1", "2", etc.)
- `generateAllMarkerImages` accepts `MarkerPoint[]` instead of `Record<string, MarkerPoint>`

**`src/components/GenerateExperience.tsx` -- Array-based**
- `markerData` prop type changes from `MarkerData | null` to `MarkerPoint[] | null`
- Readiness check: `markerData.length >= 3`
- Generation loop iterates over the array, generating N marker images and compiling N-target `.mind` file
- Upload feedback shows N markers being processed

**`src/components/wizard/StepMarkers.tsx`**
- Props updated for new `MarkerPoint[]` type
- After GLB upload with detected markers, show summary: "N marker points detected" with coordinate list and inter-marker spacing stats

**`src/components/ar/ARDetection.tsx` -- Dynamic status badges**
- For N <= 6: show individual numbered/colored badges (like current A/B/C)
- For N > 6: show "N of total detected" with progress bar
- Initial lock requires any 3+ confirmed anchors, not all N
- `markers` state changes from `Record<string, MarkerStatus>` to array-based

**`src/pages/ARViewer.tsx`**
- `markers` state becomes dynamic based on marker count from project data
- `markerData` passed as `MarkerPoint[]` to ARDetection

**Database migration**
- `projects.marker_data` column is already JSON -- no schema change needed
- Migration script to convert existing rows: `{ A: {x,y,z}, B: {x,y,z}, C: {x,y,z} }` to `[{ index: 1, ...A }, { index: 2, ...B }, { index: 3, ...C }]`

### Sprint 2: Continuous Multi-Anchor Correction in AR Viewer

**`src/components/ar/MindARScene.tsx`**
- `maxTrack` set to `markerData.length` (N anchors)
- Replace per-anchor hardcoded callbacks with unified `AnchorState[]` tracking:
  ```text
  interface AnchorState {
    index: number
    isVisible: boolean
    lastPose: Matrix4 | null
    stableFrames: number
    lastSeenAt: number  // timestamp
  }
  ```
- Render loop runs `updateWorldPosition()` every frame:
  - 0 confirmed anchors: gyro compensation only
  - 1 confirmed: translation correction only
  - 2 confirmed: translation + rotation correction
  - 3+ confirmed: full Procrustes via `computeWorldTransform` using best triangle (largest area from all combinations)
- Position corrections applied via matrix lerp (factor 0.08) to prevent snapping
- Remove explicit `'reanchoring'` state for multi-point -- re-anchoring is automatic as markers enter/leave frame
- Initial lock still requires 3+ anchors at 10+ stable frames

**`src/lib/computeWorldTransform.ts`**
- Generalize to accept N markers (select best 3 from visible set)
- Add `selectBestTriangle()` function: tries all combinations of 3 from available anchors, picks largest triangle area
- Add single-anchor and dual-anchor correction functions as fallbacks

### Summary of all files changed

| File | Phase | Change |
|---|---|---|
| `src/components/ar/MindARScene.tsx` | 2A + 2B | Orbit controls (tabletop), N-anchor continuous correction (multi-point) |
| `src/components/ar/ARDetection.tsx` | 2A + 2B | Gesture hint overlay, dynamic N-marker status badges |
| `src/lib/parseGlbMarkers.ts` | 2B | Rewrite for marker_1..marker_N + legacy compat |
| `src/components/MarkerCoordinateEditor.tsx` | 2B | Dynamic N-row editor, new type system |
| `src/lib/generateMarkers.ts` | 2B | Extended color palette, N-marker loop |
| `src/components/GenerateExperience.tsx` | 2B | Array-based marker processing |
| `src/components/wizard/StepMarkers.tsx` | 2B | Updated props for MarkerPoint[] |
| `src/pages/ARViewer.tsx` | 2B | Dynamic marker state, array markerData |
| `src/lib/computeWorldTransform.ts` | 2B | Generalize to N markers, best-triangle selection |
| Database migration | 2B | Convert existing marker_data rows to array format |

### Implementation order

1. Phase 2A first (contained to MindARScene + ARDetection, no type changes)
2. Phase 2B Sprint 1: type migration + pipeline (parseGlbMarkers, MarkerCoordinateEditor, generateMarkers, GenerateExperience, StepMarkers, ARViewer markers state, database migration)
3. Phase 2B Sprint 2: MindARScene continuous correction + computeWorldTransform generalization

