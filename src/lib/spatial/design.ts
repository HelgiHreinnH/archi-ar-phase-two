/**
 * Spatial (mode === "multipoint") print design — shared constants and the
 * location-marker artwork. Locked design v11 (18 Nov 2026): Notion "Spatial sheet v11 — LOCKED".
 * Everything here returns SVG markup strings so it renders identically in the
 * browser (canvas rasterisation) and in tests (sharp / resvg).
 */
import { SHEET_MM } from "@/lib/spatial/contract";

/** Site primary, hsl(220 80% 50%). Used for the logo tile and QR accents. */
export const BRAND = "#1A5EE6";
/** Text / QR module ink. */
export const INK = "#14181f";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Brand tile: blue rounded square with the white Lucide "Box" cube, centred on (cx, cy), half-size r. */
export function logoTile(cx: number, cy: number, r: number): string {
  const sz = r * 2;
  const ic = sz * 0.556;
  const sc = ic / 24;
  return (
    `<rect x="${cx - r}" y="${cy - r}" width="${sz}" height="${sz}" rx="${sz * 0.22}" fill="${BRAND}"/>` +
    `<g transform="translate(${cx - ic / 2} ${cy - ic / 2}) scale(${sc})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>` +
    `<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></g>`
  );
}

/** Printed diameter of a Spatial location marker (= image-target physical width). Contract §3. */
export const SPATIAL_MARKER_MM: number = SHEET_MM.circle;

// ── Deterministic organic pattern ───────────────────────────────────────────
// Multi-scale blurred noise, thresholded at 0 and traced to smooth vector
// outlines (marching squares). Pure function of (index, size): the printed
// sheet and the 8th Wall target come from the same SVG, so they are identical.

/** Field resolution (nodes per side). Pitch = size / (N - 1) ≈ 0.75 mm on the 180 mm print. */
const FIELD_N = 240;
/** Blur sigmas in field nodes (fine / medium / coarse) and their weights. */
const SCALES: [number, number][] = [
  [4.5, 0.5],
  [10.5, 0.8],
  [22, 1.0],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(n: number, rnd: () => number): Float32Array {
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i += 2) {
    const u = Math.max(rnd(), 1e-12);
    const v = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < out.length) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

function blur(src: Float32Array, n: number, sigma: number): Float32Array {
  const rad = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * rad + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) sum += k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let a = 0;
      for (let i = -rad; i <= rad; i++) a += k[i + rad] * src[y * n + Math.min(n - 1, Math.max(0, x + i))];
      tmp[y * n + x] = a;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let a = 0;
      for (let i = -rad; i <= rad; i++) a += k[i + rad] * tmp[Math.min(n - 1, Math.max(0, y + i)) * n + x];
      dst[y * n + x] = a;
    }
  return dst;
}

/** Scalar field for marker `idx`: > 0 is black. Seeded by the index only. */
function patternField(idx: number): Float32Array {
  const rnd = mulberry32(2000 + idx);
  const acc = new Float32Array(FIELD_N * FIELD_N);
  for (const [sigma, w] of SCALES) {
    const f = blur(gaussianNoise(FIELD_N, rnd), FIELD_N, sigma);
    let mean = 0;
    for (const v of f) mean += v;
    mean /= f.length;
    let varr = 0;
    for (const v of f) varr += (v - mean) * (v - mean);
    const sd = Math.sqrt(varr / f.length) || 1;
    for (let i = 0; i < acc.length; i++) acc[i] += (w * (f[i] - mean)) / sd;
  }
  return acc;
}

const fmt = (v: number) => Math.round(v * 10) / 10;

