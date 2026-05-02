import { useState, useEffect, useRef } from "react";
import { ChevronDown, MapPin, Target, Check, Loader2, Info, Camera, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import MindARScene from "./MindARScene";
import XR8Scene from "./XR8Scene";
import { type MarkerPoint, getMarkerColor } from "@/lib/markerTypes";

type MarkerStatus = "searching" | "detected" | "locked";

interface ARDetectionProps {
  mode: string;
  markers: Record<string, MarkerStatus>;
  markerCount?: number;
  onTargetFound?: (index: number) => void;
  onTargetLost?: (index: number) => void;
  onAllDetected?: () => void;
  onCancel: () => void;
  onExit: () => void;
  onReset?: () => void;
  onError?: (error: Error) => void;
  imageTargetSrc?: string;
  modelUrl?: string | null;
  modelScale?: number;
  initialRotation?: number;
  project?: { name: string; description?: string | null };
  markerData?: MarkerPoint[] | null;
  /** Tracking format — determines which AR engine to use */
  trackingFormat?: string;
}

const ARDetection = ({
  mode,
  markers,
  markerCount,
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
  trackingFormat = "mindar-mind",
}: ARDetectionProps) => {
  const useXR8 = trackingFormat === "8thwall-wtc";
  const [guideExpanded, setGuideExpanded] = useState(true);
  const [arReady, setArReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [gestureHint, setGestureHint] = useState(false);

  // ── Fix 8: Prefetch GLB during scanning phase ─────────────────
  const [prefetchedModel, setPrefetchedModel] = useState<ArrayBuffer | null>(null);
  const prefetchStarted = useRef(false);

  useEffect(() => {
    if (!modelUrl || prefetchStarted.current) return;
    prefetchStarted.current = true;

    fetch(modelUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        setPrefetchedModel(buffer);
        console.log(`[ARDetection] GLB prefetched (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      })
      .catch((err) => {
        console.warn("[ARDetection] GLB prefetch failed, will fall back to URL loading:", err);
      });
  }, [modelUrl]);

  const isMultipoint = mode !== "tabletop";
  const markerKeys = Object.keys(markers);
  const detectedCount = Object.values(markers).filter((s) => s !== "searching").length;
  const totalMarkers = markerCount ?? (isMultipoint ? markerKeys.length : 1);
  const allDetected = detectedCount >= totalMarkers && totalMarkers > 0;

  // When all markers detected, switch to active phase
  useEffect(() => {
    if (allDetected && !isActive) {
      const t = setTimeout(() => {
        setIsActive(true);
        onAllDetected?.();
        if (!isMultipoint) {
          setGestureHint(true);
          setTimeout(() => setGestureHint(false), 3000);
        }
      }, 800);
      return () => clearTimeout(t);
    }
  }, [allDetected, isActive, onAllDetected, isMultipoint]);

  const handleScreenshot = () => {
    toast({ title: "Screenshot saved", description: "Image saved to your photo library." });
  };

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
          <button onClick={onCancel} className="mt-2 text-sm text-white/60 hover:text-white/80 underline">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Determine the next un-detected marker (for N>6 guidance hint)
  const nextUndetected = isMultipoint
    ? Object.entries(markers)
        .filter(([, s]) => s === "searching")
        .map(([k]) => parseInt(k))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b)[0]
    : undefined;
  const nextMarkerColor = nextUndetected != null ? getMarkerColor(nextUndetected) : null;

  let guideIcon = <MapPin className="h-4 w-4" />;
  let guideTitle = arReady ? "Point camera at markers" : "Starting camera…";
  let guideDescription = isMultipoint
    ? `Slowly scan the space to locate the ${totalMarkers} position markers. Hold steady when a marker is in view.`
    : "Point your camera at the AR marker on the table. Hold steady when the marker is in view.";

  if (!arReady) {
    guideIcon = <Loader2 className="h-4 w-4 animate-spin" />;
    guideDescription = "Initializing AR engine and camera feed…";
  } else if (detectedCount > 0 && !allDetected) {
    guideIcon = <Target className="h-4 w-4" />;
    guideTitle = "Almost there!";
    guideDescription =
      totalMarkers > 6 && nextUndetected != null && nextMarkerColor
        ? `${detectedCount} of ${totalMarkers} detected. Scan marker #${nextUndetected} (${nextMarkerColor.name}) next.`
        : `${detectedCount} of ${totalMarkers} markers detected. Keep scanning for the remaining markers.`;
  } else if (allDetected) {
    guideIcon = <Check className="h-4 w-4" />;
    guideTitle = "Model locked";
    guideDescription = "All markers detected. Your AR experience is active.";
  }

  // Build sorted marker entries for display
  const markerEntries = Object.entries(markers).sort(([a], [b]) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* AR scene — routes to XR8 or MindAR based on tracking format */}
      {useXR8 ? (
        <XR8Scene
          imageTargetSrc={imageTargetSrc}
          modelUrl={modelUrl}
          mode={mode}
          maxTrack={isMultipoint ? totalMarkers : 1}
          modelScale={modelScale}
          initialRotation={initialRotation}
          markerData={markerData}
          prefetchedModel={prefetchedModel}
          onTargetFound={(index) => onTargetFound?.(index)}
          onTargetLost={(index) => onTargetLost?.(index)}
          onReady={() => setArReady(true)}
          onError={(err) => {
            console.error("XR8 Error:", err);
            onError?.(err);
          }}
        />
      ) : (
        <MindARScene
          imageTargetSrc={imageTargetSrc}
          modelUrl={modelUrl}
          mode={mode}
          maxTrack={isMultipoint ? totalMarkers : 1}
          modelScale={modelScale}
          initialRotation={initialRotation}
          markerData={markerData}
          prefetchedModel={prefetchedModel}
          onTargetFound={(index) => onTargetFound?.(index)}
          onTargetLost={(index) => onTargetLost?.(index)}
          onReady={() => setArReady(true)}
          onError={(err) => {
            console.error("MindAR Error:", err);
            onError?.(err);
          }}
        />
      )}

      {/* ── DETECTION PHASE UI ── */}
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
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", guideExpanded && "rotate-180")} />
              </div>
              {guideExpanded && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{guideDescription}</p>
              )}
            </button>
          </div>

          <div className="flex-1" />

          {/* Bottom Marker Status */}
          <div className="relative z-10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
            <div className={cn(
              "rounded-xl border bg-white/95 backdrop-blur-sm shadow-lg p-4 transition-colors",
              allDetected && "bg-green-50/95 border-green-200"
            )}>
              <p className="text-xs text-muted-foreground mb-3 font-medium">
                {allDetected ? (
                  <span className="text-green-600">✓ All markers locked</span>
                ) : (
                  `${detectedCount > 0 ? `${detectedCount} of ${totalMarkers} detected` : "Looking for markers…"}`
                )}
              </p>

              {isMultipoint ? (
                totalMarkers <= 6 ? (
                  <div className="flex gap-3 justify-center flex-wrap">
                    {markerEntries.map(([key, status]) => {
                      const idx = parseInt(key) || 1;
                      const color = getMarkerColor(idx);
                      const isFound = status !== "searching";
                      return (
                        <div key={key} className="flex flex-col items-center gap-1.5">
                          <div
                            className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                              isFound ? "text-white shadow-md scale-110" : "bg-muted text-muted-foreground"
                            )}
                            style={isFound ? { backgroundColor: color.bg } : undefined}
                          >
                            {isFound ? <Check className="h-4 w-4" /> : key}
                          </div>
                          <span className={cn("text-[10px]", isFound ? "font-semibold" : "text-muted-foreground")}>
                            {color.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Progress value={(detectedCount / totalMarkers) * 100} className="h-2" />
                    <p className="text-xs text-center text-muted-foreground">
                      {detectedCount} of {totalMarkers} markers detected
                    </p>
                  </div>
                )
              ) : (
                <div className="flex justify-center">
                  <div className={cn(
                    "h-12 w-12 rounded-lg flex items-center justify-center transition-all",
                    markers["QR"] !== "searching"
                      ? "bg-primary text-white shadow-md"
                      : "bg-muted text-muted-foreground animate-pulse"
                  )}>
                    {markers["QR"] !== "searching" ? <Check className="h-5 w-5" /> : "AR"}
                  </div>
                </div>
              )}
            </div>

            <button onClick={onCancel} className="w-full mt-3 text-center text-xs text-white/60 hover:text-white/80 transition-colors">
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── ACTIVE PHASE UI ── */}
      {isActive && (
        <>
          {gestureHint && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/70 backdrop-blur-sm rounded-2xl px-6 py-4 text-center animate-fade-in">
                <p className="text-white text-sm font-medium">Drag to orbit · Pinch to zoom</p>
              </div>
            </div>
          )}

          {/* Top bar */}
          <div className="relative z-10 p-4 pt-[env(safe-area-inset-top,16px)] flex items-start justify-between">
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
                <ChevronDown className={cn("h-3 w-3 text-white/60 shrink-0 transition-transform", infoExpanded && "rotate-180")} />
              </div>
              {infoExpanded && project?.description && (
                <p className="text-[11px] text-white/60 mt-1.5 leading-relaxed">{project.description}</p>
              )}
            </button>

            <div className="h-10 w-10 rounded-full bg-green-500/20 backdrop-blur-xl border border-green-400/30 flex items-center justify-center">
              <Check className="h-4 w-4 text-green-400" />
            </div>
          </div>

          <div className="flex-1" />

          {/* Bottom controls */}
          <div className="relative z-10 p-4 pb-[env(safe-area-inset-bottom,24px)]">
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => setInfoExpanded(!infoExpanded)}
                className="h-12 w-12 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
              >
                <Info className="h-5 w-5 text-white/80" />
              </button>

              <button
                onClick={handleScreenshot}
                className="h-16 w-16 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform"
              >
                <Camera className="h-6 w-6 text-white" />
              </button>

              <button
                onClick={() => onReset ? onReset() : setIsActive(false)}
                className="h-12 w-12 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
              >
                <RotateCcw className="h-5 w-5 text-white/80" />
              </button>
            </div>

            <button onClick={onExit} className="w-full mt-4 text-center text-[11px] text-white/40 hover:text-white/60 transition-colors">
              Tap to exit AR
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ARDetection;
