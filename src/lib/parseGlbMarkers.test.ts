// @vitest-environment node
// Pure parsing — no DOM needed, and jsdom drags in `canvas` native bindings.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXTRAS_TOLERANCE_MM,
  crossCheckExtras,
  describeMarkerImport,
  parseGlbMarkers,
  readArchiarExtras,
  readGlbMarkersFromBuffer,
} from "./parseGlbMarkers";
import { buildGlb, markerMeshes, rhinoToGltf, sheetQuad, type TestMesh } from "@/test/glbBuilder";

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

// ── v0.3.0 plugin output (contract §5, brief items A–C) ──────────────────

/** Six markers A–F around a kitchen far from the origin (like køkken2, 9–13 m in X). */
const SIX: Record<string, [number, number, number]> = {
  A: [9200, 775.81, 1500],
  B: [12200, 775.81, 1500],
  C: [10700, -300, 0],
  D: [13400, 2100.5, 1450.25],
  E: [9600.125, 2100, 900],
  F: [11000, -1200.004, 0],
};
const LETTERS = Object.keys(SIX);

function extrasV2(points = SIX, overrides: Record<string, unknown> = {}) {
  return {
    archiar: {
      v: 2, mode: "spatial", plugin: "0.3.0", units: "mm", frame: "rhino-z-up",
      sheet: { w: 210, h: 297, circle: 180, circleCentreFromTop: 105 },
      markers: Object.entries(points).map(([L, p], i) => ({
        key: i + 1, name: `marker_${L}`, p, n: [0, -1, 0], up: [0, 0, 1],
      })),
      ...overrides,
    },
  };
}

const sixMeshes = (): TestMesh[] => LETTERS.flatMap((L) => markerMeshes(L, SIX[L]));
const model: TestMesh = { name: "kitchen", positions: sheetQuad([11, 0.9, 0], [1, 0, 0], [0, 1, 0], 3, 0.9) };

describe("v0.3.0 Spatial export: letters A–F", () => {
  it("imports markers A to F as six markers, indices 1–6 (§8 test 4)", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb([...sixMeshes(), model], extrasV2()));
    expect(r!.usable).toBe(true);
    expect(r!.markers.map((m) => m.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r!.names).toEqual(LETTERS.map((L) => `marker_${L}`));
    expect(r!.markers.every((m) => m.source === "rhino")).toBe(true);
  });

  it("round-trips each position within 0.01 mm (§8 test 1)", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb(sixMeshes()));
    LETTERS.forEach((L, i) => {
      const m = r!.markers[i];
      const [x, y, z] = SIX[L];
      expect(Math.hypot(m.x - x, m.y - y, m.z - z), `marker_${L}`).toBeLessThan(0.01);
    });
  });

  it("reads lower-case and numeric names, and ignores letters past T", async () => {
    const meshes = [
      ...markerMeshes("a", [0, 0, 1000]),
      ...markerMeshes("7", [2000, 0, 1000]),
      ...markerMeshes("T", [1000, 1500, 0]),
      ...markerMeshes("U", [5000, 5000, 0]),
    ];
    const r = await readGlbMarkersFromBuffer(buildGlb(meshes));
    expect(r!.markers.map((m) => m.index)).toEqual([1, 7, 20]);
  });
});

