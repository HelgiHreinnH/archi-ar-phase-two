/**
 * computeWorldTransform.ts
 *
 * Generalized N-marker Procrustes alignment: maps Rhino model coordinates (mm)
 * to MindAR camera space using observed anchor poses.
 *
 * Supports:
 *   - 3+ anchors: selects best triangle (largest area) from visible set
 *   - 2 anchors: translation + rotation correction (around connecting axis)
 *   - 1 anchor: translation correction only
 */

import type { MarkerPoint } from "@/lib/markerTypes";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface VisibleAnchor {
  index: number;
  matrix: Float32Array;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Compute world transform from N visible anchors.
 * Returns a column-major Float32Array(16) for THREE.Matrix4.fromArray().
 */
export function computeWorldTransform(
  visibleAnchors: VisibleAnchor[],
  allMarkers: MarkerPoint[],
  markerSizeMM: number = 150
): Float32Array | null {
  if (visibleAnchors.length === 0) return null;

  // Build lookup: index → MarkerPoint
  const markerMap = new Map<number, MarkerPoint>();
  for (const m of allMarkers) markerMap.set(m.index, m);

  // Filter to anchors that have corresponding marker data
  const valid = visibleAnchors.filter((a) => markerMap.has(a.index));
  if (valid.length === 0) return null;

  if (valid.length >= 3) {
    return computeFromTriangle(valid, markerMap, markerSizeMM);
  }
  if (valid.length === 2) {
    return computeFromPair(valid, markerMap, markerSizeMM);
  }
  return computeFromSingle(valid[0], markerMap, markerSizeMM);
}

// ── 3+ anchors: best-triangle Procrustes ────────────────────────────────

function computeFromTriangle(
  anchors: VisibleAnchor[],
  markerMap: Map<number, MarkerPoint>,
  markerSizeMM: number
): Float32Array | null {
  const best = selectBestTriangle(anchors, markerMap);
  if (!best) return null;

  const { anchorTriple, markerTriple } = best;

  // Extract observed positions from anchor matrices
  const observed: Vec3[] = anchorTriple.map((a) => ({
    x: a.matrix[12],
    y: a.matrix[13],
    z: a.matrix[14],
  }));

  // Convert Rhino mm to MindAR units
  const rhinoPts: Vec3[] = markerTriple.map((p) => ({
    x: p.x / markerSizeMM,
    y: p.y / markerSizeMM,
    z: p.z / markerSizeMM,
  }));

  return procrustesAlign(observed, rhinoPts);
}

/**
 * Select the 3 visible anchors that form the largest-area triangle.
 */
function selectBestTriangle(
  anchors: VisibleAnchor[],
  markerMap: Map<number, MarkerPoint>
): { anchorTriple: VisibleAnchor[]; markerTriple: MarkerPoint[] } | null {
  let bestArea = -1;
  let bestTriple: VisibleAnchor[] | null = null;

  const n = anchors.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const pA: Vec3 = { x: anchors[i].matrix[12], y: anchors[i].matrix[13], z: anchors[i].matrix[14] };
        const pB: Vec3 = { x: anchors[j].matrix[12], y: anchors[j].matrix[13], z: anchors[j].matrix[14] };
        const pC: Vec3 = { x: anchors[k].matrix[12], y: anchors[k].matrix[13], z: anchors[k].matrix[14] };
        const area = triangleArea(pA, pB, pC);
        if (area > bestArea) {
          bestArea = area;
          bestTriple = [anchors[i], anchors[j], anchors[k]];
        }
      }
    }
  }

  if (!bestTriple || bestArea < 1e-6) return null;

  const markerTriple = bestTriple.map((a) => markerMap.get(a.index)!);
  return { anchorTriple: bestTriple, markerTriple };
}

// ── 2 anchors: translation + axis-aligned rotation ──────────────────────

function computeFromPair(
  anchors: VisibleAnchor[],
  markerMap: Map<number, MarkerPoint>,
  markerSizeMM: number
): Float32Array | null {
  const obs: Vec3[] = anchors.map((a) => ({
    x: a.matrix[12], y: a.matrix[13], z: a.matrix[14],
  }));

  const markers = anchors.map((a) => markerMap.get(a.index)!);
  const rhi: Vec3[] = markers.map((m) => ({
    x: m.x / markerSizeMM, y: m.y / markerSizeMM, z: m.z / markerSizeMM,
  }));

  // Compute scale from distance ratio
  const obsDist = length(sub(obs[1], obs[0]));
  const rhiDist = length(sub(rhi[1], rhi[0]));
  if (rhiDist < 1e-6) return null;
  const scale = obsDist / rhiDist;

  // Compute rotation to align the connecting vectors
  const obsDir = normalize(sub(obs[1], obs[0]));
  const rhiDir = normalize(sub(rhi[1], rhi[0]));

  const rotCols = rotationBetweenVectors(rhiDir, obsDir);
  if (!rotCols) return null;

  // Translation: centroid alignment
  const centObs = centroid(obs);
  const centRhi = centroid(rhi);
  const sR = rotCols.map((col) => scaleVec(col, scale));
  const t = sub(centObs, mat3Vec(sR, centRhi));

  return assembleMatrix(sR, t);
}

// ── 1 anchor: translation only ──────────────────────────────────────────

function computeFromSingle(
  anchor: VisibleAnchor,
  markerMap: Map<number, MarkerPoint>,
  markerSizeMM: number
): Float32Array | null {
  const obs: Vec3 = { x: anchor.matrix[12], y: anchor.matrix[13], z: anchor.matrix[14] };
  const marker = markerMap.get(anchor.index)!;
  const rhi: Vec3 = { x: marker.x / markerSizeMM, y: marker.y / markerSizeMM, z: marker.z / markerSizeMM };

  // Identity rotation, unit scale, translate so marker aligns
  const t = sub(obs, rhi);
  const identity: Vec3[] = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
  return assembleMatrix(identity, t);
}

