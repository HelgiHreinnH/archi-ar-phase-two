
# Fix: 3D Model Not Loading + Black Strip on Camera Feed

## Root Cause Analysis

Three separate bugs have been identified from the screenshot and code review.

---

## Bug 1 (Critical): Wrong Storage Bucket — Model Never Loads

In `src/pages/ARViewer.tsx`, the signed URL is requested from the wrong bucket:

```ts
// Current — WRONG
const { data, error } = await supabase.storage
  .from("models")
  .createSignedUrl(project.model_url, 3600);
```

The correct bucket name is `"project-models"` — confirmed by looking at `ModelViewer3D.tsx` which already uses `"project-models"` correctly. Because `"models"` does not exist, the request fails silently and `signedModelUrl` returns `null`. MindARScene receives `modelUrl={null}` and skips GLB loading entirely. The camera runs but nothing appears on the marker.

**Fix:** Change `"models"` → `"project-models"` in `ARViewer.tsx`.

---

## Bug 2 (Visual): Black Strip — MindAR Canvas Not Full Width

MindAR creates its own `<canvas>` and `<video>` elements inside the container. It calculates their size from the container's dimensions at initialisation time. On iOS Safari, `window.innerHeight` includes the browser chrome (address bar), causing a miscalculation — the canvas ends up shorter/narrower than the physical screen, leaving a black strip.

The container div in `MindARScene.tsx` currently uses:
```tsx
<div ref={containerRef} className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }} />
```

This is correct for positioning, but MindAR's internal canvas needs explicit `width: 100%` and `height: 100%` CSS applied after initialisation, and the container must use `position: fixed` rather than `absolute` to correctly fill the real viewport on mobile Safari.

**Fix:** Change the container from `absolute inset-0` to `fixed inset-0` in `MindARScene.tsx`. Also add a CSS rule that forces MindAR's internal canvas and video to 100% width/height via a style tag or by applying inline styles after MindAR starts.

---

## Bug 3 (Positioning): Model Floats Above/Below the Marker

The model centring logic in `MindARScene.tsx` contains a scaling error:

```ts
// Current — WRONG
const center = box.getCenter(new ThreeLib.Vector3());
model.position.sub(center.multiplyScalar(scale));
```

`center` is in model space (pre-scale). After calling `model.scale.set(scale, scale, scale)`, the effective world-space offset to subtract is `center * scale`. But `center.multiplyScalar(scale)` mutates the vector and then it's subtracted — which is mathematically correct *if* done after the scale is applied. However, the real issue is that this centres the model's geometric centre at the anchor, not its base. For an architectural/product model the **base should be at Y=0** (sitting on the marker), not the centre.

The fix is to:
1. Centre X and Z correctly (subtract the horizontal centre offset)
2. Set Y so the model's bottom sits at Y=0 (not the geometric centre)

```ts
// Correct approach
const box = new ThreeLib.Box3().setFromObject(model);
const size = box.getSize(new ThreeLib.Vector3());
const center = box.getCenter(new ThreeLib.Vector3());
const maxDim = Math.max(size.x, size.y, size.z);
const normalizedScale = (modelScale / maxDim) * 0.5;
model.scale.set(normalizedScale, normalizedScale, normalizedScale);

// After scaling, recalculate — or adjust position in scaled space:
// Move model so its base (min Y) sits at world Y=0, centred in X/Z
model.position.x = -center.x * normalizedScale;
model.position.y = -box.min.y * normalizedScale; // base at 0
model.position.z = -center.z * normalizedScale;
```

---

## Files to Change

| File | Change |
|---|---|
| `src/pages/ARViewer.tsx` | Fix bucket name: `"models"` → `"project-models"` |
| `src/components/ar/MindARScene.tsx` | Fix canvas sizing (fixed inset-0) + fix model base positioning |

No database changes. No new files. Two targeted fixes.

---

## Why This Will Work

- **Bug 1**: With the correct bucket name, `createSignedUrl` succeeds, `signedModelUrl` becomes a valid HTTPS URL, and MindARScene loads and attaches the GLB to the anchor group. The model will appear when the marker is detected.
- **Bug 2**: Using `position: fixed` ensures the container fills the true viewport, not the layout viewport affected by iOS Safari's browser chrome. MindAR will size its canvas to the full physical screen width.
- **Bug 3**: Setting `model.position.y = -box.min.y * scale` places the bottom face of the model flush with the marker plane (Y=0), so it appears to sit on top of the printed AR marker rather than floating or sinking through it.
