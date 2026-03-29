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
import { type MarkerPoint, getMarkerColor, normalizeMarkerData } from "@/lib/markerTypes";
import QRCode from "qrcode";
import ModelViewer3D from "@/components/ModelViewer3D";
import { downloadMarkerPDF, downloadAllMarkerPDFs } from "@/lib/generateMarkerPDF";
import { downloadTabletopPrintSheet } from "@/lib/generateTabletopPDF";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";

type Project = Tables<"projects">;

interface ProjectOverviewProps {
  project: Project;
  onEdit: () => void;
}

const ProjectOverview = ({ project, onEdit }: ProjectOverviewProps) => {
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const mode = project.mode === "tabletop" ? "tabletop" : "multipoint";
  const markerData = normalizeMarkerData(project.marker_data);
  const shareUrl = project.share_link
    ? buildPublicExperienceUrl(project.share_link)
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
      const qrBlob = await new Promise<Blob>((resolve, reject) => {
        qrCanvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("QR blob generation failed"));
        }, "image/png");
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(qrBlob);
      a.download = `qr_${project.name.replace(/\s+/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "QR generation failed", variant: "destructive" });
    }
  };

  const fileName = project.model_url?.split("/").pop() || "—";
  const fileFormat = project.model_url?.toLowerCase().endsWith(".usdz") ? "USDZ" : "GLB";

  return (
    <div className="space-y-3">
      {/* Top row: 3D Preview + Info card */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">
        {project.model_url && (
          <ModelViewer3D modelUrl={project.model_url} className="aspect-video w-full rounded-lg" />
        )}

        <Card className="flex flex-col">
          <CardContent className="pt-4 pb-4 space-y-3 flex-1">
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

            <Button variant="outline" size="sm" className="w-full mt-auto" onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit Experience
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Markers + Downloads */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">
        {mode === "multipoint" && markerData && markerData.length > 0 ? (
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">Markers ({markerData.length})</span>
              </div>
              <div className="grid gap-2 grid-cols-3">
                {markerData.slice(0, 6).map((marker) => {
                  const color = getMarkerColor(marker.index);
                  return (
                    <div key={marker.index} className="rounded-lg border p-2.5 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: color.bg }}
                        />
                        <span className="text-xs font-bold">Point {marker.index}</span>
                      </div>
                      {marker.label && <p className="text-[11px] text-muted-foreground">{marker.label}</p>}
                      {(["x", "y", "z"] as const).map((axis) => (
                        <div key={axis} className="flex items-baseline gap-1">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase shrink-0 w-5">{axis}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{marker[axis] >= 0 ? "+" : "−"}</span>
                          <span className="text-xs font-semibold font-mono">{Math.abs(marker[axis])}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {markerData.length > 6 && (
                <p className="text-xs text-muted-foreground mt-2">+ {markerData.length - 6} more markers</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div />
        )}

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

                  {mode === "tabletop" && (() => {
                    const markerImageUrlsData = project.marker_image_urls as Record<string, string> | null;
                    const arRefUrl = markerImageUrlsData?.tabletop;
                    return arRefUrl ? (
                      <>
                        <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-8" asChild>
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

                  {mode === "multipoint" && markerData && markerData.length > 0 && (
                    <>
                      <div className="space-y-1">
                        {markerData.map((marker) => {
                          const color = getMarkerColor(marker.index);
                          return (
                            <Button
                              key={marker.index}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start gap-2 text-xs h-7"
                              onClick={() => downloadMarkerPDF(marker, project.name, shareUrl!)}
                            >
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: color.bg }}
                              />
                              <FileText className="h-3 w-3" />
                              Marker {marker.index}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start gap-2 h-8"
                        onClick={() => downloadAllMarkerPDFs(markerData, project.name, shareUrl!)}
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
