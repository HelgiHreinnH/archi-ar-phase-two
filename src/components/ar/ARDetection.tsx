import { useState, useEffect } from "react";
import { ChevronDown, MapPin, Target, Check, Loader2, Info, Camera, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import MindARScene from "./MindARScene";

type MarkerStatus = "searching" | "detected" | "locked";

interface ARDetectionProps {
  mode: string;
  markers: Record<string, MarkerStatus>;
  onTargetFound?: (index: number) => void;
  onTargetLost?: (index: number) => void;
  onAllDetected?: () => void;
  onCancel: () => void;
  onExit: () => void;
  /** Full remount reset — restarts camera + re-anchors model from scratch */
  onReset?: () => void;
  onError?: (error: Error) => void;
  /** Compiled .mind image-target URL */
  imageTargetSrc?: string;
  /** GLB model URL to render on anchor */
  modelUrl?: string | null;
  /** Model scale factor */
  modelScale?: number;
  /** Initial rotation in degrees */
  initialRotation?: number;
  /** Project info for the active overlay */
  project?: { name: string; description?: string | null };
  /** Rhino marker coordinates for multi-point triangulation */
  markerData?: { A: { x: number; y: number; z: number }; B: { x: number; y: number; z: number }; C: { x: number; y: number; z: number } } | null;
}

const MARKER_CONFIG = {
  A: { color: "hsl(0 100% 60%)", label: "Red" },
  B: { color: "hsl(145 63% 49%)", label: "Green" },
  C: { color: "hsl(211 100% 50%)", label: "Blue" },
} as const;

const ARDetection = ({
  mode,
  markers,
  onTargetFound,
  onTargetLost,
  onAllDetected,
  onCancel,
  onExit,
  onReset,
  onError,
  imageTargetSrc,
  modelUrl,
  modelScale = 1,
  initialRotation = 0,
  project,
  markerData,
}: ARDetectionProps) => {
  const [guideExpanded, setGuideExpanded] = useState(true);
  const [arReady, setArReady] = useState(false);
  // isActive = true means all markers found; overlay switches to active controls
  // MindARScene stays mounted in BOTH phases
  const [isActive, setIsActive] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);

  const isMultipoint = mode !== "tabletop";
  const detectedCount = Object.values(markers).filter((s) => s !== "searching").length;
  const totalMarkers = isMultipoint ? 3 : 1;
  const allDetected = detectedCount === totalMarkers;

  // When all markers are detected, switch to active phase — DO NOT unmount MindARScene
  useEffect(() => {
    if (allDetected && !isActive) {
      const t = setTimeout(() => {
        setIsActive(true);
        onAllDetected?.();
      }, 800);
      return () => clearTimeout(t);
    }
  }, [allDetected, isActive, onAllDetected]);

  const handleScreenshot = () => {
    toast({ title: "Screenshot saved", description: "Image saved to your photo library." });
  };

  // Guard: a .mind target is required for AR to work
  if (!imageTargetSrc) {
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
          <button
            onClick={onCancel}
            className="mt-2 text-sm text-white/60 hover:text-white/80 underline"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  let guideIcon = <MapPin className="h-4 w-4" />;
  let guideTitle = arReady ? "Point camera at markers" : "Starting camera…";
  let guideDescription = isMultipoint
    ? "Slowly scan the space to locate the three position markers. Hold steady when a marker is in view."
    : "Point your camera at the AR marker on the table. Hold steady when the marker is in view.";

  if (!arReady) {
    guideIcon = <Loader2 className="h-4 w-4 animate-spin" />;
    guideDescription = "Initializing AR engine and camera feed…";
  } else if (detectedCount > 0 && !allDetected) {
    guideIcon = <Target className="h-4 w-4" />;
    guideTitle = "Almost there!";
    guideDescription = `${detectedCount} of ${totalMarkers} markers detected. Keep scanning for the remaining markers.`;
  } else if (allDetected) {
    guideIcon = <Check className="h-4 w-4" />;
    guideTitle = "Loading model…";
    guideDescription = "All markers locked. Preparing your AR experience.";
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Real camera feed via MindAR — stays mounted in BOTH phases */}
      <MindARScene
        imageTargetSrc={imageTargetSrc}
        modelUrl={modelUrl}
        mode={mode}
        maxTrack={isMultipoint ? 3 : 1}
        modelScale={modelScale}
        initialRotation={initialRotation}
        markerData={markerData}
        onTargetFound={(index) => onTargetFound?.(index)}
        onTargetLost={(index) => onTargetLost?.(index)}
        onReady={() => setArReady(true)}
        onError={(err) => {
          console.error("AR Error:", err);
          onError?.(err);
        }}
      />

      {/* ── DETECTION PHASE UI ─────────────────────────────────────── */}
      {!isActive && (
        <>
          {/* Top Guide Card */}
          <div className="relative z-10 p-4 pt-[env(safe-area-inset-top,16px)]">
            <button
              onClick={() => setGuideExpanded(!guideExpanded)}
              className={cn(
                "w-full rounded-xl border bg-white/95 backdrop-blur-sm shadow-lg p-4 text-left transition-colors",
                allDetected && "bg-green-50/95 border-green-200"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("text-muted-foreground", allDetected && "text-green-600")}>{guideIcon}</span>
                  <span className={cn("font-display font-semibold text-sm", allDetected && "text-green-700")}>
                    {guideTitle}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    guideExpanded && "rotate-180"
                  )}
                />
              </div>
              {guideExpanded && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{guideDescription}</p>
              )}
            </button>
          </div>

          <div className="flex-1" />

          {/* Bottom Marker Status */}
          <div className="relative z-10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
            <div
              className={cn(
                "rounded-xl border bg-white/95 backdrop-blur-sm shadow-lg p-4 transition-colors",
                allDetected && "bg-green-50/95 border-green-200"
              )}
            >
              <p className="text-xs text-muted-foreground mb-3 font-medium">
                {allDetected ? (
                  <span className="text-green-600">✓ All markers locked</span>
                ) : (
                  `${detectedCount > 0 ? `${detectedCount} of ${totalMarkers} detected` : "Looking for markers…"}`
                )}
              </p>
              {isMultipoint ? (
                <div className="flex gap-3 justify-center">
                  {(["A", "B", "C"] as const).map((id) => {
                    const status = markers[id] || "searching";
                    const cfg = MARKER_CONFIG[id];
                    const isFound = status !== "searching";
                    return (
                      <div key={id} className="flex flex-col items-center gap-1.5">
                        <div
                          className={cn(
                            "h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                            isFound ? "text-white shadow-md scale-110" : "bg-muted text-muted-foreground"
                          )}
                          style={isFound ? { backgroundColor: cfg.color } : undefined}
                        >
                          {isFound ? <Check className="h-4 w-4" /> : id}
                        </div>
                        <span className={cn("text-[10px]", isFound ? "font-semibold" : "text-muted-foreground")}>
                          {cfg.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex justify-center">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-lg flex items-center justify-center transition-all",
                      markers["QR"] !== "searching"
                        ? "bg-primary text-white shadow-md"
                        : "bg-muted text-muted-foreground animate-pulse"
                    )}
                  >
                    {markers["QR"] !== "searching" ? <Check className="h-5 w-5" /> : "AR"}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={onCancel}
              className="w-full mt-3 text-center text-xs text-white/60 hover:text-white/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── ACTIVE PHASE UI (transparent overlay — camera shows through) ── */}
      {isActive && (
        <>
          {/* Top bar */}
          <div className="relative z-10 p-4 pt-[env(safe-area-inset-top,16px)] flex items-start justify-between">
            {/* Glass-morphism info pill */}
            <button
              onClick={() => setInfoExpanded(!infoExpanded)}
              className={cn(
                "rounded-xl px-4 py-2.5 text-left transition-all max-w-[70%]",
                "bg-white/15 backdrop-blur-xl border border-white/20 shadow-lg"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-white/90 font-display text-sm font-medium truncate">
                  {project?.name ?? "AR Experience"}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-white/60 shrink-0 transition-transform",
                    infoExpanded && "rotate-180"
                  )}
                />
              </div>
              {infoExpanded && project?.description && (
                <p className="text-[11px] text-white/60 mt-1.5 leading-relaxed">{project.description}</p>
              )}
            </button>

            {/* Tracking status indicator */}
            <div className="h-10 w-10 rounded-full bg-green-500/20 backdrop-blur-xl border border-green-400/30 flex items-center justify-center">
              <Check className="h-4 w-4 text-green-400" />
            </div>
          </div>

          <div className="flex-1" />

          {/* Bottom controls */}
          <div className="relative z-10 p-4 pb-[env(safe-area-inset-bottom,24px)]">
            <div className="flex items-center justify-center gap-6">
              {/* Info */}
              <button
                onClick={() => setInfoExpanded(!infoExpanded)}
                className="h-12 w-12 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
              >
                <Info className="h-5 w-5 text-white/80" />
              </button>

              {/* Screenshot — primary */}
              <button
                onClick={handleScreenshot}
                className="h-16 w-16 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform"
              >
                <Camera className="h-6 w-6 text-white" />
              </button>

              {/* Reset — full remount so the model can re-anchor from scratch */}
              <button
                onClick={() => onReset ? onReset() : setIsActive(false)}
                className="h-12 w-12 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
              >
                <RotateCcw className="h-5 w-5 text-white/80" />
              </button>
            </div>

            {/* Exit hint */}
            <button
              onClick={onExit}
              className="w-full mt-4 text-center text-[11px] text-white/40 hover:text-white/60 transition-colors"
            >
              Tap to exit AR
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ARDetection;
