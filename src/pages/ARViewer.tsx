import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import ARLanding from "@/components/ar/ARLanding";
import ARPermission from "@/components/ar/ARPermission";
import ARDetection from "@/components/ar/ARDetection";

type Project = Tables<"projects">;
type ViewerState = "landing" | "permission-denied" | "detecting";
type MarkerStatus = "searching" | "detected" | "locked";

const ARViewer = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const [viewState, setViewState] = useState<ViewerState>("landing");
  const [markers, setMarkers] = useState<Record<string, MarkerStatus>>({
    A: "searching",
    B: "searching",
    C: "searching",
  });

  const { data: project, isLoading, error } = useQuery({
    queryKey: ["public-project", shareId],
    queryFn: async () => {
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

  // Go straight to detecting – let MindAR request the camera in a single
  // getUserMedia call.  A double request (pre-check then MindAR) breaks on
  // mobile Safari because the second call loses the user-gesture context.
  const launchDetecting = useCallback(() => {
    setViewState("detecting");
  }, []);

  // MindAR target found callback — update marker status
  const handleTargetFound = useCallback((index: number) => {
    const isMultipoint = project?.mode !== "tabletop";
    if (isMultipoint) {
      const markerIds = ["A", "B", "C"];
      const markerId = markerIds[index];
      if (markerId) {
        setMarkers((prev) => ({ ...prev, [markerId]: "detected" }));
      }
    } else {
      setMarkers((prev) => ({ ...prev, QR: "detected" }));
    }
  }, [project?.mode]);

  const handleTargetLost = useCallback((index: number) => {
    const isMultipoint = project?.mode !== "tabletop";
    if (isMultipoint) {
      const markerIds = ["A", "B", "C"];
      const markerId = markerIds[index];
      if (markerId) {
        setMarkers((prev) => ({ ...prev, [markerId]: "searching" }));
      }
    } else {
      setMarkers((prev) => ({ ...prev, QR: "searching" }));
    }
  }, [project?.mode]);

  const handleLaunchAR = () => {
    launchDetecting();
  };

  const [resetKey, setResetKey] = useState(0);

  // True reset: bump resetKey to remount ARDetection + MindARScene entirely.
  // This is wired to the reset button in the active phase so the user can
  // re-anchor the model from scratch without leaving the AR session.
  const handleReset = useCallback(() => {
    setMarkers({ A: "searching", B: "searching", C: "searching" });
    setResetKey((k) => k + 1);
  }, []);

  const [arErrorMessage, setArErrorMessage] = useState<string | null>(null);

  const handleARError = useCallback((err?: Error) => {
    setArErrorMessage(err?.message || "Camera access was denied.");
    setViewState("permission-denied");
  }, []);

  // Resolve the model URL as soon as the project loads — NOT gated on viewState.
  // If we wait until "detecting" to fetch this, MindARScene mounts before the URL
  // is ready, modelUrl is null on mount, and the GLB is never loaded.
  const { data: signedModelUrl, isLoading: isSignedUrlLoading } = useQuery({
    queryKey: ["signed-model-url", project?.model_url],
    queryFn: async () => {
      if (!project?.model_url) return null;
      // If it's already a full URL, use it directly
      if (project.model_url.startsWith("http")) return project.model_url;
      // Otherwise generate a signed URL from Supabase storage
      const { data, error } = await supabase.storage
        .from("project-models")
        .createSignedUrl(project.model_url, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!project?.model_url,
  });

  // Loading state
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

  // Error state
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

  // Parse scale to a number
  // Extract the denominator from "1:N" format (e.g. "1:50" → 50, "1:1" → 1)
  const scaleNum = project.scale
    ? parseFloat(project.scale.split(":")[1]) || 1
    : 1;

  switch (viewState) {
    case "landing":
      return <ARLanding project={project} onLaunchAR={handleLaunchAR} />;

    case "permission-denied":
      return (
        <ARPermission
          onCancel={() => setViewState("landing")}
          onRetry={launchDetecting}
          errorMessage={arErrorMessage}
        />
      );

    case "detecting":
      // Gate MindARScene on the signed URL being ready.
      // Without this guard, MindARScene mounts with modelUrl=undefined and
      // the GLB load is skipped entirely with no retry path.
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
        />
      );
  }
};

export default ARViewer;
