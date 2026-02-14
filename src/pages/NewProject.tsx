import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Grid3X3, MapPin } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Mode = "tabletop" | "multipoint";

const NewProject = () => {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    client_name: "",
    location: "",
    description: "",
    mode: "tabletop" as Mode,
    scale: "1:20",
    qr_size: "medium",
    initial_rotation: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setLoading(true);
    try {
      const project = await createProject.mutateAsync({
        name: form.name,
        client_name: form.client_name || null,
        location: form.location || null,
        description: form.description || null,
        mode: form.mode,
        scale: form.mode === "tabletop" ? form.scale : "1:1",
        qr_size: form.mode === "tabletop" ? form.qr_size : null,
        initial_rotation: form.mode === "tabletop" ? form.initial_rotation : 0,
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
          <p className="text-muted-foreground mt-1">Set up a new AR presentation for your client's space.</p>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setForm({ ...form, mode: "tabletop" })}
          className={`relative rounded-xl border-2 p-5 text-left transition-all ${
            form.mode === "tabletop"
              ? "border-blue-500 bg-blue-50/50 shadow-sm"
              : "border-border hover:border-blue-300"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`rounded-lg p-2 ${form.mode === "tabletop" ? "bg-blue-100" : "bg-muted"}`}>
              <Grid3X3 className={`h-5 w-5 ${form.mode === "tabletop" ? "text-blue-600" : "text-muted-foreground"}`} />
            </div>
            <span className="font-display font-semibold">Tabletop</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Single QR code on a table. Perfect for client presentations and design reviews at scale.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setForm({ ...form, mode: "multipoint" })}
          className={`relative rounded-xl border-2 p-5 text-left transition-all ${
            form.mode === "multipoint"
              ? "border-orange-500 bg-orange-50/50 shadow-sm"
              : "border-border hover:border-orange-300"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`rounded-lg p-2 ${form.mode === "multipoint" ? "bg-orange-100" : "bg-muted"}`}>
              <MapPin className={`h-5 w-5 ${form.mode === "multipoint" ? "text-orange-600" : "text-muted-foreground"}`} />
            </div>
            <span className="font-display font-semibold">Multi-Point</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Three markers placed in the room. Full-scale spatial visualization at 1:1 in the actual space.
          </p>
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Experience Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Experience Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Lindgren Living Room Redesign"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Full interior redesign of living and dining area in existing apartment..."
                rows={3}
              />
            </div>

            {/* Tabletop-specific config */}
            {form.mode === "tabletop" && (
              <div className="rounded-lg border bg-blue-50/30 p-4 space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Grid3X3 className="h-4 w-4 text-blue-600" />
                  Tabletop Configuration
                </h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="scale">Model Scale</Label>
                    <Select value={form.scale} onValueChange={(v) => setForm({ ...form, scale: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1:10">1:10</SelectItem>
                        <SelectItem value="1:20">1:20</SelectItem>
                        <SelectItem value="1:50">1:50</SelectItem>
                        <SelectItem value="1:100">1:100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="qr_size">QR Marker Size</Label>
                    <Select value={form.qr_size} onValueChange={(v) => setForm({ ...form, qr_size: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="small">Small (10×10cm)</SelectItem>
                        <SelectItem value="medium">Medium (15×15cm)</SelectItem>
                        <SelectItem value="large">Large (20×20cm)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rotation">Initial Rotation</Label>
                    <Input
                      id="rotation"
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

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
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