// ── Procrustes alignment (3 points) ─────────────────────────────────────

function procrustesAlign(observed: Vec3[], rhinoPts: Vec3[]): Float32Array | null {
  const centObs = centroid(observed);
  const centRhi = centroid(rhinoPts);

  const obsC = observed.map((p) => sub(p, centObs));
  const rhiC = rhinoPts.map((p) => sub(p, centRhi));

  const rmsObs = rms(obsC);
  const rmsRhi = rms(rhiC);
  if (rmsRhi < 1e-6) return null;
  const scale = rmsObs / rmsRhi;

  // Build basis vectors from each point set
  const rAB = sub(rhiC[1], rhiC[0]);
  const rAC = sub(rhiC[2], rhiC[0]);
  const rN = cross(rAB, rAC);
  if (length(rN) < 1e-6) return null;

  const rX = normalize(rAB);
  const rZ = normalize(rN);
  const rY = cross(rZ, rX);

  const oAB = sub(obsC[1], obsC[0]);
  const oAC = sub(obsC[2], obsC[0]);
  const oN = cross(oAB, oAC);
  if (length(oN) < 1e-6) return null;

  const oX = normalize(oAB);
  const oZ = normalize(oN);
  const oY = cross(oZ, oX);

  const R = mat3Multiply([oX, oY, oZ], transpose3([rX, rY, rZ]));
  const sR = R.map((col) => scaleVec(col, scale));
  const t = sub(centObs, mat3Vec(sR, centRhi));

  return assembleMatrix(sR, t);
}

// ── Matrix assembly ─────────────────────────────────────────────────────

function assembleMatrix(sR: Vec3[], t: Vec3): Float32Array {
  const m = new Float32Array(16);
  m[0] = sR[0].x; m[1] = sR[0].y; m[2] = sR[0].z; m[3] = 0;
  m[4] = sR[1].x; m[5] = sR[1].y; m[6] = sR[1].z; m[7] = 0;
  m[8] = sR[2].x; m[9] = sR[2].y; m[10] = sR[2].z; m[11] = 0;
  m[12] = t.x; m[13] = t.y; m[14] = t.z; m[15] = 1;
  return m;
}

// ── Vector helpers ──────────────────────────────────────────────────────

function centroid(pts: Vec3[]): Vec3 {
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
    z: pts.reduce((s, p) => s + p.z, 0) / n,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

function normalize(v: Vec3): Vec3 {
  const l = length(v);
  if (l < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function rms(pts: Vec3[]): number {
  const sumSq = pts.reduce((s, p) => s + dot(p, p), 0);
  return Math.sqrt(sumSq / pts.length);
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return length(cross(sub(b, a), sub(c, a))) * 0.5;
}

function mat3Multiply(A: Vec3[], B: Vec3[]): Vec3[] {
  return B.map((bCol) => mat3Vec(A, bCol));
}

function mat3Vec(cols: Vec3[], v: Vec3): Vec3 {
  return {
    x: cols[0].x * v.x + cols[1].x * v.y + cols[2].x * v.z,
    y: cols[0].y * v.x + cols[1].y * v.y + cols[2].y * v.z,
    z: cols[0].z * v.x + cols[1].z * v.y + cols[2].z * v.z,
  };
}

function transpose3(cols: Vec3[]): Vec3[] {
  return [
    { x: cols[0].x, y: cols[1].x, z: cols[2].x },
    { x: cols[0].y, y: cols[1].y, z: cols[2].y },
    { x: cols[0].z, y: cols[1].z, z: cols[2].z },
  ];
}

/**
 * Compute rotation matrix columns that rotate vector `from` to vector `to`.
 * Uses Rodrigues' rotation formula.
 */
function rotationBetweenVectors(from: Vec3, to: Vec3): Vec3[] | null {
  const c = dot(from, to);
  const v = cross(from, to);
  const vLen = length(v);

  if (vLen < 1e-10) {
    // Vectors are parallel
    if (c > 0) {
      return [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
    }
    // Anti-parallel — find perpendicular axis
    const perp = Math.abs(from.x) < 0.9
      ? normalize(cross(from, { x: 1, y: 0, z: 0 }))
      : normalize(cross(from, { x: 0, y: 1, z: 0 }));
    // 180° rotation around perp
    return [
      { x: 2 * perp.x * perp.x - 1, y: 2 * perp.x * perp.y, z: 2 * perp.x * perp.z },
      { x: 2 * perp.y * perp.x, y: 2 * perp.y * perp.y - 1, z: 2 * perp.y * perp.z },
      { x: 2 * perp.z * perp.x, y: 2 * perp.z * perp.y, z: 2 * perp.z * perp.z - 1 },
    ];
  }

  const k = (1 - c) / (vLen * vLen);
  // Skew-symmetric cross-product matrix of v
  // R = I + [v]× + [v]×² * k
  return [
    { x: 1 + k * (-(v.y * v.y + v.z * v.z)), y: v.z + k * (v.x * v.y), z: -v.y + k * (v.x * v.z) },
    { x: -v.z + k * (v.x * v.y), y: 1 + k * (-(v.x * v.x + v.z * v.z)), z: v.x + k * (v.y * v.z) },
    { x: v.y + k * (v.x * v.z), y: -v.x + k * (v.y * v.z), z: 1 + k * (-(v.x * v.x + v.y * v.y)) },
  ];
}
