
# Fix: Replace Render-Loop Matrix Sampling with `onTargetUpdate`

## What the Research Confirmed

The previous two implementation attempts both failed for the same underlying reason, just at different layers. The research into MindAR's source code identified the exact sequence of events that happens every tracking frame:

```
1. group.visible = (worldMatrix !== null)         ← Three.js Group shown/hidden
2. group.matrix = worldMatrix OR invisibleMatrix  ← pose set or zeroed
3. anchor.visible = true/false                    ← the JS flag updated
4. onTargetLost() / onTargetFound() fires         ← our callbacks
5. onTargetUpdate() fires (every frame, tracked)  ← only while valid
```

The current code updates `lastKnownMatrix` inside `renderer.setAnimationLoop` by checking `anchor.visible` (the JS flag, set in step 3). The render loop runs independently of MindAR's tracking loop — if the render loop executes between step 1 (group hidden, matrix zeroed) and step 3 (flag updated), `anchor.visible` is still `true` but `group.matrix` is already `invisibleMatrix`. The code then calls `model.updateWorldMatrix()` and copies a near-zero/garbage matrix into `lastKnownMatrix`. When `onTargetLost` fires and applies this poisoned matrix, the model snaps to a garbage position or screen-centre.

**This is the race condition that causes the "stuck to screen" behaviour.**

The fix: **`anchor.onTargetUpdate`** fires directly from MindAR's own tracking pipeline, only and always when `worldMatrix` is valid. It is structurally impossible for this callback to fire with a zero matrix. Using it to sample `lastKnownMatrix` eliminates the race condition entirely.

## Changes: Only `src/components/ar/MindARScene.tsx`

### What gets removed
- The `updateLastKnown` function (lines 197–202)
- The `(anchor as any).__updateLastKnown = updateLastKnown` assignment (line 203)
- The `mindarThree.anchors?.forEach(...)` call inside `renderer.setAnimationLoop` (line 255)

### What gets added
In place of the removed `updateLastKnown` block, a single callback:

```ts
// ── onTargetUpdate: fires every frame MindAR has a valid pose ──────────
// This is MindAR's own tracking callback — it only fires when worldMatrix
// is non-null, making it race-condition-free.
// The render loop approach (previous implementation) had a race between
// group.visible being set to false and anchor.visible being updated, which
// could poison lastKnownMatrix with the invisibleMatrix (zero matrix).
anchor.onTargetUpdate = () => {
  if (model) {
    model.updateWorldMatrix(true, false);
    lastKnownMatrix.copy(model.matrixWorld);
  }
};
```

The render loop becomes clean — just the render call:

```ts
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

### Everything else stays identical

- `onTargetFound` logic (re-attach model to anchor group, restore local transforms) — unchanged
- `onTargetLost` logic (detach from anchor group, attach to scene, apply `lastKnownMatrix`, freeze) — unchanged  
- `isWorldPlaced` flag — unchanged
- `localPos` / `localQuat` / `localScale` capture — unchanged
- Scale calculation, float constant, lighting, camera, CSS injection — all unchanged
- `ARViewer.tsx`, `ARDetection.tsx` — not touched

## Why This Works

MindAR's camera sits fixed at `(0,0,0)`. The anchor group moves around it. `model.matrixWorld` while inside `anchor.group` is therefore a camera-relative transform — when the marker is in a fixed physical position in the room, this matrix is constant (or near-constant, modulo tracking jitter). Freezing `model.matrix = lastKnownMatrix` and moving the model to the scene root means: direct child of scene, fixed camera-relative matrix, camera never moves → model appears stationary in the room.

`onTargetUpdate` guarantees that every value ever written into `lastKnownMatrix` came from a frame where MindAR had a valid pose. The last value before the marker is lost is therefore the freshest valid pose — exactly what we want for the freeze.

## Summary

| Location | Change |
|---|---|
| `MindARScene.tsx` line 197–203 | Remove `updateLastKnown` fn and `__updateLastKnown` assignment |
| `MindARScene.tsx` (same location) | Add `anchor.onTargetUpdate` callback |
| `MindARScene.tsx` line 254–257 | Remove `forEach(__updateLastKnown)` from animation loop |
| All other files | No changes |
