/**
 * One status voice for Tabletop/Wall (Oct 2026), shared by both engines.
 *
 * 4 Oct test, bugs 2 and 3: three messages contradicted each other for 55 s
 * ("Starting camera…", "Aim at the QR code", "Looking for the QR code…"), and
 * "Model placed — look around, it stays put" showed for 7 s before any model
 * was on screen, which made the tester move and delayed the real lock.
 *
 * Now a single pure state machine decides the phase, and the phase decides
 * ALL the copy. "placed" comes only from the engine's lock event — never from
 * the first QR sighting.
 */

export type QrPhase = "starting" | "aim" | "found-loading" | "placing" | "placed";

export interface QrPhaseInput {
  /** Camera live AND the engine tracking (target loaded, warm-up done). */
  engineReady: boolean;
  /** The QR is in view right now. */
  qrInView: boolean;
  /** The QR has been seen at least once this session. */
  qrSeen: boolean;
  /** The model is parsed and attached to the scene. */
  modelReady: boolean;
  /** The engine confirmed the lock (steady QR → fixed pose). */
  locked: boolean;
}

export function qrLaunchPhase(i: QrPhaseInput): QrPhase {
  if (i.locked) return "placed";
  if (!i.engineReady) return "starting";
  // Once the QR has been found, keep showing the download instead of jumping
  // back to "aim" every time the QR flickers out of frame.
  if (!i.modelReady) return i.qrSeen ? "found-loading" : "aim";
  return i.qrInView ? "placing" : "aim";
}

export interface QrStatusCopyInput {
  phase: QrPhase;
  mode: string;
  /** 0–100, or null when unknown. */
  modelProgress: number | null;
  /**
   * True when the engine holds the model in the room on its own when the QR
   * leaves the frame (8th Wall SLAM, or MindAR with motion access for the
   * gyro hold). False: MindAR without motion — honest "keep the QR in view".
   */
  holdsInRoom: boolean;
  /** Engine hint, e.g. 8th Wall "too much motion". Replaces the body. */
  hint?: string | null;
}

export interface QrStatusCopy {
  title: string;
  body: string;
}

export function qrStatusCopy(i: QrStatusCopyInput): QrStatusCopy {
  const surface = i.mode === "wall" ? "wall" : "table";
  const pct = i.modelProgress != null ? `${Math.round(i.modelProgress)}%` : null;
  let c: QrStatusCopy;
  switch (i.phase) {
    case "starting":
      c = { title: "Starting camera…", body: "" };
      break;
    case "aim":
      c = { title: "Aim at the QR code", body: `The printed QR on the ${surface} is where your model will sit.` };
      break;
    case "found-loading":
      c = { title: "QR found", body: pct ? `Loading your model… ${pct}` : "Loading your model…" };
      break;
    case "placing":
      c = { title: "Hold steady…", body: "Keep the QR in view for a moment." };
      break;
    case "placed":
      c = i.holdsInRoom
        ? { title: "Look around, the model stays put", body: "" }
        : { title: "Model placed", body: "Keep the QR in view as you move." };
      break;
  }
  if (i.hint && i.phase !== "starting") c = { ...c, body: i.hint };
  return c;
}

/** "Scale 1:50 · 0.89 × 0.86 m, 0.6 m high" — the same readout on both engines. */
export function formatScaleReadout(
  modelScale: number,
  size: { width: number; depth: number; height: number } | null | undefined,
): string | null {
  if (!size) return null;
  const m = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(1));
  return `Scale 1:${modelScale} · ${m(size.width)} × ${m(size.depth)} m, ${m(size.height)} m high`;
}
