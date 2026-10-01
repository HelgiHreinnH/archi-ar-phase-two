/**
 * surveyFit.ts — Spatial survey + fit, engine-agnostic (Sep/Oct 2026 bake-off).
 *
 * The client walks A → B → C. Every time the engine sees a marker it reports
 * that marker's position in its own world frame (SLAM / VPS). We collect those
 * sightings, take a robust median per marker, and fit the architect's Rhino
 * marker coordinates onto them:
 *
 *     world ≈ s · Ry(θ) · model + t
 *
 * Tilt is NOT fitted: world Y is gravity-up in every engine we use, and the
 * model's Y is Rhino Z (up). So the unknowns are heading θ, translation t and
 * (optionally) scale s. Two markers are enough; the third is a check, and its
 * residual is the accuracy number we report.
 *
 * Scale: 8th Wall in absolute mode reports metres, so s ≈ 1. Zappar is only
 * "approximately metric", and some engines use arbitrary units. Solving s and
 * reporting it keeps the same code honest for every engine: s far from 1.00
 * means the engine's scale is off (or a marker is misplaced).
 *
 * No three.js here on purpose — pure maths, unit-tested.
 */
import type { MarkerPoint } from "@/lib/markerTypes";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Rhino (Z-up, mm) → glTF model space (Y-up, metres), matching Rhino's glTF
 * writer with MapZToY on. Inverse of parseGlbMarkers.ts:
 *   Rhino.X = g.X·1000, Rhino.Y = −g.Z·1000, Rhino.Z = g.Y·1000
 */
export function rhinoMmToModelM(p: Pick<MarkerPoint, "x" | "y" | "z">): Vec3 {
  return { x: p.x / 1000, y: p.z / 1000, z: -p.y / 1000 };
}

// ── Sighting collector ──────────────────────────────────────────────────

export interface MarkerEstimate {
  index: number;
  position: Vec3;
  /** Sightings kept after outlier rejection. */
  count: number;
  /** Median distance of kept sightings from the estimate (world units). */
  spread: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Keeps the last `maxPerMarker` sightings per marker and returns a robust
 * per-marker position: component-wise median, then sightings further than
 * `rejectDistance` from it are dropped and the median recomputed.
 */
export class SurveyCollector {
  private samples = new Map<number, Vec3[]>();

  constructor(
    private readonly maxPerMarker = 60,
    /** World units. 0.05 = 5 cm when the engine reports metres. */
    private readonly rejectDistance = 0.05,
  ) {}

  add(index: number, p: Vec3): void {
    if (![p.x, p.y, p.z].every(Number.isFinite)) return;
    const list = this.samples.get(index) ?? [];
    list.push({ x: p.x, y: p.y, z: p.z });
    if (list.length > this.maxPerMarker) list.shift();
    this.samples.set(index, list);
  }

  clear(index?: number): void {
    if (index === undefined) this.samples.clear();
    else this.samples.delete(index);
  }

  count(index: number): number {
    return this.samples.get(index)?.length ?? 0;
  }

  estimate(index: number): MarkerEstimate | null {
    const list = this.samples.get(index);
    if (!list || list.length === 0) return null;
    const med = (pts: Vec3[]): Vec3 => ({
      x: median(pts.map((p) => p.x)),
      y: median(pts.map((p) => p.y)),
      z: median(pts.map((p) => p.z)),
    });
    let centre = med(list);
    const kept = list.filter((p) => dist(p, centre) <= this.rejectDistance);
    if (kept.length >= Math.max(3, Math.ceil(list.length / 3))) centre = med(kept);
    const used = kept.length ? kept : list;
    return {
      index,
      position: centre,
      count: used.length,
      spread: median(used.map((p) => dist(p, centre))),
    };
  }

