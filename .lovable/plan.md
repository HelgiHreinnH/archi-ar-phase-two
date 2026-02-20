
# Update MindARScene.tsx: Apply the Three Deep-Research Fixes

## What the Current File Has

The last approved plan successfully switched from the render-loop race condition to `onTargetUpdate`. That was the right architectural move. However, three specific issues remain in the current implementation that the deep research pinpointed:

---

## The Three Remaining Issues

### Issue 1: Missing `model.updateMatrix()` in `onTargetFound`

**Current code (line 217–219):**
```ts
model.position.set(localPos.x, localPos.y, localPos.z);
model.quaternion.copy(localQuat);
model.scale.set(localScale.x, localScale.y, localScale.z);
isWorldPlaced = false;
// ← onTargetUpdate fires IMMEDIATELY after this in the same MindAR frame
```

**The problem:** Three.js does not immediately recompute `model.matrix` when you set `position`/`quaternion`/`scale`. It defers that recomputation until the next `renderer.render()` traversal. But `onTargetUpdate` fires in the same MindAR frame, right after `onTargetFound` — before `renderer.render()` has run. So when `onTargetUpdate` calls `model.updateWorldMatrix(true, false)`, `model.matrix` still holds the **old frozen matrix** from when the model was in scene space.

**Fix:** Call `model.updateMatrix()` after restoring transforms. This forces Three.js to recompute `model.matrix` from the current `position`/`quaternion`/`scale` immediately, so `onTargetUpdate` samples the correct local transform.

---

### Issue 2: `onTargetUpdate` Uses `updateWorldMatrix` + `matrixWorld` (Timing-Dependent)

**Current code (line 202–207):**
```ts
anchor.onTargetUpdate = () => {
  if (model) {
    model.updateWorldMatrix(true, false);
    lastKnownMatrix.copy(model.matrixWorld);
  }
};
```

**The problem:** `updateWorldMatrix(true, false)` walks UP the parent chain to compose `matrixWorld`. This depends on Three.js's internal matrix propagation state being current for all ancestors. Given the interplay between MindAR's tracking loop and Three.js's update cycle, this can sample a stale or partially-updated matrix.

**Fix:** Compute `lastKnownMatrix` by directly multiplying `anchor.group.matrix` (which MindAR has just written with a valid pose — no timing dependency) by `model.matrix` (the model's local transform within the group). This is mathematically identical to `matrixWorld` but bypasses Three.js propagation entirely:

```ts
anchor.onTargetUpdate = () => {
  if (model && !isWorldPlaced) {
    // Force local matrix current from position/quat/scale
    model.updateMatrix();
    // Build world matrix directly: group pose × model local offset
    // anchor.group.matrix is set by MindAR just before this fires — always valid
    lastKnownMatrix.copy(anchor.group.matrix).multiply(model.matrix);
  }
};
```

The `!isWorldPlaced` guard is also added — we should only update `lastKnownMatrix` while the model is inside the anchor group being tracked. If the model is frozen in scene space (`isWorldPlaced = true`), sampling makes no sense.

---

### Issue 3: Redundant `model.matrix.decompose(...)` in `onTargetLost`

**Current code (line 233–235):**
```ts
model.matrix.copy(lastKnownMatrix);
model.matrix.decompose(model.position, model.quaternion, model.scale);
model.matrixAutoUpdate = false;
```

**The problem:** After setting `model.matrixAutoUpdate = false`, Three.js uses `model.matrix` directly for rendering — it ignores `model.position`, `model.quaternion`, `model.scale`. The `decompose` call writes into those properties unnecessarily and introduces floating point precision loss (decompose → recompose is lossy). It also reads from `model.matrix` which was just set — a no-op that adds overhead.

**Fix:** Remove the `decompose` line. `model.matrix.copy(lastKnownMatrix)` is all that is needed. With `matrixAutoUpdate = false`, the renderer uses the matrix directly.

---

## The Complete Change Set (One File Only)

**File:** `src/components/ar/MindARScene.tsx`

### Change A — `onTargetFound` (around line 217): Add `model.updateMatrix()`

```ts
anchor.onTargetFound = () => {
  if (model && isWorldPlaced) {
    scene.remove(model);
    model.matrixAutoUpdate = true;
    anchor.group.add(model);
    model.position.set(localPos.x, localPos.y, localPos.z);
    model.quaternion.copy(localQuat);
    model.scale.set(localScale.x, localScale.y, localScale.z);
    model.updateMatrix(); // ← NEW: force local matrix current before onTargetUpdate samples
    isWorldPlaced = false;
  }
  onTargetFoundRef.current?.(i);
};
```

### Change B — `onTargetUpdate` (around line 202): Replace with direct matrix multiplication

```ts
anchor.onTargetUpdate = () => {
  if (model && !isWorldPlaced) {
    // Force local matrix current from current position/quat/scale
    model.updateMatrix();
    // Compute world matrix directly: MindAR group pose × model local offset.
    // anchor.group.matrix is written by MindAR immediately before this callback fires
    // — no Three.js propagation timing dependency.
    lastKnownMatrix.copy(anchor.group.matrix).multiply(model.matrix);
  }
};
```

### Change C — `onTargetLost` (around line 233): Remove the `decompose` call

```ts
anchor.onTargetLost = () => {
  if (model && !isWorldPlaced) {
    anchor.group.remove(model);
    scene.add(model);
    model.matrix.copy(lastKnownMatrix);
    // matrixAutoUpdate = false tells Three.js to use model.matrix directly.
    // No need to decompose — decompose adds floating point error with no benefit.
    model.matrixAutoUpdate = false;
    isWorldPlaced = true;
  }
  onTargetLostRef.current?.(i);
};
```

---

## Why This Is Now Correct

MindAR's camera sits fixed at `(0,0,0)`. The scene root is identity. `anchor.group.matrix` holds the marker's current camera-relative pose, written directly by MindAR's CV pipeline.

`lastKnownMatrix = anchor.group.matrix × model.matrix` is the model's position in camera-relative scene space. This value is computed using only data MindAR has just written (no propagation timing dependency).

When the model moves to scene root with `model.matrix = lastKnownMatrix` and `matrixAutoUpdate = false`:
- Camera never moves (always at origin)
- Model matrix is a fixed camera-relative transform
- Model appears stationary in the physical room

When the marker is re-detected:
- `model.updateMatrix()` ensures `model.matrix` reflects the restored `localPos/localQuat/localScale`
- MindAR resumes updating `anchor.group.matrix` with live tracking
- `onTargetUpdate` computes correct `lastKnownMatrix` immediately

---

## Summary Table

| Change | Location | Lines | Reason |
|---|---|---|---|
| Add `model.updateMatrix()` | `onTargetFound`, after scale/pos/quat restore | ~219 | Ensures local matrix is current before `onTargetUpdate` samples it in the same frame |
| Replace `onTargetUpdate` body | `anchor.onTargetUpdate` callback | ~202–207 | Direct matrix multiplication bypasses Three.js propagation timing; add `!isWorldPlaced` guard |
| Remove `model.matrix.decompose(...)` | `onTargetLost` | ~234 | Unnecessary with `matrixAutoUpdate = false`; adds floating point loss |
| No other files | — | — | `ARViewer.tsx`, `ARDetection.tsx`, all other files untouched |
