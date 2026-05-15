import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Grid3X3, MapPin } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Mode = "tabletop" | "multipoint";

const NewProject = () => {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("tabletop");
  // Multi-Point is temporarily gated while we ship the Rhino integration + Railway .mind compiler (Q3 2026).
  // Existing multipoint experiences keep working in the dashboard and AR viewer — only new creation is blocked.
  const MULTIPOINT_DISABLED = true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const project = await createProject.mutateAsync({
        name,
        mode,
        scale: "1:1",
      });
      toast({ title: "Experience created!" });
      navigate(`/dashboard/experiences/${project.id}`);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-display text-3xl font-bold">New Experience</h1>
          <p className="text-muted-foreground mt-1">Choose a mode and name your experience to get started.</p>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("tabletop")}
          className={`relative rounded-xl border-2 p-5 text-left transition-all ${
            mode === "tabletop"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border hover:border-primary/30"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`rounded-lg p-2 ${mode === "tabletop" ? "bg-primary/10" : "bg-muted"}`}>
              <Grid3X3 className={`h-5 w-5 ${mode === "tabletop" ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <span className="font-display font-semibold">Tabletop</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Single QR code on a table. Perfect for client presentations and design reviews at scale.
          </p>
        </button>

        <button
          type="button"
          onClick={() => !MULTIPOINT_DISABLED && setMode("multipoint")}
          disabled={MULTIPOINT_DISABLED}
          aria-disabled={MULTIPOINT_DISABLED}
          className={`relative rounded-xl border-2 p-5 text-left transition-all ${
            MULTIPOINT_DISABLED
              ? "border-border bg-muted/30 cursor-not-allowed opacity-75"
              : mode === "multipoint"
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/30"
          }`}
        >
          {MULTIPOINT_DISABLED && (
            <span className="absolute top-3 right-3 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
              Coming soon
            </span>
          )}
          <div className="flex items-center gap-3 mb-2">
            <div className={`rounded-lg p-2 ${!MULTIPOINT_DISABLED && mode === "multipoint" ? "bg-primary/10" : "bg-muted"}`}>
              <MapPin className={`h-5 w-5 ${!MULTIPOINT_DISABLED && mode === "multipoint" ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <span className="font-display font-semibold">Multi-Point</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Three markers placed in the room. Full-scale spatial visualization at 1:1 in the actual space.
          </p>
          {MULTIPOINT_DISABLED && (
            <p className="mt-3 text-xs text-amber-700">
              Launching with native Rhino integration in Q3 2026.
            </p>
          )}
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Name Your Experience</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Experience Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lindgren Living Room Redesign"
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !name.trim()}>
                {loading ? "Creating..." : "Create Experience"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewProject;
