import { describe, expect, it } from "vitest";
import { formatScaleReadout, qrLaunchPhase, qrStatusCopy, type QrPhaseInput } from "./qrLaunchStatus";

const base: QrPhaseInput = { engineReady: false, qrInView: false, qrSeen: false, modelReady: false, locked: false };

describe("qrLaunchPhase", () => {
  it("is 'starting' until the engine is ready, even with the model in hand", () => {
    expect(qrLaunchPhase({ ...base, modelReady: true })).toBe("starting");
    // 4 Oct bug 2: "Aim" showed while the engine was still warming up.
    expect(qrLaunchPhase({ ...base, modelReady: true, qrInView: true, qrSeen: true })).toBe("starting");
  });

  it("asks to aim once the engine is ready and no QR is seen", () => {
    expect(qrLaunchPhase({ ...base, engineReady: true })).toBe("aim");
    expect(qrLaunchPhase({ ...base, engineReady: true, modelReady: true })).toBe("aim");
  });

  it("shows the download once the QR was found, even if it flickers out", () => {
    expect(qrLaunchPhase({ ...base, engineReady: true, qrSeen: true, qrInView: true })).toBe("found-loading");
    expect(qrLaunchPhase({ ...base, engineReady: true, qrSeen: true, qrInView: false })).toBe("found-loading");
  });

  it("holds steady while QR and model are ready but not locked", () => {
    expect(qrLaunchPhase({ ...base, engineReady: true, qrSeen: true, qrInView: true, modelReady: true })).toBe("placing");
    expect(qrLaunchPhase({ ...base, engineReady: true, qrSeen: true, qrInView: false, modelReady: true })).toBe("aim");
  });

  it("is 'placed' only on the lock event (4 Oct bug 3)", () => {
    const seenNotLocked = { engineReady: true, qrSeen: true, qrInView: true, modelReady: true, locked: false };
    expect(qrLaunchPhase(seenNotLocked)).not.toBe("placed");
    expect(qrLaunchPhase({ ...seenNotLocked, locked: true })).toBe("placed");
    // Locked and the QR has left the frame: still placed.
    expect(qrLaunchPhase({ ...seenNotLocked, qrInView: false, locked: true })).toBe("placed");
  });
});

describe("qrStatusCopy", () => {
  it("only the placed phase says the model stays put", () => {
    for (const phase of ["starting", "aim", "found-loading", "placing"] as const) {
      const c = qrStatusCopy({ phase, mode: "tabletop", modelProgress: 50, holdsInRoom: true });
      expect(`${c.title} ${c.body}`).not.toMatch(/stays put/i);
    }
    expect(qrStatusCopy({ phase: "placed", mode: "tabletop", modelProgress: 100, holdsInRoom: true }).title)
      .toBe("Look around, the model stays put");
  });

  it("is honest on MindAR without motion access", () => {
    const c = qrStatusCopy({ phase: "placed", mode: "tabletop", modelProgress: 100, holdsInRoom: false });
    expect(c.title).not.toMatch(/stays put/i);
    expect(c.body).toMatch(/QR in view/);
  });

  it("names the surface and shows the download %", () => {
    expect(qrStatusCopy({ phase: "aim", mode: "wall", modelProgress: null, holdsInRoom: true }).body).toMatch(/wall/);
    expect(qrStatusCopy({ phase: "found-loading", mode: "tabletop", modelProgress: 64.4, holdsInRoom: true }).body)
      .toBe("Loading your model… 64%");
  });

  it("an engine hint replaces the body, never the starting screen", () => {
    expect(qrStatusCopy({ phase: "placing", mode: "tabletop", modelProgress: 100, holdsInRoom: true, hint: "Move a little slower." }).body)
      .toBe("Move a little slower.");
    expect(qrStatusCopy({ phase: "starting", mode: "tabletop", modelProgress: 0, holdsInRoom: true, hint: "x" }).body).toBe("");
  });
});

describe("formatScaleReadout", () => {
  it("formats like the 8th Wall viewer did", () => {
    expect(formatScaleReadout(50, { width: 0.886, depth: 0.861, height: 0.6 })).toBe("Scale 1:50 · 0.89 × 0.86 m, 0.60 m high");
    expect(formatScaleReadout(1, { width: 12.4, depth: 8, height: 3 })).toBe("Scale 1:1 · 12.4 × 8.00 m, 3.00 m high");
    expect(formatScaleReadout(50, null)).toBeNull();
  });
});
