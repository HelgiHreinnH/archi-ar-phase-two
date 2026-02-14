import { useProjects } from "@/hooks/useProjects";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, Trash2, MoreVertical, FileBox, FileQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

const ProjectsList = () => {
  const { projects, isLoading, deleteProject } = useProjects();
  const navigate = useNavigate();

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteProject.mutateAsync(id);
      toast({ title: "Project deleted" });
    } catch {
      toast({ title: "Error deleting project", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage your interior design presentations.</p>
        </div>
        <Button onClick={() => navigate("/dashboard/projects/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

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
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="font-display text-xl font-semibold mb-2">No projects yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">
              Upload your interior design, place it in the client's space, and share an AR walkthrough — no app needed.
            </p>
            <Button onClick={() => navigate("/dashboard/projects/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="group cursor-pointer hover:shadow-md transition-all"
              onClick={() => navigate(`/dashboard/projects/${project.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-semibold truncate">{project.name}</h3>
                    {project.client_name && (
                      <p className="text-sm text-muted-foreground truncate">{project.client_name}</p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(project.id, project.name);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      project.status === "active"
                        ? "bg-marker-green/10 text-marker-green"
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
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectsList;
