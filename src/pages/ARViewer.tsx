import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { normalizeMarkerData } from "@/lib/markerTypes";
import ARLanding from "@/components/ar/ARLanding";
import ARPermission from "@/components/ar/ARPermission";
import ARDetection from "@/components/ar/ARDetection";
import ModelViewerScene from "@/components/ar/ModelViewerScene";
import ModelUnavailableRecovery from "@/components/ar/ModelUnavailableRecovery";

type Project = Tables<"projects">;
type ViewerState = "landing" | "briefing" | "permission-denied" | "detecting" | "model-viewer";
type MarkerStatus = "searching" | "detected" | "locked";

const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
const dlog = (...args: unknown[]) => { if (DEBUG) console.log("[ar-flow]", ...args); };

const ARViewer = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const [viewState, setViewState] = useState<ViewerState>("landing");

  // Fetch project via rate-limited edge function, with direct query fallback
  // Phase 4.2 — sessionStorage cache for the get-public-project response.
  // Signed URLs live 2h; we cache for 10min to bound staleness while still
  // eliminating the edge-fn round-trip on internal navigation/refresh.
  const PUBLIC_PROJECT_CACHE_TTL_MS = 10 * 60 * 1000;
  const sessionCacheKey = shareId ? `archi-pp::${shareId}` : null;

  const { data: projectResponse, isLoading, error, refetch } = useQuery({
    queryKey: ["public-project", shareId],
    queryFn: async () => {
      // Try sessionStorage first
      if (sessionCacheKey && typeof sessionStorage !== "undefined") {
        try {
          const raw = sessionStorage.getItem(sessionCacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { at: number; data: unknown };
            if (Date.now() - parsed.at < PUBLIC_PROJECT_CACHE_TTL_MS) {
              dlog("public-project served from sessionStorage");
              return parsed.data;
            }
          }
        } catch { /* ignore parse errors */ }
      }

      const { data, error: fnError } = await supabase.functions.invoke("get-public-project", {
        body: { shareId },
      });
      if (fnError || !data) throw new Error("Experience not found or unavailable");

      if (sessionCacheKey && typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem(sessionCacheKey, JSON.stringify({ at: Date.now(), data }));
        } catch { /* quota — ignore */ }
      }
      return data;
    },
    enabled: !!shareId && shareId !== ":shareId" && /^[0-9a-f-]{36}$/i.test(shareId),
  });

  // Edge function may now return { project: null, reason } for invalid links — normalize
  const project = (projectResponse && projectResponse.project === null)
    ? null
    : projectResponse;
  const modelUrlError: string | null = project?.model_url_error ?? null;

  // Parse marker data once project loads
  const markerData = project ? normalizeMarkerData(project.marker_data) : null;
  const isMultipoint = project?.mode !== "tabletop";
  const markerCount = isMultipoint ? (markerData?.length ?? 3) : 1;
  const trackingFormat = project?.tracking_format || "mindar-mind";
  const trackingFileUrl = project?.tracking_file_url || null;

  // Dynamic marker status state
  const [markers, setMarkers] = useState<Record<string, MarkerStatus>>({});

  // Initialize markers when project loads
  const getInitialMarkers = useCallback((): Record<string, MarkerStatus> => {
    const m: Record<string, MarkerStatus> = {};
    if (isMultipoint && markerData) {
      for (const mp of markerData) m[String(mp.index)] = "searching";
    } else if (isMultipoint) {
      for (let i = 1; i <= 3; i++) m[String(i)] = "searching";
    } else {
      m["QR"] = "searching";
    }
    return m;
  }, [isMultipoint, markerData]);

  // Launch AR — refresh signed URLs first (they're 2h-lived, but a stale tab could still bite)
  const launchAR = useCallback(async () => {
    setViewState("briefing");
    dlog("launchAR — refetching signed URLs");

    try {
      // Bust the sessionStorage cache so we get fresh signed URLs at launch
      if (sessionCacheKey && typeof sessionStorage !== "undefined") {
        try { sessionStorage.removeItem(sessionCacheKey); } catch { /* ignore */ }
      }
      await refetch();
    } catch (e) {
      dlog("refetch failed (will continue with cached URLs):", e);
    }

    // Brief pause for the briefing screen, then start AR
    setTimeout(async () => {
      if (!isMultipoint) {
        // Tabletop: use native AR via <model-viewer> — no marker needed
        dlog("launchAR → model-viewer (tabletop)");
        setViewState("model-viewer");
        return;
      }

      // Multi-point: request gyro permission, then launch detection
      try {
        const DOE = DeviceOrientationEvent as any;
        if (typeof DOE.requestPermission === "function") {
          await DOE.requestPermission();
        }
      } catch {
        // Silently ignore — gyro compensation will gracefully degrade
      }
      setMarkers(getInitialMarkers());
      dlog("launchAR → detecting (multipoint)", { markerCount });
      setViewState("detecting");
    }, 2000);
  }, [isMultipoint, getInitialMarkers, refetch, markerCount]);

  const handleTargetFound = useCallback((index: number) => {
    if (isMultipoint) {
      const key = markerData ? String(markerData[index]?.index ?? index + 1) : String(index + 1);
      setMarkers((prev) => ({ ...prev, [key]: "detected" }));
    } else {
      setMarkers((prev) => ({ ...prev, QR: "detected" }));
    }
  }, [isMultipoint, markerData]);

  const handleTargetLost = useCallback((index: number) => {
    if (isMultipoint) {
      const key = markerData ? String(markerData[index]?.index ?? index + 1) : String(index + 1);
      setMarkers((prev) => ({ ...prev, [key]: "searching" }));
    } else {
      setMarkers((prev) => ({ ...prev, QR: "searching" }));
    }
  }, [isMultipoint, markerData]);

  const [resetKey, setResetKey] = useState(0);

  const handleReset = useCallback(() => {
    setMarkers(getInitialMarkers());
    setResetKey((k) => k + 1);
  }, [getInitialMarkers]);

  const [arErrorMessage, setArErrorMessage] = useState<string | null>(null);

  const handleARError = useCallback((err?: Error) => {
    setArErrorMessage(err?.message || "Camera access was denied.");
    setViewState("permission-denied");
  }, []);

  // Determine which image target source to use based on tracking format
  const imageTargetSrc = trackingFormat === "8thwall-wtc"
    ? (trackingFileUrl || undefined)
    : (project?.mind_file_url || undefined);

  // Model URL comes pre-signed from the edge function (buckets are private)
  const publicModelUrl = project?.model_url || null;

  // --- Silent exponential-backoff retry when the signed model URL is missing ---
  // Avoids flashing the recovery UI for transient signing failures (cold edge fn,
  // brief storage hiccup, etc.). Sequence: 0.5s → 1s → 2s → 4s → 8s (max 5 tries).
  const MAX_BACKOFF_ATTEMPTS = 5;
  const [backoffAttempt, setBackoffAttempt] = useState(0);
  const [backoffExhausted, setBackoffExhausted] = useState(false);
  const backoffTimer = useRef<number | null>(null);

  const needsBackoff = !!project && !!project.model_url && !publicModelUrl && !modelUrlError;

  useEffect(() => {
    // Reset backoff whenever the URL becomes available or the project changes
    if (publicModelUrl) {
      if (backoffTimer.current) window.clearTimeout(backoffTimer.current);
      if (backoffAttempt !== 0) setBackoffAttempt(0);
      if (backoffExhausted) setBackoffExhausted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicModelUrl, project?.id]);

  useEffect(() => {
    if (!needsBackoff || backoffExhausted) return;
    if (backoffAttempt >= MAX_BACKOFF_ATTEMPTS) {
      setBackoffExhausted(true);
      dlog("backoff exhausted — falling back to recovery UI");
      return;
    }
    const delay = 500 * Math.pow(2, backoffAttempt); // 500, 1000, 2000, 4000, 8000
    dlog(`backoff retry #${backoffAttempt + 1} in ${delay}ms`);
    backoffTimer.current = window.setTimeout(async () => {
      try {
        await refetch();
      } catch (e) {
        dlog("backoff refetch failed", e);
      }
      setBackoffAttempt((n) => n + 1);
    }, delay);
    return () => {
      if (backoffTimer.current) window.clearTimeout(backoffTimer.current);
    };
  }, [needsBackoff, backoffAttempt, backoffExhausted, refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading AR experience…</p>
        </div>
      </div>
    );
  }

  const isModelReady = !!publicModelUrl;

  if (error || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-4 max-w-sm">
          <AlertTriangle className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <h1 className="font-display text-xl font-bold">Experience Not Found</h1>
          <p className="text-sm text-muted-foreground">
            This AR experience may have been removed or the link is invalid.
          </p>
        </div>
      </div>
    );
  }

  // Project loaded but the model URL could not be signed — surface a guided recovery flow
  // Only after the silent backoff retry sequence has been exhausted, to avoid flashing
  // the error UI for transient signing failures.
  if (modelUrlError || (project.model_url && !publicModelUrl)) {
    if (!modelUrlError && !backoffExhausted) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground text-sm">Preparing your AR experience…</p>
            {DEBUG && (
              <p className="text-[10px] text-muted-foreground/60 font-mono">
                signing retry {backoffAttempt}/{MAX_BACKOFF_ATTEMPTS}
              </p>
            )}
          </div>
        </div>
      );
    }
    return (
      <ModelUnavailableRecovery
        shareId={shareId ?? ""}
        projectName={project.name}
        errorDetail={modelUrlError}
        onRetry={async () => {
          dlog("ModelUnavailableRecovery → manual retry");
          setBackoffAttempt(0);
          setBackoffExhausted(false);
          await refetch();
        }}
      />
    );
  }

  const scaleNum = project.scale
    ? parseFloat(project.scale.split(":")[1]) || 1
    : 1;

  switch (viewState) {
    case "landing":
      return <ARLanding project={project} onLaunchAR={launchAR} />;

    case "briefing":
      return (
        <div className="fixed inset-0 bg-background flex items-center justify-center p-6">
          <div className="text-center space-y-4 max-w-sm animate-fade-in">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <h2 className="font-display text-xl font-bold">{project.name}</h2>
            {project.client_name && (
              <p className="text-sm text-muted-foreground">by {project.client_name}</p>
            )}
            <p className="text-xs text-muted-foreground">Preparing your AR experience…</p>
          </div>
        </div>
      );

    case "permission-denied":
      return (
        <ARPermission
          onCancel={() => setViewState("landing")}
          onRetry={launchAR}
          errorMessage={arErrorMessage}
        />
      );

    case "model-viewer":
      if (!isModelReady) {
        return (
          <div className="fixed inset-0 bg-background flex items-center justify-center">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground text-sm">Preparing 3D model…</p>
            </div>
          </div>
        );
      }
      return (
        <ModelViewerScene
          modelUrl={publicModelUrl || ""}
          project={project}
          onBack={() => setViewState("landing")}
        />
      );

    case "detecting":
      if (!isModelReady) {
        return (
          <div className="fixed inset-0 bg-black flex items-center justify-center">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-white/70 mx-auto" />
              <p className="text-white/50 text-sm">Preparing AR model…</p>
            </div>
          </div>
        );
      }
      return (
        <ARDetection
          key={resetKey}
          mode={project.mode}
          markers={markers}
          markerCount={markerCount}
          trackingFormat={trackingFormat}
          onTargetFound={handleTargetFound}
          onTargetLost={handleTargetLost}
          onCancel={() => setViewState("landing")}
          onExit={() => setViewState("landing")}
          onReset={handleReset}
          onError={(err) => handleARError(err)}
          imageTargetSrc={imageTargetSrc}
          modelUrl={publicModelUrl}
          modelScale={scaleNum}
          initialRotation={project.initial_rotation || 0}
          project={project}
          markerData={markerData}
          shareId={shareId}
        />
      );
  }
};

export default ARViewer;
