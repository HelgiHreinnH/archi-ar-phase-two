/**
 * Spatial marker carriers inside a GLB.
 *
 * The Rhino plugin bakes one small invisible sphere per marker
 * (`marker_A_proxy` inside a layer node `marker_A`), because Rhino's glTF
 * writer drops Point objects. The marker parser reads them; everything else
 * has to leave them alone or work around them.
 *
 * This file is the single definition of which names count (D11): letters
 * A–T and numbers 1–20, case-insensitive, spaces/hyphens as underscores, an
 * optional `_proxy` suffix. The parser and the optimiser both call it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MARKER_LETTERS, MAX_MARKERS } from "@/lib/spatial/contract";

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]/g, "_");
}

/**
 * 1-based marker index for a node name, or null when the name is not a marker:
 * `marker_A` → 1, `Marker-T_proxy` → 20, `marker_7` → 7, `marker_U` → null.
 */
export function markerIndexFromNodeName(name: string): number | null {
  const m = normalise(name).match(/^marker_([a-z]|\d{1,2})(?:_proxy)?$/);
  if (!m) return null;
  const key = m[1];
  if (/^\d+$/.test(key)) {
    const n = parseInt(key, 10);
    return n >= 1 && n <= MAX_MARKERS ? n : null;
  }
  const i = MARKER_LETTERS.indexOf(key.toUpperCase());
  return i >= 0 ? i + 1 : null;
}

/** True for the proxy mesh (`marker_A_proxy`), false for the layer group node. */
export function isMarkerProxyName(name: string): boolean {
  return markerIndexFromNodeName(name) !== null && /_proxy$/.test(normalise(name));
}

/** Node names the marker parser reads (`parseGlbMarkers.ts`). */
export function isMarkerNodeName(name: string): boolean {
  return markerIndexFromNodeName(name) !== null;
}

/**
 * Detach the marker carriers from a loaded three.js scene. For previews only:
 * the spheres are invisible, but a floor marker two metres in front of a
 * kitchen doubles the bounding box, so the model was framed at half size.
 * Never use this before AR placement or marker parsing.
 */
export function removeMarkerCarriers(root: any): number {
  const carriers: any[] = [];
  root?.traverse?.((o: any) => {
    if (o !== root && typeof o.name === "string" && isMarkerNodeName(o.name)) carriers.push(o);
  });
  for (const o of carriers) o.parent?.remove(o);
  return carriers.length;
}
