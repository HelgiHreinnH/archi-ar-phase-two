import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Rocket, CheckCircle2, AlertCircle, Loader2,
  Download, Link2, Copy, FileDown, Image, Cpu, QrCode, Upload, Zap, FileText,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerData } from "@/components/MarkerCoordinateEditor";
import QRCode from "qrcode";
import { generateAllMarkerImages, canvasToImage, type MarkerPoint } from "@/lib/generateMarkers";
import { compileMindFile } from "@/lib/compileMindFile";
import { downloadMarkerPDF, downloadAllMarkerPDFs } from "@/lib/generateMarkerPDF";

type Project = Tables<"projects">;

interface GenerateExperienceProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: "tabletop" | "multipoint";
  markerData: MarkerData | null;
  onGenerated: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  hint?: string;
}

type GenerationStep =
  | "idle"
  | "markers"
  | "compiling"
  | "qr"
  | "uploading"
  | "activating"
  | "done"
  | "error";

const STEP_LABELS: Record<GenerationStep, string> = {
  idle: "",
  markers: "Generating marker images…",
  compiling: "Compiling MindAR targets…",
  qr: "Creating QR code…",
  uploading: "Uploading assets…",
  activating: "Activating experience…",
  done: "Complete!",
  error: "Generation failed",
};

const STEP_PROGRESS: Record<GenerationStep, number> = {
  idle: 0,
  markers: 15,
  compiling: 45,
  qr: 60,
  uploading: 80,
  activating: 95,
  done: 100,
  error: 0,
};

