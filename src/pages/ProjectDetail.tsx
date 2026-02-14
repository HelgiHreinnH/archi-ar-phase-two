import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, User, Clock, Grid3X3 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import ModelUploader from "@/components/ModelUploader";
import ModelPreview from "@/components/ModelPreview";
import MarkerCoordinateEditor, { type MarkerData } from "@/components/MarkerCoordinateEditor";
import GenerateExperience from "@/components/GenerateExperience";

type Project = Tables<"projects">;

const modeConfig = {
  tabletop: {
    icon: Grid3X3,
    label: "Tabletop",
    badgeBg: "bg-blue-100 text-blue-700",
  },
  multipoint: {
    icon: MapPin,
    label: "Multi-Point",
    badgeBg: "bg-orange-100 text-orange-700",
  },
} as const;

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showUploader, setShowUploader] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Project;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Experience not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard/experiences")}>
          Back to experiences
        </Button>
      </div>
    );
  }

  const mode = project.mode === "tabletop" ? "tabletop" : "multipoint";
  const config = modeConfig[mode];
  const ModeIcon = config.icon;

  const markerData = project.marker_data as unknown as MarkerData | null;
  const hasModel = !!project.model_url;
  const hasValidMarkers = mode === "tabletop" || (
    !!markerData?.A && !!markerData?.B && !!markerData?.C &&
    (markerData.A.x !== 0 || markerData.A.y !== 0 || markerData.A.z !== 0 ||
     markerData.B.x !== 0 || markerData.B.y !== 0 || markerData.B.z !== 0 ||
     markerData.C.x !== 0 || markerData.C.y !== 0 || markerData.C.z !== 0)
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard/experiences")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-display text-3xl font-bold">{project.name}</h1>
              <Badge className={`text-xs gap-1 ${config.badgeBg} border-0`}>
                <ModeIcon className="h-3 w-3" />
                {config.label}
              </Badge>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                project.status === "active"
                  ? "bg-marker-green/10 text-marker-green"
                  : "bg-marker-yellow/10 text-marker-yellow"
              }`}
            >
              {project.status}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Experience Info */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display">Experience Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {project.description && <p className="text-muted-foreground">{project.description}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {project.client_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>{project.client_name}</span>
                </div>
              )}
              {project.location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{project.location}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Tabletop-specific info */}
            {mode === "tabletop" && (
              <div className="rounded-lg border bg-blue-50/30 p-4 mt-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Grid3X3 className="h-4 w-4 text-blue-600" />
                  Tabletop Settings
                </h3>
                <div className="grid gap-3 sm:grid-cols-3 text-sm">
                  <div>
                    <span className="text-muted-foreground block text-xs">Scale</span>
                    <span className="font-mono font-medium">{project.scale || "1:20"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">QR Size</span>
                    <span className="font-medium capitalize">{project.qr_size || "medium"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Rotation</span>
                    <span className="font-mono font-medium">{project.initial_rotation || 0}°</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3D Model */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">3D Model</CardTitle>
          </CardHeader>
          <CardContent>
            {project.model_url && !showUploader ? (
              <ModelPreview
                modelUrl={project.model_url}
                projectId={project.id}
                onReplace={() => setShowUploader(true)}
                onDelete={() => {
                  queryClient.invalidateQueries({ queryKey: ["project", id] });
                  setShowUploader(false);
                }}
              />
            ) : (
              <ModelUploader
                projectId={project.id}
                onUploadComplete={() => {
                  queryClient.invalidateQueries({ queryKey: ["project", id] });
                  setShowUploader(false);
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Marker Configuration — only for Multi-Point */}
      {mode === "multipoint" && (
        <MarkerCoordinateEditor
          projectId={project.id}
          markerData={markerData}
          onUpdate={() => queryClient.invalidateQueries({ queryKey: ["project", id] })}
        />
      )}

      {/* Generate AR Experience */}
      <GenerateExperience
        project={project}
        hasModel={hasModel}
        hasValidMarkers={hasValidMarkers}
        mode={mode}
        markerData={markerData}
        onGenerated={() => queryClient.invalidateQueries({ queryKey: ["project", id] })}
      />
    </div>
  );
};

export default ProjectDetail;
