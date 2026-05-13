import { useEffect, useState, useRef } from "react";
// Phase 3.3 — Lazy-load <model-viewer>. The multi-point AR path never uses it
// (it goes through XR8/MindAR), so keeping ~200KB out of that bundle is free.
import { ArrowLeft, Box, Info, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelViewerSceneProps {
  modelUrl: string;
  project: {
    name: string;
    description?: string | null;
    scale?: string | null;
  };
  onBack: () => void;
}

/**
 * Tabletop AR experience using Google's <model-viewer> web component.
 * Provides:
 * - 3D model preview with orbit controls
 * - Native AR via ARKit Quick Look (iOS) and Scene Viewer (Android)
 * - No printed marker needed — uses device SLAM for surface detection
 */
const LOAD_TIMEOUT_MS = 25_000;

const ModelViewerScene = ({ modelUrl, project, onBack }: ModelViewerSceneProps) => {
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [mvReady, setMvReady] = useState(typeof window !== "undefined" && !!customElements.get("model-viewer"));
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const mvRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mvReady) return;
    let cancelled = false;
    import("@google/model-viewer")
      .then(() => { if (!cancelled) setMvReady(true); })
      .catch((err) => {
        if (cancelled) return;
        console.error("[ModelViewerScene] Failed to load <model-viewer> module:", err);
        setLoadState("error");
        setErrorDetail("Failed to load the 3D engine. Check your connection and try again.");
      });
    return () => { cancelled = true; };
  }, [mvReady]);

  // Wire load/error/timeout handlers onto the model-viewer element so the user
  // gets a real error UI instead of an indefinite spinner if the GLB stalls.
  useEffect(() => {
    if (!mvReady) return;
    const el = mvRef.current;
    if (!el) return;

    setLoadState("loading");
    setErrorDetail(null);

    const onLoad = () => {
      console.log("[ModelViewerScene] model loaded");
      setLoadState("loaded");
    };
    const onError = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      console.error("[ModelViewerScene] model-viewer error:", detail);
      setErrorDetail(
        typeof detail === "object" && detail && "type" in detail
          ? `Model failed to load (${(detail as { type: string }).type}).`
          : "Model failed to load."
      );
      setLoadState("error");
    };

    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);

    const timeout = window.setTimeout(() => {
      setLoadState((prev) => {
        if (prev === "loading") {
          console.warn("[ModelViewerScene] load timeout after", LOAD_TIMEOUT_MS, "ms");
          setErrorDetail("The 3D model is taking too long to load. Check your connection.");
          return "error";
        }
        return prev;
      });
    }, LOAD_TIMEOUT_MS);

    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
      window.clearTimeout(timeout);
    };
  }, [mvReady, modelUrl, retryKey]);

  // Track A — release the model-viewer's internal Three.js renderer/textures
  // on unmount so navigating between experiences doesn't stack GPU memory.
  useEffect(() => {
    return () => {
      const el = mvRef.current as (HTMLElement & { src?: string }) | null;
      if (!el) return;
      try { el.removeAttribute("src"); } catch { /* noop */ }
    };
  }, []);

  const handleRetry = () => {
    setLoadState("loading");
    setErrorDetail(null);
    setRetryKey((k) => k + 1);
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-4 py-3 border-b bg-card">
        <button
          onClick={onBack}
          className="h-9 w-9 rounded-full bg-muted flex items-center justify-center hover:bg-accent transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-semibold text-sm truncate">{project.name}</h1>
          {project.scale && (
            <p className="text-xs text-muted-foreground">Scale: {project.scale}</p>
          )}
        </div>
        <button
          onClick={() => setInfoExpanded(!infoExpanded)}
          className="h-9 w-9 rounded-full bg-muted flex items-center justify-center hover:bg-accent transition-colors"
          aria-label="Info"
        >
          <Info className="h-4 w-4" />
        </button>
      </header>

      {/* Info panel */}
      {infoExpanded && project.description && (
        <div className="relative z-10 px-4 py-3 bg-card border-b">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {project.description}
          </p>
        </div>
      )}

      {/* Model Viewer — fills remaining space */}
      <div className="flex-1 relative">
        {!mvReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <div className="text-center space-y-3">
              <Box className="h-10 w-10 text-muted-foreground/40 mx-auto animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading 3D engine…</p>
            </div>
          </div>
        ) : (
        <model-viewer
          key={retryKey}
          ref={mvRef as React.MutableRefObject<any>}
          src={modelUrl}
          crossOrigin="anonymous"
          ar
          ar-modes="webxr scene-viewer quick-look"
          ar-scale="auto"
          ar-placement="floor"
          camera-controls
          auto-rotate
          shadow-intensity="1"
          shadow-softness="1"
          environment-image="neutral"
          exposure="1"
          interaction-prompt="auto"
          loading="eager"
          alt={`3D model of ${project.name}`}
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            inset: 0,
            "--poster-color": "transparent",
          } as React.CSSProperties}
        >
          {/* Custom AR button */}
          <button
            slot="ar-button"
            className={cn(
              "absolute bottom-6 left-1/2 -translate-x-1/2",
              "px-6 py-3 rounded-full",
              "bg-primary text-primary-foreground",
              "font-display font-semibold text-sm",
              "shadow-lg shadow-primary/30",
              "flex items-center gap-2",
              "active:scale-95 transition-transform"
            )}
          >
            <Box className="h-4 w-4" />
            View in AR
          </button>

          {/* Loading poster */}
          <div slot="poster" className="flex items-center justify-center w-full h-full bg-muted">
            <div className="text-center space-y-3">
              <Box className="h-10 w-10 text-muted-foreground/40 mx-auto animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading 3D model…</p>
            </div>
          </div>
        </model-viewer>
        )}

        {/* Error overlay — shown when load fails or times out */}
        {loadState === "error" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/95 p-6 animate-fade-in">
            <div className="max-w-sm text-center space-y-4">
              <Box className="h-12 w-12 text-destructive mx-auto" />
              <div className="space-y-2">
                <h2 className="font-display text-lg font-semibold">Couldn't load 3D model</h2>
                <p className="text-sm text-muted-foreground">
                  {errorDetail ?? "Something went wrong while preparing the model."}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleRetry}
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Try again
                </button>
                <button
                  onClick={onBack}
                  className="w-full h-10 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <footer className="relative z-10 px-4 py-3 border-t bg-card">
        <p className="text-center text-xs text-muted-foreground">
          Drag to orbit · Pinch to zoom · Tap "View in AR" to place in your space
        </p>
      </footer>
    </div>
  );
};

export default ModelViewerScene;
