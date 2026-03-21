import { useState, useCallback } from "react";
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

type Project = Tables<"projects">;
type ViewerState = "landing" | "permission-denied" | "detecting" | "model-viewer";
type MarkerStatus = "searching" | "detected" | "locked";

const ARViewer = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const [viewState, setViewState] = useState<ViewerState>("landing");

  // Fetch project via rate-limited edge function, with direct query fallback
  const { data: project, isLoading, error } = useQuery({
    queryKey: ["public-project", shareId],
    queryFn: async () => {
      // Try edge function first (rate-limited, cached)
      try {
        const { data, error: fnError } = await supabase.functions.invoke("get-public-project", {
          body: { shareId },
        });
        if (!fnError && data) return data;
      } catch {
        // Edge function unavailable — fall back to direct query
      }

      // Fallback: direct PostgREST query
      const { data, error } = await supabase
        .from("projects")
        .select("name, description, client_name, model_url, mode, scale, marker_data, status, initial_rotation, mind_file_url, marker_image_urls, qr_code_url")
        .eq("share_link", shareId!)
        .eq("status", "active")
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!shareId,
  });

  // Parse marker data once project loads
  const markerData = project ? normalizeMarkerData(project.marker_data) : null;
  const isMultipoint = project?.mode !== "tabletop";
  const markerCount = isMultipoint ? (markerData?.length ?? 3) : 1;

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

  // Launch AR — different paths for tabletop (Model Viewer) vs multipoint (MindAR)
  const launchAR = useCallback(async () => {
    if (!isMultipoint) {
      // Tabletop: use native AR via <model-viewer> — no marker needed
      setViewState("model-viewer");
      return;
    }

    // Multi-point: request gyro permission, then launch MindAR detection
    try {
      const DOE = DeviceOrientationEvent as any;
      if (typeof DOE.requestPermission === "function") {
        await DOE.requestPermission();
      }
    } catch {
      // Silently ignore — gyro compensation will gracefully degrade
    }
    setMarkers(getInitialMarkers());
    setViewState("detecting");
  }, [isMultipoint, getInitialMarkers]);

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

  // Public URL for the 3D model (bucket is public — no auth needed)
  const publicModelUrl = (() => {
    if (!project?.model_url) return null;
    if (project.model_url.startsWith("http")) return project.model_url;
    const { data } = supabase.storage
      .from("project-models")
      .getPublicUrl(project.model_url);
    return data.publicUrl;
  })();

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

  const scaleNum = project.scale
    ? parseFloat(project.scale.split(":")[1]) || 1
    : 1;

  switch (viewState) {
    case "landing":
      return <ARLanding project={project} onLaunchAR={launchAR} />;

    case "permission-denied":
      return (
        <ARPermission
          onCancel={() => setViewState("landing")}
          onRetry={launchAR}
          errorMessage={arErrorMessage}
        />
      );

    case "model-viewer":
      // Tabletop: native AR via <model-viewer> — walk-around SLAM, no marker
      if (project.model_url && isSignedUrlLoading) {
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
          modelUrl={signedModelUrl || ""}
          project={project}
          onBack={() => setViewState("landing")}
        />
      );

    case "detecting":
      // Multi-point: MindAR marker-based detection
      if (project.model_url && isSignedUrlLoading) {
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
          onTargetFound={handleTargetFound}
          onTargetLost={handleTargetLost}
          onCancel={() => setViewState("landing")}
          onExit={() => setViewState("landing")}
          onReset={handleReset}
          onError={(err) => handleARError(err)}
          imageTargetSrc={project.mind_file_url || undefined}
          modelUrl={signedModelUrl}
          modelScale={scaleNum}
          initialRotation={project.initial_rotation || 0}
          project={project}
          markerData={markerData}
        />
      );
  }
};

export default ARViewer;
