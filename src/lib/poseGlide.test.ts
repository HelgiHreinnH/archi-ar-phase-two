import { describe, expect, it } from "vitest";
import * as T from "three";
import { easeInOut, glideProgress, GLIDE_MS, lerpPose } from "./poseGlide";

describe("poseGlide", () => {
  it("eases from 0 to 1 with flat ends", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(0.05)).toBeLessThan(0.002); // starts gently, no jump
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });

  it("reports progress over GLIDE_MS", () => {
    expect(glideProgress(1000, 1000)).toBe(0);
    expect(glideProgress(1000 + GLIDE_MS, 1000)).toBe(1);
    expect(glideProgress(5, 0, 0)).toBe(1);
  });

  it("interpolates position, rotation and width", () => {
    const from = { position: new T.Vector3(0, 0, 0), quaternion: new T.Quaternion(), width: 1 };
    const to = {
      position: new T.Vector3(2, 0, 0),
      quaternion: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2),
      width: 3,
    };
    const mid = lerpPose(from, to, 0.5);
    expect(mid.position.x).toBeCloseTo(1, 6);
    expect(mid.width).toBeCloseTo(2, 6);
    expect(mid.quaternion.angleTo(from.quaternion)).toBeCloseTo(Math.PI / 4, 5);
    expect(from.position.x).toBe(0); // inputs untouched
  });
});
