/**
 * Spatial (mode === "multipoint") print design — shared constants and the
 * location-marker artwork. Locked design: Notion "Spatial sheet + 3 QR designs — LOCKED".
 * Everything here returns SVG markup strings so it renders identically in the
 * browser (canvas rasterisation) and in tests (sharp / resvg).
 */

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

/**
 * Location marker (8th Wall image target): the disc fills the full square
 * (1200 units by default), white corners. Dial rim, asymmetric arcs rotated by
 * (index × 47)°, dots, centre number. No text other than the number, so a
 * layout change never changes the tracked image.
 */
export function markerDiscInner(idx: number, col: string, size = 1200): string {
  const c = size / 2;
  const R = size / 2;
  let s = `<rect width="${size}" height="${size}" fill="#fff"/><circle cx="${c}" cy="${c}" r="${R}" fill="${col}"/>`;

  // outer white ring + dial ticks
  s += `<circle cx="${c}" cy="${c}" r="${R * 0.93}" fill="none" stroke="#fff" stroke-width="${R * 0.03}"/>`;
  const T = 72;
  for (let i = 0; i < T; i++) {
    const a = (i / T) * Math.PI * 2;
    const major = i % 6 === 0;
    const len = R * (major ? 0.085 : 0.04);
    const r0 = R * 0.9;
    s +=
      `<line x1="${c + Math.cos(a) * r0}" y1="${c + Math.sin(a) * r0}" x2="${c + Math.cos(a) * (r0 - len)}" y2="${c + Math.sin(a) * (r0 - len)}" ` +
      `stroke="#fff" stroke-width="${R * (major ? 0.014 : 0.008)}" stroke-linecap="round"/>`;
  }

  // asymmetric ring segments (rotated per marker → unique + breaks symmetry)
  const rot = (idx * 47) % 360;
  const arc = (r: number, a0: number, a1: number, w: number, op: number) => {
    const p = (a: number): [number, number] => [
      c + Math.cos((a * Math.PI) / 180) * r,
      c + Math.sin((a * Math.PI) / 180) * r,
    ];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `<path d="M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  s +=
    arc(R * 0.72, rot, rot + 118, R * 0.05, 0.95) +
    arc(R * 0.72, rot + 150, rot + 205, R * 0.05, 0.6) +
    arc(R * 0.72, rot + 235, rot + 330, R * 0.05, 0.95);
  s += arc(R * 0.6, rot + 200, rot + 290, R * 0.025, 0.7) + arc(R * 0.6, rot + 20, rot + 70, R * 0.025, 0.7);
  for (let i = 0; i <= (idx % 5) + 2; i++) {
    const a = ((rot + i * 23 + 10) * Math.PI) / 180;
    s += `<circle cx="${c + Math.cos(a) * R * 0.82}" cy="${c + Math.sin(a) * R * 0.82}" r="${R * 0.022}" fill="#fff"/>`;
  }

  // centre number + crosshair
  s += `<circle cx="${c}" cy="${c}" r="${R * 0.44}" fill="#000" fill-opacity=".14"/><circle cx="${c}" cy="${c}" r="${R * 0.44}" fill="none" stroke="#fff" stroke-width="${R * 0.018}"/>`;
  s += `<text x="${c}" y="${c + R * 0.2}" text-anchor="middle" font-size="${R * 0.62}" font-weight="700" fill="#fff" font-family="Inter, Helvetica, Arial, sans-serif">${idx}</text>`;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    s += `<line x1="${c + dx * R * 0.48}" y1="${c + dy * R * 0.48}" x2="${c + dx * R * 0.58}" y2="${c + dy * R * 0.58}" stroke="#fff" stroke-width="${R * 0.014}"/>`;
  }
  return s;
}

/** Standalone SVG document of the marker disc (1200 × 1200 by default). */
export function markerDiscSvg(idx: number, col: string, size = 1200): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${markerDiscInner(idx, col, size)}</svg>`;
}
