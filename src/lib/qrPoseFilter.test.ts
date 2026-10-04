import { describe, it, expect } from "vitest";
import * as T from "three";
import { gravityAlign, QrPoseFilter, refineLockedPose } from "./qrPoseFilter";

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

  it("is steady only after enough readings that agree within 3 mm (QR widths)", () => {
    const f = new QrPoseFilter(T, "tabletop");
    // QR 0.15 units wide: 3 mm ≈ 0.02 widths ≈ 0.003 units.
    for (let i = 0; i < 7; i++) f.push(read(0, 0, 0.15, i % 2 ? 0.0005 : -0.0005));
    expect(f.isSteady()).toBe(false); // only 7 readings
    f.push(read(0, 0, 0.15, 0.0005));
    expect(f.isSteady()).toBe(true);
    // A hand still moving: readings 1 cm apart.
    const g = new QrPoseFilter(T, "tabletop");
    for (let i = 0; i < 10; i++) g.push(read(0, 0, 0.15, i * 0.01));
    expect(g.isSteady()).toBe(false);
    g.reset();
    expect(g.isSteady()).toBe(false);
    expect(g.accepted).toBe(0);
  });
});

describe("wall facing guard", () => {
  // Wall QR facing +Z (identity), centred at the origin.
  const wallRead = (flip: boolean) => {
    const q = flip
      ? new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI)
      : new T.Quaternion();
    return { position: { x: 0, y: 0, z: 0 }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, width: 0.15 };
  };
  const camera = { x: 0, y: 0, z: 1.2 }; // standing 1.2 m in front of the wall

  it("accepts a wall QR that faces the camera", () => {
    const f = new QrPoseFilter(T, "wall");
    expect(f.push(wallRead(false), camera)).not.toBeNull();
  });

  it("rejects a flipped reading that would put the model into the wall", () => {
    const f = new QrPoseFilter(T, "wall");
    expect(f.push(wallRead(true), camera)).toBeNull();
    expect(f.rejected).toBe(1);
  });

  it("rejects a table QR 'seen' from below the table", () => {
    const f = new QrPoseFilter(T, "tabletop");
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
    const r = { position: { x: 0, y: 0, z: 0 }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, width: 0.15 };
    expect(f.push(r, { x: 0, y: 0.5, z: 0.3 })).not.toBeNull();
    expect(new QrPoseFilter(T, "tabletop").push(r, { x: 0, y: -0.5, z: 0.3 })).toBeNull();
  });
});

describe("refineLockedPose", () => {
  const pose = (x: number, yawDeg: number, width = 0.15) => ({
    position: new T.Vector3(x, 0, 0),
    quaternion: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), deg(yawDeg)),
    width,
  });

  it("nudges toward a fresh reading, never snaps", () => {
    const out = refineLockedPose(T, pose(0, 0), pose(0.01, 10), 0.03)!;
    expect(out.position.x).toBeCloseTo(0.0003, 6); // 3 % of 1 cm
    expect(out.quaternion.angleTo(pose(0, 0).quaternion)).toBeCloseTo(deg(0.3), 4);
  });

  it("converges over about a second of readings", () => {
    let p = pose(0, 0);
    for (let i = 0; i < 30; i++) p = refineLockedPose(T, p, pose(0.01, 0))!;
    expect(p.position.x).toBeGreaterThan(0.005);
    expect(p.position.x).toBeLessThan(0.01);
  });

  it("ignores a reading that can't be the same placement (> 2 QR widths away)", () => {
    expect(refineLockedPose(T, pose(0, 0), pose(0.5, 0))).toBeNull();
  });
});

