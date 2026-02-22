

# Fix Gyro-Compensated World Anchoring

## Problem
When the model locks after tracking, it moves with the phone instead of staying fixed in physical space. The gyro compensation code has two bugs:

1. **Wrong quaternion conversion**: The `deviceOrientationToQuaternion` function is missing a critical -90 degree X-axis correction. The W3C device orientation spec assumes the device is lying flat (screen up), but during AR the phone is held upright (portrait). Without this correction, the rotation axes don't map to MindAR's camera coordinate system.

2. **Missing screen orientation compensation**: Phone rotation (portrait/landscape) changes which physical axis maps to which screen axis. The current code ignores `window.screen.orientation.angle`, causing wrong axis mapping on rotated devices.

## What Changes

**`src/components/ar/MindARScene.tsx`**

### 1. Rewrite `deviceOrientationToQuaternion` (lines 66-84)

Replace with the standard algorithm from Three.js's DeviceOrientationControls:

```
function deviceOrientationToQuaternion(
  alpha, beta, gamma, orient, ThreeLib
) {
  const degToRad = Math.PI / 180;
  const euler = new ThreeLib.Euler(
    beta * degToRad,
    alpha * degToRad,
    -gamma * degToRad,
    "YXZ"
  );
  const q = new ThreeLib.Quaternion().setFromEuler(euler);

  // Correction: device flat -> device upright (-90deg around X)
  const q1 = new ThreeLib.Quaternion(
    -Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)
  );
  q.multiply(q1);

  // Screen orientation compensation
  const q2 = new ThreeLib.Quaternion();
  q2.setFromAxisAngle(
    new ThreeLib.Vector3(0, 0, 1),
    -orient * degToRad
  );
  q.multiply(q2);

  return q;
}
```

The `-90 degree X correction` (q1) rotates from "device flat on table" reference frame to "device held upright" -- matching how users hold phones during AR. The screen orientation quaternion (q2) compensates for portrait/landscape rotation.

### 2. Track screen orientation in the listener (around line 146)

Add screen orientation tracking alongside the deviceorientation listener:

```
let screenOrientation = window.screen?.orientation?.angle || 0;
const onOrientationChange = () => {
  screenOrientation = window.screen?.orientation?.angle || 0;
};
window.addEventListener("orientationchange", onOrientationChange);
```

Pass `screenOrientation` into `deviceOrientationToQuaternion` in the `onDeviceOrientation` handler.

### 3. Simplify render loop compensation (lines 424-452)

The delta quaternion math has a double-inversion (computes delta then inverts). Simplify to the correct single operation:

```
// delta = how much phone rotated since lock
const deltaQuat = lockedDeviceQuat.clone().invert()
  .multiply(deviceQuaternionRef.current.clone());

// Apply inverse rotation to keep model stationary in world
const invDelta = deltaQuat.clone().invert();
const deltaMatrix = new ThreeLib.Matrix4()
  .makeRotationFromQuaternion(invDelta);

// Decompose locked matrix, apply rotation around model's world position
const lockedPos = new ThreeLib.Vector3();
const lockedQuat = new ThreeLib.Quaternion();
const lockedScl = new ThreeLib.Vector3();
lockedMatrix.decompose(lockedPos, lockedQuat, lockedScl);

const compensatedQuat = invDelta.clone().multiply(lockedQuat);
const compensated = new ThreeLib.Matrix4()
  .compose(lockedPos, compensatedQuat, lockedScl);
modelRef.matrix.copy(compensated);
```

Key difference: only the rotation is compensated (via quaternion), while position and scale are preserved from the locked snapshot. This prevents the model from drifting in translation when the phone rotates.

### 4. Clean up orientation listener on unmount

Add `window.removeEventListener("orientationchange", ...)` to the cleanup function.

## Why the current code fails

| Issue | Current | Fixed |
|-------|---------|-------|
| Device-to-camera frame | Raw Euler, no upright correction | Standard q1 correction (-90 deg X) |
| Screen rotation | Ignored | Compensated via screen.orientation.angle |
| Compensation math | Double inversion (delta inverted twice) | Single inverse delta applied to rotation only |
| Translation during gyro | Full matrix multiply shifts position | Decompose/recompose preserves position |

## Files Changed

| File | Change |
|------|--------|
| `src/components/ar/MindARScene.tsx` | Fix quaternion conversion, add screen orientation, simplify compensation loop |

