import { useState } from "react";
import { ChevronDown, MapPin, Target, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import MindARScene from "./MindARScene";

type MarkerStatus = "searching" | "detected" | "locked";

interface ARDetectionProps {
  mode: string;
  markers: Record<string, MarkerStatus>;
  onTargetFound?: (index: number) => void;
  onTargetLost?: (index: number) => void;
  onAllDetected: () => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
  /** Compiled .mind image-target URL */
  imageTargetSrc?: string;
  /** GLB model URL to render on anchor */
  modelUrl?: string | null;
  /** Model scale factor */
  modelScale?: number;
  /** Initial rotation in degrees */
  initialRotation?: number;
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
  onError,
  imageTargetSrc,
  modelUrl,
  modelScale = 1,
  initialRotation = 0,
}: ARDetectionProps) => {
  const [guideExpanded, setGuideExpanded] = useState(true);
  const [arReady, setArReady] = useState(false);
  const isMultipoint = mode !== "tabletop";

  const detectedCount = Object.values(markers).filter((s) => s !== "searching").length;
  const totalMarkers = isMultipoint ? 3 : 1;
  const allDetected = detectedCount === totalMarkers;

  // Determine guide state
  let guideIcon = <MapPin className="h-4 w-4" />;
  let guideTitle = arReady ? "Point camera at markers" : "Starting camera…";
  let guideDescription = isMultipoint
    ? "Slowly scan the space to locate the three position markers. Hold steady when a marker is in view."
    : "Point your camera at the QR marker on the table. Hold steady when the marker is in view.";

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

  // Use default example target if none provided
  const targetSrc =
    imageTargetSrc ||
    "https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/examples/image-tracking/assets/card-example/card.mind";

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Real camera feed via MindAR */}
      <MindARScene
        imageTargetSrc={targetSrc}
        modelUrl={modelUrl}
        maxTrack={isMultipoint ? 3 : 1}
        modelScale={modelScale}
        initialRotation={initialRotation}
        onTargetFound={(index) => {
          onTargetFound?.(index);
        }}
        onTargetLost={(index) => {
          onTargetLost?.(index);
        }}
        onReady={() => setArReady(true)}
        onError={(err) => {
          console.error("AR Error:", err);
          onError?.(err);
        }}
      />

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

      {/* Spacer */}
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
                {markers["QR"] !== "searching" ? <Check className="h-5 w-5" /> : "QR"}
              </div>
            </div>
          )}
        </div>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="w-full mt-3 text-center text-xs text-white/60 hover:text-white/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ARDetection;
