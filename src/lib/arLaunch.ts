/**
 * The single tap (Tabletop/Wall, Oct 2026).
 *
 * Why a tap at all: on iOS, motion access (DeviceMotionEvent /
 * DeviceOrientationEvent.requestPermission) can ONLY be asked inside a user
 * gesture. 8th Wall's world tracking (SLAM) needs it, and MindAR's gyro hold
 * needs it. The 18 Sep auto-launch had no tap, so motion was never granted:
 * the model rode with the screen when the QR left the frame (4 Oct test,
 * bug 4). One tap is our agreed floor (decisions, 18 Sep).
 *
 * beginARLaunchFromTap() MUST be called synchronously at the top of the click
 * handler — before any await — or iOS drops the user activation:
 *   1. motion permission (both APIs; iOS shows one prompt),
 *   2. camera permission via getUserMedia.
 * The probe stream is stopped as soon as it is granted, so the engine's own
 * getUserMedia (MindAR start() / XR8.run) is the only capture running — two
 * concurrent captures of the same camera can mute one another on iOS.
 * Engines call waitForCameraGrant() before starting their camera so a second
 * permission prompt can't queue behind ours.
 */
import { markAR } from "@/lib/arTiming";

export type MotionState = "unknown" | "pending" | "granted" | "denied" | "not-required";

type PermissionFn = () => Promise<PermissionState>;

let cameraGrant: Promise<void> | null = null;
let motion: MotionState = "unknown";
const motionListeners = new Set<(s: MotionState) => void>();

function setMotion(s: MotionState) {
  motion = s;
  for (const l of motionListeners) l(s);
}

function permissionFn(api: unknown): PermissionFn | null {
  const fn = (api as { requestPermission?: PermissionFn } | undefined)?.requestPermission;
  return typeof fn === "function" ? fn.bind(api) : null;
}

/** True where motion access needs a tap (iOS 13+ Safari). */
export function motionNeedsPermission(): boolean {
  try {
    return (
      (typeof DeviceMotionEvent !== "undefined" && !!permissionFn(DeviceMotionEvent)) ||
      (typeof DeviceOrientationEvent !== "undefined" && !!permissionFn(DeviceOrientationEvent))
    );
  } catch {
    return false;
  }
}

/** Ask for motion access. Synchronous call into the APIs; result arrives later. */
export function requestMotionAccess(): void {
  let motionFn: PermissionFn | null = null;
  let orientFn: PermissionFn | null = null;
  try {
    motionFn = typeof DeviceMotionEvent !== "undefined" ? permissionFn(DeviceMotionEvent) : null;
    orientFn = typeof DeviceOrientationEvent !== "undefined" ? permissionFn(DeviceOrientationEvent) : null;
  } catch { /* API absent */ }
  if (!motionFn && !orientFn) {
    setMotion("not-required");
    return;
  }
  setMotion("pending");
  // Both calls happen now, inside the gesture. iOS shows a single prompt for
  // "Motion & Orientation Access" and resolves both with the same answer.
  const asks = [motionFn, orientFn]
    .filter((f): f is PermissionFn => !!f)
    .map((f) => f().catch(() => "denied" as PermissionState));
  void Promise.all(asks).then((r) => setMotion(r.includes("granted") ? "granted" : "denied"));
}

/** Ask for the camera now (inside the tap); resolves when the prompt is answered. */
function requestCameraAccess(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.resolve();
  }
  return navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
    .then((stream) => {
      markAR("camera-granted");
      for (const t of stream.getTracks()) {
        try { t.stop(); } catch { /* noop */ }
      }
    })
    .catch((err) => {
      // Denied or no camera: the engine's own request surfaces the error and
      // ARViewer's permission screen takes over.
      markAR("camera-granted", `failed: ${(err as Error)?.name ?? "error"}`);
    });
}

/** The tap. Call first thing in the click handler, before any await. */
export function beginARLaunchFromTap(): void {
  requestMotionAccess();
  cameraGrant = requestCameraAccess();
}

/** Engines await this before starting their camera. No tap → resolves now. */
export function waitForCameraGrant(): Promise<void> {
  return cameraGrant ?? Promise.resolve();
}

export function getMotionState(): MotionState {
  return motion;
}

export function subscribeMotionState(l: (s: MotionState) => void): () => void {
  motionListeners.add(l);
  return () => { motionListeners.delete(l); };
}

/** Test hook. */
export function __resetARLaunchForTests(): void {
  cameraGrant = null;
  motion = "unknown";
  motionListeners.clear();
}
