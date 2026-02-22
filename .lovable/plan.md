

# Fix Rhino Z-up Axis Correction in MindARScene

## Problem
The 3D model appears lying flat (face toward ceiling) because Rhino exports with Z-up coordinates while Three.js/glTF uses Y-up. The bounding box is also computed before any axis correction, causing wrong floor plane offset, scale, and centering.

## What Changes

**`src/components/ar/MindARScene.tsx`** -- one section reordered (lines 226-244)

After `model = gltf.scene` and before the bounding box computation, insert:

```
model.rotation.x = -Math.PI / 2;
model.updateMatrixWorld(true);
```

This rotates the model so Rhino's +Z (up) becomes Three.js's +Y (up). The `updateMatrixWorld(true)` forces all child transforms to recompute before the bounding box is measured.

The existing bounding box, scale, position, and rotation code stays exactly the same -- it just now runs after the axis correction, giving correct values.

## Already Fixed (No Action Needed)
- Bug 3A: `model.updateMatrix()` in onTargetFound -- present at line 295
- Bug 3B: Direct `anchor.group.matrix.multiply(model.matrix)` in onTargetUpdate -- present at line 264
- Bug 3C: No decompose in onTargetLost -- already removed

## Technical Details

| Axis | Rhino | Three.js/glTF |
|------|-------|---------------|
| Right | X | X |
| Up | Z | Y |
| Depth | Y | Z (toward viewer) |

The -90 degree X rotation remaps: +Z becomes +Y (up), +Y becomes -Z (depth). This is the standard Rhino-to-glTF conversion.

## Files Changed

| File | Change |
|------|--------|
| `src/components/ar/MindARScene.tsx` | Add 2 lines (axis correction) before bounding box computation |

