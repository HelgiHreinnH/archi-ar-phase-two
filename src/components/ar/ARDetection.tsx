import { useState, useEffect, useRef } from "react";
import { ChevronDown, MapPin, Target, Check, Loader2, Info, Camera, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import MindARScene from "./MindARScene";
import XR8Scene from "./XR8Scene";
import { type MarkerPoint, getMarkerColor } from "@/lib/markerTypes";
import { buildAssetKey, getCachedAsset, setCachedAsset } from "@/lib/assetCache";

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
  project?: { name: string; description?: string | null; share_link?: string | null; updated_at?: string | null };
  markerData?: MarkerPoint[] | null;
  /** Tracking format — determines which AR engine to use */
  trackingFormat?: string;
  /** Share UUID — used as part of the persistent asset cache key */
  shareId?: string;
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
  shareId,
}: ARDetectionProps) => {
  const useXR8 = trackingFormat === "8thwall-wtc";
  const [guideExpanded, setGuideExpanded] = useState(true);
  const [arReady, setArReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [gestureHint, setGestureHint] = useState(false);

  // ── Prefetch GLB *and* tracking file in parallel, with Phase 4 IDB cache ──
  const [prefetchedModel, setPrefetchedModel] = useState<ArrayBuffer | null>(null);
  const [prefetchProgress, setPrefetchProgress] = useState<number | null>(null);
  const prefetchStarted = useRef(false);

  // Phase 4.1 — Stable cache invalidation token. We prefer project.updated_at
  // (changes on republish) and fall back to a daily bucket so the cache still
  // self-heals if the field is missing.
  const cacheToken = (project?.updated_at ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9a-zA-Z]/g, "");
  const modelCacheKey = shareId ? buildAssetKey(shareId, "model", cacheToken) : null;
  const trackingCacheKey = shareId ? buildAssetKey(shareId, "tracking", cacheToken) : null;

  useEffect(() => {
    if (prefetchStarted.current) return;
    if (!modelUrl && !imageTargetSrc) return;
    prefetchStarted.current = true;

    const ac = new AbortController();

    // Tracking file (.mind/.wtc): try IDB first, then network warm.
    if (imageTargetSrc) {
      (async () => {
        if (trackingCacheKey) {
          const cached = await getCachedAsset(trackingCacheKey);
          if (cached) {
            console.log("[ARDetection] Tracking file served from IDB cache.");
            return;
          }
        }
        try {
          const res = await fetch(imageTargetSrc, { signal: ac.signal, cache: "force-cache" });
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          if (trackingCacheKey) await setCachedAsset(trackingCacheKey, buf);
        } catch { /* non-fatal */ }
      })();
    }

    // GLB: stream from network with progress, OR pull from IDB instantly.
    if (modelUrl) {
      (async () => {
        try {
          if (modelCacheKey) {
            const cached = await getCachedAsset(modelCacheKey);
            if (cached) {
              setPrefetchProgress(100);
              setPrefetchedModel(cached);
              console.log(
                `[ARDetection] GLB served from IDB cache (${(cached.byteLength / 1024 / 1024).toFixed(1)} MB)`
              );
              return;
            }
          }

          const res = await fetch(modelUrl, { signal: ac.signal });
          if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);

          const totalHeader = res.headers.get("content-length");
          const total = totalHeader ? Number(totalHeader) : 0;

          if (!res.body || typeof res.body.getReader !== "function") {
            const buffer = await res.arrayBuffer();
            setPrefetchProgress(100);
            setPrefetchedModel(buffer);
            if (modelCacheKey) await setCachedAsset(modelCacheKey, buffer);
            return;
          }

          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          let lastReported = -1;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              if (total > 0) {
                const pct = Math.min(99, Math.round((received / total) * 100));
                if (pct !== lastReported) {
                  lastReported = pct;
                  setPrefetchProgress(pct);
                }
              }
            }
          }

          const buffer = new Uint8Array(received);
          let offset = 0;
          for (const c of chunks) {
            buffer.set(c, offset);
            offset += c.length;
          }
          setPrefetchProgress(100);
          setPrefetchedModel(buffer.buffer);
          if (modelCacheKey) {
            await setCachedAsset(modelCacheKey, buffer.buffer);
          }
          console.log(
            `[ARDetection] GLB prefetched (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`
          );
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          console.warn("[ARDetection] GLB prefetch failed, will fall back to URL loading:", err);
        }
      })();
    }

    return () => ac.abort();
  }, [modelUrl, imageTargetSrc, modelCacheKey, trackingCacheKey]);

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

  // Track the most recently detected markers so we can suggest the spatially
  // nearest un-detected one (better guidance than always pointing at the lowest #).
  const [recentDetections, setRecentDetections] = useState<number[]>([]);
  const prevMarkersRef = useRef<Record<string, MarkerStatus>>({});
  useEffect(() => {
    const prev = prevMarkersRef.current;
    const newlyFound: number[] = [];
    for (const [k, status] of Object.entries(markers)) {
      if (status !== "searching" && prev[k] === "searching") {
        const n = parseInt(k);
        if (!isNaN(n)) newlyFound.push(n);
      }
    }
    if (newlyFound.length > 0) {
      setRecentDetections((r) => [...newlyFound, ...r].slice(0, 3));
    }
    prevMarkersRef.current = markers;
  }, [markers]);

  // Determine the next un-detected marker — prefer spatial proximity to the
  // last detection(s) when we have marker coordinates, else fall back to
  // lowest-numbered remaining marker.
  const undetectedNumbers = isMultipoint
    ? Object.entries(markers)
        .filter(([, s]) => s === "searching")
        .map(([k]) => parseInt(k))
        .filter((n) => !isNaN(n))
    : [];

  const distance3D = (a: MarkerPoint, b: MarkerPoint) => {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  let nextUndetected: number | undefined;
  if (undetectedNumbers.length > 0) {
    const anchorIdx = recentDetections[0];
    const anchor = markerData?.find((m) => m.index === anchorIdx);
    if (anchor && markerData) {
      // Pick the spatially nearest un-detected marker to the latest detection
      let best: { idx: number; d: number } | null = null;
      for (const n of undetectedNumbers) {
        const mp = markerData.find((m) => m.index === n);
        if (!mp) continue;
        const d = distance3D(anchor, mp);
        if (!best || d < best.d) best = { idx: n, d };
      }
      nextUndetected = best?.idx ?? undetectedNumbers.sort((a, b) => a - b)[0];
    } else {
      nextUndetected = undetectedNumbers.sort((a, b) => a - b)[0];
    }
  }
  const nextMarkerColor = nextUndetected != null ? getMarkerColor(nextUndetected) : null;
  const anchorColor = recentDetections[0] != null ? getMarkerColor(recentDetections[0]) : null;
  const hasSpatialHint = !!(anchorColor && markerData?.find((m) => m.index === recentDetections[0]) && markerData?.find((m) => m.index === nextUndetected));

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
    if (totalMarkers > 6 && nextUndetected != null && nextMarkerColor) {
      guideDescription = hasSpatialHint && anchorColor
        ? `${detectedCount} of ${totalMarkers} detected. Look near the ${anchorColor.name} marker for marker #${nextUndetected} (${nextMarkerColor.name}).`
        : `${detectedCount} of ${totalMarkers} detected. Scan marker #${nextUndetected} (${nextMarkerColor.name}) next.`;
    } else {
      guideDescription = `${detectedCount} of ${totalMarkers} markers detected. Keep scanning for the remaining markers.`;
    }
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
              {/* Phase 1.4 — real GLB download progress */}
              {prefetchProgress != null && prefetchProgress < 100 && !prefetchedModel && (
                <div className="mt-3 space-y-1.5">
                  <Progress value={prefetchProgress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground">
                    Downloading 3D model… {prefetchProgress}%
                  </p>
                </div>
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

            {/* Skip CTA — Procrustes only needs 3 markers, no point forcing the user to walk to all N */}
            {isMultipoint && totalMarkers > 3 && detectedCount >= 3 && !allDetected && (
              <button
                onClick={() => {
                  setIsActive(true);
                  onAllDetected?.();
                }}
                className="w-full mt-3 rounded-xl bg-primary/90 hover:bg-primary text-white text-xs font-medium py-2.5 transition-colors backdrop-blur-sm"
              >
                Skip — I have {detectedCount} of {totalMarkers} (3 is enough)
              </button>
            )}

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
