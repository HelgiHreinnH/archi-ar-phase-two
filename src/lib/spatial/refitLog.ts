/**
 * Rotation isolation log (contract §6.4, brief item F). Debug only: it records
 * what the placement did and changes nothing.
 *
 * One entry per refit while surveying, one at Lock, one per tracking-state
 * change and camera restart, and — after Lock — one per second from a shadow
 * fit of the new sightings against the locked fit. The model still ignores
 * those sightings (1 Oct 2026 rule). The shadow fit is what makes R3 visible:
 * if the engine re-localises after Lock, the shadow heading moves away from
 * the locked heading while the model sits still on screen.
 */
import type { FitResult } from "./surveyFit";
import type { TrackingState } from "./SpatialTracker";

export type RefitEvent = "refit" | "lock" | "post-lock" | "tracking" | "camera-restart" | "replace";

export interface RefitEntry {
  /** Seconds since the log started. */
  t: number;
  event: RefitEvent;
  /** Heading in degrees, (−180, 180]. */
  yawDeg: number | null;
  rmsMm: number | null;
  markers: number;
  tracking: TrackingState;
  /** Heading change since the previous entry with a heading, degrees. */
  dYawDeg: number | null;
  /** After Lock: shadow heading − locked heading, degrees (R3). */
  driftDeg?: number | null;
  note?: string;
}

const deg = (rad: number) => (rad * 180) / Math.PI;
/** Smallest signed angle a − b in degrees. */
export function angleDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export class RefitLog {
  private entries: RefitEntry[] = [];
  private t0: number;
  private lastYaw: number | null = null;
  private lockedYaw: number | null = null;

  constructor(private readonly max = 400, now = performance.now(), private readonly echo = false) {
    this.t0 = now;
  }

  record(
    event: RefitEvent,
    fit: Pick<FitResult, "yaw" | "rmsMm" | "markersUsed"> | null,
    tracking: TrackingState,
    now = performance.now(),
    note?: string,
  ): RefitEntry {
    const yawDeg = fit ? deg(fit.yaw) : null;
    const dYawDeg = yawDeg !== null && this.lastYaw !== null && event !== "post-lock" ? angleDiffDeg(yawDeg, this.lastYaw) : null;
    if (event === "lock") this.lockedYaw = yawDeg;
    if (event === "replace") this.lockedYaw = null;
    const entry: RefitEntry = {
      t: Number(((now - this.t0) / 1000).toFixed(2)),
      event,
      yawDeg: yawDeg === null ? null : Number(yawDeg.toFixed(2)),
      rmsMm: fit ? Number(fit.rmsMm.toFixed(1)) : null,
      markers: fit?.markersUsed ?? 0,
      tracking,
      dYawDeg: dYawDeg === null ? null : Number(dYawDeg.toFixed(2)),
      note,
    };
    if (event === "post-lock") {
      entry.driftDeg = yawDeg !== null && this.lockedYaw !== null ? Number(angleDiffDeg(yawDeg, this.lockedYaw).toFixed(2)) : null;
    } else if (yawDeg !== null) {
      this.lastYaw = yawDeg;
    }
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    if (this.echo) console.debug("[spatial:refit]", JSON.stringify(entry));
    return entry;
  }

  list(): readonly RefitEntry[] {
    return this.entries;
  }

  /** Largest heading jump between consecutive refits, degrees. */
  maxJumpDeg(): number {
    return this.entries.reduce((m, e) => Math.max(m, Math.abs(e.dYawDeg ?? 0)), 0);
  }

  /** Largest shadow drift after Lock, degrees. */
  maxDriftDeg(): number {
    return this.entries.reduce((m, e) => Math.max(m, Math.abs(e.driftDeg ?? 0)), 0);
  }

  toJSON(): RefitEntry[] {
    return [...this.entries];
  }
}