const GenerateExperience = ({
  project,
  hasModel,
  hasValidMarkers,
  mode,
  markerData,
  onGenerated,
}: GenerateExperienceProps) => {
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState<GenerationStep>("idle");
  const [compileProgress, setCompileProgress] = useState(0);

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

  const overallProgress =
    step === "compiling"
      ? STEP_PROGRESS.markers + (compileProgress / 100) * (STEP_PROGRESS.compiling - STEP_PROGRESS.markers)
      : STEP_PROGRESS[step];

  const handleGenerate = useCallback(async () => {
    if (!allPassed) return;

    setGenerating(true);
    setStep("idle");

    try {
      const shareId = project.share_link || crypto.randomUUID();
      const shareUrl = `${window.location.origin}/view/${shareId}`;
      const projectPath = `${project.id}`;

      // ── Step 1: Generate marker images ──
      setStep("markers");
      let markerImageUrls: Record<string, string> = {};
      let mindFileUrl: string | null = null;

      if (mode === "multipoint" && markerData) {
        const points: Record<string, MarkerPoint> = {};
        for (const [id, data] of Object.entries(markerData)) {
          points[id] = {
            x: data.x,
            y: data.y,
            z: data.z,
            label: data.label || `Point ${id}`,
          };
        }

        const generatedMarkers = await generateAllMarkerImages(points, project.name);

        // ── Step 2: Compile .mind file ──
        setStep("compiling");
        setCompileProgress(0);

        const markerImages = await Promise.all(
          generatedMarkers.map((m) => canvasToImage(m.canvas))
        );
        const { blob: mindBlob } = await compileMindFile(markerImages, (p) =>
          setCompileProgress(p)
        );

        // ── Step 3: Generate QR code ──
        setStep("qr");

        // ── Step 4: Upload everything ──
        setStep("uploading");

        // Upload marker images
        for (const marker of generatedMarkers) {
          const filePath = `${projectPath}/markers/marker_${marker.id}.png`;
          const { error: uploadErr } = await supabase.storage
            .from("project-assets")
            .upload(filePath, marker.blob, {
              contentType: "image/png",
              upsert: true,
            });
          if (uploadErr) throw uploadErr;

          const { data: urlData } = supabase.storage
            .from("project-assets")
            .getPublicUrl(filePath);
          markerImageUrls[marker.id] = urlData.publicUrl;
        }

        // Upload .mind file
        const mindPath = `${projectPath}/targets.mind`;
        const { error: mindUploadErr } = await supabase.storage
          .from("project-assets")
          .upload(mindPath, mindBlob, {
            contentType: "application/octet-stream",
            upsert: true,
          });
        if (mindUploadErr) throw mindUploadErr;

        const { data: mindUrlData } = supabase.storage
          .from("project-assets")
          .getPublicUrl(mindPath);
        mindFileUrl = mindUrlData.publicUrl;
      }

      // Generate and upload QR code
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, shareUrl, {
        width: 600,
        margin: 2,
        color: { dark: "#212121", light: "#FFFFFF" },
      });
      const qrBlob = await new Promise<Blob>((resolve) => {
        qrCanvas.toBlob((b) => resolve(b!), "image/png");
      });
      const qrPath = `${projectPath}/qr_code.png`;
      const { error: qrUploadErr } = await supabase.storage
        .from("project-assets")
        .upload(qrPath, qrBlob, {
          contentType: "image/png",
          upsert: true,
        });
      if (qrUploadErr) throw qrUploadErr;

      const { data: qrUrlData } = supabase.storage
        .from("project-assets")
        .getPublicUrl(qrPath);

      // ── Step 5: Activate experience ──
      setStep("activating");

      const updatePayload: Record<string, any> = {
        share_link: shareId,
        status: "active",
        qr_code_url: qrUrlData.publicUrl,
      };

      if (mode === "multipoint") {
        updatePayload.mind_file_url = mindFileUrl;
        updatePayload.marker_image_urls = markerImageUrls;
      }

      const { error } = await supabase
        .from("projects")
        .update(updatePayload)
        .eq("id", project.id);

      if (error) throw error;

      setStep("done");
      toast({
        title: "AR Experience Generated! 🚀",
        description: "Marker images compiled, assets uploaded, and experience is live.",
      });
      onGenerated();
    } catch (err: any) {
      setStep("error");
      console.error("Generation error:", err);
      toast({
        title: "Generation failed",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [allPassed, project, mode, markerData, onGenerated]);

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

        {/* Generation Progress */}
        {generating && step !== "idle" && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              {step === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-marker-green" />
              ) : step === "error" ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              <span>{STEP_LABELS[step]}</span>
            </div>
            <Progress value={overallProgress} className="h-2" />
            <div className="grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
              {[
                { key: "markers", icon: Image, label: "Markers" },
                { key: "compiling", icon: Cpu, label: "Compile" },
                { key: "qr", icon: QrCode, label: "QR Code" },
                { key: "uploading", icon: Upload, label: "Upload" },
                { key: "activating", icon: Zap, label: "Activate" },
              ].map(({ key, icon: Icon, label }) => {
                const stepKeys: GenerationStep[] = ["markers", "compiling", "qr", "uploading", "activating", "done"];
                const currentIdx = stepKeys.indexOf(step);
                const thisIdx = stepKeys.indexOf(key as GenerationStep);
                const isDone = currentIdx > thisIdx || step === "done";
                const isActive = key === step;
                return (
                  <div
                    key={key}
                    className={`flex flex-col items-center gap-0.5 ${
                      isDone
                        ? "text-marker-green"
                        : isActive
                        ? "text-primary font-medium"
                        : ""
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

        {/* Downloads Section */}
        {isActive && shareUrl && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileDown className="h-4 w-4 text-muted-foreground" />
              Downloads
            </h3>

            {/* QR Code Download */}
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
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
              <Download className="h-3 w-3" />
              Download QR Code
            </Button>

            {/* Marker PDFs — multipoint only */}
            {mode === "multipoint" && markerData && (
              <>
                <p className="text-xs text-muted-foreground">
                  Download print-ready A4 PDFs with marker image, QR code, and placement instructions.
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
                        onClick={() =>
                          downloadMarkerPDF(pointId, point, project.name, shareUrl!)
                        }
                      >
                        <div
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              pointId === "A" ? "hsl(0 100% 60%)" : pointId === "B" ? "hsl(145 63% 49%)" : "hsl(211 100% 50%)",
                          }}
                        />
                        <FileText className="h-3 w-3" />
                        Marker {pointId} PDF
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    const points: Record<string, { x: number; y: number; z: number; label: string }> = {};
                    for (const id of ["A", "B", "C"] as const) {
                      if (markerData[id]) points[id] = markerData[id];
                    }
                    downloadAllMarkerPDFs(points, project.name, shareUrl!);
                  }}
                >
                  <Download className="h-3 w-3" />
                  Download All Marker PDFs
                </Button>
              </>
            )}

            {/* .mind file download */}
            {(project as any).mind_file_url && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                asChild
              >
                <a
                  href={(project as any).mind_file_url}
                  download={`targets_${project.name.replace(/\s+/g, "_")}.mind`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="h-3 w-3" />
                  Download MindAR Targets (.mind)
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GenerateExperience;