  estimates(): MarkerEstimate[] {
    return [...this.samples.keys()]
      .sort((a, b) => a - b)
      .map((i) => this.estimate(i))
      .filter((e): e is MarkerEstimate => !!e);
  }
}

// ── Gravity-aligned similarity fit ──────────────────────────────────────

export interface FitPair {
  index: number;
  /** Marker in model space (metres, Y-up). */
  model: Vec3;
  /** Marker as observed in the engine's world frame. */
  world: Vec3;
}

export interface FitOptions {
  /** Solve scale (default true). If false, s = 1 (engine must report metres). */
  solveScale?: boolean;
}

export interface MarkerResidual {
  index: number;
  /** Distance between fitted and observed marker, in millimetres. */
  errorMm: number;
}

export interface PairDistance {
  a: number;
  b: number;
  /** Distance in the Rhino model (mm). */
  modelMm: number;
  /** Observed distance converted to mm with the fitted scale. */
  observedMm: number;
}

export interface FitResult {
  /** Heading in radians (rotation about world +Y). */
  yaw: number;
  /** World units per model metre. ≈1 when the engine reports metres. */
  scale: number;
  translation: Vec3;
  /** Column-major 4×4 (THREE.Matrix4.fromArray): world = M · model. */
  matrix: number[];
  residuals: MarkerResidual[];
  /** Root-mean-square of residuals, mm. 0 with only two markers. */
  rmsMm: number;
  pairs: PairDistance[];
  markersUsed: number;
}

/** world = s · Ry(yaw) · p + t */
export function applyFit(yaw: number, s: number, t: Vec3, p: Vec3): Vec3 {
  const c = Math.cos(yaw), n = Math.sin(yaw);
  // three.js rotation about +Y: x' = c·x + n·z, z' = −n·x + c·z
  return {
    x: s * (c * p.x + n * p.z) + t.x,
    y: s * p.y + t.y,
    z: s * (-n * p.x + c * p.z) + t.z,
  };
}

/** Column-major 4×4 of s·Ry(yaw) then translation t (THREE.Matrix4.fromArray). */
export function fitMatrix(yaw: number, s: number, t: Vec3): number[] {
  const c = Math.cos(yaw), si = Math.sin(yaw);
  return [
    s * c, 0, -s * si, 0,
    0, s, 0, 0,
    s * si, 0, s * c, 0,
    t.x, t.y, t.z, 1,
  ];
}

/**
 * Least-squares fit of model points onto world points, rotation about Y only.
 * Returns null with fewer than two markers or when they are (nearly) on top of
 * each other in plan.
 */
export function fitGravityAligned(pairs: FitPair[], opts: FitOptions = {}): FitResult | null {
  const solveScale = opts.solveScale ?? true;
  if (pairs.length < 2) return null;

  const n = pairs.length;
  const pc = { x: 0, y: 0, z: 0 }, qc = { x: 0, y: 0, z: 0 };
  for (const { model: p, world: q } of pairs) {
    pc.x += p.x / n; pc.y += p.y / n; pc.z += p.z / n;
    qc.x += q.x / n; qc.y += q.y / n; qc.z += q.z / n;
  }

  let A = 0, B = 0, planSpread = 0;
  for (const { model: p, world: q } of pairs) {
    const px = p.x - pc.x, pz = p.z - pc.z;
    const qx = q.x - qc.x, qz = q.z - qc.z;
    A += qx * px + qz * pz;
    B += qx * pz - qz * px;
    planSpread += px * px + pz * pz;
  }
  if (planSpread < 1e-6) return null; // markers stacked vertically: heading unknown
  const yaw = Math.atan2(B, A);

  let s = 1;
  if (solveScale) {
    const c = Math.cos(yaw), si = Math.sin(yaw);
    let num = 0, den = 0;
    for (const { model: p, world: q } of pairs) {
      const px = p.x - pc.x, py = p.y - pc.y, pz = p.z - pc.z;
      const rx = c * px + si * pz, rz = -si * px + c * pz;
      num += (q.x - qc.x) * rx + (q.y - qc.y) * py + (q.z - qc.z) * rz;
      den += px * px + py * py + pz * pz;
    }
    s = den > 1e-12 && num > 0 ? num / den : 1;
  }

  const rpc = applyFit(yaw, s, { x: 0, y: 0, z: 0 }, pc);
  const t = { x: qc.x - rpc.x, y: qc.y - rpc.y, z: qc.z - rpc.z };

  // World units → mm: one model metre is `s` world units.
  const toMm = 1000 / s;
  const residuals = pairs.map(({ index, model, world }) => ({
    index,
    errorMm: dist(applyFit(yaw, s, t, model), world) * toMm,
  }));
  const rmsMm = Math.sqrt(residuals.reduce((a, r) => a + r.errorMm ** 2, 0) / n);

  const pairDistances: PairDistance[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairDistances.push({
        a: pairs[i].index,
        b: pairs[j].index,
        modelMm: dist(pairs[i].model, pairs[j].model) * 1000,
        observedMm: dist(pairs[i].world, pairs[j].world) * toMm,
      });
    }
  }

  return { yaw, scale: s, translation: t, matrix: fitMatrix(yaw, s, t), residuals, rmsMm, pairs: pairDistances, markersUsed: n };
}

/**
 * Convenience: fit stored Rhino markers against collector estimates.
 * Markers with fewer than `minSightings` are left out.
 */
export function fitSurvey(
  markers: MarkerPoint[],
  collector: SurveyCollector,
  opts: FitOptions & { minSightings?: number } = {},
): FitResult | null {
  const min = opts.minSightings ?? 5;
  const pairs: FitPair[] = [];
  for (const m of markers) {
    const e = collector.estimate(m.index);
    if (e && e.count >= min) pairs.push({ index: m.index, model: rhinoMmToModelM(m), world: e.position });
  }
  return fitGravityAligned(pairs, opts);
}
