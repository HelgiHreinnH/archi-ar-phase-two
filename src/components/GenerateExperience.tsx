import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rocket, CheckCircle2, AlertCircle, Loader2, Download, Link2, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

interface GenerateExperienceProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: "tabletop" | "multipoint";
  onGenerated: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  hint?: string;
}

const GenerateExperience = ({ project, hasModel, hasValidMarkers, mode, onGenerated }: GenerateExperienceProps) => {
  const [generating, setGenerating] = useState(false);

  const checks: CheckItem[] =
    mode === "tabletop"
      ? [
          { label: "3D model uploaded", passed: hasModel, hint: "Upload a GLB or USDZ model above" },
          { label: "Scale configured", passed: !!project.scale, hint: "Set the model scale" },
        ]
      : [
          { label: "3D model uploaded", passed: hasModel, hint: "Upload a GLB or USDZ model above" },
          { label: "Marker coordinates set", passed: hasValidMarkers, hint: "Enter coordinates for points A, B, C" },
          { label: "Triangle quality sufficient", passed: hasValidMarkers, hint: "Ensure points form a valid triangle" },
        ];

  const allPassed = checks.every((c) => c.passed);
  const isActive = project.status === "active";

  const handleGenerate = async () => {
    if (!allPassed) return;

    setGenerating(true);
    try {
      // Generate a share link and set status to active
      const shareId = crypto.randomUUID();
      const { error } = await supabase
        .from("projects")
        .update({ share_link: shareId, status: "active" })
        .eq("id", project.id);

      if (error) throw error;

      toast({
        title: "AR Experience Generated! 🚀",
        description: "Your experience is live and ready to share with clients.",
      });
      onGenerated();
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const shareUrl = project.share_link
    ? `${window.location.origin}/view/${project.share_link}`
    : null;

  const copyShareLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied to clipboard" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          Generate AR Experience
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Checklist */}
        <div className="space-y-2">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center gap-2 text-sm">
              {check.passed ? (
                <CheckCircle2 className="h-4 w-4 text-marker-green shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={check.passed ? "text-foreground" : "text-muted-foreground"}>
                {check.label}
              </span>
              {!check.passed && check.hint && (
                <span className="text-xs text-muted-foreground ml-auto">{check.hint}</span>
              )}
            </div>
          ))}
        </div>

        {/* Generate Button */}
        {!isActive ? (
          <Button
            className="w-full"
            size="lg"
            disabled={!allPassed || generating}
            onClick={handleGenerate}
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" />
                Generate AR Experience
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-marker-green/30 bg-marker-green/5 p-3">
              <CheckCircle2 className="h-5 w-5 text-marker-green shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Experience is Live</p>
                {shareUrl && (
                  <p className="text-xs text-muted-foreground truncate">{shareUrl}</p>
                )}
              </div>
              <Badge className="bg-marker-green/10 text-marker-green border-0">Active</Badge>
            </div>

            {shareUrl && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={copyShareLink}>
                  <Copy className="mr-1 h-3 w-3" />
                  Copy Link
                </Button>
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                    <Link2 className="mr-1 h-3 w-3" />
                    Preview
                  </a>
                </Button>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Regenerate
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GenerateExperience;
