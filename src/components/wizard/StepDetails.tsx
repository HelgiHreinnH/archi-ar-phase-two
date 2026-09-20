import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Compass, Check, Loader2, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODE_COPY, type ExperienceMode } from "@/lib/modeCopy";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

const SCALE_PRESETS = [
  { value: "1:1",   label: "1:1",   description: "True size — furniture & objects" },
  { value: "1:10",  label: "1:10",  description: "Large furniture & room objects" },
  { value: "1:25",  label: "1:25",  description: "Room-scale interiors" },
  { value: "1:50",  label: "1:50",  description: "Standard floor plan" },
  { value: "1:100", label: "1:100", description: "Building overview" },
  { value: "1:200", label: "1:200", description: "Site plan / master planning" },
] as const;

const ROTATION_PRESETS = [
  { value: 0, label: "N", icon: "↑" },
  { value: 90, label: "E", icon: "→" },
  { value: 180, label: "S", icon: "↓" },
  { value: 270, label: "W", icon: "←" },
] as const;

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

const StepDetails = forwardRef<StepDetailsHandle, StepDetailsProps>(({ project, mode, onUpdate }, ref) => {
  const [form, setForm] = useState({
    client_name: project.client_name || "",
    location: project.location || "",
    description: project.description || "",
    scale: project.scale || "1:1",
    qr_size: project.qr_size || "medium",
    initial_rotation: project.initial_rotation || 0,
  });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const formRef = useRef(form);
  formRef.current = form;
  const dirtyRef = useRef(false);

  const isWall = mode === "wall";
  const copy = MODE_COPY[mode];
  const ModeIcon = copy.icon;

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
        ...(mode !== "multipoint" && {
          scale: f.scale,
          qr_size: f.qr_size,
          initial_rotation: f.initial_rotation,
        }),
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
  }, [project.id, mode, onUpdate]);

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

  // Renders grid items: Details (1 column, beside the 3D model) and, for
  // Tabletop/Wall, the configuration as a full-width row underneath.
  return (
    <>
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

      {mode !== "multipoint" && (
        <Card className="flow-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ModeIcon className="h-4 w-4 text-primary" />
              {copy.label} configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-3">

          {/* Scale */}
          <div className="space-y-2">
            <Label>Presentation scale</Label>
            <p className="text-xs text-muted-foreground">
              How large the model appears on the {copy.surface}
            </p>
            <Select value={form.scale} onValueChange={(v) => update({ scale: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCALE_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    <span className="font-mono font-medium">{preset.label}</span>
                    <span className="ml-2 text-muted-foreground text-xs">{preset.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* QR Size */}
          <div className="space-y-2">
            <Label>QR marker size</Label>
            <Select value={form.qr_size} onValueChange={(v) => update({ qr_size: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small (10 × 10 cm)</SelectItem>
                <SelectItem value="medium">Medium (15 × 15 cm)</SelectItem>
                <SelectItem value="large">Large (20 × 20 cm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rotation — compass on a table; plain degrees on a wall, where
              north/east/south/west has no meaning. */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5" />
              Initial rotation
            </Label>
            <p className="text-xs text-muted-foreground">
              {isWall
                ? "Rotate the model in 90° steps for how it should sit on the wall when it loads."
                : "Which direction should the model face when it loads?"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {ROTATION_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant={form.initial_rotation === preset.value ? "default" : "outline"}
                  size="sm"
                  className="font-mono gap-1 px-0"
                  onClick={() => update({ initial_rotation: preset.value })}
                >
                  {isWall ? (
                    <span>{preset.value}°</span>
                  ) : (
                    <>
                      <span>{preset.icon}</span>
                      <span>{preset.label}</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
          </div>
          </CardContent>
        </Card>
      )}
    </>
  );
});

StepDetails.displayName = "StepDetails";

export default StepDetails;
