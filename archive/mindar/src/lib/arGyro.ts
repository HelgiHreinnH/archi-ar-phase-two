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
 * MindAR's camera never moves — everything is expressed in camera space. For
 * the model to stay put in the room while the phone turns, its WHOLE pose
 * (position and orientation) must be rotated about the camera by the inverse
 * of the phone's rotation since lock:  C_now = (Q_now⁻¹ · Q_lock) · C_lock.
 *
 * Sept 2026: this used to rotate only the model's orientation about its own
 * centre and leave its position where it was on screen, so the model rode
 * along with the phone. It also wrote `matrix` without flagging
 * `matrixWorldNeedsUpdate`; with matrixAutoUpdate=false three.js then never
 * recomputed matrixWorld, so no locked-pose update ever reached the screen.
 * Phone translation is not observable from the gyro — only the tracked marker
 * can correct that.
 */
export function applyGyroCompensation(
  lockedMatrix: any,
  lockedDeviceQuat: any,
  currentDeviceQuat: any,
  modelRef: any,
  ThreeLib: any
): void {
  // Rotation that takes lock-time camera space to current camera space.
  const invDelta = currentDeviceQuat.clone().invert().multiply(lockedDeviceQuat);
  const rot = new ThreeLib.Matrix4().makeRotationFromQuaternion(invDelta);
  modelRef.matrix.copy(rot.multiply(lockedMatrix));
  modelRef.matrixWorldNeedsUpdate = true;
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
