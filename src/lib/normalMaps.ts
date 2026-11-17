/**
 * Normal maps that are not normal maps.
 *
 * Rhino's glTF writer fills the normal-map slot with whatever the material's
 * bump channel held. Kitchen test, 16 Nov 2026 (three materials, all wrong):
 *   - oak and ash: a flat image of constant (255, 128, 128). A flat normal is
 *     (128, 128, 255) — the channels arrived in the wrong order;
 *   - marble: a 16-bit greyscale height map.
 * three.js reads either as a surface tilted hard to one side: the wood shades
 * flat, door and drawer joints disappear and the worktop renders speckled.
 *
 * A tangent-space normal map points out of the surface, so its blue channel is
 * on average far above red and green (typically ~128 / ~128 / 230+). An image
 * without that is not a normal map and rendering without it is always better.
 *
 * Checked at load, in the browser, so every consumer agrees: upload still,
 * 3D preview and both AR scenes — including models uploaded before this
 * existed and files exported without the Rhino plugin.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Blue must lead red and green by at least this much (0–255 scale). */
const MIN_BLUE_LEAD = 24;
const SAMPLE_SIZE = 16;

/** True when mean RGB (0–255) is plausible for a tangent-space normal map. */
export function looksLikeNormalMap(r: number, g: number, b: number): boolean {
  return b - Math.max(r, g) >= MIN_BLUE_LEAD;
}

/**
 * Mean colour of a texture image, from a 16 × 16 downsample. Returns null when
 * the image can't be read (compressed GPU texture, no DOM, tainted canvas) —
 * callers then leave the texture alone.
 */
export function sampleMeanRgb(image: any): [number, number, number] | null {
  try {
    if (!image || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return [r / n, g / n, b / n];
  } catch {
    return null;
  }
}

/**
 * Remove every normal map under `root` that is not a normal map. Returns the
 * number of materials changed. `sample` is injectable for tests.
 */
export function dropBrokenNormalMaps(
  root: any,
  sample: (image: any) => [number, number, number] | null = sampleMeanRgb,
): number {
  const usable = new Map<any, boolean>();
  const seen = new Set<any>();
  let dropped = 0;

  root?.traverse?.((o: any) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const tex = m.normalMap;
      if (!tex) continue;
      let ok = usable.get(tex);
      if (ok === undefined) {
        const rgb = sample(tex.image);
        ok = rgb ? looksLikeNormalMap(rgb[0], rgb[1], rgb[2]) : true;
        usable.set(tex, ok);
      }
      if (ok) continue;
      m.normalMap = null;
      m.needsUpdate = true;
      dropped++;
    }
  });

  if (dropped) console.info(`[normalMaps] ignored ${dropped} normal map(s) that are not normal maps`);
  return dropped;
}
