/**
 * Spatial marker carriers inside a GLB.
 *
 * The Rhino plugin bakes one small invisible sphere per marker
 * (`marker_A_proxy` inside a layer node `marker_A`), because Rhino's glTF
 * writer drops Point objects. The marker parser reads them; everything else
 * has to leave them alone or work around them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Node names the marker parser reads (`parseGlbMarkers.ts`): `marker_A`,
 * `marker_3`, `Marker-B_proxy` … Kept in step with that parser's normalising.
 */
export function isMarkerNodeName(name: string): boolean {
  return /^marker_(?:[a-z]|\d{1,2})(?:_proxy)?$/.test(name.trim().toLowerCase().replace(/[\s-]/g, "_"));
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
