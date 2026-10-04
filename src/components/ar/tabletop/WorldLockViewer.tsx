import { useCallback, useEffect, useState } from "react";
import WorldLockScene, { QR_SIZE_MM } from "./WorldLockScene";
import type { Xr8ImageTargetData } from "@/lib/xr8QrTarget";
import { modelCacheKeyFor, preloadQrTarget } from "@/lib/arPreload";
import { ModelLoadError } from "@/lib/modelLoadError";
import { formatScaleReadout, qrLaunchPhase } from "@/lib/qrLaunchStatus";
import QrViewerChrome from "@/components/ar/qr/QrViewerChrome";

/**
 * Tabletop / wall viewer on 8th Wall (image target + SLAM).
 *
 * Flow (Oct 2026): camera opens → aim at the printed QR → the model appears
 * on it and follows it while the readings settle → the scene locks it in the
 * room by itself (onLocked) → walk around it, look away, come back.
 * "Re-place" unlocks: the model follows the QR again and re-locks when
 * steady. Status copy comes from qrLaunchStatus — the same voice as the
 * MindAR viewer.
 */

interface WorldLockViewerProps {
  project: {
    name: string;
    mode: string;
    qr_code_url?: string | null;
    updated_at?: string | null;
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

const LICENSE_URL = "https://github.com/8thwall/engine/blob/main/LICENSE";

/** If the engine never reports "scanning", treat it as ready this long after start. */
const SCANNING_FALLBACK_MS = 3000;

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
  const [target, setTarget] = useState<Xr8ImageTargetData | null>(null);
  const [started, setStarted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [shownSize, setShownSize] = useState<{ width: number; depth: number; height: number } | null>(null);
  const [qrInView, setQrInView] = useState(false);
  const [qrSeen, setQrSeen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [replaceSignal, setReplaceSignal] = useState(0);
  const [tracking, setTracking] = useState<{ status: string; reason: string }>({ status: "", reason: "" });

  useEffect(() => {
    let cancelled = false;
    // Built on the pre-camera screen already (arPreload); this joins it.
    preloadQrTarget(project.qr_code_url, shareId, QR_SIZE_MM)
      .then((t) => { if (!cancelled) setTarget(t); })
      .catch((e) => { if (!cancelled) onEngineError(e instanceof Error ? e : new Error(String(e))); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.qr_code_url, shareId]);

  useEffect(() => {
    if (!started || scanning) return;
    const t = setTimeout(() => setScanning(true), SCANNING_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [started, scanning]);

  const handleError = useCallback((err: Error) => {
    if (err instanceof ModelLoadError) onModelError(err);
    else onEngineError(err);
  }, [onModelError, onEngineError]);

  const phase = qrLaunchPhase({
    engineReady: !!target && started && scanning,
    qrInView,
    qrSeen,
    modelReady: modelLoaded,
    locked,
  });
  const hint = tracking.status === "LIMITED" && tracking.reason === "TOO_MUCH_MOTION"
    ? "Move a little slower."
    : null;

  return (
    <div className="fixed inset-0 bg-black">
      {target && (
        <WorldLockScene
          target={target}
          modelUrl={modelUrl}
          modelCacheKey={modelCacheKeyFor(shareId, project.updated_at)}
          mode={project.mode}
          modelScale={modelScale}
          initialRotation={initialRotation}
          replaceSignal={replaceSignal}
          onReady={() => setStarted(true)}
          onScanning={() => setScanning(true)}
          onModelProgress={(f) => setModelProgress(f * 100)}
          onModelLoaded={(info) => { setModelLoaded(true); setShownSize(info.displayedSizeM ?? null); }}
          onTargetFound={() => { setQrInView(true); setQrSeen(true); }}
          onTargetLost={() => setQrInView(false)}
          onLocked={() => setLocked(true)}
          onUnlocked={() => setLocked(false)}
          onTrackingStatus={(status, reason) => setTracking({ status, reason })}
          onError={handleError}
        />
      )}

      <QrViewerChrome
        phase={phase}
        mode={project.mode}
        projectName={project.name}
        modelProgress={modelProgress}
        holdsInRoom
        hint={hint}
        scaleReadout={formatScaleReadout(modelScale, shownSize)}
        onClose={onClose}
        onReplace={() => setReplaceSignal((n) => n + 1)}
        footer={
          // Required by the engine licence — keep on screen.
          <p className="text-[10px] text-white/55 text-center">
            AR engine: 8th Wall by Niantic Spatial ·{" "}
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="underline">
              licence
            </a>{" "}
            · provided without warranty
          </p>
        }
      />
    </div>
  );
};

export default WorldLockViewer;
