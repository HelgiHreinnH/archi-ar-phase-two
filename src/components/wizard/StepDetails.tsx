import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Grid3X3, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

const SCALE_PRESETS = [
  { value: "1:10", label: "1:10", description: "Very large detail — furniture studies" },
  { value: "1:20", label: "1:20", description: "Large detail — room layouts" },
  { value: "1:50", label: "1:50", description: "Standard presentation — buildings" },
  { value: "1:100", label: "1:100", description: "Overview — building exteriors" },
  { value: "1:200", label: "1:200", description: "Master planning — campus / site" },
  { value: "1:500", label: "1:500", description: "Urban planning — city blocks" },
] as const;

const ROTATION_PRESETS = [
  { value: 0, label: "N", icon: "↑" },
  { value: 90, label: "E", icon: "→" },
  { value: 180, label: "S", icon: "↓" },
  { value: 270, label: "W", icon: "←" },
] as const;

type Project = Tables<"projects">;

interface StepDetailsProps {
  project: Project;
  mode: "tabletop" | "multipoint";
  onSaved: () => void;
}

const StepDetails = ({ project, mode, onSaved }: StepDetailsProps) => {
  const [form, setForm] = useState({
    client_name: project.client_name || "",
    location: project.location || "",
    description: project.description || "",
    scale: project.scale || "1:20",
    qr_size: project.qr_size || "medium",
    initial_rotation: project.initial_rotation || 0,
  });
  const [saving, setSaving] = useState(false);

  // Expose save function via custom event for the wizard's Continue button
  useEffect(() => {
    const handler = async () => {
      setSaving(true);
      const { error } = await supabase
        .from("projects")
        .update({
          client_name: form.client_name || null,
          location: form.location || null,
          description: form.description || null,
          ...(mode === "tabletop" && {
            scale: form.scale,
            qr_size: form.qr_size,
            initial_rotation: form.initial_rotation,
          }),
        })
        .eq("id", project.id);

      setSaving(false);
      if (error) {
        toast({ title: "Error saving details", variant: "destructive" });
      } else {
        onSaved();
      }
    };

    window.addEventListener("wizard-save-details", handler);
    return () => window.removeEventListener("wizard-save-details", handler);
  }, [form, project.id, mode, onSaved]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="client">Client Name</Label>
        <Input
          id="client"
          value={form.client_name}
          onChange={(e) => setForm({ ...form, client_name: e.target.value })}
          placeholder="Lindgren Family"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          placeholder="Strandvägen 7, Stockholm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Full interior redesign of living and dining area..."
          rows={3}
        />
      </div>

      {mode === "tabletop" && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-primary" />
            Tabletop Configuration
          </h3>

          {/* Scale */}
          <div className="space-y-2">
            <Label>Presentation Scale</Label>
            <p className="text-xs text-muted-foreground">
              How large the model appears on the table
            </p>
            <Select value={form.scale} onValueChange={(v) => setForm({ ...form, scale: v })}>
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
            <Label>QR Marker Size</Label>
            <Select value={form.qr_size} onValueChange={(v) => setForm({ ...form, qr_size: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small (10×10 cm)</SelectItem>
                <SelectItem value="medium">Medium (15×15 cm)</SelectItem>
                <SelectItem value="large">Large (20×20 cm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rotation — compass buttons */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5" />
              Initial Rotation
            </Label>
            <p className="text-xs text-muted-foreground">
              Which direction should the model face when it loads?
            </p>
            <div className="flex gap-2">
              {ROTATION_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant={form.initial_rotation === preset.value ? "default" : "outline"}
                  size="sm"
                  className="flex-1 font-mono gap-1"
                  onClick={() => setForm({ ...form, initial_rotation: preset.value })}
                >
                  <span>{preset.icon}</span>
                  <span>{preset.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepDetails;
