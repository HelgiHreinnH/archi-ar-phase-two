
# Implement DeviceOrientation-Based World Anchoring (Tabletop + Multi-Point)

## Summary

The current world-anchoring code freezes a camera-relative matrix when tracking is lost, causing the model to appear "glued to the screen." The fix uses the device's gyroscope to compensate for phone rotation after lock, making the model appear stationary in physical space. Two separate code paths handle the two modes.

## What Changes

### 1. `src/pages/ARViewer.tsx` -- iOS Motion Permission (3 lines)

Add `DeviceOrientationEvent.requestPermission()` call inside `launchDetecting` before `setViewState('detecting')`. This must happen during the user's tap gesture (iOS 13+ requirement). If denied, AR still loads -- gyro compensation just won't work (graceful degradation).

Also pass `markerData` prop to `ARDetection` for multi-point mode.

### 2. `src/components/ar/ARDetection.tsx` -- Prop Pass-through

Add optional `markerData` prop to the interface. Pass it straight to `MindARScene`. No logic changes.

### 3. `src/components/ar/MindARScene.tsx` -- Major Rewrite

**New prop:** `markerData` (optional, for multi-point triangulation)

**DeviceOrientation listener:** A `useEffect` inside `startAR` that reads `alpha/beta/gamma` from `deviceorientation` events and converts to a Three.js Quaternion stored in `deviceQuaternionRef`.

**3-state machine** replaces boolean `isWorldPlaced`:
- `'tracking'` -- model in anchor.group, follows marker live
- `'locked'` -- model in scene root, gyro-compensated each frame
- `'reanchoring'` -- marker re-detected while locked, returns to tracking

**Tabletop lock (anchor 0 only):**
- `onTargetUpdate` increments `stableFrameCount`
- At 10 frames: capture `lockedMatrix` (anchor.group.matrix x model.matrix) and `lockedDeviceQuat`, move model to scene root, set state to `'locked'`

**Multi-point lock (all 3 anchors):**
- Anchors 1 and 2 get `onTargetUpdate` callbacks that store their poses in `anchorPoses[i]` and increment `anchorStableCounts[i]`
- When all 3 anchors have 10+ stable frames AND `markerData` exists: call `computeWorldTransform()` to get the triangulated placement matrix, use that as `lockedMatrix`
- If `markerData` is missing: fall back to anchor-A-only placement with console warning

**Gyro-compensated render loop:**
```text
deltaQuat = inverse(lockedDeviceQuat) * currentDeviceQuat
deltaMatrix = Matrix4.fromQuaternion(deltaQuat).invert()
model.matrix = deltaMatrix * lockedMatrix
```
This runs every frame while state is `'locked'`, cancelling device rotation so the model appears world-stable.

**Re-anchor on `onTargetFound`:** If state is `'locked'`, return model to anchor.group, restore local transforms, reset stable counts, set state to `'tracking'`. Will re-lock after 10 new stable frames.

**Cleanup:** Remove `deviceorientation` listener on unmount alongside existing MindAR cleanup.

### 4. `src/lib/computeWorldTransform.ts` -- New File

Pure function implementing 3-point Procrustes alignment:

1. Extract positions from 3 MindAR anchor matrices
2. Convert Rhino mm coordinates to MindAR units (divide by MARKER_SIZE_MM = 150)
3. Compute centroids of both point sets
4. Compute scale from ratio of inter-marker distances
5. Compute rotation by aligning basis vectors (cross-product method)
6. Compute translation from centroids
7. Assemble final Matrix4: Translation x Rotation x Scale

Returns the transform that places the Rhino model correctly in MindAR camera space. Includes degenerate triangle detection (near-zero cross product) with fallback.

## Edge Cases Handled

| Scenario | Handling |
|---|---|
| Gyro permission denied (iOS) | Graceful degradation -- static freeze, no rotation compensation |
| No gyroscope hardware | Same as above |
| Marker detected < 10 frames then lost | Lock never triggers, model disappears (acceptable) |
| Marker flickering | Stable count resets on each loss, preventing premature lock |
| User walks across room | Gyro handles rotation only; translation causes drift. Re-scan corrects instantly |
| `markerData` missing in multi-point | Falls back to anchor-A-only with console warning |
| Degenerate triangle (collinear markers) | Detected via cross product magnitude, falls back to anchor-A |
| Only 2/3 markers stable | Lock deferred until all 3 reach threshold |
| Re-scan after lock | All stable counts reset, full re-lock required |

## Files Summary

| File | Change |
|---|---|
| `src/pages/ARViewer.tsx` | Add iOS motion permission + pass `markerData` prop |
| `src/components/ar/ARDetection.tsx` | Add `markerData` prop pass-through |
| `src/components/ar/MindARScene.tsx` | Major rewrite: gyro hook, 3-state machine, mode-specific lock, gyro render loop |
| `src/lib/computeWorldTransform.ts` | New file: 3-point Procrustes alignment |

## Important Limitation

This approach compensates for **rotation only**, not translation (walking). For the interior design use case where users primarily rotate to view from different angles, this is acceptable. Walking several metres causes drift -- re-scanning the marker corrects this instantly.

## No User Flow Changes

The detection phase, UI overlays, marker status indicators, active phase controls, and all transitions remain exactly as they are. The only visible difference is that the model now stays anchored in physical space instead of sticking to the screen.
