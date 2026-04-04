import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";
import QRCode from "qrcode";
import { generateAllMarkerImages, canvasToImage } from "@/lib/generateMarkers";
import { compileMindFile } from "@/lib/compileMindFile";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";

type Project = Tables<"projects">;

export type MultipointStep =
  | "idle" | "markers" | "compiling" | "qr" | "uploading" | "activating" | "done" | "error";

const STEP_PROGRESS: Record<MultipointStep, number> = {
  idle: 0,
  markers: 15,
  compiling: 45,
  qr: 60,
  uploading: 80,
  activating: 95,
  done: 100,
  error: 0,
};

export const MULTIPOINT_PIPELINE = [
  { key: "markers" as const, label: "Markers" },
  { key: "compiling" as const, label: "Compile" },
  { key: "qr" as const, label: "QR Code" },
  { key: "uploading" as const, label: "Upload" },
  { key: "activating" as const, label: "Activate" },
] as const;

export function useMultipointGeneration(
  project: Project,
  markerData: MarkerPoint[] | null,
  onGenerated: () => void
) {
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState<MultipointStep>("idle");
  const [compileProgress, setCompileProgress] = useState(0);

  const progress =
    step === "compiling"
      ? STEP_PROGRESS.markers +
        (compileProgress / 100) * (STEP_PROGRESS.compiling - STEP_PROGRESS.markers)
      : STEP_PROGRESS[step];

  const generate = useCallback(async () => {
    if (!markerData || markerData.length < 3) return;

    setGenerating(true);
    setStep("idle");
    setCompileProgress(0);

    try {
      const shareId = project.share_link || crypto.randomUUID();
      const shareUrl = buildPublicExperienceUrl(shareId);
      const projectPath = project.id;

      // ── Generate marker images ──
      setStep("markers");
      const generatedMarkers = await generateAllMarkerImages(markerData, project.name);

      // ── Compile .mind file ──
      setStep("compiling");
      const markerImages = await Promise.all(
        generatedMarkers.map((m) => canvasToImage(m.canvas))
      );
      const { blob: mindBlob } = await compileMindFile(markerImages, (p) =>
        setCompileProgress(p)
      );

      // ── Upload marker images + .mind ──
      setStep("uploading");
      const markerImageUrls: Record<string, string> = {};

      for (const marker of generatedMarkers) {
        const filePath = `${projectPath}/markers/marker_${marker.index}.png`;
        const { error: uploadErr } = await supabase.storage
          .from("project-assets")
          .upload(filePath, marker.blob, { contentType: "image/png", upsert: true });
        if (uploadErr) throw uploadErr;

        // Store bare path — signed URLs are generated on retrieval
        markerImageUrls[String(marker.index)] = filePath;
      }

      const mindPath = `${projectPath}/targets.mind`;
      const { error: mindUploadErr } = await supabase.storage
        .from("project-assets")
        .upload(mindPath, mindBlob, { contentType: "application/octet-stream", upsert: true });
      if (mindUploadErr) throw mindUploadErr;

      // ── QR code ──
      setStep("qr");
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
          mind_file_url: mindPath,
          marker_image_urls: markerImageUrls,
        })
        .eq("id", project.id);
      if (error) throw error;

      setStep("done");
      toast({
        title: "AR Experience Generated! 🚀",
        description: `${markerData.length} markers compiled and experience is live.`,
      });
      onGenerated();
    } catch (err: any) {
      setStep("error");
      console.error("Multipoint generation error:", err);
      toast({
        title: "Generation failed",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [project, markerData, onGenerated]);

  return { generating, step, progress, generate };
}
