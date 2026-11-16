import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import MindARScene from "@/components/ar/multipoint/MindARScene";
import QrViewerChrome from "./QrViewerChrome";
import { modelCacheKeyFor, preloadModel, subscribeModelProgress } from "@/lib/arPreload";
import { getMotionState, subscribeMotionState, type MotionState } from "@/lib/arLaunch";
import { formatScaleReadout, qrLaunchPhase } from "@/lib/qrLaunchStatus";
import { buildSizedExperienceUrl, qrVariantForSize, type QrSizeMm } from "@/lib/qrSizes";
import { spatialQrSvg } from "@/lib/spatial/qr";
import { svgToCanvas } from "@/lib/spatial/raster";
import { compileMindFile } from "@/lib/compileMindFile";

/**
 * Tabletop / Wall on MindAR (the free-tier default, Oct 2026).
 *
 * Until now Tabletop/Wall ran inside MultipointViewer, Spatial's viewer, and
 * inherited its copy: three contradicting messages and a "placed" message
 * fired by the first QR sighting (4 Oct test, bugs 2 and 3). This viewer
 * shares its status voice and chrome with the 8th Wall viewer
 * (QrViewerChrome + qrLaunchStatus), so both engines behave the same in the
 * A/B phone test. MultipointViewer is left untouched for Spatial.
 *
 * The scene underneath is the same MindARScene (lock on 10 steady frames,
 * gyro hold, QR re-snap — 96a8b26); "placed" now comes from its lock event.
 */
interface MindARQrViewerProps {
  project: { name: string; mode: string; updated_at?: string | null };
  shareId: string;
  imageTargetSrc?: string;
  modelUrl: string | null;
  modelScale: number;
  /** Printed QR width from ?q= (default 150 mm, the stored .mind). */
  qrSizeMm?: number;
  initialRotation?: number;
  onClose: () => void;
  onError: (err: Error) => void;
}

const MindARQrViewer = ({
  project,
  shareId,
  imageTargetSrc,
  modelUrl,
  modelScale,
  qrSizeMm = 150,
  initialRotation = 0,
  onClose,
  onError,
}: MindARQrViewerProps) => {
  const [arReady, setArReady] = useState(false);
  const [qrInView, setQrInView] = useState(false);
  const [qrSeen, setQrSeen] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [replaceSignal, setReplaceSignal] = useState(0);
  const [shownSize, setShownSize] = useState<{ width: number; depth: number; height: number } | null>(null);
  const [motion, setMotion] = useState<MotionState>(getMotionState);
  useEffect(() => subscribeMotionState(setMotion), []);

  // GLB: join the download the pre-camera screen started (arPreload).
  const [prefetchedModel, setPrefetchedModel] = useState<ArrayBuffer | null>(null);
  const [prefetchFailed, setPrefetchFailed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    if (!modelUrl) return;
    let cancelled = false;
    const p = preloadModel(modelUrl, modelCacheKeyFor(shareId, project.updated_at));
    const unsub = subscribeModelProgress(modelUrl, (f) => { if (!cancelled) setProgress(f == null ? null : f * 100); });
    p.then((buf) => { if (!cancelled) setPrefetchedModel(buf); })
      .catch((e) => {
        console.warn("[MindARQrViewer] GLB preload failed, the scene loads from the URL:", e);
        if (!cancelled) setPrefetchFailed(true);
      });
    return () => { cancelled = true; unsub(); };
    // A re-signed URL has the same path and joins the same download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, shareId]);

  // 100 / 50 mm prints have no stored .mind (only the 150 mm one is): compile
  // it here from the same deterministic QR image the download made. The MindAR
  // path is only the fallback engine, so the wait is acceptable.
  const [sizedMindSrc, setSizedMindSrc] = useState<string | null>(null);
  const [sizedMindFailed, setSizedMindFailed] = useState(false);
  useEffect(() => {
    if (qrSizeMm === 150) return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const size = qrSizeMm as QrSizeMm;
        const canvas = await svgToCanvas(
          spatialQrSvg(buildSizedExperienceUrl(shareId, size), qrVariantForSize(size)), 1440, 1440);
        const img = await new Promise<HTMLImageElement>((ok, fail) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = fail;
          i.src = canvas.toDataURL("image/png");
        });
        const { blob } = await compileMindFile([img]);
        url = URL.createObjectURL(blob);
        if (!cancelled) setSizedMindSrc(url);
      } catch (e) {
        console.warn("[MindARQrViewer] could not compile the sized QR target:", e);
        if (!cancelled) setSizedMindFailed(true);
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [qrSizeMm, shareId]);
  const trackingSrc = qrSizeMm === 150 ? imageTargetSrc : sizedMindSrc ?? undefined;

  if (qrSizeMm !== 150 && !sizedMindSrc && !sizedMindFailed) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-6">
        <p className="text-sm text-white/70">Preparing the {qrSizeMm} mm QR target…</p>
      </div>
    );
  }

  if (!trackingSrc) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="bg-destructive/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
            <Target className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-lg font-bold text-white">Experience Not Ready</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            This experience needs to be re-generated. Please ask the project owner to regenerate it.
          </p>
          <button onClick={onClose} className="mt-2 text-sm text-white/60 hover:text-white/80 underline">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const phase = qrLaunchPhase({ engineReady: arReady, qrInView, qrSeen, modelReady, locked });

  // Same capture as before (MultipointViewer, audit H-2): the model layer.
  const handleScreenshot = () => {
    const canvas = document.querySelector("#mindar-ar-container canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      toast({ title: "Screenshot unavailable", description: "AR canvas not ready yet.", variant: "destructive" });
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        toast({ title: "Screenshot failed", description: "Could not capture image.", variant: "destructive" });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `archi-ar-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Screenshot saved", description: "Image downloaded to your device." });
    }, "image/png");
  };

  return (
    <div className="fixed inset-0 bg-black">
      <MindARScene
        imageTargetSrc={trackingSrc}
        modelUrl={modelUrl}
        mode={project.mode}
        maxTrack={1}
        modelScale={modelScale}
        qrSizeMm={qrSizeMm}
        initialRotation={initialRotation}
        prefetchedModel={prefetchedModel}
        awaitPrefetch={!!modelUrl && !prefetchedModel && !prefetchFailed}
        onReady={() => setArReady(true)}
        onTargetFound={() => { setQrInView(true); setQrSeen(true); }}
        onTargetLost={() => setQrInView(false)}
        onModelPlaced={(info) => { setModelReady(true); setShownSize(info.displayedSizeM ?? null); }}
        onLocked={() => setLocked(true)}
        replaceSignal={replaceSignal}
        onError={(err) => {
          console.error("MindAR Error:", err);
          onError(err);
        }}
      />

      <QrViewerChrome
        phase={phase}
        mode={project.mode}
        projectName={project.name}
        modelProgress={progress}
        // The gyro holds the model while the QR is out of view only with
        // motion access; without it, say so instead of promising it.
        holdsInRoom={motion !== "denied"}
        scaleReadout={formatScaleReadout(modelScale, shownSize)}
        onClose={onClose}
        onReplace={() => { setLocked(false); setReplaceSignal((n) => n + 1); }}
        onScreenshot={handleScreenshot}
      />
    </div>
  );
};

export default MindARQrViewer;
