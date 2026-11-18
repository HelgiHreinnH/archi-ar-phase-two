import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/plans";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";
import { spatialQrPng } from "@/lib/spatial/qrExport";
import { generateAllMarkerImages } from "@/lib/generateMarkers";
import { SPATIAL_TRACKING_FORMAT } from "@/lib/arEngines";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";

type Project = Tables<"projects">;

export type MultipointStep =
  | "idle" | "markers" | "qr" | "uploading" | "activating" | "done" | "error";

const STEP_PROGRESS: Record<MultipointStep, number> = {
  idle: 0,
  markers: 15,
  qr: 60,
  uploading: 80,
  activating: 95,
  done: 100,
  error: 0,
};

// No "Compile" step: 8th Wall builds its targets from the marker PNGs at
// view time (the MindAR .mind compile was archived on 18 Nov 2026).
export const MULTIPOINT_PIPELINE = [
  { key: "markers" as const, label: "Markers" },
  { key: "qr" as const, label: "QR Code" },
  { key: "uploading" as const, label: "Upload" },
  { key: "activating" as const, label: "Activate" },
];

export function useMultipointGeneration(
  project: Project,
  markerData: MarkerPoint[] | null,
  onGenerated: () => void
) {
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState<MultipointStep>("idle");
  const progress = STEP_PROGRESS[step];

  const generate = useCallback(async () => {
    if (!markerData || markerData.length < 3) return;

    setGenerating(true);
    setStep("idle");

    try {
      const shareId = project.share_link || crypto.randomUUID();
      const shareUrl = buildPublicExperienceUrl(shareId);
      const projectPath = project.id;

      // ── Generate marker images ──
      setStep("markers");
      const generatedMarkers = await generateAllMarkerImages(markerData, project.name);

      // ── Upload marker images ──
      // The marker PNGs are the 8th Wall image targets (one per marker), built
      // into targets at view time by SpatialWorldViewer. Nothing is compiled:
      // the MindAR .mind compile was archived on 18 Nov 2026 (archive/mindar/).
      setStep("uploading");
      const markerImageUrls: Record<string, string> = {};
      await Promise.all(generatedMarkers.map(async (marker) => {
        const filePath = `${projectPath}/markers/marker_${marker.index}.png`;
        const { error: uploadErr } = await supabase.storage
          .from("project-assets")
          .upload(filePath, marker.blob, { contentType: "image/png", upsert: true });
        if (uploadErr) throw uploadErr;
        // Store bare path — signed URLs are generated on retrieval
        markerImageUrls[String(marker.index)] = filePath;
      }));

      // ── QR code ──
      setStep("qr");
      // Designed round QR (Spatial only — Tabletop/Wall keep TABLETOP_QR_OPTIONS)
      const qrBlob = await spatialQrPng(shareUrl, "round", 1200);
      const qrPath = `${projectPath}/qr_code.png`;
      const { error: qrUploadErr } = await supabase.storage
        .from("project-assets")
        .upload(qrPath, qrBlob, { contentType: "image/png", upsert: true });
      if (qrUploadErr) throw qrUploadErr;

      // ── Activate ──
      setStep("activating");
      const { error } = await supabase
        .from("projects")
        .update({
          share_link: shareId,
          status: "active",
          qr_code_url: qrPath,
          // Cleared so a regenerated project never points at an old .mind (the
          // file itself stays in storage — archived, not deleted).
          mind_file_url: null,
          tracking_format: SPATIAL_TRACKING_FORMAT,
          marker_image_urls: markerImageUrls,
        })
        .eq("id", project.id);
      if (error) throw error;

      setStep("done");
      toast({
        title: "AR Experience Generated! 🚀",
        description: `${markerData.length} markers generated and experience is live.`,
      });
      onGenerated();
    } catch (err: any) {
      setStep("error");
      console.error("Multipoint generation error:", err);
      toast({
        title: "Generation failed",
        description: friendlyError(err),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [project, markerData, onGenerated]);

  return { generating, step, progress, generate };
}
