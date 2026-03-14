/**
 * Shared AR gyroscope utilities.
 * Provides device orientation → quaternion conversion with
 * upright correction and screen orientation compensation.
 *
 * Used by MindARScene (multi-point) and potentially future AR scene components.
 */

/**
 * Convert W3C deviceorientation (alpha/beta/gamma) to a Three.js Quaternion.
 *
 * Includes two critical corrections:
 * 1. -90° X rotation: W3C spec assumes device flat (screen up), but during AR
 *    the phone is held upright. This rotates from flat-reference to upright-reference.
 * 2. Screen orientation compensation: adjusts for portrait/landscape rotation
 *    using `window.screen.orientation.angle`.
 */
export function deviceOrientationToQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
  screenOrientation: number,
  ThreeLib: any
): any {
  const degToRad = Math.PI / 180;
  const euler = new ThreeLib.Euler(
    beta * degToRad,
    alpha * degToRad,
    -gamma * degToRad,
    "YXZ"
  );
  const q = new ThreeLib.Quaternion().setFromEuler(euler);

  // Correction: device flat → device upright (-90° around X)
  const q1 = new ThreeLib.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  q.multiply(q1);

  // Screen orientation compensation (portrait/landscape)
  const q2 = new ThreeLib.Quaternion();
  q2.setFromAxisAngle(
    new ThreeLib.Vector3(0, 0, 1),
    -screenOrientation * degToRad
  );
  q.multiply(q2);

  return q;
}

/**
 * Apply gyro-compensated rotation to a locked model.
 *
 * Computes how much the phone has rotated since the model was locked,
 * then applies the inverse rotation to keep the model stationary in
 * physical space. Only rotation is compensated — position and scale
 * are preserved from the locked snapshot.
 */
export function applyGyroCompensation(
  lockedMatrix: any,
  lockedDeviceQuat: any,
  currentDeviceQuat: any,
  modelRef: any,
  ThreeLib: any
): void {
  // delta = how much phone rotated since lock
  const deltaQuat = lockedDeviceQuat
    .clone()
    .invert()
    .multiply(currentDeviceQuat.clone());

  // Apply inverse rotation to keep model stationary in world
  const invDelta = deltaQuat.clone().invert();

  // Decompose locked matrix, apply rotation around model's world position
  const lockedPos = new ThreeLib.Vector3();
  const lockedQuat = new ThreeLib.Quaternion();
  const lockedScl = new ThreeLib.Vector3();
  lockedMatrix.decompose(lockedPos, lockedQuat, lockedScl);

  const compensatedQuat = invDelta.clone().multiply(lockedQuat);
  const compensated = new ThreeLib.Matrix4();
  compensated.compose(lockedPos, compensatedQuat, lockedScl);
  modelRef.matrix.copy(compensated);
}

/**
 * Create a gyroscope listener setup with screen orientation tracking.
 * Returns a cleanup function.
 */
export function createGyroListener(
  deviceQuaternionRef: { current: any },
  hasGyroRef: { current: boolean },
  ThreeLib: any
): () => void {
  let screenOrientation = window.screen?.orientation?.angle || 0;

  const onOrientationChange = () => {
    screenOrientation = window.screen?.orientation?.angle || 0;
  };
  window.addEventListener("orientationchange", onOrientationChange);

  const onDeviceOrientation = (event: DeviceOrientationEvent) => {
    if (event.alpha != null && event.beta != null && event.gamma != null) {
      hasGyroRef.current = true;
      deviceQuaternionRef.current = deviceOrientationToQuaternion(
        event.alpha,
        event.beta,
        event.gamma,
        screenOrientation,
        ThreeLib
      );
    }
  };
  window.addEventListener("deviceorientation", onDeviceOrientation, true);

  return () => {
    window.removeEventListener("deviceorientation", onDeviceOrientation, true);
    window.removeEventListener("orientationchange", onOrientationChange);
  };
}