describe("asset.extras.archiar", () => {
  it("v2: node position is authoritative; n and up are carried along (D8)", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb(sixMeshes(), extrasV2()));
    expect(r!.extras?.markers).toHaveLength(6);
    expect(r!.warnings).toEqual([]);
    expect(r!.markers[0].n).toEqual([0, -1, 0]);
    expect(r!.markers[0].up).toEqual([0, 0, 1]);
    expect(r!.markers[0].extrasDeltaMm).toBeLessThan(0.01);
  });

  it("v2: a node more than 1 mm from p is a warning, and the node still wins", async () => {
    const moved = { ...SIX, B: [SIX.B[0] + 2.5, SIX.B[1], SIX.B[2]] as [number, number, number] };
    const r = await readGlbMarkersFromBuffer(buildGlb(sixMeshes(), extrasV2(moved)));
    expect(r!.warnings).toHaveLength(1);
    expect(r!.warnings[0]).toMatch(/Marker B.*2\.5 mm.*node position is used/);
    expect(r!.markers[1].x).toBeCloseTo(SIX.B[0], 2);
  });

  it("v1 (Tabletop/Wall), none and another mode are ignored without a warning", () => {
    expect(readArchiarExtras({ extras: { archiar: { v: 1, mode: "tabletop", scale: 1, plugin: "0.2.0" } } })).toEqual({ extras: null, warnings: [] });
    expect(readArchiarExtras({ version: "2.0" })).toEqual({ extras: null, warnings: [] });
    expect(readArchiarExtras(undefined)).toEqual({ extras: null, warnings: [] });
  });

  it("v1 in the file: markers still import from the nodes", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb(sixMeshes(), { archiar: { v: 1, mode: "wall", scale: 1 } }));
    expect(r!.usable).toBe(true);
    expect(r!.extras).toBeNull();
    expect(r!.warnings).toEqual([]);
  });

  it("a corrupt v2 block is ignored with a warning; import still works", async () => {
    const corrupt = extrasV2(SIX, { markers: [{ key: 1, p: ["x", 0, 0] }] });
    const r = await readGlbMarkersFromBuffer(buildGlb(sixMeshes(), corrupt));
    expect(r!.usable).toBe(true);
    expect(r!.extras).toBeNull();
    expect(r!.warnings[0]).toMatch(/could not be read/);
    expect(readArchiarExtras({ extras: { archiar: { v: 2, mode: "spatial", units: "m", frame: "rhino-z-up", markers: [] } } }).extras).toBeNull();
  });

  it("names markers missing on either side", () => {
    const markers = [{ index: 1, x: 0, y: 0, z: 0 }, { index: 2, x: 1000, y: 0, z: 0 }];
    const e = { v: 2 as const, mode: "spatial" as const, markers: [{ key: 1, name: "marker_A", p: [0, 0, 0] as [number, number, number], n: null, up: null }, { key: 3, name: "marker_C", p: [0, 1000, 0] as [number, number, number], n: null, up: null }] };
    const { warnings } = crossCheckExtras(markers, e);
    expect(warnings.join(" ")).toMatch(/Marker B is in the model but missing/);
    expect(warnings.join(" ")).toMatch(/exported marker C, but the model has no node/);
    expect(EXTRAS_TOLERANCE_MM).toBe(1);
  });

  it("a different sheet size in extras is reported", () => {
    const { warnings } = readArchiarExtras({ extras: extrasV2(SIX, { sheet: { w: 210, h: 297, circle: 150, circleCentreFromTop: 105 } }) });
    expect(warnings[0]).toMatch(/different sheet/);
  });
});

describe("import message for a bad file (item C)", () => {
  it("a plain Rhino _Export (sheets, no marker nodes) is named as such", async () => {
    // Two wall sheets (portrait) and one floor sheet at a rotated heading — like køkken2.
    const c = Math.SQRT1_2;
    const sheets: TestMesh[] = [
      { name: "", positions: sheetQuad(rhinoToGltf([9500, 775, 1456.5]), [1, 0, 0], [0, 1, 0]) },
      { name: "", positions: sheetQuad(rhinoToGltf([12000, 775, 1456.5]), [1, 0, 0], [0, 1, 0]) },
      { name: "", positions: sheetQuad(rhinoToGltf([10700, -300, 0]), [c, 0, c], [-c, 0, c]) },
    ];
    const r = await readGlbMarkersFromBuffer(buildGlb([model, ...sheets]));
    expect(r!.markers).toHaveLength(0);
    expect(r!.sheetMeshes).toBe(3);
    const msg = describeMarkerImport(r);
    expect(msg.kind).toBe("plain-rhino-export");
    expect(msg.description).toMatch(/3 A4 sheets/);
    expect(msg.description).toMatch(/plugin's Export/);
  });

  it("a sheet-sized model part is not mistaken for a sheet when markers exist", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb([...sixMeshes(), { name: "", positions: sheetQuad([11, 1, 0], [1, 0, 0], [0, 1, 0]) }]));
    expect(describeMarkerImport(r).kind).toBe("ok");
  });

  it("fewer than three markers: says how many and which", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb([...markerMeshes("A", [0, 0, 1000]), ...markerMeshes("B", [3000, 0, 1000]), model]));
    expect(r!.usable).toBe(false);
    const msg = describeMarkerImport(r);
    expect(msg.kind).toBe("too-few");
    expect(msg.title).toBe("Only 2 markers found");
    expect(msg.description).toMatch(/marker_A, marker_B/);
  });

  it("no markers and no sheets", async () => {
    const r = await readGlbMarkersFromBuffer(buildGlb([model]));
    expect(describeMarkerImport(r).kind).toBe("none");
    expect(describeMarkerImport(null).kind).toBe("none");
  });

  it("success lists the letters and counts warnings", async () => {
    const moved = { ...SIX, A: [SIX.A[0], SIX.A[1] + 5, SIX.A[2]] as [number, number, number] };
    const msg = describeMarkerImport(await readGlbMarkersFromBuffer(buildGlb(sixMeshes(), extrasV2(moved))));
    expect(msg.kind).toBe("ok");
    expect(msg.description).toMatch(/Found 6 markers \(A, B, C, D, E, F\)\. 1 warning/);
  });
});
