import { describe, it, expect } from "vitest";
import * as T from "three";
import { gravityAlign, QrPoseFilter } from "./qrPoseFilter";

const deg = (d: number) => (d * Math.PI) / 180;

/** Raw 8th Wall-style rotation of a QR lying on a table, turned by `yaw`, tilted by `tilt`. */
function tableQr(yawDeg: number, tiltDeg = 0) {
  // Local +Z (normal) must end up world +Y: rotate -90° about X, then yaw, then tilt.
  const q = new T.Quaternion()
    .setFromAxisAngle(new T.Vector3(0, 1, 0), deg(yawDeg))
    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), deg(-90 + tiltDeg)));
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

describe("gravityAlign", () => {
  it("keeps a flat table QR's heading and makes +Z exactly world up", () => {
    const a = gravityAlign(T, tableQr(30, 10), "tabletop")!;
    expect(a.tiltDeg).toBeCloseTo(10, 3);
    const z = new T.Vector3(0, 0, 1).applyQuaternion(a.quaternion);
    expect(z.y).toBeCloseTo(1, 6);
    const flat = gravityAlign(T, tableQr(30, 0), "tabletop")!;
    expect(a.quaternion.angleTo(flat.quaternion)).toBeLessThan(1e-6);
  });

  it("makes a wall QR stand upright with +Z horizontal", () => {
    // Wall QR: normal horizontal (identity = facing +Z), tipped 12° back.
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), deg(12));
    const a = gravityAlign(T, { x: q.x, y: q.y, z: q.z, w: q.w }, "wall")!;
    expect(a.tiltDeg).toBeCloseTo(12, 3);
    const y = new T.Vector3(0, 1, 0).applyQuaternion(a.quaternion);
    const z = new T.Vector3(0, 0, 1).applyQuaternion(a.quaternion);
    expect(y.y).toBeCloseTo(1, 6);
    expect(z.y).toBeCloseTo(0, 6);
  });
});

describe("QrPoseFilter", () => {
  const read = (yaw: number, tilt: number, width: number, x = 0) => ({
    position: { x, y: 0, z: -1 },
    rotation: tableQr(yaw, tilt),
    width,
  });

  it("rejects a reading that flips the QR onto its edge (the 23 Sep glitch)", () => {
    const f = new QrPoseFilter(T, "tabletop");
    expect(f.push(read(0, 3, 0.4))).not.toBeNull();
    expect(f.push(read(0, 80, 0.4))).toBeNull();
    expect(f.rejected).toBe(1);
  });

  it("rejects a size jump once it has a baseline, and uses the median size", () => {
    const f = new QrPoseFilter(T, "tabletop");
    f.push(read(0, 0, 0.4));
    f.push(read(0, 0, 0.42));
    f.push(read(0, 0, 0.41));
    expect(f.push(read(0, 0, 1.2))).toBeNull(); // model would have grown 3x
    const out = f.push(read(0, 0, 0.4))!;
    expect(out.width).toBeCloseTo(0.405, 3);
  });

  it("smooths position toward new readings instead of jumping", () => {
    const f = new QrPoseFilter(T, "tabletop");
    f.push(read(0, 0, 0.4, 0));
    const out = f.push(read(0, 0, 0.4, 1))!;
    expect(out.position.x).toBeGreaterThan(0);
    expect(out.position.x).toBeLessThan(1);
  });
});
