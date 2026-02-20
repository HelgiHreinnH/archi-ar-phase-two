
# Fix: Model Locks to Screen Instead of Real-World Position

## What's Going Wrong

The current world-anchoring code fires synchronously inside `onTargetFound`:

```ts
anchor.onTargetFound = () => {
  if (model && !worldPlaced) {
    model.updateWorldMatrix(true, false);          // ← problem here
    const worldMatrix = model.matrixWorld.clone();
    anchor.group.remove(model);
    scene.add(model);
    model.matrix.copy(worldMatrix);
    model.matrix.decompose(model.position, model.quaternion, model.scale);
    worldPlaced = true;
  }
};
```

**The root cause:** `onTargetFound` fires the moment MindAR's tracking algorithm detects the marker — but Three.js has not yet run `renderer.render()` with the anchor's updated world transform. The `anchor.group.matrixWorld` is the identity matrix (zero position, no rotation). So `model.matrixWorld` is also identity: the model snaps to world origin, which in MindAR's camera-relative system is a point directly in front of the camera lens.

The model then gets detached from the anchor and fixed there — directly in front of the camera, filling the screen, stuck in screen-space.

**The screenshots confirm this:** The model (brown FanFrame geometry) fills the entire viewport regardless of where the camera points. This is classic "origin lock" — the model is at (0,0,0) in world space, which is camera-forward.

---

## The Fix: Defer World-Capture by One Render Frame

Three.js computes `matrixWorld` propagation through the scene graph during `renderer.render()`. We need to wait for exactly one render frame after the anchor becomes active before capturing the world matrix.

The solution is to wrap the world-capture in a `requestAnimationFrame` callback. This guarantees the capture happens after the next full render pass, when MindAR has updated the anchor group's transform to reflect the real-world marker position.

```ts
anchor.onTargetFound = () => {
  if (model && !worldPlaced) {
    // ── Wait one render frame so Three.js has propagated the anchor's
    //    world transform before we capture it. Without this delay,
    //    matrixWorld is the identity matrix (origin = directly in front
    //    of the camera) and the model locks to screen-space.
    requestAnimationFrame(() => {
      if (worldPlaced) return; // guard against double-fire

      model.updateWorldMatrix(true, false);
      const worldMatrix = model.matrixWorld.clone();

      anchor.group.remove(model);
      scene.add(model);

      model.matrix.copy(worldMatrix);
      model.matrix.decompose(model.position, model.quaternion, model.scale);
      model.matrixAutoUpdate = false; // freeze the matrix — no further updates

      worldPlaced = true;
    });
  }
  onTargetFoundRef.current?.(i);
};
```

The key addition is `model.matrixAutoUpdate = false` after placement. This tells Three.js not to recompute the model's matrix from position/rotation/scale on each frame, locking it exactly where it was placed. Without this, Three.js's animation loop could overwrite the world position with the local-space position values.

---

## Two-Frame Safety Net (Belt and Suspenders)

On some mobile devices and with large GLB files, even one RAF may be insufficient if the marker tracking hasn't stabilised yet. A safer approach is to use **two sequential `requestAnimationFrame` calls**, giving MindAR two full render cycles to establish the anchor's world transform:

```ts
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    // now guaranteed to have a valid world matrix
    model.updateWorldMatrix(true, false);
    // ... rest of placement logic
  });
});
```

This adds approximately 32ms of delay (two 16ms frames at 60fps), which is imperceptible to the user.

---

## Also Fix: `model.matrixAutoUpdate = false` Missing

After decomposing the world matrix back into `model.position` / `model.quaternion` / `model.scale`, Three.js's render loop will call `updateMatrix()` on the model each frame (because `matrixAutoUpdate` defaults to `true`). This recomputes `model.matrix` from the position/quaternion/scale values — which are now in world space, but the model is a direct child of `scene`, so this is fine. However, setting `matrixAutoUpdate = false` makes the fix bulletproof and prevents any drift.

---

## File Changed

Only one file needs to change:

**`src/components/ar/MindARScene.tsx`** — lines 193–208, the `anchor.onTargetFound` handler.

Change from:
```ts
anchor.onTargetFound = () => {
  if (model && !worldPlaced) {
    model.updateWorldMatrix(true, false);
    const worldMatrix = model.matrixWorld.clone();
    anchor.group.remove(model);
    scene.add(model);
    model.matrix.copy(worldMatrix);
    model.matrix.decompose(model.position, model.quaternion, model.scale);
    worldPlaced = true;
  }
  onTargetFoundRef.current?.(i);
};
```

Change to:
```ts
anchor.onTargetFound = () => {
  if (model && !worldPlaced) {
    // Defer capture by two render frames so Three.js has propagated
    // the anchor's real-world matrix before we read matrixWorld.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (worldPlaced) return;
        model.updateWorldMatrix(true, false);
        const worldMatrix = model.matrixWorld.clone();
        anchor.group.remove(model);
        scene.add(model);
        model.matrix.copy(worldMatrix);
        model.matrix.decompose(model.position, model.quaternion, model.scale);
        model.matrixAutoUpdate = false;
        worldPlaced = true;
      });
    });
  }
  onTargetFoundRef.current?.(i);
};
```

No other files need to change. No database migration. No new dependencies.

---

## Why This Works

- **One render frame before capture** → Three.js has run `renderer.render(scene, camera)` at least once with the anchor group active. MindAR updates `anchor.group.matrixWorld` inside its own render/update loop, which runs before Three.js's render. After one full cycle, the world matrix correctly encodes the marker's real-world position and orientation relative to the camera.
- **`matrixAutoUpdate = false`** → The model's position in world space is frozen. Three.js will not overwrite the matrix with stale local-space values on subsequent frames.
- **Double RAF** → Extra safety for slow devices or large models where one frame may not be enough for MindAR's pose estimation to stabilise.

The result: point the camera at the marker once → the model appears floating above the marker in real 3D space → move the camera away → the model stays at exactly that location in the room.
