// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  computeModelPlacement,
  measureModel,
  placeModelOnQr,
  qrOffsetMm,
  TABLETOP_LIFT_MM,
  WALL_OFFSET_MM,
} from "./modelPlacement";

const MARKER = 150; // mm

/** Size the model ends up as on the printed marker, in metres. */
const displayedMetres = (maxDim: number, modelScale: number) =>
  maxDim * computeModelPlacement(maxDim, MARKER, modelScale).scale * (MARKER / 1000);

describe("computeModelPlacement", () => {
  it("shows a 1:1 model at its real size (millimetre file)", () => {
    expect(displayedMetres(1200, 1)).toBeCloseTo(1.2, 3);
  });

  it("shows a 1:1 model at its real size (metre file)", () => {
    expect(displayedMetres(1.2, 1)).toBeCloseTo(1.2, 3);
  });

  it("divides by the scale denominator", () => {
    expect(displayedMetres(20000, 50)).toBeCloseTo(0.4, 3); // 20 m building at 1:50
    expect(displayedMetres(20, 50)).toBeCloseTo(0.4, 3);
  });

  it("reports the real size and detected unit", () => {
    expect(computeModelPlacement(1200, MARKER, 1)).toMatchObject({ unitMm: 1, realSizeM: 1.2 });
    expect(computeModelPlacement(1.2, MARKER, 1)).toMatchObject({ unitMm: 1000, realSizeM: 1.2 });
  });

  it("never produces the old 150-marker-width blow-up", () => {
    // Previously every model was scaled to 150 marker widths = 22.5 m.
    for (const [dim, scale] of [[1200, 1], [1.2, 1], [20000, 50], [0.6, 1]] as const) {
      expect(displayedMetres(dim, scale)).toBeLessThan(10);
    }
  });

  it("falls back safely on nonsense input", () => {
    expect(computeModelPlacement(0, MARKER, 0).scale).toBeGreaterThan(0);
    expect(Number.isFinite(computeModelPlacement(0, MARKER, 0).scale)).toBe(true);
  });
});


/** A box mesh far from the origin whose loader-seeded bounds are inverted on Z,
 *  like the Rhino/Draco export of Fændediget 12 (24 Sep 2026). */
function offsetModelWithBadBounds() {
  const root = new T.Group();
  const g = new T.BoxGeometry(8.8, 3, 8.6).translate(4.4, 1.5, -20.4); // metres, Y-up
  g.boundingBox = new T.Box3(new T.Vector3(0, 0, -16.1), new T.Vector3(8.8, 3, -24.7)); // min.z > max.z
  root.add(new T.Mesh(g));
  return root;
}

describe("measureModel", () => {
  it("measures real vertices, not exporter-written bounds", () => {
    const m = offsetModelWithBadBounds();
    m.rotation.x = Math.PI / 2;
    const box = measureModel(m, T);
    expect(box.min.z).toBeCloseTo(0, 5);
    expect(box.max.z).toBeCloseTo(3, 5);
    expect(box.min.y).toBeCloseTo(16.1, 5);
  });
});

describe("placeModelOnQr", () => {
  it("tabletop: plan centre on the QR centre, bottom on the QR, wherever the model sits in Rhino", () => {
    const m = offsetModelWithBadBounds();
    placeModelOnQr(m, T, { mode: "tabletop", modelScale: 10, markerSizeMm: 150 });
    const box = (m.updateMatrixWorld(true), new T.Box3().setFromObject(m));
    const c = box.getCenter(new T.Vector3());
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.y).toBeCloseTo(0, 5);
    expect(box.min.z).toBeCloseTo(0, 5);
  });

  it("wall: centred on the QR in X/Y, back of the model flat on the wall", () => {
    const m = offsetModelWithBadBounds();
    placeModelOnQr(m, T, { mode: "wall", modelScale: 10, markerSizeMm: 150 });
    m.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(m);
    const c = box.getCenter(new T.Vector3());
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.y).toBeCloseTo(0, 5);
    expect(box.min.z).toBeCloseTo(0, 5);
  });

  it("offsets by real millimetres, independent of the project scale", () => {
    for (const modelScale of [1, 10, 50]) {
      const t = offsetModelWithBadBounds();
      placeModelOnQr(t, T, { mode: "tabletop", modelScale, markerSizeMm: 150, offsetMm: 40 });
      t.updateMatrixWorld(true);
      // 40 mm on a 150 mm QR = 0.2667 QR widths above the QR plane.
      expect(new T.Box3().setFromObject(t).min.z).toBeCloseTo(40 / 150, 5);

      const w = offsetModelWithBadBounds();
      placeModelOnQr(w, T, { mode: "wall", modelScale, markerSizeMm: 150, offsetMm: 20 });
      w.updateMatrixWorld(true);
      expect(new T.Box3().setFromObject(w).min.z).toBeCloseTo(20 / 150, 5);
    }
  });

  it("reports the size as shown on the QR: real size ÷ scale", () => {
    const m = offsetModelWithBadBounds(); // 8.8 × 8.6 m room, 3 m high, metres
    const p = placeModelOnQr(m, T, { mode: "tabletop", modelScale: 10, markerSizeMm: 150 });
    expect(p.displayedSizeM!.width).toBeCloseTo(0.88, 5);
    expect(p.displayedSizeM!.depth).toBeCloseTo(0.86, 5);
    expect(p.displayedSizeM!.height).toBeCloseTo(0.3, 5);
    const one = placeModelOnQr(offsetModelWithBadBounds(), T, { mode: "tabletop", modelScale: 1, markerSizeMm: 150 });
    expect(one.displayedSizeM!.width).toBeCloseTo(8.8, 5);
  });
});

describe("qrOffsetMm", () => {
  it("defaults per mode", () => {
    expect(qrOffsetMm("tabletop", "")).toBe(TABLETOP_LIFT_MM);
    expect(qrOffsetMm("wall", "")).toBe(WALL_OFFSET_MM);
  });
  it("takes ?lift= for tabletop and ?gap= for wall", () => {
    expect(qrOffsetMm("tabletop", "?lift=0")).toBe(0);
    expect(qrOffsetMm("tabletop", "?lift=25&gap=90")).toBe(25);
    expect(qrOffsetMm("wall", "?gap=35")).toBe(35);
  });
  it("ignores nonsense", () => {
    expect(qrOffsetMm("tabletop", "?lift=abc")).toBe(TABLETOP_LIFT_MM);
    expect(qrOffsetMm("wall", "?gap=-5")).toBe(WALL_OFFSET_MM);
    expect(qrOffsetMm("wall", "?gap=99999")).toBe(WALL_OFFSET_MM);
  });
});
