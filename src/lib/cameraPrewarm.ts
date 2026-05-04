/**
 * Phase 2.1 — Camera pre-warm.
 *
 * Holds a singleton MediaStream that can be acquired during the AR landing
 * page (while the user reads the briefing) so that the actual AR engine init
 * doesn't pay the 1–2s `getUserMedia` cost.
 *
 * Notes:
 *  - We only acquire when a previous grant likely exists (Permissions API
 *    reports "granted"). Otherwise we'd trigger a confusing pre-emptive
 *    permission prompt before the user taps "Launch AR".
 *  - The stream is parked but never attached to any visible element. AR engines
 *    (XR8, MindAR) typically request their own getUserMedia internally; the
 *    benefit here is that the camera hardware is already "warm" so subsequent
 *    requests resolve almost instantly on iOS/Android.
 *  - On unmount or cancel we stop tracks to release the camera light.
 */

let warmStream: MediaStream | null = null;
let warmInFlight: Promise<MediaStream | null> | null = null;

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

async function hasGrantedCamera(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return status?.state === "granted";
  } catch {
    return false;
  }
}

export async function prewarmCamera(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  if (warmStream && warmStream.getVideoTracks().some((t) => t.readyState === "live")) {
    return warmStream;
  }
  if (warmInFlight) return warmInFlight;

  if (!(await hasGrantedCamera())) {
    // Don't trigger a permission prompt on landing — let the AR engine ask later.
    return null;
  }

  warmInFlight = (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: VIDEO_CONSTRAINTS,
        audio: false,
      });
      warmStream = stream;
      console.log("[cameraPrewarm] Camera warmed.");
      return stream;
    } catch (err) {
      console.warn("[cameraPrewarm] Pre-warm failed (non-fatal):", err);
      return null;
    } finally {
      warmInFlight = null;
    }
  })();

  return warmInFlight;
}

export function getWarmStream(): MediaStream | null {
  if (warmStream && warmStream.getVideoTracks().some((t) => t.readyState === "live")) {
    return warmStream;
  }
  return null;
}

export function releaseWarmCamera(): void {
  if (warmStream) {
    for (const t of warmStream.getTracks()) {
      try { t.stop(); } catch { /* noop */ }
    }
    warmStream = null;
    console.log("[cameraPrewarm] Camera released.");
  }
}
