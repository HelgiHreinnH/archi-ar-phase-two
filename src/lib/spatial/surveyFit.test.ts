import { describe, expect, it } from "vitest";
import {
  SurveyCollector,
  fitGravityAligned,
  fitSurvey,
  rhinoMmToModelM,
  type FitPair,
  type Vec3,
} from "./surveyFit";

// A kitchen-sized marker layout in Rhino mm (Z up): door, far wall, window wall.
const RHINO = [
  { index: 1, x: 0, y: 0, z: 1200 },
  { index: 2, x: 4200, y: 300, z: 1500 },
  { index: 3, x: 1800, y: 3600, z: 900 },
];

function toWorld(p: Vec3, yaw: number, s: number, t: Vec3): Vec3 {
  const c = Math.cos(yaw), n = Math.sin(yaw);
  return { x: s * (c * p.x + n * p.z) + t.x, y: s * p.y + t.y, z: s * (-n * p.x + c * p.z) + t.z };
}

function pairs(yaw: number, s: number, t: Vec3, noise: (i: number) => Vec3 = () => ({ x: 0, y: 0, z: 0 })): FitPair[] {
  return RHINO.map((m, i) => {
    const model = rhinoMmToModelM(m);
    const w = toWorld(model, yaw, s, t);
    const e = noise(i);
    return { index: m.index, model, world: { x: w.x + e.x, y: w.y + e.y, z: w.z + e.z } };
  });
}

describe("rhinoMmToModelM", () => {
  it("maps Rhino Z-up mm to glTF Y-up metres (MapZToY)", () => {
    expect(rhinoMmToModelM({ x: 1000, y: 2000, z: 3000 })).toEqual({ x: 1, y: 3, z: -2 });
  });
});

describe("fitGravityAligned", () => {
  it("recovers heading, translation and unit scale exactly", () => {
    const t = { x: 0.4, y: -1.3, z: 2.1 };
    const fit = fitGravityAligned(pairs(0.7, 1, t))!;
    expect(fit.yaw).toBeCloseTo(0.7, 9);
    expect(fit.scale).toBeCloseTo(1, 9);
    expect(fit.translation.x).toBeCloseTo(t.x, 9);
    expect(fit.translation.y).toBeCloseTo(t.y, 9);
    expect(fit.translation.z).toBeCloseTo(t.z, 9);
    expect(fit.rmsMm).toBeLessThan(1e-6);
  });

  it("recovers an engine scale that is not metres and reports mm in model units", () => {
    const fit = fitGravityAligned(pairs(-2.4, 3.7, { x: 1, y: 2, z: 3 }))!;
    expect(fit.scale).toBeCloseTo(3.7, 9);
    expect(fit.yaw).toBeCloseTo(-2.4, 9);
    for (const p of fit.pairs) expect(p.observedMm).toBeCloseTo(p.modelMm, 6);
  });

  it("with solveScale off keeps scale at 1", () => {
    const fit = fitGravityAligned(pairs(0.2, 1.05, { x: 0, y: 0, z: 0 }), { solveScale: false })!;
    expect(fit.scale).toBe(1);
    expect(fit.rmsMm).toBeGreaterThan(10); // 5 % scale error shows up as residual
  });

  it("reports a misplaced marker as residual (≈ error / 3 spread over the fit)", () => {
    // Marker C mounted 30 mm off in plan.
    const fit = fitGravityAligned(
      pairs(1.1, 1, { x: 0, y: 0, z: 0 }, (i) => (i === 2 ? { x: 0.03, y: 0, z: 0 } : { x: 0, y: 0, z: 0 })),
      { solveScale: false },
    )!;
    expect(fit.rmsMm).toBeGreaterThan(5);
    expect(fit.rmsMm).toBeLessThan(30);
    const worst = fit.residuals.reduce((a, r) => (r.errorMm > a.errorMm ? r : a));
    expect(worst.index).toBe(3);
  });

  it("matrix places model points at their world positions (column-major)", () => {
    const ps = pairs(0.9, 1.2, { x: -3, y: 0.5, z: 4 });
    const { matrix: m } = fitGravityAligned(ps)!;
    for (const { model: p, world: q } of ps) {
      const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
      const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
      const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
      expect(x).toBeCloseTo(q.x, 9);
      expect(y).toBeCloseTo(q.y, 9);
      expect(z).toBeCloseTo(q.z, 9);
    }
  });

  it("works with two markers and refuses one, or markers stacked vertically", () => {
    expect(fitGravityAligned(pairs(0.3, 1, { x: 0, y: 0, z: 0 }).slice(0, 2))).not.toBeNull();
    expect(fitGravityAligned(pairs(0.3, 1, { x: 0, y: 0, z: 0 }).slice(0, 1))).toBeNull();
    const stacked: FitPair[] = [
      { index: 1, model: { x: 0, y: 0, z: 0 }, world: { x: 0, y: 0, z: 0 } },
      { index: 2, model: { x: 0, y: 1, z: 0 }, world: { x: 0, y: 1, z: 0 } },
    ];
    expect(fitGravityAligned(stacked)).toBeNull();
  });
});

describe("SurveyCollector", () => {
  it("takes a median and drops outliers (glare, half-seen marker)", () => {
    const c = new SurveyCollector();
    for (let i = 0; i < 20; i++) c.add(1, { x: 1 + (i % 2 ? 0.002 : -0.002), y: 1, z: 1 });
    c.add(1, { x: 3, y: 1, z: 1 }); // a wild reading 2 m off
    const e = c.estimate(1)!;
    expect(e.position.x).toBeCloseTo(1, 2);
    expect(e.count).toBe(20);
    expect(e.spread).toBeLessThan(0.005);
  });

  it("ignores non-finite readings and caps the history", () => {
    const c = new SurveyCollector(10);
    c.add(2, { x: NaN, y: 0, z: 0 });
    for (let i = 0; i < 25; i++) c.add(2, { x: i, y: 0, z: 0 });
    expect(c.count(2)).toBe(10);
  });

  it("fitSurvey only uses markers with enough sightings", () => {
    const c = new SurveyCollector();
    const truth = pairs(0.5, 1, { x: 1, y: 0, z: 1 });
    truth.forEach(({ index, world }) => {
      const n = index === 3 ? 2 : 8; // C barely seen
      for (let i = 0; i < n; i++) c.add(index, world);
    });
    const fit = fitSurvey(RHINO, c, { minSightings: 5 })!;
    expect(fit.markersUsed).toBe(2);
    expect(fit.yaw).toBeCloseTo(0.5, 6);
  });
});
