import { useEffect, useState } from "react";
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
const ModelViewerScene = ({ modelUrl, project, onBack }: ModelViewerSceneProps) => {
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [mvReady, setMvReady] = useState(typeof window !== "undefined" && !!customElements.get("model-viewer"));

  useEffect(() => {
    if (mvReady) return;
    let cancelled = false;
    import("@google/model-viewer").then(() => { if (!cancelled) setMvReady(true); });
    return () => { cancelled = true; };
  }, [mvReady]);

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
        <model-viewer
          src={modelUrl}
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
            // Use CSS custom properties for theming
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
