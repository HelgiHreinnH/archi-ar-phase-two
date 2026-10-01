/**
 * poseBlend.ts — "corrections blend, never snap" (Tracking principle, Oct 2026).
 *
 * Every placement correction (a new survey fit, later a VPS re-localise) goes
 * through a PoseBlender instead of being written straight to the model:
 *
 *  - The first pose is applied at once (nothing on screen to jump from).
 *  - A new target that moves the model less than `minMoveM` (1 cm) at any
 *    marker is ignored: a steady 1 cm offset looks better than constant jitter.
 *  - A larger correction eases in over `durationMs` (0.5 s, ease-in-out).
 *    Yaw takes the short way round; scale and translation interpolate linearly.
 *  - A new target mid-blend restarts the blend from where the model is now,
 *    so there is never a jump.
 *
 * "How far the model moves" is measured at the Rhino markers themselves, so a
 * small heading change on a big room counts as the metres it really is.
 * Pure maths, no three.js.
 */
import { applyFit, fitMatrix, type Vec3 } from "./surveyFit";

export interface Pose {
  yaw: number;
  scale: number;
  translation: Vec3;
}

export interface BlendOptions {
  /** Ignore corrections that move every marker less than this (world units). */
  minMoveM?: number;
  durationMs?: number;
}

const TAU = Math.PI * 2;

/** Shortest signed angle from a to b, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Largest distance any of `points` (model space) moves between two poses. */
export function poseMove(a: Pose, b: Pose, points: Vec3[]): number {
  const pts = points.length ? points : [{ x: 0, y: 0, z: 0 }];
  let max = 0;
  for (const p of pts) {
    const pa = applyFit(a.yaw, a.scale, a.translation, p);
    const pb = applyFit(b.yaw, b.scale, b.translation, p);
    max = Math.max(max, Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z));
  }
  return max;
}

export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    yaw: a.yaw + angleDelta(a.yaw, b.yaw) * k,
    scale: a.scale + (b.scale - a.scale) * k,
    translation: {
      x: a.translation.x + (b.translation.x - a.translation.x) * k,
      y: a.translation.y + (b.translation.y - a.translation.y) * k,
      z: a.translation.z + (b.translation.z - a.translation.z) * k,
    },
  };
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export class PoseBlender {
  private from: Pose | null = null;
  private to: Pose | null = null;
  private startedAt = 0;
  private readonly minMove: number;
  private readonly duration: number;

  constructor(
    /** Model-space points used to measure movement (the Rhino markers). */
    private points: Vec3[] = [],
    opts: BlendOptions = {},
  ) {
    this.minMove = opts.minMoveM ?? 0.01;
    this.duration = opts.durationMs ?? 500;
  }

  setPoints(points: Vec3[]): void {
    this.points = points;
  }

  /** Forget everything (re-survey). The next target applies at once. */
  reset(): void {
    this.from = this.to = null;
  }

  /**
   * Offer a new target pose. Returns "applied" (first pose), "blending"
   * (eases in from now) or "ignored" (below the move threshold).
   */
  setTarget(target: Pose, now: number): "applied" | "blending" | "ignored" {
    if (!this.to) {
      this.from = this.to = target;
      this.startedAt = now - this.duration;
      return "applied";
    }
    const current = this.sample(now);
    if (poseMove(current, target, this.points) < this.minMove) return "ignored";
    this.from = current;
    this.to = target;
    this.startedAt = now;
    return "blending";
  }

  /** Pose to render at time `now` (ms), or null before the first target. */
  sample(now: number): Pose {
    if (!this.from || !this.to) throw new Error("PoseBlender has no pose yet");
    const k = Math.min(1, Math.max(0, (now - this.startedAt) / this.duration));
    return k >= 1 ? this.to : lerpPose(this.from, this.to, easeInOut(k));
  }

  hasPose(): boolean {
    return !!this.to;
  }

  isBlending(now: number): boolean {
    return !!this.to && now - this.startedAt < this.duration;
  }

  /** Column-major matrix for the pose at `now`. */
  matrix(now: number): number[] {
    const p = this.sample(now);
    return fitMatrix(p.yaw, p.scale, p.translation);
  }
}
