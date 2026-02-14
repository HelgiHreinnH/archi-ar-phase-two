import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, Plus, Clock, Eye, Grid3X3, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const modeConfig = {
  tabletop: {
    icon: Grid3X3,
    label: "Tabletop",
    borderColor: "border-l-blue-500",
    badgeBg: "bg-blue-100 text-blue-700",
  },
  multipoint: {
    icon: MapPin,
    label: "Multi-Point",
    borderColor: "border-l-orange-500",
    badgeBg: "bg-orange-100 text-orange-700",
  },
} as const;

const DashboardHome = () => {
  const { user } = useAuth();
  const { projects, isLoading } = useProjects();
  const navigate = useNavigate();

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";

  const stats = [
    {
      label: "Total Experiences",
      value: projects.length,
      icon: FolderOpen,
      color: "text-primary",
    },
    {
      label: "Active",
      value: projects.filter((p) => p.status === "active").length,
      icon: Eye,
      color: "text-marker-green",
    },
    {
      label: "Drafts",
      value: projects.filter((p) => p.status === "draft").length,
      icon: Clock,
      color: "text-marker-yellow",
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Hey, {displayName} 👋
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's an overview of your AR experiences.
          </p>
        </div>
        <Button onClick={() => navigate("/dashboard/experiences/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Experience
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-display font-bold">
                {isLoading ? "—" : stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent experiences */}
      <div>
        <h2 className="font-display text-xl font-semibold mb-4">Recent Experiences</h2>
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
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="font-display text-lg font-semibold mb-1">No experiences yet</h3>
               <p className="text-sm text-muted-foreground mb-4">
                Create your first experience to start presenting designs in real spaces.
               </p>
              <Button onClick={() => navigate("/dashboard/experiences/new")}>
                <Plus className="mr-2 h-4 w-4" />
                Create Experience
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.slice(0, 6).map((project) => {
              const mode = (project as any).mode === "tabletop" ? "tabletop" : "multipoint";
              const config = modeConfig[mode];
              const ModeIcon = config.icon;

              return (
                <Card
                  key={project.id}
                  className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${config.borderColor}`}
                  onClick={() => navigate(`/dashboard/experiences/${project.id}`)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <Badge className={`text-[10px] gap-1 mb-1 ${config.badgeBg} border-0`}>
                          <ModeIcon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                        <h3 className="font-display font-semibold truncate">{project.name}</h3>
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
                    {project.client_name && (
                      <p className="text-sm text-muted-foreground">{project.client_name}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Updated {new Date(project.updated_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardHome;
