import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExperienceMode } from "@/lib/modeCopy";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

export interface StepDetailsHandle {
  /** Persist the current form. Resolves true on success. */
  save: () => Promise<boolean>;
}

interface StepDetailsProps {
  project: Project;
  mode: ExperienceMode;
  /** Called after every successful save so the parent can refetch. */
  onUpdate: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

const StepDetails = forwardRef<StepDetailsHandle, StepDetailsProps>(({ project, onUpdate }, ref) => {
  const [form, setForm] = useState({
    client_name: project.client_name || "",
    location: project.location || "",
    description: project.description || "",
  });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const formRef = useRef(form);
  formRef.current = form;
  const dirtyRef = useRef(false);

  const save = useCallback(async (): Promise<boolean> => {
    const f = formRef.current;
    dirtyRef.current = false;
    setStatus("saving");
    const { error } = await supabase
      .from("projects")
      .update({
        client_name: f.client_name || null,
        location: f.location || null,
        description: f.description || null,
      })
      .eq("id", project.id);

    if (error) {
      dirtyRef.current = true;
      setStatus("error");
      toast({ title: "Error saving details", variant: "destructive" });
      return false;
    }
    setStatus("saved");
    onUpdate();
    return true;
  }, [project.id, onUpdate]);

  // Autosave shortly after the user stops editing, so nothing is lost when
  // they scroll on without pressing the section CTA.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => { void save(); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [form, save]);

  useImperativeHandle(ref, () => ({ save }), [save]);

  const update = (patch: Partial<typeof form>) => {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const saveStatus = (
    <p className="h-4 text-[11px] text-muted-foreground flex items-center gap-1" aria-live="polite">
      {status === "saving" && (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>)}
      {status === "saved" && (<><Check className="h-3 w-3 text-green-600" /> Changes saved</>)}
      {status === "error" && <span className="text-destructive">Not saved — check your connection</span>}
    </p>
  );

  // Details (1 column, beside the 3D model). Tabletop/Wall presentation
  // settings live in PresentationConfigCard (the "Scale & Quality" step).
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="client">Client name</Label>
        <Input
          id="client"
          value={form.client_name}
          onChange={(e) => update({ client_name: e.target.value })}
          placeholder="Lindgren Family"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={form.location}
          onChange={(e) => update({ location: e.target.value })}
          placeholder="Strandvägen 7, Stockholm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={form.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Full interior redesign of living and dining area…"
          rows={3}
        />
      </div>

      {saveStatus}
      </CardContent>
    </Card>
  );
});

StepDetails.displayName = "StepDetails";

export default StepDetails;
