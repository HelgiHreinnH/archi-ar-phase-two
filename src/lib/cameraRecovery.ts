/**
 * Camera recovery after an interruption (Oct 2026; 4 Oct test, bug 7: the
 * camera feed went black behind the model after a screenshot and never came
 * back).
 *
 * iOS can end or mute the capture track, or pause the <video>, when the page
 * is interrupted: a screenshot, an app switch, a notification or Control
 * Centre, a phone call. Nothing restarted it. This watches the engine's
 * camera video and calls the engine-specific `restart` when the feed is dead
 * while the page is visible:
 *   · track ended                         → restart now
 *   · track muted for > MUTE_GRACE_MS      → restart
 *   · video paused                        → play(); restart if that fails
 *   · no new video frame for 2 checks (frozen frame) → restart — counted
 *     with requestVideoFrameCallback, and only for an on-screen video (a
 *     hidden one, like 8th Wall's 1×1 element, never presents frames)
 *   · page becomes visible again          → check right away
 * Restarts are throttled (RESTART_MIN_GAP_MS) so a flapping track can't loop.
 * The scene and the model lock are untouched — only the feed is replaced.
 */
import { markARRepeat } from "@/lib/arTiming";

export const MUTE_GRACE_MS = 1500;
export const CHECK_INTERVAL_MS = 1000;
export const RESTART_MIN_GAP_MS = 3000;
/** Consecutive checks with no new video time before the feed counts as frozen. */
export const STALL_CHECKS = 2;

export interface CameraHealthInput {
  visible: boolean;
  hasVideo: boolean;
  trackState: "live" | "ended" | "none";
  mutedForMs: number;
  paused: boolean;
  stalledChecks: number;
}

export type CameraVerdict = "ok" | "play" | "restart";

/** Pure decision, unit-tested. */
export function cameraVerdict(i: CameraHealthInput): CameraVerdict {
  if (!i.visible || !i.hasVideo) return "ok"; // hidden: the OS owns the camera; no video yet: still starting
  if (i.trackState === "ended") return "restart";
  if (i.mutedForMs > MUTE_GRACE_MS) return "restart";
  if (i.paused) return "play";
  if (i.stalledChecks >= STALL_CHECKS) return "restart";
  return "ok";
}

export interface WatchCameraOptions {
  /** The engine's camera <video> (may change after a restart). */
  getVideo: () => HTMLVideoElement | null;
  /** Engine-specific restart of the feed. */
  restart: (reason: string) => Promise<void> | void;
  label: string;
}

export function watchCamera(opts: WatchCameraOptions): () => void {
  let stopped = false;
  let frames = 0;
  let lastFrames = -1;
  let frameVideo: HTMLVideoElement | null = null;
  let stalledChecks = 0;
  let mutedSince = 0;
  let lastRestart = 0;
  let restarting = false;
  let boundTrack: MediaStreamTrack | null = null;

  const onMute = () => { if (!mutedSince) mutedSince = performance.now(); };
  const onUnmute = () => { mutedSince = 0; };
  const onEnded = () => { void check("track ended"); };

  const currentTrack = (v: HTMLVideoElement | null): MediaStreamTrack | null => {
    const src = v?.srcObject;
    if (!src || !(src instanceof MediaStream)) return null;
    return src.getVideoTracks()[0] ?? null;
  };

  const bind = (t: MediaStreamTrack | null) => {
    if (t === boundTrack) return;
    if (boundTrack) {
      boundTrack.removeEventListener("mute", onMute);
      boundTrack.removeEventListener("unmute", onUnmute);
      boundTrack.removeEventListener("ended", onEnded);
    }
    boundTrack = t;
    mutedSince = t?.muted ? performance.now() : 0;
    if (t) {
      t.addEventListener("mute", onMute);
      t.addEventListener("unmute", onUnmute);
      t.addEventListener("ended", onEnded);
    }
  };

  type RvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  /** Count presented frames of an on-screen video (frozen-frame check). */
  const countFrames = (v: HTMLVideoElement | null): boolean => {
    const rv = v as RvfcVideo | null;
    if (!rv || typeof rv.requestVideoFrameCallback !== "function") return false;
    if (rv.offsetWidth <= 1 || rv.getClientRects().length === 0) return false;
    if (frameVideo !== rv) {
      frameVideo = rv;
      lastFrames = -1;
      const tick = () => {
        if (stopped || frameVideo !== rv) return;
        frames++;
        rv.requestVideoFrameCallback!(tick);
      };
      rv.requestVideoFrameCallback(tick);
    }
    return true;
  };

  const doRestart = async (reason: string) => {
    const now = performance.now();
    if (restarting || now - lastRestart < RESTART_MIN_GAP_MS) return;
    restarting = true;
    lastRestart = now;
    console.warn(`[cameraRecovery:${opts.label}] restarting camera feed — ${reason}`);
    try {
      await opts.restart(reason);
      markARRepeat("camera-recovered", `${opts.label}: ${reason}`);
    } catch (e) {
      console.warn(`[cameraRecovery:${opts.label}] restart failed`, e);
    } finally {
      restarting = false;
      stalledChecks = 0;
      lastFrames = -1;
      frameVideo = null;
      mutedSince = 0;
    }
  };

  const check = async (why?: string) => {
    if (stopped || restarting) return;
    const v = opts.getVideo();
    const t = currentTrack(v);
    bind(t);
    const visible = document.visibilityState === "visible";
    if (v && visible && !v.paused && countFrames(v)) {
      if (frames === lastFrames) stalledChecks++;
      else stalledChecks = 0;
      lastFrames = frames;
    } else {
      stalledChecks = 0;
    }
    const verdict = cameraVerdict({
      visible,
      hasVideo: !!v,
      trackState: !t ? "none" : t.readyState === "ended" ? "ended" : "live",
      mutedForMs: mutedSince ? performance.now() - mutedSince : 0,
      paused: !!v?.paused,
      stalledChecks,
    });
    if (verdict === "play" && v) {
      try {
        await v.play();
        return;
      } catch {
        return doRestart(why ?? "video paused and would not play");
      }
    }
    if (verdict === "restart") {
      const reason = why
        ?? (t?.readyState === "ended" ? "track ended"
          : mutedSince ? "track muted"
          : "frozen frame");
      return doRestart(reason);
    }
  };

  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    // Let the OS hand the camera back first.
    stalledChecks = 0;
    lastFrames = -1;
    setTimeout(() => void check(), 400);
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onVisible);
    bind(null);
  };
}

/**
 * MindAR restart: a fresh rear-camera stream into MindAR's own <video>, with
 * the same constraints MindAR 1.2.5 used. MindAR reads frames from that
 * element, so tracking and the locked model carry on.
 */
export async function restartVideoElementStream(video: HTMLVideoElement): Promise<void> {
  const old = video.srcObject instanceof MediaStream ? video.srcObject : null;
  // Stop first: iOS won't hand out a second capture of the same camera.
  old?.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "environment" },
  });
  video.srcObject = stream;
  await video.play();
}
