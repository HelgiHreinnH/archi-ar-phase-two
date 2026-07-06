import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import QRCode from "qrcode";
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

/**
 * QR render parameters. The SAME parameters must be used everywhere the QR is
 * rendered (upload, print sheet), because the compiled .mind tracking target
 * must match the printed image pixel-for-pixel for MindAR to anchor on it.
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
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, shareUrl, TABLETOP_QR_OPTIONS);
      const qrBlob = await new Promise<Blob>((resolve) => {
        qrCanvas.toBlob((b) => resolve(b!), "image/png");
      });

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
      const { error: qrUploadErr } = await supabase.storage
        .from("project-assets")
        .upload(qrPath, qrBlob, { contentType: "image/png", upsert: true });
      if (qrUploadErr) throw qrUploadErr;

      const mindPath = `${projectPath}/targets.mind`;
      const { error: mindUploadErr } = await supabase.storage
        .from("project-assets")
        .upload(mindPath, mindBlob, { contentType: "application/octet-stream", upsert: true });
      if (mindUploadErr) throw mindUploadErr;

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
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [project, onGenerated]);

  return { generating, step, progress, generate };
}
