
# Root Cause: Wrong Mental Model of MindAR's Coordinate System

## What's Actually Happening

After reading the MindAR source code directly, the world-anchoring approach has been built on an incorrect understanding of how MindAR's scene graph works.

### How MindAR's coordinate system actually works

In MindAR's Three.js integration:

- The **camera is fixed at the scene origin (0,0,0)**. It never moves.
- The **world moves around the camera**. MindAR's tracking updates `anchor.group.matrix` every frame with a view-space matrix derived from the detected marker pose.
- `anchor.group.matrixAutoUpdate = false` — MindAR sets this itself (line 76 of the source). The group matrix is driven entirely by MindAR's controller.

This means there is **no concept of "world space"** in the traditional sense. The scene has no fixed coordinate frame — everything is expressed relative to the camera (which is fixed). This is a fundamentally different setup from a standard Three.js scene.

### Why the current code fails

The current approach:
```ts
model.updateWorldMatrix(true, false);
const worldMatrix = model.matrixWorld.clone();   // ← captures camera-relative coords
anchor.group.remove(model);
scene.add(model);                                 // model is now a direct child of scene
model.matrix.copy(worldMatrix);                  // ← locks model at camera-relative coords
model.matrixAutoUpdate = false;                  // ← freezes those camera-relative coords
```

