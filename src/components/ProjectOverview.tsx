import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Copy, Link2, Download, FileDown, Pencil,
  MapPin, Grid3X3, Compass, User, FileBox, FileText,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerData } from "@/components/MarkerCoordinateEditor";
import QRCode from "qrcode";
import ModelViewer3D from "@/components/ModelViewer3D";
import { downloadMarkerPDF, downloadAllMarkerPDFs } from "@/lib/generateMarkerPDF";

type Project = Tables<"projects">;

interface ProjectOverviewProps {
  project: Project;
  onEdit: () => void;
}

const MARKER_COLORS: Record<string, { fill: string; label: string }> = {
  A: { fill: "#E53935", label: "Point A" },
  B: { fill: "#43A047", label: "Point B" },
  C: { fill: "#1E88E5", label: "Point C" },
};

const ROTATION_LABELS: Record<number, string> = {
  0: "North ↑",
  90: "East →",
  180: "South ↓",
  270: "West ←",
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

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 800, 1000);
  ctx.strokeStyle = "#E0E0E0";
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 760, 960);

  ctx.beginPath();
  ctx.arc(400, 220, 120, 0, Math.PI * 2);
  ctx.fillStyle = cfg.fill;
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 100px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pointId, 400, 220);

  ctx.fillStyle = "#212121";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(cfg.label, 400, 390);
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#757575";
  ctx.fillText(coords.label || cfg.label, 400, 425);

  ctx.font = "bold 20px monospace";
  ctx.fillStyle = "#424242";
  ctx.fillText(`X: ${coords.x}   Y: ${coords.y}   Z: ${coords.z}  (mm)`, 400, 480);

  try {
    const qrCanvas = document.createElement("canvas");
    await QRCode.toCanvas(qrCanvas, shareUrl, { width: 260, margin: 0, color: { dark: "#212121", light: "#FFFFFF" } });
    ctx.drawImage(qrCanvas, 270, 520, 260, 260);
  } catch {}

  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#424242";
  ctx.fillText("Scan to view in AR", 400, 810);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#9E9E9E";
  ctx.fillText(shareUrl, 400, 838);
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#BDBDBD";
  ctx.fillText(projectName, 400, 900);

  return canvas.toDataURL("image/png");
}

const ProjectOverview = ({ project, onEdit }: ProjectOverviewProps) => {
  const mode = project.mode === "tabletop" ? "tabletop" : "multipoint";
  const markerData = project.marker_data as unknown as MarkerData | null;
  const shareUrl = project.share_link
    ? `${window.location.origin}/view/${project.share_link}`
    : null;

  const copyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied to clipboard" });
    }
  };

  const downloadQR = async () => {
    if (!shareUrl) return;
    try {
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, shareUrl, { width: 600, margin: 2, color: { dark: "#212121", light: "#FFFFFF" } });
      const a = document.createElement("a");
      a.href = qrCanvas.toDataURL("image/png");
      a.download = `qr_${project.name.replace(/\s+/g, "_")}.png`;
      a.click();
    } catch {
      toast({ title: "QR generation failed", variant: "destructive" });
    }
  };

  const downloadMarker = async (pointId: string) => {
    if (!shareUrl || !markerData) return;
    const point = markerData[pointId as keyof MarkerData];
    if (!point) return;
    const dataUrl = await generateMarkerImage(pointId, point, project.name, shareUrl);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `marker_${pointId}_${project.name.replace(/\s+/g, "_")}.png`;
    a.click();
  };

  const fileName = project.model_url?.split("/").pop() || "—";
  const fileFormat = project.model_url?.toLowerCase().endsWith(".usdz") ? "USDZ" : "GLB";

  return (
    <div className="space-y-6">
      {/* 3D Model Preview */}
      {project.model_url && (
        <ModelViewer3D modelUrl={project.model_url} className="h-64 w-full" />
      )}

      {/* Project Info */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          {/* Status bar */}
          {shareUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Experience is Live</p>
                <p className="text-xs text-muted-foreground truncate">{shareUrl}</p>
              </div>
              <Badge className="bg-primary/10 text-primary border-0">Active</Badge>
            </div>
          )}

          {/* Actions */}
          {shareUrl && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={copyLink}>
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

          {/* Details grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {project.client_name && (
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <span className="text-xs text-muted-foreground block">Client</span>
                  <span className="text-sm font-medium">{project.client_name}</span>
                </div>
              </div>
            )}
            {project.location && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <span className="text-xs text-muted-foreground block">Location</span>
                  <span className="text-sm font-medium">{project.location}</span>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <FileBox className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-xs text-muted-foreground block">3D Model</span>
                <span className="text-sm font-medium truncate block max-w-[200px]">{fileName}</span>
                <Badge variant="secondary" className="text-[10px] mt-0.5">{fileFormat}</Badge>
              </div>
            </div>
            {mode === "tabletop" && (
              <>
                <div className="flex items-start gap-2">
                  <Grid3X3 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs text-muted-foreground block">Scale</span>
                    <span className="text-sm font-mono font-medium">{project.scale || "1:20"}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Compass className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs text-muted-foreground block">Rotation</span>
                    <span className="text-sm font-medium">
                      {ROTATION_LABELS[project.initial_rotation ?? 0] || `${project.initial_rotation}°`}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {project.description && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Description</span>
              <p className="text-sm">{project.description}</p>
            </div>
          )}

          {/* Marker coordinates — multipoint only */}
          {mode === "multipoint" && markerData && (
            <div className="space-y-2 border-t pt-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Marker Coordinates
              </h4>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["A", "B", "C"] as const).map((id) => {
                  const point = markerData[id];
                  if (!point) return null;
                  return (
                    <div key={id} className="rounded-lg border p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: MARKER_COLORS[id].fill }}
                        />
                        <span className="text-xs font-semibold">Point {id}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{point.label}</p>
                      <p className="font-mono text-[11px]">
                        X: {point.x} · Y: {point.y} · Z: {point.z}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Downloads */}
          {shareUrl && (
            <div className="space-y-3 border-t pt-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <FileDown className="h-4 w-4 text-muted-foreground" />
                Downloads
              </h4>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={downloadQR}>
                <Download className="h-3 w-3" />
                Download QR Code
              </Button>

              {mode === "multipoint" && markerData && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Download print-ready A4 PDFs with marker image, QR code, and placement instructions.
                  </p>

                  {/* PDF downloads */}
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(["A", "B", "C"] as const).map((id) => {
                      const point = markerData[id];
                      if (!point) return null;
                      return (
                        <Button
                          key={id}
                          variant="outline"
                          size="sm"
                          className="justify-start gap-2"
                          onClick={() =>
                            downloadMarkerPDF(id, point, project.name, shareUrl!)
                          }
                        >
                          <div
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: MARKER_COLORS[id].fill }}
                          />
                          <FileText className="h-3 w-3" />
                          Marker {id} PDF
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

                  {/* Raw PNG downloads */}
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Or download raw marker images (PNG):
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(["A", "B", "C"] as const).map((id) => (
                      <Button
                        key={id}
                        variant="ghost"
                        size="sm"
                        className="justify-start gap-2 text-xs"
                        onClick={() => downloadMarker(id)}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: MARKER_COLORS[id].fill }}
                        />
                        <Download className="h-3 w-3" />
                        PNG {id}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Edit button */}
          <Button variant="outline" className="w-full" onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit Experience
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectOverview;
