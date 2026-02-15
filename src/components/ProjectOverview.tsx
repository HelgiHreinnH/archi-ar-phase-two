import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Copy, Link2, Download, Pencil,
  MapPin, ChevronDown, ChevronUp, FileText, ExternalLink,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
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

const MARKER_COLORS: Record<string, string> = {
  A: "#E53935",
  B: "#43A047",
  C: "#1E88E5",
};

const ProjectOverview = ({ project, onEdit }: ProjectOverviewProps) => {
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const mode = project.mode === "tabletop" ? "tabletop" : "multipoint";
  const markerData = project.marker_data as unknown as MarkerData | null;
  const shareUrl = project.share_link
    ? `${window.location.origin}/view/${project.share_link}`
    : null;

  const copyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied" });
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

  const fileName = project.model_url?.split("/").pop() || "—";
  const fileFormat = project.model_url?.toLowerCase().endsWith(".usdz") ? "USDZ" : "GLB";

  return (
    <div className="space-y-4">
      {/* 3D Model Preview */}
      {project.model_url && (
        <ModelViewer3D modelUrl={project.model_url} className="h-56 w-full" />
      )}

      {/* Primary Actions */}
      <Card>
        <CardContent className="pt-5 pb-5 space-y-4">
          {/* Status + share row */}
          {shareUrl ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-sm font-medium truncate">Live</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyLink} title="Copy link">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Open preview">
                  <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <Badge variant="secondary" className="text-xs">Draft</Badge>
          )}

          {/* Key details — compact */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {project.client_name && (
              <div>
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Client</span>
                <p className="font-medium truncate">{project.client_name}</p>
              </div>
            )}
            <div>
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Model</span>
              <p className="font-medium truncate">{fileName}</p>
              <Badge variant="secondary" className="text-[10px] mt-0.5 px-1.5 py-0">{fileFormat}</Badge>
            </div>
            {project.location && (
              <div>
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Location</span>
                <p className="font-medium truncate">{project.location}</p>
              </div>
            )}
            {mode === "tabletop" && (
              <>
                <div>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Scale</span>
                  <p className="font-mono font-medium">{project.scale || "1:20"}</p>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Rotation</span>
                  <p className="font-medium">{project.initial_rotation ?? 0}°</p>
                </div>
              </>
            )}
          </div>

          {project.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
          )}
        </CardContent>
      </Card>

      {/* Marker Coordinates — multipoint only */}
      {mode === "multipoint" && markerData && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Markers</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["A", "B", "C"] as const).map((id) => {
                const point = markerData[id];
                if (!point) return null;
                return (
                  <div key={id} className="rounded-lg border p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: MARKER_COLORS[id] }}
                      />
                      <span className="text-sm font-bold">Point {id}</span>
                    </div>

                    {/* Label */}
                    <div className="rounded-md border bg-muted/40 px-3 py-1.5">
                      <span className="text-sm text-muted-foreground">{point.label}</span>
                    </div>

                    {/* X */}
                    <div>
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">X (mm)</span>
                      <div className="rounded-md border bg-muted/40 px-3 py-1.5 mt-1 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{point.x >= 0 ? "+" : "−"}</span>
                        <span className="text-base font-semibold font-mono">{Math.abs(point.x)}</span>
                      </div>
                    </div>

                    {/* Y */}
                    <div>
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Y (mm)</span>
                      <div className="rounded-md border bg-muted/40 px-3 py-1.5 mt-1 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{point.y >= 0 ? "+" : "−"}</span>
                        <span className="text-base font-semibold font-mono">{Math.abs(point.y)}</span>
                      </div>
                    </div>

                    {/* Z */}
                    <div>
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Z (mm)</span>
                      <div className="rounded-md border bg-muted/40 px-3 py-1.5 mt-1 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{point.z >= 0 ? "+" : "−"}</span>
                        <span className="text-base font-semibold font-mono">{Math.abs(point.z)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Downloads — collapsible */}
      {shareUrl && (
        <Card>
          <CardContent className="pt-0 pb-0">
            <button
              className="flex items-center justify-between w-full py-3.5 text-sm font-semibold text-left"
              onClick={() => setDownloadsOpen(!downloadsOpen)}
            >
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4 text-muted-foreground" />
                Downloads
              </span>
              {downloadsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {downloadsOpen && (
              <div className="pb-4 space-y-3">
                <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={downloadQR}>
                  <Download className="h-3.5 w-3.5" />
                  QR Code
                </Button>

                {mode === "multipoint" && markerData && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(["A", "B", "C"] as const).map((id) => {
                        const point = markerData[id];
                        if (!point) return null;
                        return (
                          <Button
                            key={id}
                            variant="ghost"
                            size="sm"
                            className="justify-start gap-2 text-xs h-8"
                            onClick={() => downloadMarkerPDF(id, point, project.name, shareUrl!)}
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: MARKER_COLORS[id] }}
                            />
                            <FileText className="h-3 w-3" />
                            Marker {id}
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
                      <Download className="h-3.5 w-3.5" />
                      All Markers (PDF)
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit */}
      <Button variant="outline" className="w-full" onClick={onEdit}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit Experience
      </Button>
    </div>
  );
};

export default ProjectOverview;
