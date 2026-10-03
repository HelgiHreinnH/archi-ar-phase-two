import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";
import { MODE_COPY, type ExperienceMode } from "@/lib/modeCopy";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import SettingsCard, { SaveStatusLine, type SaveStatus } from "@/components/wizard/SettingsCard";

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

export interface PresentationConfigHandle {
  /** Persist pending edits. Resolves true on success. */
  save: () => Promise<boolean>;
}

interface PresentationConfigCardProps {
  project: Project;
  /** Tabletop or Wall — Spatial has no presentation config. */
  mode: Exclude<ExperienceMode, "multipoint">;
  onUpdate: () => void;
  className?: string;
}

const AUTOSAVE_DELAY_MS = 800;

/**
 * Tabletop/Wall presentation settings: scale, QR size, initial rotation.
 * Oct 2026: moved out of Details into the "Scale & Quality" step, which comes
 * BEFORE the upload (so the Model quality choice beside it applies to it).
 * Autosaves like Details.
 */
const PresentationConfigCard = forwardRef<PresentationConfigHandle, PresentationConfigCardProps>(
  ({ project, mode, onUpdate, className }, ref) => {
    const [form, setForm] = useState({
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

    const save = useCallback(async (): Promise<boolean> => {
      if (!dirtyRef.current) return true;
      const f = formRef.current;
      dirtyRef.current = false;
      setStatus("saving");
      const { error } = await supabase
        .from("projects")
        .update({ scale: f.scale, qr_size: f.qr_size, initial_rotation: f.initial_rotation })
        .eq("id", project.id);
      if (error) {
        dirtyRef.current = true;
        setStatus("error");
        toast({ title: "Error saving configuration", variant: "destructive" });
        return false;
      }
      setStatus("saved");
      onUpdate();
      return true;
    }, [project.id, onUpdate]);

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

    return (
      <SettingsCard
        className={className}
        icon={copy.icon}
        title={`${copy.label} configuration`}
        subtitle={`How the model sits on the ${copy.surface} when it loads.`}
        footer={<SaveStatusLine status={status} />}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {/* Scale */}
          <div className="space-y-2">
            <Label>Presentation scale</Label>
            <p className="text-xs text-muted-foreground">How large the model appears on the {copy.surface}</p>
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
            <p className="text-xs text-muted-foreground">Printed size of the code</p>
            <Select value={form.qr_size} onValueChange={(v) => update({ qr_size: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small (10 × 10 cm)</SelectItem>
                <SelectItem value="medium">Medium (15 × 15 cm)</SelectItem>
                <SelectItem value="large">Large (20 × 20 cm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rotation — compass on a table; plain degrees on a wall. */}
          <div className="space-y-2 sm:col-span-2">
            <Label className="flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5" />
              Initial rotation
            </Label>
            <p className="text-xs text-muted-foreground">
              {isWall
                ? "Rotate the model in 90° steps for how it should sit on the wall when it loads."
                : "Which direction should the model face when it loads?"}
            </p>
            <div className="grid grid-cols-4 gap-2 max-w-sm">
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
        </div>
      </SettingsCard>
    );
  },
);

PresentationConfigCard.displayName = "PresentationConfigCard";

export default PresentationConfigCard;
