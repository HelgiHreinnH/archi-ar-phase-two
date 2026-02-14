import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Share2, MapPin, User, Clock, Grid3X3 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import ModelUploader from "@/components/ModelUploader";
import ModelPreview from "@/components/ModelPreview";

type Project = Tables<"projects">;

const modeConfig = {
  tabletop: {
    icon: Grid3X3,
    label: "Tabletop",
    badgeBg: "bg-blue-100 text-blue-700",
    accent: "text-blue-600",
  },
  multipoint: {
    icon: MapPin,
    label: "Multi-Point",
    badgeBg: "bg-orange-100 text-orange-700",
    accent: "text-orange-600",
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

  const handleGenerateShareLink = async () => {
    if (!project) return;
    const shareId = crypto.randomUUID();
    const { error } = await supabase
      .from("projects")
      .update({ share_link: shareId, status: "active" })
      .eq("id", project.id);
    if (error) {
      toast({ title: "Error generating link", variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["project", id] });
    toast({ title: "Share link generated!", description: "Your client can now view the design in their space." });
  };

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

  const mode = (project as any).mode === "tabletop" ? "tabletop" : "multipoint";
  const config = modeConfig[mode];
  const ModeIcon = config.icon;

  return (
    <div className="space-y-6 animate-fade-in">
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleGenerateShareLink}>
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
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
                    <span className="font-mono font-medium">{(project as any).scale || "1:20"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">QR Size</span>
                    <span className="font-medium capitalize">{(project as any).qr_size || "medium"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Rotation</span>
                    <span className="font-mono font-medium">{(project as any).initial_rotation || 0}°</span>
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
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Marker Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              {["A", "B", "C"].map((label, i) => {
                const colors = ["bg-marker-red", "bg-marker-green", "bg-marker-blue"];
                const labels = ["Anchor Point", "Reference Point", "Reference Point"];
                return (
                  <div
                    key={label}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${colors[i]}`} />
                      <span className="font-display font-semibold">Point {label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{labels[i]}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {["X", "Y", "Z"].map((axis) => (
                        <div key={axis} className="text-center">
                          <span className="text-[10px] text-muted-foreground block">{axis}</span>
                          <span className="text-sm font-mono">0</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ProjectDetail;
