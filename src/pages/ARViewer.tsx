import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, Box, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

const ARViewer = () => {
  const { shareId } = useParams<{ shareId: string }>();

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading AR experience...</p>
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
            This AR experience may have been removed or the link is invalid. Please ask the designer for a new link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Box className="h-6 w-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg truncate">{project.name}</h1>
            {project.client_name && (
              <p className="text-xs text-muted-foreground truncate">For {project.client_name}</p>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-lg mx-auto p-6 space-y-6">
        {project.description && (
          <p className="text-sm text-muted-foreground">{project.description}</p>
        )}

        {/* AR Launch Instructions */}
        <div className="rounded-xl border-2 border-dashed border-primary/30 p-8 text-center space-y-4">
          <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold mb-1">View in AR</h2>
            <p className="text-sm text-muted-foreground">
              {project.mode === "tabletop"
                ? "Point your camera at the QR marker on the table to see the design appear."
                : "Point your camera at any of the 3 colored markers placed in the room to view the design at full scale."}
            </p>
          </div>
          <Button size="lg" className="w-full" disabled>
            <Smartphone className="mr-2 h-4 w-4" />
            Launch AR Camera
            <span className="ml-2 text-xs opacity-60">(Coming soon)</span>
          </Button>
        </div>

        {/* Project Info */}
        <div className="rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
          <p><strong>Mode:</strong> {project.mode === "tabletop" ? "Tabletop" : "Multi-Point"}</p>
          {project.mode === "tabletop" && project.scale && (
            <p><strong>Scale:</strong> {project.scale}</p>
          )}
          <p><strong>Model:</strong> {project.model_url ? "✅ Loaded" : "⚠️ Not uploaded"}</p>
        </div>

        <p className="text-center text-[10px] text-muted-foreground">
          Powered by Archi AR
        </p>
      </main>
    </div>
  );
};

export default ARViewer;
