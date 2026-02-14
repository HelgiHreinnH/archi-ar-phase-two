import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Grid3X3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

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
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-primary" />
            Tabletop Configuration
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Model Scale</Label>
              <Select value={form.scale} onValueChange={(v) => setForm({ ...form, scale: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:10">1:10</SelectItem>
                  <SelectItem value="1:20">1:20</SelectItem>
                  <SelectItem value="1:50">1:50</SelectItem>
                  <SelectItem value="1:100">1:100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>QR Marker Size</Label>
              <Select value={form.qr_size} onValueChange={(v) => setForm({ ...form, qr_size: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small (10×10cm)</SelectItem>
                  <SelectItem value="medium">Medium (15×15cm)</SelectItem>
                  <SelectItem value="large">Large (20×20cm)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Initial Rotation</Label>
              <Input
                type="number"
                min={0}
                max={360}
                value={form.initial_rotation}
                onChange={(e) => setForm({ ...form, initial_rotation: parseInt(e.target.value) || 0 })}
                placeholder="0°"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepDetails;
