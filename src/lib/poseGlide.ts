/**
 * Smooth moves for a placed model (4 Oct 2026, Helgi: "if the model should
 * move, make the movement smoother").
 *
 * Every time a locked model has to move (8th Wall re-anchoring after SLAM
 * lost the room, MindAR re-snapping onto the QR) it glides from where it is
 * to where it should be with an ease-in-out curve, instead of a jump or a
 * quick snap.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** How long a correction glide takes. Long enough to read as a glide, not a jump. */
export const GLIDE_MS = 900;

/** Smootherstep (Perlin): zero velocity AND acceleration at both ends. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Progress 0..1 of a glide that started at `start` (ms). */
export function glideProgress(now: number, start: number, durationMs = GLIDE_MS): number {
  if (!(durationMs > 0)) return 1;
  return easeInOut((now - start) / durationMs);
}

export interface Pose {
  position: any;
  quaternion: any;
  width: number;
}

/** Interpolate two anchor poses (three.js Vector3/Quaternion) at eased progress k. */
export function lerpPose(from: Pose, to: Pose, k: number): Pose {
  return {
    position: from.position.clone().lerp(to.position, k),
    quaternion: from.quaternion.clone().slerp(to.quaternion, k),
    width: from.width + (to.width - from.width) * k,
  };
}
