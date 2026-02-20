import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Copy, Link2, Download, Pencil,
  MapPin, ChevronDown, ChevronUp, FileText, ExternalLink, Image,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerData } from "@/components/MarkerCoordinateEditor";
import QRCode from "qrcode";
import ModelViewer3D from "@/components/ModelViewer3D";
import { downloadMarkerPDF, downloadAllMarkerPDFs } from "@/lib/generateMarkerPDF";
import { downloadTabletopPrintSheet } from "@/lib/generateTabletopPDF";

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
    <div className="space-y-3">
      {/* Top row: 3D Preview (landscape) + Info card (portrait) */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">
        {/* 3D Model Preview — 16:9ish */}
        {project.model_url && (
          <ModelViewer3D modelUrl={project.model_url} className="aspect-video w-full rounded-lg" />
        )}

        {/* Info card */}
        <Card className="flex flex-col">
          <CardContent className="pt-4 pb-4 space-y-3 flex-1">
            {/* Status + share row */}
            {shareUrl ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                  <span className="text-sm font-medium">Live</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyLink} title="Copy link">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Open preview">
                    <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <Badge variant="secondary" className="text-xs">Draft</Badge>
            )}

            {/* Key details — stacked in narrow card */}
            <div className="space-y-2 text-sm">
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Scale</span>
                    <p className="font-mono font-medium">{project.scale || "1:1"}</p>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Rotation</span>
                    <p className="font-medium">{project.initial_rotation ?? 0}°</p>
                  </div>
                </div>
              )}
            </div>

            {/* Edit button at bottom of card */}
            <Button variant="outline" size="sm" className="w-full mt-auto" onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit Experience
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Markers + Downloads side by side */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">
        {/* Marker Coordinates — multipoint only */}
        {mode === "multipoint" && markerData ? (
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">Markers</span>
              </div>
              <div className="grid gap-2 grid-cols-3">
                {(["A", "B", "C"] as const).map((id) => {
                  const point = markerData[id];
                  if (!point) return null;
                  return (
                    <div key={id} className="rounded-lg border p-2.5 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: MARKER_COLORS[id] }}
                        />
                        <span className="text-xs font-bold">Point {id}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{point.label}</p>
                      {(["x", "y", "z"] as const).map((axis) => (
                        <div key={axis} className="flex items-baseline gap-1">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase shrink-0 w-5">{axis}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{point[axis] >= 0 ? "+" : "−"}</span>
                          <span className="text-xs font-semibold font-mono">{Math.abs(point[axis])}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div />
        )}

        {/* Downloads */}
        {shareUrl && (
          <Card>
            <CardContent className="pt-0 pb-0">
              <button
                className="flex items-center justify-between w-full py-3 text-sm font-semibold text-left"
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
                <div className="pb-3 space-y-2">
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-8" onClick={downloadQR}>
                    <Download className="h-3.5 w-3.5" />
                    QR Code
                  </Button>

                  {/* Tabletop downloads */}
                  {mode === "tabletop" && (() => {
                    const markerImageUrlsData = project.marker_image_urls as Record<string, string> | null;
                    const arRefUrl = markerImageUrlsData?.tabletop;
                    return arRefUrl ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 h-8"
                          asChild
                        >
                          <a href={arRefUrl} download={`ar_marker_${project.name.replace(/\s+/g, "_")}.png`} target="_blank" rel="noopener noreferrer">
                            <Image className="h-3.5 w-3.5" />
                            AR Reference Image
                          </a>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 h-8"
                          onClick={async () => {
                            try {
                              await downloadTabletopPrintSheet(project.name, shareUrl!, arRefUrl);
                            } catch {
                              toast({ title: "PDF generation failed", variant: "destructive" });
                            }
                          }}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Print Sheet (PDF)
                        </Button>
                      </>
                    ) : null;
                  })()}

                  {/* Multipoint marker downloads */}
                  {mode === "multipoint" && markerData && (
                    <>
                      <div className="space-y-1">
                        {(["A", "B", "C"] as const).map((id) => {
                          const point = markerData[id];
                          if (!point) return null;
                          return (
                            <Button
                              key={id}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start gap-2 text-xs h-7"
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
                        className="w-full justify-start gap-2 h-8"
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
      </div>
    </div>
  );
};

export default ProjectOverview;
