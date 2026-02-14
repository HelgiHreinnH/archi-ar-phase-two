import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Grid3X3 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import ExperienceWizard from "@/components/ExperienceWizard";

type Project = Tables<"projects">;

const modeConfig = {
  tabletop: {
    icon: Grid3X3,
    label: "Tabletop",
    badgeBg: "bg-primary/10 text-primary",
  },
  multipoint: {
    icon: MapPin,
    label: "Multi-Point",
    badgeBg: "bg-primary/10 text-primary",
  },
} as const;

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard/experiences")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-2xl font-bold">{project.name}</h1>
            <Badge className={`text-xs gap-1 ${config.badgeBg} border-0`}>
              <ModeIcon className="h-3 w-3" />
              {config.label}
            </Badge>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              project.status === "active"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {project.status}
          </span>
        </div>
      </div>

      {/* Wizard */}
      <ExperienceWizard
        project={project}
        onProjectUpdate={() => queryClient.invalidateQueries({ queryKey: ["project", id] })}
      />
    </div>
  );
};

export default ProjectDetail;
