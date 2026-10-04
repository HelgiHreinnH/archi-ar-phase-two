import { useProjects } from "@/hooks/useProjects";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Plus, FolderOpen, FileBox, FileQuestion, Grid3X3, MapPin, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import ProjectCardMenu from "@/components/ProjectCardMenu";
import { isArchived } from "@/lib/projectActions";

const modeConfig = {
  tabletop: {
    icon: Grid3X3,
    label: "Tabletop",
    borderColor: "border-l-blue-500",
    badgeBg: "bg-blue-100 text-blue-700",
  },
  wall: {
    icon: Grid3X3,
    label: "Wall",
    borderColor: "border-l-sky-500",
    badgeBg: "bg-sky-100 text-sky-700",
  },
  multipoint: {
    icon: MapPin,
    label: "Spatial",
    borderColor: "border-l-orange-500",
    badgeBg: "bg-orange-100 text-orange-700",
  },
} as const;

const ProjectsList = () => {
  const { projects: allProjects, isLoading } = useProjects();
  const navigate = useNavigate();
  const [view, setView] = useState<"current" | "archived">("current");
  const archivedCount = allProjects.filter(isArchived).length;
  const projects = allProjects.filter((p) => (view === "archived" ? isArchived(p) : !isArchived(p)));
  const allNames = allProjects.map((p) => p.name);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Experiences</h1>
          <p className="text-muted-foreground mt-1">Manage your AR interior design presentations.</p>
        </div>
        <Button onClick={() => navigate("/dashboard/experiences/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Experience
        </Button>
      </div>

      {(archivedCount > 0 || view === "archived") && (
        <div role="tablist" aria-label="Filter experiences" className="inline-flex rounded-full border bg-muted/40 p-0.5 text-sm">
          {([["current", "Current"], ["archived", `Archived (${archivedCount})`]] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`rounded-full px-3 py-1 transition-colors ${
                view === key ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-muted rounded w-2/3 mb-3" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : view === "archived" && projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Archive className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nothing archived.</p>
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="font-display text-xl font-semibold mb-2">No experiences yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">
              Upload your interior design, place it in the client's space, and share an AR walkthrough — no app needed.
            </p>
            <Button onClick={() => navigate("/dashboard/experiences/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first experience
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const mode = ((project as any).mode === "multipoint" ? "multipoint" : ((project as any).mode === "wall" ? "wall" : "tabletop"));
            const config = modeConfig[mode];
            const ModeIcon = config.icon;

            return (
              <Card
                key={project.id}
                className={`group cursor-pointer hover:shadow-md transition-all border-l-4 ${config.borderColor} ${isArchived(project) ? "opacity-70" : ""}`}
                onClick={() => navigate(`/dashboard/experiences/${project.id}`)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`text-[10px] gap-1 ${config.badgeBg} border-0`}>
                          <ModeIcon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                      </div>
                      <h3 className="font-display font-semibold truncate">{project.name}</h3>
                      {project.client_name && (
                        <p className="text-sm text-muted-foreground truncate">{project.client_name}</p>
                      )}
                    </div>
                    <ProjectCardMenu project={project} allNames={allNames} />
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        project.status === "active"
                          ? "bg-marker-green/10 text-marker-green"
                          : isArchived(project)
                          ? "bg-muted text-muted-foreground"
                          : "bg-marker-yellow/10 text-marker-yellow"
                      }`}
                    >
                      {project.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(project.updated_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    {project.model_url ? (
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <FileBox className="h-3 w-3" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                        <FileQuestion className="h-3 w-3" />
                        No model
                      </Badge>
                    )}
                    {project.location && (
                      <span className="text-xs text-muted-foreground truncate">📍 {project.location}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProjectsList;
