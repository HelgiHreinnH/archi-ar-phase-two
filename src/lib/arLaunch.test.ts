import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetARLaunchForTests,
  beginARLaunchFromTap,
  getMotionState,
  waitForCameraGrant,
} from "./arLaunch";

type W = Record<string, unknown>;

describe("beginARLaunchFromTap", () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] }));
  const motionAsk = vi.fn(() => Promise.resolve("granted"));
  const orientAsk = vi.fn(() => Promise.resolve("granted"));

  beforeEach(() => {
    __resetARLaunchForTests();
    vi.clearAllMocks();
    (globalThis as W).DeviceMotionEvent = { requestPermission: motionAsk };
    (globalThis as W).DeviceOrientationEvent = { requestPermission: orientAsk };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  });
  afterEach(() => {
    delete (globalThis as W).DeviceMotionEvent;
    delete (globalThis as W).DeviceOrientationEvent;
  });

  it("asks for motion AND camera synchronously, inside the tap", () => {
    beginARLaunchFromTap();
    // No await has happened yet: all three calls must already be made.
    expect(motionAsk).toHaveBeenCalledTimes(1);
    expect(orientAsk).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(motionAsk.mock.invocationCallOrder[0]).toBeLessThan(getUserMedia.mock.invocationCallOrder[0]);
    expect(getMotionState()).toBe("pending");
  });

  it("releases the probe stream once granted, so the engine owns the camera", async () => {
    beginARLaunchFromTap();
    await waitForCameraGrant();
    expect(stop).toHaveBeenCalled();
    await Promise.resolve();
    expect(getMotionState()).toBe("granted");
  });

  it("a denied camera still lets the engine continue (it reports the error)", async () => {
    getUserMedia.mockImplementationOnce(() => Promise.reject(new DOMException("no", "NotAllowedError")));
    beginARLaunchFromTap();
    await expect(waitForCameraGrant()).resolves.toBeUndefined();
  });

  it("no tap (Spatial auto-launch): engines start immediately", async () => {
    await expect(waitForCameraGrant()).resolves.toBeUndefined();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("Android / desktop: motion needs no permission", () => {
    delete (globalThis as W).DeviceMotionEvent;
    delete (globalThis as W).DeviceOrientationEvent;
    beginARLaunchFromTap();
    expect(getMotionState()).toBe("not-required");
  });
});
