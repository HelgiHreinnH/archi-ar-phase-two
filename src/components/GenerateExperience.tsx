import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Rocket, CheckCircle2, AlertCircle, Loader2,
  Download, Link2, Copy, FileDown, FileText, QrCode, Upload, Zap, Image, Cpu,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import { type MarkerPoint, getMarkerColor } from "@/lib/markerTypes";
import { downloadMarkerPDF, downloadAllMarkerPDFs } from "@/lib/generateMarkerPDF";
import QRCode from "qrcode";
import {
  useTabletopGeneration,
  TABLETOP_PIPELINE,
  type TabletopStep,
} from "@/hooks/useTabletopGeneration";
import {
  useMultipointGeneration,
  MULTIPOINT_PIPELINE,
  type MultipointStep,
} from "@/hooks/useMultipointGeneration";

type Project = Tables<"projects">;

interface GenerateExperienceProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: "tabletop" | "multipoint";
  markerData: MarkerPoint[] | null;
  onGenerated: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  hint?: string;
}

const STEP_LABELS: Record<string, string> = {
  idle: "",
  markers: "Generating marker images…",
  compiling: "Compiling MindAR targets…",
  qr: "Creating QR code…",
  uploading: "Uploading assets…",
  activating: "Activating experience…",
  done: "Complete!",
  error: "Generation failed",
};

const ICON_MAP: Record<string, typeof QrCode> = {
  qr: QrCode,
  uploading: Upload,
  activating: Zap,
  markers: Image,
  compiling: Cpu,
};

const GenerateExperience = ({
  project,
  hasModel,
  hasValidMarkers,
  mode,
  markerData,
  onGenerated,
}: GenerateExperienceProps) => {
  const isTabletop = mode === "tabletop";

  const tabletop = useTabletopGeneration(project, onGenerated);
  const multipoint = useMultipointGeneration(project, markerData, onGenerated);

  // Unified interface
  const generating = isTabletop ? tabletop.generating : multipoint.generating;
  const step = isTabletop ? tabletop.step : multipoint.step;
  const progress = isTabletop ? tabletop.progress : multipoint.progress;
  const generate = isTabletop ? tabletop.generate : multipoint.generate;

  const pipeline = isTabletop ? TABLETOP_PIPELINE : MULTIPOINT_PIPELINE;
  const stepKeys = [...pipeline.map((s) => s.key), "done"] as string[];

  // ── Checklist ──
  const checks: CheckItem[] = isTabletop
    ? [
        { label: "3D model uploaded", passed: hasModel, hint: "Upload a GLB or USDZ model above" },
        { label: "Scale configured", passed: !!project.scale, hint: "Set the model scale" },
      ]
    : [
        { label: "3D model uploaded", passed: hasModel, hint: "Upload a GLB or USDZ model above" },
        { label: `Marker coordinates set (${markerData?.length ?? 0} points)`, passed: hasValidMarkers, hint: "Enter coordinates for at least 3 points" },
        { label: "Spacing quality sufficient", passed: hasValidMarkers, hint: "Ensure points form a valid configuration" },
      ];

  const allPassed = checks.every((c) => c.passed);
  const isActive = project.status === "active";

  const shareUrl = project.share_link
    ? `${window.location.origin}/view/${project.share_link}`
    : null;

  const copyShareLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied to clipboard" });
    }
  };

  const currentIdx = stepKeys.indexOf(step);

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
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
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
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : step === "error" ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              <span>{STEP_LABELS[step] || step}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className={`grid gap-1 text-[10px] text-muted-foreground`} style={{ gridTemplateColumns: `repeat(${pipeline.length}, 1fr)` }}>
              {pipeline.map(({ key, label }) => {
                const thisIdx = stepKeys.indexOf(key);
                const isDone = currentIdx > thisIdx || step === "done";
                const isCurrent = key === step;
                const Icon = ICON_MAP[key] || Zap;
                return (
                  <div
                    key={key}
                    className={`flex flex-col items-center gap-0.5 ${
                      isDone ? "text-green-600" : isCurrent ? "text-primary font-medium" : ""
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

        {/* Generate / Regenerate Button */}
        {!isActive ? (
          <Button className="w-full" size="lg" disabled={!allPassed || generating} onClick={generate}>
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
            <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/5 p-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Experience is Live</p>
                {shareUrl && <p className="text-xs text-muted-foreground truncate">{shareUrl}</p>}
              </div>
              <Badge className="bg-green-600/10 text-green-600 border-0">Active</Badge>
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

            <Button variant="outline" className="w-full" onClick={generate} disabled={generating}>
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

        {/* ── Downloads Section ── */}
        {isActive && shareUrl && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileDown className="h-4 w-4 text-muted-foreground" />
              Downloads
            </h3>

            {/* QR Code Download — both modes */}
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={async () => {
                try {
                  const qrCanvas = document.createElement("canvas");
                  await QRCode.toCanvas(qrCanvas, shareUrl, {
                    width: 600, margin: 2,
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

            {/* Tabletop: QR code only — no markers needed */}
            {isTabletop && (
              <p className="text-xs text-muted-foreground">
                Print and display the QR code — users scan it to launch the 3D experience with native AR placement.
              </p>
            )}

            {/* Multipoint: Marker PDFs + .mind file */}
            {!isTabletop && markerData && markerData.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  Download print-ready A4 PDFs with marker image, QR code, and placement instructions.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {markerData.map((marker) => {
                    const color = getMarkerColor(marker.index);
                    return (
                      <Button
                        key={marker.index}
                        variant="outline"
                        size="sm"
                        className="justify-start gap-2"
                        onClick={() => downloadMarkerPDF(marker, project.name, shareUrl)}
                      >
                        <div
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: color.bg }}
                        />
                        <FileText className="h-3 w-3" />
                        Marker {marker.index} PDF
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => downloadAllMarkerPDFs(markerData, project.name, shareUrl)}
                >
                  <Download className="h-3 w-3" />
                  Download All Marker PDFs
                </Button>
              </>
            )}

            {/* .mind file — multipoint only */}
            {!isTabletop && project.mind_file_url && (
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" asChild>
                <a
                  href={project.mind_file_url}
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
