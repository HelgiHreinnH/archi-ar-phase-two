// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeModelPlacement } from "./modelPlacement";

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
