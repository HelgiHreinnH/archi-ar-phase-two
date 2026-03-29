import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import QRCode from "qrcode";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";

type Project = Tables<"projects">;

export type TabletopStep = "idle" | "qr" | "uploading" | "activating" | "done" | "error";

const STEP_PROGRESS: Record<TabletopStep, number> = {
  idle: 0,
  qr: 30,
  uploading: 65,
  activating: 90,
  done: 100,
  error: 0,
};

export const TABLETOP_PIPELINE = [
  { key: "qr" as const, label: "QR Code" },
  { key: "uploading" as const, label: "Upload" },
  { key: "activating" as const, label: "Activate" },
] as const;

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

      setStep("uploading");
      const qrPath = `${projectPath}/qr_code.png`;
      const { error: qrUploadErr } = await supabase.storage
        .from("project-assets")
        .upload(qrPath, qrBlob, { contentType: "image/png", upsert: true });
      if (qrUploadErr) throw qrUploadErr;

      const { data: qrUrlData } = supabase.storage
        .from("project-assets")
        .getPublicUrl(qrPath);

      // ── Activate ──
      setStep("activating");
      const { error } = await supabase
        .from("projects")
        .update({
          share_link: shareId,
          status: "active",
          qr_code_url: qrUrlData.publicUrl,
          mind_file_url: null,
        })
        .eq("id", project.id);
      if (error) throw error;

      setStep("done");
      toast({
        title: "AR Experience Generated! 🚀",
        description: "QR code created — experience is live with native AR placement.",
      });
      onGenerated();
    } catch (err: any) {
      setStep("error");
      console.error("Tabletop generation error:", err);
      toast({
        title: "Generation failed",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [project, onGenerated]);

  return { generating, step, progress, generate };
}
