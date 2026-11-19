// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LOCK_MAX_RMS_MM, LOCK_MIN_MARKERS, lockDecision, pairRows } from "./lockGuard";
import { fitGravityAligned, rhinoMmToModelM, applyFit } from "./surveyFit";

describe("lockDecision (D9)", () => {
  it("starts at 3 markers and 30 mm", () => {
    expect([LOCK_MIN_MARKERS, LOCK_MAX_RMS_MM]).toEqual([3, 30]);
  });

  it("blocks without a fit", () => {
    expect(lockDecision(null)).toMatchObject({ ok: false, reason: "no-fit" });
  });

  it("blocks on two markers even with a perfect fit", () => {
    const d = lockDecision({ markersUsed: 2, rmsMm: 0 });
    expect(d).toMatchObject({ ok: false, reason: "too-few-markers" });
    expect(d.message).toMatch(/1 more marker to lock \(2\/3\)/);
  });

  it("blocks above the threshold, allows at and below it", () => {
    expect(lockDecision({ markersUsed: 3, rmsMm: 30.1 })).toMatchObject({ ok: false, reason: "residual-too-high" });
    expect(lockDecision({ markersUsed: 3, rmsMm: 30 }).ok).toBe(true);
    expect(lockDecision({ markersUsed: 4, rmsMm: 8 }).ok).toBe(true);
  });

  it("treats a NaN residual as blocked", () => {
    expect(lockDecision({ markersUsed: 3, rmsMm: NaN }).ok).toBe(false);
  });

  it("takes tuned limits without code changes elsewhere", () => {
    expect(lockDecision({ markersUsed: 3, rmsMm: 20 }, { maxRmsMm: 15 }).ok).toBe(false);
  });
});

describe("swapped sheets (R2) are caught by the third marker", () => {
  const rhino = [
    { index: 1, x: 0, y: 0, z: 1500 },
    { index: 2, x: 3000, y: 0, z: 1500 },
    { index: 3, x: 500, y: -2000, z: 0 }, // asymmetric: a symmetric C would hide the swap in the pair distances
  ];
  const yaw = 0.4, t = { x: 1, y: 0, z: -2 };
  const world = rhino.map((m) => applyFit(yaw, 1, t, rhinoMmToModelM(m)));

  it("A and B swapped: two markers fit perfectly, three do not", () => {
    const swapped = [world[1], world[0], world[2]];
    const two = fitGravityAligned(rhino.slice(0, 2).map((m, i) => ({ index: m.index, model: rhinoMmToModelM(m), world: swapped[i] })), { solveScale: false })!;
    expect(two.rmsMm).toBeLessThan(1);
    expect(lockDecision(two).ok).toBe(false);
    const three = fitGravityAligned(rhino.map((m, i) => ({ index: m.index, model: rhinoMmToModelM(m), world: swapped[i] })), { solveScale: false })!;
    expect(three.rmsMm).toBeGreaterThan(LOCK_MAX_RMS_MM);
    expect(lockDecision(three).reason).toBe("residual-too-high");
    // The pair table puts the disagreeing pairs first.
    expect(Math.abs(pairRows(three)[0].deltaMm)).toBeGreaterThan(100);
  });
});
