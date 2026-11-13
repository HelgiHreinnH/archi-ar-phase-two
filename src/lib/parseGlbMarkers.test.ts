// @vitest-environment node
// Pure parsing — no DOM needed, and jsdom drags in `canvas` native bindings.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGlbMarkers } from "./parseGlbMarkers";

/**
 * Fixture: a real Rhino 8 export (kitchen model, 13 Nov 2026) written with
 * MapZToY + ExportLayers on. It is the shape that broke the parser in
 * production — each marker appears twice, as an empty layer group node
 * ("marker_A") and as the proxy sphere inside it ("marker_A_proxy").
 *
 * Ground truth, taken from the Rhino document the GLB was written from:
 *   marker_A  (-200.00, 775.81, 1500.0)
 *   marker_B  (2800.00, 775.81, 1500.0)
 *   marker_C  (1300.00, -300.00, -199.0)
 */
const EXPECTED = [
  { index: 1, x: -200, y: 775.81, z: 1500 },
  { index: 2, x: 2800, y: 775.81, z: 1500 },
  { index: 3, x: 1300, y: -300, z: -199 },
];

function fixtureFile(): File {
  const bytes = readFileSync(resolve(__dirname, "../test/fixtures/marker-layers.glb"));
  return new File([new Uint8Array(bytes)], "marker-layers.glb", {
    type: "model/gltf-binary",
  });
}

describe("parseGlbMarkers", () => {
  it("reads marker coordinates out of a Rhino export with ExportLayers on", async () => {
    const markers = await parseGlbMarkers(fixtureFile());

    expect(markers).not.toBeNull();
    expect(markers).toHaveLength(3);

    for (const want of EXPECTED) {
      const got = markers!.find((m) => m.index === want.index);
      expect(got, `marker ${want.index} missing`).toBeDefined();
      // Sub-millimetre: the only loss is the float round-trip through glTF.
      expect(got!.x).toBeCloseTo(want.x, 1);
      expect(got!.y).toBeCloseTo(want.y, 1);
      expect(got!.z).toBeCloseTo(want.z, 1);
    }
  });

  it("does not read the empty layer node instead of the proxy mesh", async () => {
    const markers = await parseGlbMarkers(fixtureFile());

    // The regression: layer group nodes are vertex-baked and sit at the origin,
    // so reading them gave three identical points and the editor reported
    // "Invalid — points overlap".
    const atOrigin = markers!.filter((m) => m.x === 0 && m.y === 0 && m.z === 0);
    expect(atOrigin).toHaveLength(0);
  });

  it("returns Rhino millimetres, not glTF metres", async () => {
    const markers = await parseGlbMarkers(fixtureFile());

    // In raw glTF units these would be ±0.2 to 2.8. Anything under 10 means the
    // unit conversion was dropped.
    const spread = Math.max(...markers!.map((m) => Math.abs(m.x)));
    expect(spread).toBeGreaterThan(100);
  });

  it("maps the Z-up/Y-up swap the way the exporter wrote it", async () => {
    const markers = await parseGlbMarkers(fixtureFile());

    // marker_C is the floor marker: low Z, negative Y (in front of the model).
    // If the axis swap were missing or inverted these two would trade places.
    const c = markers!.find((m) => m.index === 3)!;
    expect(c.z).toBeLessThan(0);
    expect(c.y).toBeLessThan(0);
    expect(Math.abs(c.z)).toBeCloseTo(199, 0);
  });

  it("ignores non-GLB files", async () => {
    const notGlb = new File(["{}"], "markers.json", { type: "application/json" });
    expect(await parseGlbMarkers(notGlb)).toBeNull();
  });
});
