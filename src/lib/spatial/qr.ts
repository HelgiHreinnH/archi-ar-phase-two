/**
 * Spatial QR renderer — three outputs, all custom SVG built from the
 * `qrcode` module matrix (error correction H). Spatial only: Tabletop/Wall
 * keep TABLETOP_QR_OPTIONS because there the QR is the tracking target.
 *
 *   round  — "designed" badge: square code inside concentric arcs (variant A2)
 *   subtle — just the code: blue rounded finders, logo centre, no arcs
 *
 * Locked design: Notion "Spatial sheet + 3 QR designs — LOCKED".
 */
import QRCode from "qrcode";
import { BRAND, INK, logoTile } from "@/lib/spatial/design";

export type SpatialQrVariant = "round" | "subtle";

const D = 1000; // viewBox units
const R = D / 2;

interface QrMatrix {
  n: number;
  at: (x: number, y: number) => boolean;
}

function buildMatrix(text: string): QrMatrix {
  const q = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = q.modules.size;
  const data = q.modules.data as ArrayLike<number | boolean>;
  return { n, at: (x, y) => x >= 0 && y >= 0 && x < n && y < n && !!data[y * n + x] };
}

/**
 * The code itself (segment style: horizontal runs merged into rounded bars,
 * rounded finder rings with a round eye in `accent`, white knockout with the
 * logo tile in the middle). `scale` = code width as a fraction of the 1000-unit box.
 */
function codeInner(m: QrMatrix, scale: number, accent: string, ink: string): { svg: string; c: number } {
  const { n, at } = m;
  const S = D * scale;
  const c = S / n;
  const o = (D - S) / 2;
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  const clear = (x: number, y: number) =>
    Math.abs(x + 0.5 - n / 2) < 5.2 && Math.abs(y + 0.5 - n / 2) < 5.2;
  const ok = (x: number, y: number) => x < n && at(x, y) && !inFinder(x, y) && !clear(x, y);

  let s = "";
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (ok(x, y)) {
        let x1 = x;
        while (ok(x1 + 1, y)) x1++;
        s += `<rect x="${o + x * c + c * 0.05}" y="${o + y * c + c * 0.07}" width="${(x1 - x + 1) * c - c * 0.1}" height="${c * 0.86}" rx="${c * 0.43}" fill="${ink}"/>`;
        x = x1 + 1;
      } else x++;
    }
  }
  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    const X = o + fx * c;
    const Y = o + fy * c;
    s +=
      `<rect x="${X + c / 2}" y="${Y + c / 2}" width="${6 * c}" height="${6 * c}" rx="${c * 1.7}" fill="none" stroke="${accent}" stroke-width="${c}"/>` +
      `<circle cx="${X + 3.5 * c}" cy="${Y + 3.5 * c}" r="${1.65 * c}" fill="${accent}"/>`;
  }
  const k = 5.0 * c;
  s += `<rect x="${R - k}" y="${R - k}" width="${2 * k}" height="${2 * k}" rx="${c * 1.6}" fill="#fff"/>` + logoTile(R, R, 3.5 * c);
  return { svg: s, c };
}

// ── Round badge arcs (variant A2) ───────────────────────────────────────────

type OuterArc = [from: number, to: number, width: number, opacity: number];
/** [radius, arcs] — radius and width as fractions of R. */
const OUTER_TRACKS: [number, OuterArc[]][] = [
  [0.905, [[10, 115, 0.03, 0.95], [150, 205, 0.03, 0.55], [238, 335, 0.03, 0.95]]],
  [0.945, [[55, 150, 0.013, 0.7], [196, 262, 0.013, 0.7], [300, 372, 0.013, 0.7]]],
  [0.978, [[95, 190, 0.022, 0.95], [236, 330, 0.022, 0.55], [352, 418, 0.022, 0.95]]],
];

/** White-area arcs per side. Side centres: 0 = right, 90 = bottom, 180 = left, 270 = top.
 *  [radius, from, to (° relative to the side axis), width, opacity]; radius/width in R fractions. */
const SIDE_ARCS: Record<number, [number, number, number, number, number][]> = {
  0: [[0.8, -30, 22, 0.026, 0.95], [0.75, -24, 26, 0.012, 0.7], [0.705, -12, 16, 0.02, 0.55]],
  90: [[0.775, -26, 30, 0.02, 0.95], [0.735, -20, 22, 0.012, 0.7], [0.7, -10, 14, 0.026, 0.55]],
  180: [[0.8, -32, 20, 0.014, 0.7], [0.76, -28, 26, 0.028, 0.95], [0.715, -14, 12, 0.012, 0.7]],
  270: [[0.79, -30, 30, 0.022, 0.55], [0.74, -24, 18, 0.012, 0.95], [0.7, -17, 18, 0.02, 0.95]],
};

function arcPath(r: number, a0: number, a1: number, w: number, op: number, col: string): string {
  const p = (a: number): [number, number] => [
    R + Math.cos((a * Math.PI) / 180) * r * R,
    R + Math.sin((a * Math.PI) / 180) * r * R,
  ];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return (
    `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${(r * R).toFixed(1)} ${(r * R).toFixed(1)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" ` +
    `fill="none" stroke="${col}" stroke-opacity="${op}" stroke-width="${(w * R).toFixed(1)}" stroke-linecap="round"/>`
  );
}

function roundArcs(col: string): string {
  let s = "";
  for (const [r, arcs] of OUTER_TRACKS) for (const [a0, a1, w, op] of arcs) s += arcPath(r, a0, a1, w, op, col);
  for (const [centre, list] of Object.entries(SIDE_ARCS)) {
    for (const [r, a, b, w, op] of list) s += arcPath(r, +centre + a, +centre + b, w, op, col);
  }
  return s;
}

/** Share of the 1000-unit box the code occupies in each variant. */
const CODE_SCALE: Record<SpatialQrVariant, number> = { round: 0.58, subtle: 0.86 };

/** Inner markup (viewBox 0 0 1000 1000, white background included) for embedding in a larger SVG. */
export function spatialQrInner(url: string, variant: SpatialQrVariant): string {
  const code = codeInner(buildMatrix(url), CODE_SCALE[variant], BRAND, INK);
  const bg = `<rect width="${D}" height="${D}" fill="#fff"/>`;
  return variant === "round" ? bg + code.svg + roundArcs(BRAND) : bg + code.svg;
}

/** Standalone SVG document, 1000 × 1000 units. */
export function spatialQrSvg(url: string, variant: SpatialQrVariant): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${D} ${D}" width="${D}" height="${D}">${spatialQrInner(url, variant)}</svg>`;
}
