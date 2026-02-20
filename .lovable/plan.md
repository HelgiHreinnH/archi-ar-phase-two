
# Three-Part Fix: World-Anchored Model, Full-Width Camera, Corrected Scale System

## Problem Summary

**Issue 1 — Model vanishes when camera moves away from marker (anchor-tracking)**
In MindAR, `anchor.group` is a transform node that follows the marker in real time. When the printed marker leaves the camera frame, MindAR hides the anchor group — so the model disappears. The user's requirement is: detect the marker once → place the model in world space → model stays visible no matter where the camera points.

**Issue 2 — Double camera feed / black strip on the right**
MindAR creates both a `<canvas>` (WebGL render) and a `<video>` (camera feed) inside the container. It sets explicit pixel dimensions on these internally via `style` attributes. Our post-`start()` CSS patch (`width: 100%`) is applied once, but MindAR may overwrite or conflict with it. The two elements are also independently sized, causing a visible seam. The container's `fixed inset-0` is correct but MindAR also sets `position: absolute` on the canvas internally, which can mis-align.

**Issue 3 — Scale presets don't match real-world model dimensions**
The current presets (1:10 to 1:500) are architectural but don't serve the user's workflow where models are built 1:1 in millimetres. The parser in ARViewer also incorrectly extracts the scale denominator. The new set of presets should be: `1:1` (furniture, true size), `1:10`, `1:25`, `1:50`, `1:100`, `1:200`.

---

## Fix 1: World-Anchored Model (One-Shot Placement)

### Concept
Instead of attaching the model to `anchor.group` (which follows the marker), we:
1. Attach the model to `anchor.group` initially — this lets MindAR tell us the world-space transform of the marker via Three.js's scene graph
2. On first `onTargetFound`, extract the model's computed world matrix
3. Detach the model from `anchor.group` and re-attach it directly to the `scene` root, applying the captured world matrix
4. Set a `worldPlaced` flag so subsequent `onTargetFound` events (if the marker is re-detected) don't move the model again

This gives exactly the behaviour described: "camera detects AR marker → model loads at that location → stays fixed in world space as user walks around."

### Float above marker
The user wants the model to float ~40mm above the marker centre. In MindAR's coordinate system, the marker plane is Y=0. We add `+0.04` in world-space Y (units are metres in MindAR's Three.js scene) to make it float 4cm above.

The updated `model.position.y` before placement:
```ts
// Instead of sitting on the marker plane (Y=0), float 40mm above
model.position.y = -box.min.y * normalizedScale + 0.04;
```

### Implementation in `MindARScene.tsx`
```ts
let worldPlaced = false;

anchor.onTargetFound = () => {
  if (!worldPlaced && model.parent === anchor.group) {
    // Capture world transform
    model.updateWorldMatrix(true, false);
    const worldMatrix = model.matrixWorld.clone();

    // Move from anchor.group to scene root
    anchor.group.remove(model);
    scene.add(model);

    // Apply captured world matrix (position + rotation + scale)
    model.matrix.copy(worldMatrix);
    model.matrix.decompose(model.position, model.quaternion, model.scale);

    worldPlaced = true;
  }
  onTargetFoundRef.current?.(i);
};
```

After this, the model is a direct child of the `scene` with an absolute world position — MindAR's anchor tracking no longer affects its visibility.

---

## Fix 2: Full-Width Camera (Eliminate Double Feed / Black Strip)

### Root Cause
MindAR creates its video and canvas with explicit pixel dimensions set via JS style properties (not CSS classes). It uses `window.innerWidth` / `window.innerHeight` for sizing, which on iOS Safari includes the browser chrome, causing the camera feed to be narrower than the viewport.

The additional complication is that after our CSS patch, MindAR's own render loop may re-touch the canvas dimensions on each frame.

### Fix: Use a `ResizeObserver` + persistent style injection
Instead of setting styles once after `start()`, we:
1. Use a `ResizeObserver` on the container to re-apply the fill styles whenever dimensions change
2. Add a `<style>` element inside the container that forces the canvas and video to fill it via CSS specificity (CSS applied via stylesheet beats inline `style` from JavaScript in some browsers)

