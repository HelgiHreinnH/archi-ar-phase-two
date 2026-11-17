import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/plans";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";
import { spatialQrPng } from "@/lib/spatial/qrExport";
import { generateAllMarkerImages, canvasToImage } from "@/lib/generateMarkers";
import { compileMindFile } from "@/lib/compileMindFile";
import { MINDAR_ENABLED, SPATIAL_TRACKING_FORMAT } from "@/lib/arEngines";
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

// 17 Nov 2026: no "Compile" step while MindAR is off — 8th Wall builds its
// targets from the marker PNGs at runtime, so there is nothing to compile.
export const MULTIPOINT_PIPELINE = [
  { key: "markers" as const, label: "Markers" },
  ...(MINDAR_ENABLED ? [{ key: "compiling" as const, label: "Compile" }] : []),
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

      // ── Compile .mind file (MindAR only — off since 17 Nov 2026) ──
      // With MindAR off nothing is compiled: the marker PNGs uploaded below
      // are the 8th Wall image targets. mind_file_url is cleared so a
      // regenerated project never points at an old .mind (the file itself
      // stays in storage — archived, not deleted).
      let mindBlob: Blob | null = null;
      if (MINDAR_ENABLED) {
        setStep("compiling");
        const markerImages = await Promise.all(
          generatedMarkers.map((m) => canvasToImage(m.canvas))
        );
        ({ blob: mindBlob } = await compileMindFile(markerImages, (p) =>
          setCompileProgress(p)
        ));
        console.log(
          `[multipoint] .mind compiled — ${(mindBlob.size / 1024).toFixed(1)} KB ` +
          `(${markerImages.length} markers)`
        );
      }

      // ── Upload marker images (+ .mind when MindAR is on) ──
      setStep("uploading");
      const markerImageUrls: Record<string, string> = {};
      const mindPath = mindBlob ? `${projectPath}/targets.mind` : null;

      // Upload all marker images (and the .mind file, if any) in parallel.
      const uploads = generatedMarkers.map(async (marker) => {
        const filePath = `${projectPath}/markers/marker_${marker.index}.png`;
        const { error: uploadErr } = await supabase.storage
          .from("project-assets")
          .upload(filePath, marker.blob, { contentType: "image/png", upsert: true });
        if (uploadErr) throw uploadErr;
        // Store bare path — signed URLs are generated on retrieval
        markerImageUrls[String(marker.index)] = filePath;
      });
      if (mindBlob && mindPath) {
        uploads.push(
          supabase.storage
            .from("project-assets")
            .upload(mindPath, mindBlob, { contentType: "application/octet-stream", upsert: true })
            .then(({ error: mindUploadErr }) => { if (mindUploadErr) throw mindUploadErr; }),
        );
      }
      await Promise.all(uploads);

      // ── Verify .mind reachability before activating ──
      if (mindPath) {
        const { data: signedMind, error: signErr } = await supabase.storage
          .from("project-assets")
          .createSignedUrl(mindPath, 60);
        if (signErr || !signedMind?.signedUrl) {
          throw new Error("Failed to verify .mind file: signing returned no URL");
        }
        const headRes = await fetch(signedMind.signedUrl, { method: "HEAD" });
        if (!headRes.ok) {
          throw new Error(`Failed to verify .mind file: HEAD returned ${headRes.status}`);
        }
        const contentLength = parseInt(headRes.headers.get("content-length") || "0", 10);
        if (contentLength < 1024) {
          throw new Error(`.mind file appears empty or invalid (${contentLength} bytes)`);
        }
        console.log(`[multipoint] .mind verified — ${(contentLength / 1024).toFixed(1)} KB reachable`);
      }

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
          mind_file_url: mindPath,
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
