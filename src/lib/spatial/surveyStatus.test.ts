import { describe, expect, it } from "vitest";
import { fitGravityAligned, rhinoMmToModelM, type FitPair } from "./surveyFit";
import { formatDistance, surveyStatus } from "./surveyStatus";

// The kitchen of 23 Nov 2026 (Rhino mm): A and B on the back wall, C on the floor.
const KITCHEN = [
  { index: 1, x: 9834.6, y: 775.8, z: 1101 },
  { index: 2, x: 12755.6, y: 775.8, z: 1101 },
  { index: 3, x: 11295.1, y: -1006.2, z: -199 },
];

function pairs(offsets: Record<number, number> = {}, count = 3): FitPair[] {
  return KITCHEN.slice(0, count).map((m) => {
    const model = rhinoMmToModelM(m);
    return { index: m.index, model, world: { x: model.x + (offsets[m.index] ?? 0) / 1000, y: model.y, z: model.z } };
  });
}

const order = [1, 2, 3];

describe("surveyStatus", () => {
  it("asks for a room scan before anything is found while tracking settles", () => {
    const s = surveyStatus({ order, found: new Set(), fit: null, trackingReady: false });
    expect(s.text).toMatch(/Scan the room/);
    expect(s.lockReady).toBe(false);
  });

  it("names the next marker to find", () => {
    const s = surveyStatus({ order, found: new Set([1]), fit: null, trackingReady: true });
    expect(s.text).toMatch(/Find marker B \(1\/3\)/);
  });

  it("two markers at the wrong distance: drawing vs measured, no lock", () => {
    const fit = fitGravityAligned(pairs({ 2: -660 }, 2), { solveScale: false });
    const s = surveyStatus({ order, found: new Set([1, 2]), fit, trackingReady: true });
    expect(s.text).toContain("A–B: drawing 2.92 m, measured 2.26 m");
    expect(s.tone).toBe("bad");
    expect(s.lockReady).toBe(false);
    expect(s.quality[1]).toBe("bad");
  });

  it("two good markers: ask for the third before locking", () => {
    const fit = fitGravityAligned(pairs({}, 2), { solveScale: false });
    const s = surveyStatus({ order, found: new Set([1, 2]), fit, trackingReady: true });
    expect(s.text).toMatch(/find marker C to check/);
    expect(s.lockReady).toBe(false);
  });

  it("three good markers: lock is ready", () => {
    const fit = fitGravityAligned(pairs({ 3: 15 }), { solveScale: false });
    const s = surveyStatus({ order, found: new Set([1, 2, 3]), fit, trackingReady: true });
    expect(s.lockReady).toBe(true);
    expect(s.tone).toBe("good");
    expect(s.quality[3]).toBe("good");
  });

  it("one misplaced marker is named, lock is not the normal next step", () => {
    const fit = fitGravityAligned(pairs({ 3: 1200 }), { solveScale: false });
    const s = surveyStatus({ order, found: new Set([1, 2, 3]), fit, trackingReady: true });
    expect(s.worst).toBe(3);
    expect(s.text).toMatch(/^Marker C is about 1\.\d m/);
    expect(s.lockReady).toBe(false);
    expect(s.quality[3]).toBe("bad");
  });
});

describe("formatDistance", () => {
  it("rounds to 10 mm below a metre and to 0.1 m above", () => {
    expect(formatDistance(334)).toBe("330 mm");
    expect(formatDistance(3)).toBe("10 mm");
    expect(formatDistance(1374)).toBe("1.4 m");
  });
});

describe("surveyStatus agrees with the Lock guard (D9)", () => {
  it("lockReady is exactly lockDecision(fit).ok", async () => {
    const { lockDecision } = await import("./lockGuard");
    for (const off of [0, 15, 29, 45, 80, 400, 1200]) {
      const fit = fitGravityAligned(pairs({ 3: off }), { solveScale: false });
      const s = surveyStatus({ order, found: new Set([1, 2, 3]), fit, trackingReady: true });
      expect(s.lockReady).toBe(lockDecision(fit).ok);
    }
  });
});
