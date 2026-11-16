import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/plans";
import type { Tables } from "@/integrations/supabase/types";
import { spatialQrSvg } from "@/lib/spatial/qr";
import { canvasToBlob, svgToCanvas } from "@/lib/spatial/raster";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";
import { compileMindFile } from "@/lib/compileMindFile";

type Project = Tables<"projects">;

export type TabletopStep =
  | "idle" | "qr" | "compiling" | "uploading" | "activating" | "done" | "error";

const STEP_PROGRESS: Record<TabletopStep, number> = {
  idle: 0,
  qr: 15,
  compiling: 50,
  uploading: 75,
  activating: 90,
  done: 100,
  error: 0,
};

export const TABLETOP_PIPELINE = [
  { key: "qr" as const, label: "QR Code" },
  { key: "compiling" as const, label: "Compile" },
  { key: "uploading" as const, label: "Upload" },
  { key: "activating" as const, label: "Activate" },
] as const;

/** Pixel size of the stored tracking QR (designed round badge). */
export const TABLETOP_QR_PX = 1440;

/**
 * LEGACY plain-QR render parameters. Since the round QR design (16 Nov 2026) new
 * experiences store the designed badge as qr_code.png and everything reads that
 * stored image. These options remain only as the re-render fallback for
 * experiences generated BEFORE the image was stored / before the round design —
 * for those the plain QR is still the correct target.
 *
 * The printed image must always be the exact image the tracking target was built
 * from, pixel-for-pixel, for MindAR / 8th Wall to anchor on it.
 */
export const TABLETOP_QR_OPTIONS = {
  width: 600,
  margin: 2,
  errorCorrectionLevel: "H" as const, // denser pattern → more tracking features
  color: { dark: "#212121", light: "#FFFFFF" },
};

export function useTabletopGeneration(project: Project, onGenerated: () => void) {
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState<TabletopStep>("idle");
  const [compileProgress, setCompileProgress] = useState(0);

  const progress =
    step === "compiling"
      ? STEP_PROGRESS.qr +
        (compileProgress / 100) * (STEP_PROGRESS.compiling - STEP_PROGRESS.qr)
      : STEP_PROGRESS[step];

  const generate = useCallback(async () => {
    setGenerating(true);
    setStep("idle");
    setCompileProgress(0);

    try {
      const shareId = project.share_link || crypto.randomUUID();
      const shareUrl = buildPublicExperienceUrl(shareId);
      const projectPath = project.id;

      // ── QR code ──
      // The printed QR is both the launch link AND the AR anchor: the model's
      // centre locks onto the centre of this image in the AR view.
      setStep("qr");
      // Designed round QR (same design as Spatial, locked 16 Nov 2026). The whole
      // square image is the tracking target: 1440 px = 3 × the 480 px 8th Wall
      // target width, so the nearest-neighbour downscale there stays clean.
      const qrCanvas = await svgToCanvas(spatialQrSvg(shareUrl, "round"), TABLETOP_QR_PX, TABLETOP_QR_PX);
      const qrBlob = await canvasToBlob(qrCanvas);

      // ── Compile .mind tracking target from the QR image ──
      setStep("compiling");
      const qrImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = qrCanvas.toDataURL("image/png");
      });
      const { blob: mindBlob } = await compileMindFile([qrImage], (p) =>
        setCompileProgress(p)
      );
      console.log(`[tabletop] .mind compiled from QR — ${(mindBlob.size / 1024).toFixed(1)} KB`);

      // ── Upload QR + .mind ──
      setStep("uploading");
      const qrPath = `${projectPath}/qr_code.png`;
      const mindPath = `${projectPath}/targets.mind`;
      const [qrUpload, mindUpload] = await Promise.all([
        supabase.storage
          .from("project-assets")
          .upload(qrPath, qrBlob, { contentType: "image/png", upsert: true }),
        supabase.storage
          .from("project-assets")
          .upload(mindPath, mindBlob, { contentType: "application/octet-stream", upsert: true }),
      ]);
      if (qrUpload.error) throw qrUpload.error;
      if (mindUpload.error) throw mindUpload.error;

      // ── Verify .mind reachability before activating (same gate as multipoint) ──
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

      // ── Activate ──
      setStep("activating");
      const { error } = await supabase
        .from("projects")
        .update({
          share_link: shareId,
          status: "active",
          qr_code_url: qrPath,
          mind_file_url: mindPath,
        })
        .eq("id", project.id);
      if (error) throw error;

      setStep("done");
      toast({
        title: "Experience is live",
        description: "QR code ready — the model will anchor to the printed QR.",
      });
      onGenerated();
    } catch (err: any) {
      setStep("error");
      console.error("Tabletop generation error:", err);
      toast({
        title: "Generation failed",
        description: friendlyError(err),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [project, onGenerated]);

  return { generating, step, progress, generate };
}