Because the camera is always at (0,0,0) and the world moves, `model.matrixWorld` at any given instant is a camera-space transform, not a world-space transform. When we capture it and freeze it, the model is locked to a position relative to the camera (i.e., directly in front of the user's face, stuck to the screen).

This is exactly what the user is seeing: the model appears on the screen at a fixed position regardless of where the camera points.

### What the correct approach is

For MindAR's coordinate system, "world anchoring" — keeping the model visible after losing the marker — is not possible by capturing a world transform, because there is no persistent world frame.

**The correct approach to keep a model visible is much simpler:**

1. Keep the model as a **child of `anchor.group`** (the standard MindAR way).
2. On `onTargetLost`, **do not remove or hide** the model — instead prevent MindAR from hiding it.
3. The challenge: MindAR sets `group.visible = false` on target lost (line 168), which hides all children including the model.

**Solution:** Keep the model attached to the anchor group, but on `onTargetLost`, **detach the model from the anchor group and re-attach it directly to the scene**, at the **last known position captured from the anchor group's matrix**. At this moment the anchor matrix IS valid — the target was just visible, so MindAR computed a correct pose. When the target is lost, we then freeze the model at that position in scene space.

The key difference from the current code:
- We must capture the position **on `onTargetLost`**, not `onTargetFound`
- At the moment of `onTargetLost`, MindAR has just determined the marker is gone, but the LAST VALID pose is still in `anchor.group.matrix` before MindAR overwrites it with `invisibleMatrix`

Wait — actually re-reading the source more carefully:

```js
// Line 158-195 in MindAR three.js source:
onUpdate: (data) => {
  if (data.type === 'updateMatrix') {
    ...
    if (worldMatrix !== null) {
      let m = new Matrix4();
      m.elements = [...worldMatrix];
      m.multiply(this.postMatrixs[targetIndex]);
      this.anchors[i].group.matrix = m;           // ← FIRST: matrix is set
    } else {
      this.anchors[i].group.matrix = invisibleMatrix; // ← FIRST: matrix zeroed
    }

    if (this.anchors[i].visible && worldMatrix === null) {
      this.anchors[i].visible = false;
      this.anchors[i].onTargetLost();              // ← THEN: callback fires AFTER matrix is zeroed
    }

    if (!this.anchors[i].visible && worldMatrix !== null) {
      this.anchors[i].visible = true;
      this.anchors[i].onTargetFound();             // ← THEN: callback fires AFTER matrix is set
    }
  }
}
```

**Critical finding:** When `onTargetFound` fires, MindAR has **already set** `anchor.group.matrix` to the correct tracking matrix. So `anchor.group.matrix` IS valid at the moment `onTargetFound` fires — no delay is needed for the matrix to become valid.

When `onTargetLost` fires, MindAR has **already overwritten** `anchor.group.matrix` with `invisibleMatrix` (the zero matrix). So we cannot capture the last known pose from `onTargetLost`.

### Correct Solution

**Strategy: Capture position on `onTargetFound` (immediate, no delay), keep model in anchor group, freeze it in scene on target lost by using a "last known matrix" variable.**

1. On `onTargetFound`:
   - Record the anchor group's current matrix as `lastKnownMatrix` (this is valid — MindAR just set it)
   - If first detection, also set up the model

2. Every render frame (in the animation loop), while target is visible:
   - Continuously update `lastKnownMatrix` from `anchor.group.matrix` so we always have the freshest pose

3. On `onTargetLost`:
   - Move the model out of `anchor.group` (because MindAR will hide the group)
   - Attach it directly to `scene`
   - Apply `lastKnownMatrix` (the last valid pose before the matrix was zeroed)
   - Freeze it: `model.matrixAutoUpdate = false`

4. On `onTargetFound` again (if user re-scans):
   - Move model back into `anchor.group` so it tracks the marker again
   - Resume updating `lastKnownMatrix` each frame

This is the only approach that correctly leverages MindAR's coordinate system. The model tracks the marker when visible, and freezes in its last real-world position when the marker is lost.

---

## Implementation Plan

### Changes to `src/components/ar/MindARScene.tsx`

The entire world-anchoring block needs to be rewritten. The new logic:

```ts
if (i === 0 && modelUrl) {
  let model: any = null;
  const lastKnownMatrix = new ThreeLib.Matrix4();
  let isWorldPlaced = false; // true once model has been seen at least once

  // Load model and add to anchor group (standard MindAR way)
  try {
    // ... GLB loading, scale calc (unchanged) ...
    anchor.group.add(model);
  } catch (loadError) { ... }

  // ── onTargetFound: marker is visible, MindAR's matrix is valid ────────
  anchor.onTargetFound = () => {
    if (model) {
      if (isWorldPlaced) {
        // Model was frozen in scene — move it back into the anchor group
        // so it tracks the marker again
        scene.remove(model);
        model.matrixAutoUpdate = true;
        anchor.group.add(model);
        // Restore local-space position/rotation/scale
        model.position.set(localPos.x, localPos.y, localPos.z);
        model.quaternion.copy(localQuat);
        model.scale.set(localScale.x, localScale.y, localScale.z);
      }
    }
    onTargetFoundRef.current?.(i);
  };

  // ── onTargetLost: marker lost, anchor.group.matrix is NOW invisibleMatrix ──
  // We must use lastKnownMatrix (updated every render frame) to freeze the model
  anchor.onTargetLost = () => {
    if (model) {
      anchor.group.remove(model);
      scene.add(model);
      // Apply the last valid pose we recorded
      model.matrix.copy(lastKnownMatrix);
      model.matrix.decompose(model.position, model.quaternion, model.scale);
      model.matrixAutoUpdate = false;
      isWorldPlaced = true;
    }
    onTargetLostRef.current?.(i);
  };

  // ── Render loop: update lastKnownMatrix every frame while marker visible ──
  // Store reference so we can update it in the animation loop
  // We'll use anchor.visible to gate this
  const updateLastKnown = () => {
    if (anchor.visible) {
      // anchor.group.matrix is valid while target is tracked
      // We need the model's world matrix at this point
      model?.updateWorldMatrix(true, false);
      lastKnownMatrix.copy(model?.matrixWorld ?? new ThreeLib.Matrix4());
    }
  };
  // Store for animation loop access
  (anchor as any).__updateLastKnown = updateLastKnown;
}
```

Then in the render loop:
```ts
renderer.setAnimationLoop(() => {
  // Update last-known matrices for all anchors before rendering
  mindarThree.anchors?.forEach((a: any) => a.__updateLastKnown?.());
  renderer.render(scene, camera);
});
```

### Storing local-space values

We need to save the model's local position/quaternion/scale (set during the loading phase) so we can restore them when the model goes back into the anchor group:

```ts
// After model.scale.set / model.position.set / model.rotation.y = ...
const localPos = model.position.clone();
const localQuat = model.quaternion.clone();
const localScale = model.scale.clone();
```

### Summary of files to change

Only `src/components/ar/MindARScene.tsx` needs to change.

The animation loop, loading, and scale calculation all stay the same. Only the `onTargetFound` / `onTargetLost` handlers and the animation loop update change.

---

## Why This Works

- MindAR's camera is fixed. When the marker is visible, `anchor.group.matrix` is a valid camera-relative pose updated every frame.
- `model.matrixWorld` (which is `anchor.group.matrixWorld * model.localMatrix`) encodes the model's full position in the scene's camera-relative space.
- When we freeze `model.matrix = lastKnownMatrix` and detach from the anchor group, the model is now a direct child of scene with a camera-relative matrix that doesn't change. Since the camera never moves, the model appears stationary relative to the room.
- When the user re-scans, we restore the model to the anchor group so it tracks again.

This is the standard, documented approach for "keep visible after lost" in MindAR's Three.js API — we're just implementing the Three.js version of what the A-Frame community does with `visible=true` on target lost.
