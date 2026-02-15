import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import ARLanding from "@/components/ar/ARLanding";
import ARPermission from "@/components/ar/ARPermission";
import ARDetection from "@/components/ar/ARDetection";
import ARActiveView from "@/components/ar/ARActiveView";

type Project = Tables<"projects">;
type ViewerState = "landing" | "permission-denied" | "detecting" | "active";
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

  // Request camera access
  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      stream.getTracks().forEach((t) => t.stop());
      setViewState("detecting");
    } catch {
      setViewState("permission-denied");
    }
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

  // Transition to active when all markers detected
  const handleAllDetected = useCallback(() => {
    setViewState("active");
  }, []);

  const handleLaunchAR = () => {
    requestCamera();
  };

  const handleReset = () => {
    setMarkers({ A: "searching", B: "searching", C: "searching" });
    setViewState("detecting");
  };

  const handleARError = useCallback(() => {
    setViewState("permission-denied");
  }, []);

  // Resolve the model URL (generate signed URL for Supabase storage)
  const { data: signedModelUrl } = useQuery({
    queryKey: ["signed-model-url", project?.model_url],
    queryFn: async () => {
      if (!project?.model_url) return null;
      // If it's already a full URL, use it directly
      if (project.model_url.startsWith("http")) return project.model_url;
      // Otherwise generate a signed URL from Supabase storage
      const { data, error } = await supabase.storage
        .from("models")
        .createSignedUrl(project.model_url, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!project?.model_url && viewState === "detecting",
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
  const scaleNum = project.scale ? parseFloat(project.scale.replace(/[^0-9.]/g, "")) || 1 : 1;

  switch (viewState) {
    case "landing":
      return <ARLanding project={project} onLaunchAR={handleLaunchAR} />;

    case "permission-denied":
      return (
        <ARPermission
          onCancel={() => setViewState("landing")}
          onRetry={requestCamera}
        />
      );

    case "detecting":
      return (
        <ARDetection
          mode={project.mode}
          markers={markers}
          onTargetFound={handleTargetFound}
          onTargetLost={handleTargetLost}
          onAllDetected={handleAllDetected}
          onCancel={() => setViewState("landing")}
          onError={handleARError}
          imageTargetSrc={project.mind_file_url || undefined}
          modelUrl={signedModelUrl}
          modelScale={scaleNum}
          initialRotation={project.initial_rotation || 0}
        />
      );

    case "active":
      return (
        <ARActiveView
          project={project}
          onReset={handleReset}
          onExit={() => setViewState("landing")}
        />
      );
  }
};

export default ARViewer;
