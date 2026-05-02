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
 *
 * Primary source: `deviceorientation` (absolute heading via compass).
 * Fallback source: `devicemotion` rotationRate, integrated to alpha/beta/gamma,
 * activated if no `deviceorientation` event arrives within 1500 ms. This rescues
 * Android browsers / iframe previews where deviceorientation never fires.
 *
 * The active source is tagged on `deviceQuaternionRef.source` ("orientation" |
 * "motion-fallback" | "none") so callers can warn the user about degraded tracking.
 *
 * Returns a cleanup function.
 */
export function createGyroListener(
  deviceQuaternionRef: { current: any; source?: "orientation" | "motion-fallback" | "none" },
  hasGyroRef: { current: boolean },
  ThreeLib: any
): () => void {
  let screenOrientation = window.screen?.orientation?.angle || 0;
  let receivedOrientationEvent = false;
  deviceQuaternionRef.source = "none";

  const onOrientationChange = () => {
    screenOrientation = window.screen?.orientation?.angle || 0;
  };
  window.addEventListener("orientationchange", onOrientationChange);

  const onDeviceOrientation = (event: DeviceOrientationEvent) => {
    if (event.alpha != null && event.beta != null && event.gamma != null) {
      receivedOrientationEvent = true;
      hasGyroRef.current = true;
      deviceQuaternionRef.source = "orientation";
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

  // ── DeviceMotion fallback ──
  // If no deviceorientation event arrives within 1500 ms, integrate rotationRate.
  let motionAlpha = 0, motionBeta = 0, motionGamma = 0;
  let lastMotionTs = 0;
  const onDeviceMotion = (event: DeviceMotionEvent) => {
    const r = event.rotationRate;
    if (!r || (r.alpha == null && r.beta == null && r.gamma == null)) return;
    const now = event.timeStamp || performance.now();
    if (lastMotionTs === 0) { lastMotionTs = now; return; }
    const dt = (now - lastMotionTs) / 1000;
    lastMotionTs = now;
    if (dt <= 0 || dt > 0.5) return; // ignore stalls

    motionAlpha = (motionAlpha + (r.alpha ?? 0) * dt) % 360;
    motionBeta = Math.max(-180, Math.min(180, motionBeta + (r.beta ?? 0) * dt));
    motionGamma = Math.max(-90, Math.min(90, motionGamma + (r.gamma ?? 0) * dt));

    hasGyroRef.current = true;
    deviceQuaternionRef.source = "motion-fallback";
    deviceQuaternionRef.current = deviceOrientationToQuaternion(
      motionAlpha, motionBeta, motionGamma, screenOrientation, ThreeLib
    );
  };

  const fallbackTimer = window.setTimeout(() => {
    if (!receivedOrientationEvent) {
      console.warn("[arGyro] No deviceorientation events — attaching devicemotion fallback");
      window.addEventListener("devicemotion", onDeviceMotion, true);
    }
  }, 1500);

  return () => {
    window.clearTimeout(fallbackTimer);
    window.removeEventListener("deviceorientation", onDeviceOrientation, true);
    window.removeEventListener("devicemotion", onDeviceMotion, true);
    window.removeEventListener("orientationchange", onOrientationChange);
  };
}
