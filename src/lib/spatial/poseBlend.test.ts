import { describe, expect, it } from "vitest";
import { PoseBlender, angleDelta, poseMove, type Pose } from "./poseBlend";

const MARKERS = [
  { x: 0, y: 1.2, z: 0 },
  { x: 4.2, y: 1.5, z: -0.3 },
  { x: 1.8, y: 0.9, z: -3.6 },
];
const pose = (yaw = 0, tx = 0, scale = 1): Pose => ({ yaw, scale, translation: { x: tx, y: 0, z: 0 } });

describe("angleDelta", () => {
  it("takes the short way round", () => {
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 9);
    expect(angleDelta(-3.1, 3.1)).toBeCloseTo(-(2 * Math.PI - 6.2), 9);
    expect(angleDelta(0.2, 0.5)).toBeCloseTo(0.3, 9);
  });
});

describe("poseMove", () => {
  it("measures a heading change as distance at the far markers", () => {
    // 0.5° on a marker 4.2 m out ≈ 37 mm.
    const d = poseMove(pose(0), pose((0.5 * Math.PI) / 180), MARKERS);
    expect(d).toBeGreaterThan(0.03);
    expect(d).toBeLessThan(0.04);
  });
});

describe("PoseBlender", () => {
  it("applies the first pose at once", () => {
    const b = new PoseBlender(MARKERS);
    expect(b.setTarget(pose(0.3, 1), 0)).toBe("applied");
    expect(b.sample(0).translation.x).toBe(1);
    expect(b.isBlending(0)).toBe(false);
  });

  it("ignores corrections under 1 cm", () => {
    const b = new PoseBlender(MARKERS);
    b.setTarget(pose(0, 0), 0);
    expect(b.setTarget(pose(0, 0.006), 1000)).toBe("ignored");
    expect(b.sample(1000).translation.x).toBe(0);
  });

  it("eases a larger correction in over 0.5 s, never jumping", () => {
    const b = new PoseBlender(MARKERS);
    b.setTarget(pose(0, 0), 0);
    expect(b.setTarget(pose(0, 0.1), 1000)).toBe("blending");
    let prev = 0;
    for (let t = 1000; t <= 1500; t += 16) {
      const x = b.sample(t).translation.x;
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x - prev).toBeLessThan(0.01); // < 1 cm per frame at 60 fps
      prev = x;
    }
    expect(b.sample(1250).translation.x).toBeCloseTo(0.05, 6);
    expect(b.sample(1500).translation.x).toBe(0.1);
    expect(b.isBlending(1600)).toBe(false);
  });

  it("restarts from the current pose when retargeted mid-blend", () => {
    const b = new PoseBlender(MARKERS);
    b.setTarget(pose(0, 0), 0);
    b.setTarget(pose(0, 0.2), 1000);
    const mid = b.sample(1250).translation.x;
    b.setTarget(pose(0, -0.2), 1250);
    expect(b.sample(1250).translation.x).toBeCloseTo(mid, 9);
  });

  it("reset makes the next target apply at once", () => {
    const b = new PoseBlender(MARKERS);
    b.setTarget(pose(0, 0), 0);
    b.reset();
    expect(b.hasPose()).toBe(false);
    expect(b.setTarget(pose(0, 3), 10)).toBe("applied");
  });
});
