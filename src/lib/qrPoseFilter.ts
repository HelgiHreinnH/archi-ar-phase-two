/**
 * Turns noisy 8th Wall image-target poses of the printed QR into a stable,
 * gravity-aligned anchor pose.
 *
 * Why: device test 23 Sep — at steep angles, through glare on a screen or with
 * the QR half in frame, 8th Wall occasionally reports a wildly wrong
 * orientation/size (the model flipped flat and grew huge for seconds). But
 * SLAM knows gravity (world +Y is up), and a tabletop QR is always flat and a
 * wall QR always vertical, so the QR only needs to provide POSITION, HEADING
 * and SIZE. Tilt comes from gravity. Readings whose tilt or size disagree with
 * that are discarded as outliers; the rest are smoothed.
 *
 * Anchor frame convention (same as MindAR / placeModelOnQr): the QR spans
 * local X/Y, +Z points out of it. Tabletop → +Z = world up, +Y = the QR's
 * "up" edge projected flat. Wall → +Y = world up, +Z = the QR's facing
 * direction projected horizontal.
 */

// three.js runtime module (self-hosted) or the npm package in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Three = any;

export interface QrReading {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  /** QR width in scene units. */
  width: number;
}

/** A reading is rejected if its surface is tilted more than this from the expected plane. */
export const MAX_TILT_DEG = 35;
/** …or if its size is more than this fraction away from the running median. */
export const MAX_SIZE_DEVIATION = 0.3;
/** Blend toward each accepted reading (1 = jump). */
export const POSE_ALPHA = 0.35;
const HISTORY = 15;

/**
 * Automatic lock (Oct 2026): the QR counts as steady when the last
 * STEADY_FRAMES accepted readings sit within STEADY_MAX_SD QR widths of each
 * other (standard deviation of position). 0.02 × 150 mm = 3 mm — the same
 * gate the MindAR lock uses (MindARScene VARIANCE_THRESHOLD). On 8th Wall the
 * readings are world-space, so SLAM already removes the hand's own motion.
 */
export const STEADY_FRAMES = 8;
export const STEADY_MAX_SD = 0.02;

/**
 * Gravity-aligned orientation for a raw QR rotation. Returns the corrected
 * quaternion and how far (degrees) the raw reading was tilted off the plane
 * we expect, or null if the reading is degenerate.
 */
export function gravityAlign(
  T: Three,
  rotation: QrReading["rotation"],
  mode: string,
): { quaternion: Three; tiltDeg: number } | null {
  const q = new T.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
  const up = new T.Vector3(0, 1, 0);
  const normal = new T.Vector3(0, 0, 1).applyQuaternion(q);
  const qrUp = new T.Vector3(0, 1, 0).applyQuaternion(q);
  let X: Three, Y: Three, Z: Three, tiltDeg: number;

  if (mode === "wall") {
    // Wall QR: normal should be horizontal.
    const nh = normal.clone().setY(0);
    if (nh.lengthSq() < 1e-6) return null;
    nh.normalize();
    tiltDeg = T.MathUtils.radToDeg(Math.asin(Math.min(1, Math.abs(normal.y))));
    Z = nh;
    Y = up.clone();
    X = new T.Vector3().crossVectors(Y, Z).normalize();
  } else {
    // Table QR: normal should point straight up.
    tiltDeg = T.MathUtils.radToDeg(normal.angleTo(up));
    const yh = qrUp.clone().setY(0);
    if (yh.lengthSq() < 1e-6) {
      // QR "up" edge points vertically (reading is ~90° off) — use its right edge.
      const xh = new T.Vector3(1, 0, 0).applyQuaternion(q).setY(0);
      if (xh.lengthSq() < 1e-6) return null;
      xh.normalize();
      yh.crossVectors(up, xh); // Y = Z × X
    }
    Y = yh.normalize();
    Z = up.clone();
    X = new T.Vector3().crossVectors(Y, Z).normalize();
  }
  const m = new T.Matrix4().makeBasis(X, Y, Z);
  return { quaternion: new T.Quaternion().setFromRotationMatrix(m), tiltDeg };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Stateful filter: feed readings, get a stable anchor pose (or null if rejected). */
export class QrPoseFilter {
  private widths: number[] = [];
  private position: Three = null;
  private quaternion: Three = null;
  private width = 0;
  /** Raw accepted positions (before smoothing), newest last — for isSteady. */
  private recent: { x: number; y: number; z: number }[] = [];
  rejected = 0;
  /** Accepted readings since the last reset. */
  accepted = 0;

  constructor(private T: Three, private mode: string) {}

  reset() {
    this.widths = [];
    this.position = null;
    this.quaternion = null;
    this.width = 0;
    this.recent = [];
    this.accepted = 0;
  }

  /**
   * True when the recent readings agree closely enough to lock on. `maxSd` is
   * in QR widths (STEADY_MAX_SD = 3 mm on the 150 mm QR).
   */
  isSteady(frames = STEADY_FRAMES, maxSd = STEADY_MAX_SD): boolean {
    if (this.recent.length < frames || !(this.width > 0)) return false;
    const r = this.recent.slice(-frames);
    const m = r.reduce((a, p) => ({ x: a.x + p.x / r.length, y: a.y + p.y / r.length, z: a.z + p.z / r.length }), { x: 0, y: 0, z: 0 });
    const sd = Math.sqrt(r.reduce((a, p) => a + (p.x - m.x) ** 2 + (p.y - m.y) ** 2 + (p.z - m.z) ** 2, 0) / r.length);
    return sd / this.width < maxSd;
  }

  /** Returns the smoothed pose after this reading, or null if it was discarded. */
  push(r: QrReading): { position: Three; quaternion: Three; width: number } | null {
    const T = this.T;
    const aligned = gravityAlign(T, r.rotation, this.mode);
    if (!aligned || aligned.tiltDeg > MAX_TILT_DEG || !(r.width > 0)) {
      this.rejected++;
      return null;
    }
    if (this.widths.length >= 3) {
      const med = median(this.widths);
      if (Math.abs(r.width / med - 1) > MAX_SIZE_DEVIATION) {
        this.rejected++;
        return null;
      }
    }
    this.widths.push(r.width);
    if (this.widths.length > HISTORY) this.widths.shift();

    const p = new T.Vector3(r.position.x, r.position.y, r.position.z);
    this.accepted++;
    this.recent.push({ x: p.x, y: p.y, z: p.z });
    if (this.recent.length > HISTORY) this.recent.shift();
    if (!this.position) {
      this.position = p;
      this.quaternion = aligned.quaternion;
    } else {
      this.position.lerp(p, POSE_ALPHA);
      this.quaternion.slerp(aligned.quaternion, POSE_ALPHA);
    }
    this.width = median(this.widths);
    return { position: this.position.clone(), quaternion: this.quaternion.clone(), width: this.width };
  }
}
