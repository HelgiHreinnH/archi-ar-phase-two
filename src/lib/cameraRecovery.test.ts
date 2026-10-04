import { describe, expect, it } from "vitest";
import { cameraVerdict, MUTE_GRACE_MS, STALL_CHECKS, type CameraHealthInput } from "./cameraRecovery";

const ok: CameraHealthInput = { visible: true, hasVideo: true, trackState: "live", mutedForMs: 0, paused: false, stalledChecks: 0 };

describe("cameraVerdict", () => {
  it("leaves a healthy feed alone", () => {
    expect(cameraVerdict(ok)).toBe("ok");
  });
  it("does nothing while the page is hidden or the camera is still starting", () => {
    expect(cameraVerdict({ ...ok, visible: false, trackState: "ended" })).toBe("ok");
    expect(cameraVerdict({ ...ok, hasVideo: false })).toBe("ok");
  });
  it("restarts an ended track (screenshot / app switch on iOS)", () => {
    expect(cameraVerdict({ ...ok, trackState: "ended" })).toBe("restart");
  });
  it("waits out a short mute, restarts a long one", () => {
    expect(cameraVerdict({ ...ok, mutedForMs: MUTE_GRACE_MS - 1 })).toBe("ok");
    expect(cameraVerdict({ ...ok, mutedForMs: MUTE_GRACE_MS + 1 })).toBe("restart");
  });
  it("tries play() on a paused video first", () => {
    expect(cameraVerdict({ ...ok, paused: true })).toBe("play");
  });
  it("restarts a frozen frame", () => {
    expect(cameraVerdict({ ...ok, stalledChecks: STALL_CHECKS - 1 })).toBe("ok");
    expect(cameraVerdict({ ...ok, stalledChecks: STALL_CHECKS })).toBe("restart");
  });
});
