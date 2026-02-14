import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rocket, CheckCircle2, AlertCircle, Loader2, Download, Link2, Copy, FileDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerData } from "@/components/MarkerCoordinateEditor";
import QRCode from "qrcode";

type Project = Tables<"projects">;

interface GenerateExperienceProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: "tabletop" | "multipoint";
  markerData: MarkerData | null;
  onGenerated: () => void;
}

const MARKER_COLORS: Record<string, { fill: string; label: string }> = {
  A: { fill: "#E53935", label: "Point A" },
  B: { fill: "#43A047", label: "Point B" },
  C: { fill: "#1E88E5", label: "Point C" },
};

async function generateMarkerImage(
  pointId: string,
  coords: { x: number; y: number; z: number; label: string },
  projectName: string,
  shareUrl: string
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d")!;
  const cfg = MARKER_COLORS[pointId];

  // White background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 800, 1000);

  // Border
  ctx.strokeStyle = "#E0E0E0";
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 760, 960);

  // Colored circle
  ctx.beginPath();
  ctx.arc(400, 220, 120, 0, Math.PI * 2);
  ctx.fillStyle = cfg.fill;
  ctx.fill();

  // Letter inside circle
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 100px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pointId, 400, 220);

  // Label
  ctx.fillStyle = "#212121";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(cfg.label, 400, 390);
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#757575";
  ctx.fillText(coords.label || cfg.label, 400, 425);

  // Coordinates
  ctx.font = "bold 20px monospace";
  ctx.fillStyle = "#424242";
  ctx.fillText(`X: ${coords.x}   Y: ${coords.y}   Z: ${coords.z}  (mm)`, 400, 480);

  // QR Code
  try {
    const qrCanvas = document.createElement("canvas");
    await QRCode.toCanvas(qrCanvas, shareUrl, {
      width: 260,
      margin: 0,
      color: { dark: "#212121", light: "#FFFFFF" },
    });
    ctx.drawImage(qrCanvas, 270, 520, 260, 260);
  } catch {
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#9E9E9E";
    ctx.fillText("QR generation failed", 400, 650);
  }

  // "Scan to view in AR" label
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#424242";
  ctx.fillText("Scan to view in AR", 400, 810);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#9E9E9E";
  ctx.fillText(shareUrl, 400, 838);

  // Project name footer
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#BDBDBD";
  ctx.fillText(projectName, 400, 900);
  ctx.fillText("Print at 100% scale · Place marker at indicated coordinates", 400, 925);

  return canvas.toDataURL("image/png");
}

interface CheckItem {
  label: string;
  passed: boolean;
  hint?: string;
}

const GenerateExperience = ({ project, hasModel, hasValidMarkers, mode, markerData, onGenerated }: GenerateExperienceProps) => {
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
              <div className="space-y-2">
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
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    try {
                      const qrCanvas = document.createElement("canvas");
                      await QRCode.toCanvas(qrCanvas, shareUrl, {
                        width: 600,
                        margin: 2,
                        color: { dark: "#212121", light: "#FFFFFF" },
                      });
                      const a = document.createElement("a");
                      a.href = qrCanvas.toDataURL("image/png");
                      a.download = `qr_${project.name.replace(/\s+/g, "_")}.png`;
                      a.click();
                    } catch {
                      toast({ title: "QR generation failed", variant: "destructive" });
                    }
                  }}
                >
                  <Download className="mr-1 h-3 w-3" />
                  Download QR Code
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

        {/* Download Marker References */}
        {isActive && mode === "multipoint" && markerData && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileDown className="h-4 w-4 text-muted-foreground" />
              Marker Reference Sheets
            </h3>
            <p className="text-xs text-muted-foreground">
              Download and print these reference sheets. Place each marker at the indicated coordinates on site.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["A", "B", "C"] as const).map((pointId) => {
                const point = markerData[pointId];
                if (!point) return null;
                return (
                  <Button
                    key={pointId}
                    variant="outline"
                    size="sm"
                    className="justify-start gap-2"
                    onClick={async () => {
                      const dataUrl = await generateMarkerImage(pointId, point, project.name, shareUrl!);
                      const a = document.createElement("a");
                      a.href = dataUrl;
                      a.download = `marker_${pointId}_${project.name.replace(/\s+/g, "_")}.png`;
                      a.click();
                    }}
                  >
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: MARKER_COLORS[pointId].fill }}
                    />
                    <Download className="h-3 w-3" />
                    Marker {pointId}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GenerateExperience;