/** Marching squares on the field (padded with a white border) → smooth closed outlines of the black areas. */
function patternPath(idx: number, size: number): string {
  const n = FIELD_N + 2;
  const f = new Float32Array(n * n).fill(-1);
  const src = patternField(idx);
  for (let y = 0; y < FIELD_N; y++) for (let x = 0; x < FIELD_N; x++) f[(y + 1) * n + x + 1] = src[y * FIELD_N + x];
  const pitch = size / (FIELD_N - 1);
  const px = (i: number) => (i - 1) * pitch;

  // edge ids: horizontal edge from node (x,y) to (x+1,y) = 2*(y*n+x); vertical (x,y)→(x,y+1) = 2*(y*n+x)+1
  const pts = new Map<number, [number, number]>();
  const point = (id: number): [number, number] => {
    let p = pts.get(id);
    if (!p) {
      const vertical = id & 1;
      const node = id >> 1;
      const x = node % n;
      const y = (node - x) / n;
      const a = f[node];
      const b = vertical ? f[node + n] : f[node + 1];
      const t = a / (a - b);
      p = vertical ? [px(x), px(y) + t * pitch] : [px(x) + t * pitch, px(y)];
      pts.set(id, p);
    }
    return p;
  };
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };

  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const i = y * n + x;
      const v0 = f[i], v1 = f[i + 1], v2 = f[i + n + 1], v3 = f[i + n];
      const c = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const top = 2 * i, right = 2 * (i + 1) + 1, bottom = 2 * (i + n), left = 2 * i + 1;
      switch (c) {
        case 1: case 14: link(left, top); break;
        case 2: case 13: link(top, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, bottom); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, bottom); break;
        case 5: case 10: {
          const centreBlack = (v0 + v1 + v2 + v3) / 4 > 0;
          if ((c === 5) === centreBlack) { link(left, bottom); link(top, right); }
          else { link(left, top); link(right, bottom); }
          break;
        }
      }
    }

  const seen = new Set<number>();
  let d = "";
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let prev = -1, cur = start;
    for (;;) {
      seen.add(cur);
      loop.push(cur);
      const nb = adj.get(cur)!;
      const next = nb[0] !== prev && !seen.has(nb[0]) ? nb[0] : nb[1] !== undefined && !seen.has(nb[1]) ? nb[1] : -1;
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    if (loop.length < 4) continue;
    const P = loop.map(point);
    const mid = (a: [number, number], b: [number, number]) => `${fmt((a[0] + b[0]) / 2)} ${fmt((a[1] + b[1]) / 2)}`;
    d += `M${mid(P[P.length - 1], P[0])}`;
    for (let i = 0; i < P.length; i++) d += `Q${fmt(P[i][0])} ${fmt(P[i][1])} ${mid(P[i], P[(i + 1) % P.length])}`;
    d += "Z";
  }
  return d;
}

/**
 * Location marker (8th Wall image target, locked v11): black/white organic
 * pattern inside a thin black rim, filling the full square (1200 units by
 * default; the circle touches the square's edges, corners are transparent).
 * No text and no colour, so a sheet layout change never changes the tracked
 * image. The pattern is unique per index and has no rotational symmetry.
 */
export function markerDiscInner(idx: number, size = 1200): string {
  const c = size / 2;
  const u = size / 1200;
  const ring = 8 * u; // rim thickness ≈ 1.2 mm on the 180 mm print
  const rimR = c - 2 * u - ring / 2;
  const patR = rimR - ring / 2 - 8 * u; // white gap of ≈ 1.2 mm inside the rim
  const clip = `archi-mk-${idx}`;
  return (
    `<clipPath id="${clip}"><circle cx="${c}" cy="${c}" r="${patR}"/></clipPath>` +
    `<circle cx="${c}" cy="${c}" r="${rimR}" fill="none" stroke="#000" stroke-width="${ring}"/>` +
    `<path clip-path="url(#${clip})" fill="#000" fill-rule="evenodd" d="${patternPath(idx, size)}"/>`
  );
}

/** Standalone SVG document of the marker on a white square (1200 × 1200 by default). */
export function markerDiscSvg(idx: number, size = 1200): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/>${markerDiscInner(idx, size)}</svg>`;
}