```ts
// After mindarThree.start():
const styleTag = document.createElement("style");
styleTag.textContent = `
  #mindar-container canvas,
  #mindar-container video {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    position: absolute !important;
    top: 0 !important; left: 0 !important;
  }
`;
containerRef.current.id = "mindar-container";
containerRef.current.appendChild(styleTag);
```

This is injected once and stays active for the lifetime of the component, overriding MindAR's own inline styles with `!important`.

---

## Fix 3: Scale System Redesign

### New Scale Presets
Replace existing presets in `StepDetails.tsx` with:

| Value | Label | Use case |
|-------|-------|----------|
| `1:1` | 1:1 | Furniture — true size |
| `1:10` | 1:10 | Large furniture / room object |
| `1:25` | 1:25 | Room-scale interior |
| `1:50` | 1:50 | Standard floor plan |
| `1:100` | 1:100 | Building overview |
| `1:200` | 1:200 | Site plan / masterplan |

### How scale is applied to the model
The `scale` string (e.g. `"1:50"`) is parsed in `ARViewer.tsx`:
```ts
const scaleNum = project.scale ? parseFloat(project.scale.replace(/[^0-9.]/g, "")) || 1 : 1;
```
This extracts `50` from `"1:50"` and passes it as `modelScale` to `MindARScene`.

In `MindARScene.tsx`, the normalisation formula is:
```ts
const normalizedScale = (modelScale / maxDim) * 0.5;
```

This divides the target display size (`modelScale`) by the model's largest dimension and scales to fit within 0.5 MindAR units. But this doesn't correctly implement architectural scale ratios.

**Correct logic:** If a model is built at 1:1 in millimetres (e.g. a chair is 800mm tall → `maxDim = 800`), and we want to show it at `1:50`, the real-world height is `800mm` but we want to show it at `800/50 = 16mm` on the table. In MindAR units (1 unit ≈ 1 marker width, typically ~15cm printed), we convert mm to MindAR units by dividing by a reference marker size in mm.

For a printed A4-sized AR marker (approximately 150mm), 1 MindAR unit = 150mm.

So:
```ts
// modelScale is the scale denominator (e.g. 50 for 1:50)
// maxDim is in mm (model built 1:1 in Rhino)
// 1 MindAR unit ≈ 150mm (marker size)
const MARKER_SIZE_MM = 150;
const scaleFactor = (1 / modelScale) / (1 / MARKER_SIZE_MM);
// = MARKER_SIZE_MM / modelScale
const normalizedScale = scaleFactor / maxDim;
```

This cleanly maps: `1:1` → model appears true size relative to marker, `1:50` → model appears 50× smaller.

**Default scale** for new tabletop projects changed from `"1:20"` to `"1:1"` in `NewProject.tsx`.

---

## Files to Change

| File | What changes |
|------|-------------|
| `src/components/ar/MindARScene.tsx` | World-anchor placement on first detection; float +40mm; CSS injection fix for full-width camera |
| `src/components/wizard/StepDetails.tsx` | New scale presets: 1:1, 1:10, 1:25, 1:50, 1:100, 1:200; update descriptions |
| `src/pages/NewProject.tsx` | Default scale changed to `"1:1"` |
| `src/pages/ARViewer.tsx` | Fix scale parsing to extract denominator correctly from `"1:50"` format |

No database migration needed. No new components. No new dependencies.

---

## Why This Solves Each User Complaint

1. **"Camera does not need to be pointed at marker after load"** → World placement extracts the model from the anchor group on first detection. The model lives in absolute scene space and is always rendered regardless of where the camera points.
2. **"Model should float 4cm above marker"** → `model.position.y += 0.04` (in metres) applied before world placement.
3. **"Two active camera sessions / black strip"** → CSS `!important` injection via a `<style>` tag inside the container overrides MindAR's own inline pixel dimensions, forcing both the video and canvas to fill the container completely at all times.
4. **"Scale parameters should match real-world model dimensions"** → New presets + correct scale formula using marker physical size as the reference unit.
