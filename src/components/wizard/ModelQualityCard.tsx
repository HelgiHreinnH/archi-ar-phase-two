import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Gauge, Info, Zap, Package, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

interface ModelQualityCardProps {
  project: Project;
  onUpdate: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The architect's choice, per project: run the phone-optimisation pipeline
 * (compressGlbGeometry — join/simplify/meshopt + material fixes) on upload,
 * or send the GLB exactly as exported. Sits beside Details in the right-hand
 * column of Step 1 (see ExperienceWizard's `.flow-col-3`).
 *
 * Persisted (`projects.optimize_model`, default true) rather than a session
 * toggle, so it's remembered for every future upload/replace on this project
 * — not just the next click.
 */
const ModelQualityCard = ({ project, onUpdate }: ModelQualityCardProps) => {
  const [optimized, setOptimized] = useState(project.optimize_model);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const handleChange = async (next: boolean) => {
    const prev = optimized;
    setOptimized(next); // optimistic — the switch shouldn't wait on the network
    setStatus("saving");
    const { error } = await supabase
      .from("projects")
      .update({ optimize_model: next })
      .eq("id", project.id);
    if (error) {
      setOptimized(prev);
      setStatus("error");
      toast({ title: "Couldn't save that setting", description: "Check your connection and try again.", variant: "destructive" });
      return;
    }
    setStatus("saved");
    onUpdate();
  };

  return (
    <Card className="flow-col-3">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          Model quality
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 ml-auto text-muted-foreground hover:text-foreground"
                aria-label="More about the optimize setting"
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-sm space-y-2.5">
              <p className="font-medium">What "Optimize for AR" does</p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>Merges the model's parts to cut draw calls — often thousands down to dozens</li>
                <li>Simplifies geometry too fine to see at normal viewing distance</li>
                <li>Compresses textures and fixes materials that would otherwise render pitch black or shimmer on a phone</li>
                <li>Typically 80–95% smaller, with no visible difference at arm's length</li>
              </ul>
              <p className="text-muted-foreground">
                Turn it off to send the exact file you exported — useful for testing geometry fidelity,
                or if it's already lightweight. Large or intricate models may load slowly and stutter in AR without it.
              </p>
            </PopoverContent>
          </Popover>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="optimize-switch" className="text-sm font-normal cursor-pointer">
            Optimize for AR
          </Label>
          <div className="flex items-center gap-2">
            <span className="h-3.5 w-3.5" aria-live="polite">
              {status === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {status === "saved" && <Check className="h-3.5 w-3.5 text-green-600" />}
            </span>
            <Switch id="optimize-switch" checked={optimized} onCheckedChange={handleChange} />
          </div>
        </div>

        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-xs transition-colors ${
            optimized ? "border-primary/25 bg-primary/5" : "border-amber-500/40 bg-amber-500/10"
          }`}
        >
          {optimized ? (
            <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          ) : (
            <Package className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <p className="text-muted-foreground">
            {optimized
              ? "Recommended. Merges parts, simplifies geometry and compresses textures so the model loads fast and moves smoothly on a phone."
              : "Uploads the file exactly as exported — full geometry and texture resolution, untouched. Large or complex models may be slow to load and stutter in AR."}
          </p>
        </div>

        {!!project.model_url && (
          <p className="text-[11px] text-muted-foreground">
            Applies the next time you upload or replace the model — not retroactively.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default ModelQualityCard;
