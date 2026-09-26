import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Grid3X3, MapPin, LayoutPanelTop, Lock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePlan } from "@/hooks/usePlan";
import { FREE_MODEL_CAP, PLAN_COPY, canCreate, friendlyError } from "@/lib/plans";

type Mode = "tabletop" | "wall" | "multipoint";

const NewProject = () => {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("tabletop");
  // Free vs paid (migration 009): Spatial (`multipoint`) is paid-only and free
  // accounts get FREE_MODEL_CAP Tabletop/Wall models. The DB trigger enforces
  // both; this only explains it up front.
  const { plan, quota } = usePlan();
  const spatialLocked = plan !== "paid";
  const allowed = canCreate(mode, plan, quota.used);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !allowed) return;

    setLoading(true);
    try {
      const project = await createProject.mutateAsync({
        name,
        mode,
        scale: "1:1",
      });
      toast({ title: "Experience created!" });
      navigate(`/dashboard/experiences/${project.id}`);
    } catch (error: unknown) {
      toast({ title: "Couldn't create the experience", description: friendlyError(error), variant: "destructive" });
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
      <div className="grid gap-4 sm:grid-cols-3">
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
            QR code laid flat on a table. Model anchors on top for design reviews at scale.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setMode("wall")}
          className={`relative rounded-xl border-2 p-5 text-left transition-all ${
            mode === "wall"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border hover:border-primary/30"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`rounded-lg p-2 ${mode === "wall" ? "bg-primary/10" : "bg-muted"}`}>
              <LayoutPanelTop className={`h-5 w-5 ${mode === "wall" ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <span className="font-display font-semibold">Wall</span>
          </div>
          <p className="text-sm text-muted-foreground">
            QR code mounted on a wall. Model anchors vertically — perfect for art, panels, or wall-mounted design.
          </p>
        </button>


        <button
          type="button"
          onClick={() => setMode("multipoint")}
          aria-describedby={spatialLocked ? "spatial-paid-note" : undefined}
          className={`relative rounded-xl border-2 p-5 text-left transition-all ${
            mode === "multipoint"
              ? spatialLocked
                ? "border-amber-400 bg-amber-50/60 shadow-sm"
                : "border-primary bg-primary/5 shadow-sm"
              : "border-border hover:border-primary/30"
          }`}
        >
          {spatialLocked && (
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Paid
            </span>
          )}
          <div className="flex items-center gap-3 mb-2">
            <div className={`rounded-lg p-2 ${mode === "multipoint" ? "bg-primary/10" : "bg-muted"}`}>
              <MapPin className={`h-5 w-5 ${mode === "multipoint" ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <span className="font-display font-semibold">Spatial</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Three markers placed in the room. Full-scale spatial visualization at 1:1 in the actual space.
          </p>
        </button>
      </div>

      {mode === "multipoint" && spatialLocked && (
        <div
          id="spatial-paid-note"
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Spatial is part of the paid plan</p>
            <p>{PLAN_COPY.spatialLocked}</p>
          </div>
        </div>
      )}

      {mode !== "multipoint" && plan === "free" && (
        <div
          role="status"
          className={`rounded-xl border p-4 text-sm ${
            quota.reached
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          {quota.reached ? (
            <>
              <p className="font-medium">Free limit reached</p>
              <p className="mt-1">{PLAN_COPY.capReached}</p>
            </>
          ) : (
            <p>
              {quota.used} of {FREE_MODEL_CAP} free Tabletop/Wall models used.
            </p>
          )}
        </div>
      )}

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
              <Button type="submit" disabled={loading || !name.trim() || !allowed}>
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
