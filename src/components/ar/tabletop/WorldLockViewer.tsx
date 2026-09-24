import { useCallback, useEffect, useState } from "react";
import { Lock, Unlock, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import WorldLockScene, { QR_SIZE_MM } from "./WorldLockScene";
import { buildQrImageTarget, type Xr8ImageTargetData } from "@/lib/xr8QrTarget";
import { ModelLoadError } from "@/lib/modelLoadError";

/**
 * Tabletop / wall viewer on 8th Wall (image target + SLAM).
 *
 * Flow: camera opens → point at the printed QR → the model appears on it →
 * tap "Lock model" → the model is fixed in the room; walk around it, look away,
 * come back. Before locking, new QR sightings keep refining the placement;
 * after locking they are ignored. "Unlock" goes back to following the QR.
 */

interface WorldLockViewerProps {
  project: {
    name: string;
    mode: string;
    qr_code_url?: string | null;
  };
  shareId: string;
  modelUrl: string | null;
  modelScale: number;
  initialRotation?: number;
  onClose: () => void;
  /** Model failed to load — ARViewer's recovery flow. */
  onModelError: (err: Error) => void;
  /** Engine couldn't start on this device — fall back to MindAR. */
  onEngineError: (err: Error) => void;
}

/** 0.886 → "0.89", 12.4 → "12.4" */
const fmtM = (m: number) => (m < 10 ? m.toFixed(2) : m.toFixed(1));

const LICENSE_URL = "https://github.com/8thwall/engine/blob/main/LICENSE";

const WorldLockViewer = ({
  project,
  shareId,
  modelUrl,
  modelScale,
  initialRotation,
  onClose,
  onModelError,
  onEngineError,
}: WorldLockViewerProps) => {
  const surface = project.mode === "wall" ? "wall" : "table";
  const [target, setTarget] = useState<Xr8ImageTargetData | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [shownSize, setShownSize] = useState<{ width: number; depth: number; height: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const [qrInView, setQrInView] = useState(false);
  const [locked, setLocked] = useState(false);
  const [tracking, setTracking] = useState<{ status: string; reason: string }>({ status: "", reason: "" });

  useEffect(() => {
    let cancelled = false;
    buildQrImageTarget(project.qr_code_url, shareId, QR_SIZE_MM)
      .then((t) => { if (!cancelled) setTarget(t); })
      .catch((e) => { if (!cancelled) onEngineError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.qr_code_url, shareId]);

  const handleError = useCallback((err: Error) => {
    if (err instanceof ModelLoadError) onModelError(err);
    else onEngineError(err);
  }, [onModelError, onEngineError]);

  let title: string;
  let body: string | null = null;
  let busy = false;
  if (!target || !engineReady) {
    title = "Starting AR…";
    busy = true;
  } else if (!placed) {
    title = `Point at the QR code on the ${surface}`;
    body = modelLoaded ? "Hold the phone steady for a moment." : "Loading the model…";
    busy = !modelLoaded;
  } else if (!locked) {
    title = "Model placed";
    body = "Tap Lock when it sits right. Then walk around it freely.";
  } else {
    title = "Locked in the room";
    body = "Walk around the model and move in close for detail.";
  }
  if (engineReady && tracking.status === "LIMITED" && tracking.reason === "TOO_MUCH_MOTION") {
    body = "Move a little slower.";
  }

  return (
    <div className="fixed inset-0 bg-black">
      {target && (
        <WorldLockScene
          target={target}
          modelUrl={modelUrl}
          mode={project.mode}
          modelScale={modelScale}
          initialRotation={initialRotation}
          locked={locked}
          onReady={() => setEngineReady(true)}
          onModelLoaded={(info) => { setModelLoaded(true); setShownSize(info.displayedSizeM ?? null); }}
          onPlaced={() => setPlaced(true)}
          onTargetFound={() => setQrInView(true)}
          onTargetLost={() => setQrInView(false)}
          onTrackingStatus={(status, reason) => setTracking({ status, reason })}
          onError={handleError}
        />
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 p-4 pt-[env(safe-area-inset-top,16px)] flex items-start gap-2">
        <div className="flex-1 min-w-0 rounded-xl bg-white/95 backdrop-blur-sm shadow-lg px-4 py-3">
          <div className="flex items-center gap-2">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            ) : locked ? (
              <Lock className="h-4 w-4 text-primary shrink-0" />
            ) : null}
            <span className="font-display font-semibold text-sm truncate">{title}</span>
          </div>
          {body && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>}
        </div>
        <button
          onClick={onClose}
          aria-label="Close AR view"
          className="h-11 w-11 shrink-0 rounded-full bg-black/45 backdrop-blur-xl border border-white/25 flex items-center justify-center shadow-lg active:scale-95 transition-transform"
        >
          <X className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Bottom: lock control + required engine attribution */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pb-[max(env(safe-area-inset-bottom),16px)] flex flex-col items-center gap-3">
        {placed && (
          locked ? (
            <button
              onClick={() => setLocked(false)}
              className="h-11 px-5 rounded-full bg-black/45 backdrop-blur-xl border border-white/25 text-white text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform"
            >
              <Unlock className="h-4 w-4" /> Unlock and re-place
            </button>
          ) : (
            <button
              onClick={() => setLocked(true)}
              className={cn(
                "h-14 px-8 rounded-full bg-primary text-primary-foreground text-base font-semibold shadow-lg shadow-primary/30",
                "flex items-center gap-2 active:scale-95 transition-transform",
              )}
            >
              <Lock className="h-5 w-5" /> Lock model
            </button>
          )
        )}
        {placed && !locked && !qrInView && (
          <p className="text-[11px] text-white/80 text-center">Point back at the QR to adjust the placement.</p>
        )}
        {placed && shownSize && (
          <p className="text-[11px] text-white/85 text-center font-mono tabular-nums">
            Scale 1:{modelScale} · {fmtM(shownSize.width)} × {fmtM(shownSize.depth)} m, {fmtM(shownSize.height)} m high
          </p>
        )}
        <p className="text-[10px] text-white/55 text-center">
          AR engine: 8th Wall by Niantic Spatial ·{" "}
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="underline">
            licence
          </a>{" "}
          · provided without warranty
        </p>
      </div>
    </div>
  );
};

export default WorldLockViewer;
