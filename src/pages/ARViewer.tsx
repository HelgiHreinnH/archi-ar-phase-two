import { useState, useCallback, useEffect } from "react";
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
        .select("name, description, client_name, model_url, mode, scale, marker_data, status")
        .eq("share_link", shareId!)
        .eq("status", "active")
        .single();
      if (error) throw error;
      return data as Pick<Project, "name" | "description" | "client_name" | "model_url" | "mode" | "scale" | "marker_data" | "status">;
    },
    enabled: !!shareId,
  });

  // Request camera access
  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      // Got access — stop preview stream and move to detection
      stream.getTracks().forEach((t) => t.stop());
      setViewState("detecting");
    } catch {
      setViewState("permission-denied");
    }
  }, []);

  // Simulate marker detection for demo purposes
  // In production, MindAR.js would drive these state changes
  useEffect(() => {
    if (viewState !== "detecting") return;

    const isMultipoint = project?.mode !== "tabletop";
    const markerIds = isMultipoint ? ["A", "B", "C"] : ["QR"];
    let idx = 0;

    const interval = setInterval(() => {
      if (idx < markerIds.length) {
        setMarkers((prev) => ({ ...prev, [markerIds[idx]]: "detected" }));
        idx++;
      } else {
        clearInterval(interval);
        // All detected — transition to active after a brief pause
        setTimeout(() => setViewState("active"), 800);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [viewState, project?.mode]);

  const handleLaunchAR = () => {
    requestCamera();
  };

  const handleReset = () => {
    setMarkers({ A: "searching", B: "searching", C: "searching" });
    setViewState("detecting");
  };

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
          onAllDetected={() => setViewState("active")}
          onCancel={() => setViewState("landing")}
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
