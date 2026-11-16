import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/plans";
import type { Tables } from "@/integrations/supabase/types";
import QRCode from "qrcode";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";

type Project = Tables<"projects">;

// No "compiling" step: Tabletop/Wall run on 8th Wall, which builds its image
// target from the stored QR at view time (xr8QrTarget). The MindAR .mind
// compile was removed with the MindAR fallback on 16 Nov 2026.
export type TabletopStep =
  | "idle" | "qr" | "uploading" | "activating" | "done" | "error";

const STEP_PROGRESS: Record<TabletopStep, number> = {
  idle: 0,
  qr: 25,
  uploading: 60,
  activating: 90,
  done: 100,
  error: 0,
};

export const TABLETOP_PIPELINE = [
  { key: "qr" as const, label: "QR Code" },
  { key: "uploading" as const, label: "Upload" },
  { key: "activating" as const, label: "Activate" },
] as const;

/**
 * QR render parameters. The SAME parameters must be used everywhere the QR is
 * rendered (upload, print sheet, the xr8QrTarget re-render), because the 8th
 * Wall tracking target must match the printed image pixel-for-pixel.
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

  const progress = STEP_PROGRESS[step];

  const generate = useCallback(async () => {
    setGenerating(true);
    setStep("idle");

    try {
      const shareId = project.share_link || crypto.randomUUID();
      const shareUrl = buildPublicExperienceUrl(shareId);
      const projectPath = project.id;

      // ── QR code ──
      // The printed QR is both the launch link AND the AR anchor: the model's
      // centre locks onto the centre of this image in the AR view.
      setStep("qr");
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, shareUrl, TABLETOP_QR_OPTIONS);
      const qrBlob = await new Promise<Blob>((resolve) => {
        qrCanvas.toBlob((b) => resolve(b!), "image/png");
      });

      // ── Upload the QR ──
      // The stored image is the tracking source: the 8th Wall viewer builds its
      // image target from it when the client opens the link.
      setStep("uploading");
      const qrPath = `${projectPath}/qr_code.png`;
      const qrUpload = await supabase.storage
        .from("project-assets")
        .upload(qrPath, qrBlob, { contentType: "image/png", upsert: true });
      if (qrUpload.error) throw qrUpload.error;

      // ── Activate ──
      // mind_file_url is left as it is: experiences generated before 16 Nov
      // 2026 still carry a .mind path, which nothing reads for Tabletop/Wall.
      setStep("activating");
      const { error } = await supabase
        .from("projects")
        .update({
          share_link: shareId,
          status: "active",
          qr_code_url: qrPath,
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
