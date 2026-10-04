import { useEffect, useState, type ReactNode } from "react";
import { Camera, Check, Loader2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import LaunchRing, { type LaunchRingState } from "@/components/ar/multipoint/LaunchRing";
import { qrStatusCopy, type QrPhase } from "@/lib/qrLaunchStatus";

/**
 * Everything drawn over the camera for Tabletop/Wall, on both engines — one
 * status voice at a time (qrLaunchStatus):
 *
 *   starting       B1 ring + "Starting camera…"            (no reticle)
 *   aim            B2 brackets + "Aim at the QR code"
 *   found-loading  B3 frame + download %
 *   placing        top card "Hold steady…"
 *   placed         "Look around, the model stays put" for a few seconds,
 *                  then a quiet project pill; Re-place + scale readout
 *
 * The ring and the top card are never on screen together.
 */
interface QrViewerChromeProps {
  phase: QrPhase;
  mode: string;
  projectName: string;
  /** 0–100, or null when unknown. */
  modelProgress: number | null;
  holdsInRoom: boolean;
  hint?: string | null;
  /** formatScaleReadout(...) once the model is placed. */
  scaleReadout?: string | null;
  onClose: () => void;
  /** Placed → back to following the QR, then lock again when steady. */
  onReplace?: () => void;
  onScreenshot?: () => void;
  /** Bottom line under the controls (8th Wall attribution). */
  footer?: ReactNode;
}

const RING_STATE: Partial<Record<QrPhase, LaunchRingState>> = {
  starting: "loading",
  aim: "loaded",
  "found-loading": "found-loading",
};

/** How long the "stays put" line stays up after the lock. */
const PLACED_MESSAGE_MS = 3500;

const QrViewerChrome = ({
  phase,
  mode,
  projectName,
  modelProgress,
  holdsInRoom,
  hint,
  scaleReadout,
  onClose,
  onReplace,
  onScreenshot,
  footer,
}: QrViewerChromeProps) => {
  const copy = qrStatusCopy({ phase, mode, modelProgress, holdsInRoom, hint });
  const ring = RING_STATE[phase];

  // The placed message is shown once per lock, then steps back.
  const [placedFresh, setPlacedFresh] = useState(false);
  useEffect(() => {
    if (phase !== "placed") { setPlacedFresh(false); return; }
    setPlacedFresh(true);
    const t = setTimeout(() => setPlacedFresh(false), PLACED_MESSAGE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const closeButton = (
    <button
      onClick={onClose}
      aria-label="Close AR view"
      className="pointer-events-auto h-11 w-11 shrink-0 rounded-full bg-black/45 backdrop-blur-xl border border-white/25 flex items-center justify-center shadow-lg active:scale-95 transition-transform"
    >
      <X className="h-5 w-5 text-white" />
    </button>
  );

  // Top card: only when the ring is not speaking.
  let topCard: ReactNode = null;
  if (!ring) {
    if (phase === "placed" && !placedFresh) {
      topCard = (
        <div className="rounded-xl bg-white/15 backdrop-blur-xl border border-white/20 shadow-lg px-4 py-2.5 max-w-full">
          <span className="block truncate font-display text-sm font-medium text-white/90">{projectName}</span>
          {copy.body && <span className="block text-[11px] text-white/70 mt-0.5">{copy.body}</span>}
        </div>
      );
    } else {
      topCard = (
        <div
          className={cn(
            "rounded-xl backdrop-blur-sm shadow-lg px-4 py-3 max-w-full",
            phase === "placed" ? "bg-green-50/95 border border-green-200" : "bg-white/95",
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {phase === "placed" ? (
              <Check className="h-4 w-4 text-green-600 shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            )}
            <span className={cn("font-display font-semibold text-sm", phase === "placed" && "text-green-700")}>
              {copy.title}
            </span>
          </div>
          {copy.body && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{copy.body}</p>}
        </div>
      );
    }
  }

  return (
    <>
      {ring && (
        <LaunchRing
          state={ring}
          // While starting, the ring spins: a model % next to "Starting
          // camera…" read as if the camera itself were loading.
          progress={phase === "starting" ? null : modelProgress}
          cameraReady={phase !== "starting"}
          aimTitle={copy.title}
          aimBody={copy.body}
          title={copy.title}
          body={copy.body}
        />
      )}

      {/* Top bar: status card (when the ring is quiet) + ✕ */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-4 pt-[max(env(safe-area-inset-top),16px)] flex items-start gap-2">
        <div className="flex-1 min-w-0">{topCard}</div>
        {closeButton}
      </div>

      {/* Bottom: controls once placed, scale readout, footer */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4 pb-[max(env(safe-area-inset-bottom),16px)] flex flex-col items-center gap-3">
        {phase === "placed" && (onReplace || onScreenshot) && (
          <div className="pointer-events-auto flex items-center justify-center gap-5">
            {onReplace && (
              <button
                onClick={onReplace}
                className="h-11 px-5 rounded-full bg-black/45 backdrop-blur-xl border border-white/25 text-white text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform"
              >
                <RotateCcw className="h-4 w-4" /> Re-place
              </button>
            )}
            {onScreenshot && (
              <button
                onClick={onScreenshot}
                aria-label="Save a screenshot"
                className="h-14 w-14 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform"
              >
                <Camera className="h-6 w-6 text-white" />
              </button>
            )}
          </div>
        )}
        {phase === "placed" && scaleReadout && (
          <p className="text-[11px] text-white/85 text-center font-mono tabular-nums drop-shadow">{scaleReadout}</p>
        )}
        {footer && <div className="pointer-events-auto">{footer}</div>}
      </div>
    </>
  );
};

export default QrViewerChrome;
