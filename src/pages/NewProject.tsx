import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const NewProject = () => {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    client_name: "",
    location: "",
    description: "",
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
      });
      toast({ title: "Project created!" });
      navigate(`/dashboard/projects/${project.id}`);
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
          <h1 className="font-display text-3xl font-bold">New Project</h1>
          <p className="text-muted-foreground mt-1">Set up a new interior design presentation for your client's space.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Project Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name *</Label>
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

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Project"}
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
