// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RefitLog, angleDiffDeg } from "./refitLog";

const fit = (yawDeg: number, rmsMm = 10, markersUsed = 3) => ({ yaw: (yawDeg * Math.PI) / 180, rmsMm, markersUsed });

describe("RefitLog (§6.4 isolating test)", () => {
  it("wraps heading differences across ±180°", () => {
    expect(angleDiffDeg(179, -179)).toBe(-2);
    expect(angleDiffDeg(-179, 179)).toBe(2);
    expect(angleDiffDeg(10, 10)).toBe(0);
  });

  it("logs yaw, rms, marker count and tracking, with the jump between refits", () => {
    const log = new RefitLog(100, 0);
    log.record("refit", fit(20, 40, 2), "normal", 250);
    log.record("refit", fit(26.5, 12, 3), "normal", 500);
    const [a, b] = log.list();
    expect(a).toMatchObject({ t: 0.25, event: "refit", yawDeg: 20, rmsMm: 40, markers: 2, tracking: "normal", dYawDeg: null });
    expect(b.dYawDeg).toBe(6.5);
    expect(log.maxJumpDeg()).toBe(6.5);
  });

  it("after Lock, measures shadow drift against the locked heading (R3)", () => {
    const log = new RefitLog(100, 0);
    log.record("refit", fit(30), "normal", 0);
    log.record("lock", fit(30), "normal", 100);
    log.record("post-lock", fit(31), "normal", 1100);
    log.record("post-lock", fit(24), "limited", 2100);
    expect(log.list()[3].driftDeg).toBe(-6);
    expect(log.maxDriftDeg()).toBe(6);
    // Post-lock entries never count as refit jumps.
    expect(log.maxJumpDeg()).toBe(0);
  });

  it("keeps a bounded ring", () => {
    const log = new RefitLog(3, 0);
    for (let i = 0; i < 5; i++) log.record("refit", fit(i), "normal", i * 250);
    expect(log.list().map((e) => e.yawDeg)).toEqual([2, 3, 4]);
  });
});
