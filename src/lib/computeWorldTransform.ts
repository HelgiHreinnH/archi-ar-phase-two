/**
 * computeWorldTransform.ts
 *
 * 3-point Procrustes alignment: maps Rhino model coordinates (mm) to
 * MindAR camera space using three observed anchor poses.
 *
 * Input:
 *   - anchorMatrices: the THREE.Matrix4 world matrices of anchors A, B, C
 *     as captured from MindAR anchor.group.matrix while tracking.
 *   - markerData: the Rhino-space coordinates { A: {x,y,z}, B: {x,y,z}, C: {x,y,z} }
 *     in millimetres, as stored in the project's marker_data column.
 *   - MARKER_SIZE_MM: physical marker width in mm (default 150).
 *
 * Returns a Matrix4 that, when applied to scene-root geometry, places
 * the Rhino model correctly in MindAR's camera-relative space.
 *
 * Falls back to anchor-A-only placement if the triangle is degenerate
 * (collinear or coincident markers).
 */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface MarkerCoords {
  A: Vec3;
  B: Vec3;
  C: Vec3;
}

// Minimal Matrix4 / Vector3 helpers — we receive the THREE namespace at
// runtime so we operate on plain arrays and return a flat Float32Array(16)
// that the caller can feed into THREE.Matrix4.fromArray().

export function computeWorldTransform(
  anchorMatrices: [Float32Array, Float32Array, Float32Array],
  markerData: MarkerCoords,
  markerSizeMM: number = 150
): Float32Array | null {
  // 1. Extract positions from anchor matrices (elements 12,13,14 = tx,ty,tz)
  const observed: Vec3[] = anchorMatrices.map((m) => ({
    x: m[12],
    y: m[13],
    z: m[14],
  }));

  // 2. Convert Rhino mm to MindAR units (1 unit ≈ markerSizeMM mm)
  const rhinoPts: Vec3[] = [markerData.A, markerData.B, markerData.C].map(
    (p) => ({
      x: p.x / markerSizeMM,
      y: p.y / markerSizeMM,
      z: p.z / markerSizeMM,
    })
  );

  // 3. Compute centroids
  const centroidObs = centroid(observed);
  const centroidRhino = centroid(rhinoPts);

  // 4. Centre both point sets
  const obsC = observed.map((p) => sub(p, centroidObs));
  const rhiC = rhinoPts.map((p) => sub(p, centroidRhino));

  // 5. Compute scale from ratio of RMS distances
  const rmsObs = rms(obsC);
  const rmsRhi = rms(rhiC);
  if (rmsRhi < 1e-6) {
    console.warn("[computeWorldTransform] Degenerate Rhino triangle — markers coincident");
    return null;
  }
  const scale = rmsObs / rmsRhi;

  // 6. Compute rotation using Kabsch / cross-covariance SVD approximation
  // For 3 points we use a simplified approach: build basis vectors from
  // each set and compute the rotation that maps one to the other.

  // Basis from Rhino points (centred)
  const rAB = sub(rhiC[1], rhiC[0]);
  const rAC = sub(rhiC[2], rhiC[0]);
  const rN = cross(rAB, rAC);
  if (length(rN) < 1e-6) {
    console.warn("[computeWorldTransform] Degenerate triangle — collinear markers");
    return null;
  }

  const rX = normalize(rAB);
  const rZ = normalize(rN);
  const rY = cross(rZ, rX); // already unit length

  // Basis from observed points (centred)
  const oAB = sub(obsC[1], obsC[0]);
  const oAC = sub(obsC[2], obsC[0]);
  const oN = cross(oAB, oAC);
  if (length(oN) < 1e-6) {
    console.warn("[computeWorldTransform] Degenerate observed triangle");
    return null;
  }

  const oX = normalize(oAB);
  const oZ = normalize(oN);
  const oY = cross(oZ, oX);

  // Rotation R maps Rhino basis → observed basis
  // R = [oX oY oZ] · [rX rY rZ]^T
  // In column-major for Matrix4:
  const R = mat3Multiply(
    [oX, oY, oZ],
    transpose3([rX, rY, rZ])
  );

  // 7. Assemble final Matrix4 (column-major): T * R * S
  // result = Translation(centroidObs) * Rotation * Scale * Translation(-centroidRhino)
  // Simplified: p_obs = centroidObs + R * scale * (p_rhino - centroidRhino)
  // = R*scale*p_rhino + (centroidObs - R*scale*centroidRhino)
  const sR = R.map((col) => scaleVec(col, scale)); // 3 column vectors
  const t = sub(centroidObs, mat3Vec(sR, centroidRhino));

  // Column-major flat array
  const m = new Float32Array(16);
  // Col 0
  m[0] = sR[0].x;
  m[1] = sR[0].y;
  m[2] = sR[0].z;
  m[3] = 0;
  // Col 1
  m[4] = sR[1].x;
  m[5] = sR[1].y;
  m[6] = sR[1].z;
  m[7] = 0;
  // Col 2
  m[8] = sR[2].x;
  m[9] = sR[2].y;
  m[10] = sR[2].z;
  m[11] = 0;
  // Col 3 (translation)
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  m[15] = 1;

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
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function rms(pts: Vec3[]): number {
  const sumSq = pts.reduce((s, p) => s + dot(p, p), 0);
  return Math.sqrt(sumSq / pts.length);
}

// 3×3 column vectors multiplied: C = A * B  (each is [col0, col1, col2])
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
