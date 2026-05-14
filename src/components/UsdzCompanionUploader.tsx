import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Apple, Upload, Trash2, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const MAX_FILE_SIZE_MB = 250;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface UsdzCompanionUploaderProps {
  projectId: string;
  /** Current usdz_model_url path stored on the project (or null/empty). */
  usdzUrl: string | null | undefined;
  onChange: () => void;
}

/**
 * iOS Quick Look (Apple AR) only opens .usdz — never .glb. This component lets
 * the architect upload a USDZ companion to their existing GLB so iPhone users
 * get a working "View in AR" button instead of an indefinite OS-level spinner.
 */
const UsdzCompanionUploader = ({ projectId, usdzUrl, onChange }: UsdzCompanionUploaderProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasUsdz = !!usdzUrl;

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".usdz")) {
      setError("File must be a .usdz");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File exceeds ${MAX_FILE_SIZE_MB} MB`);
      return;
    }

    setBusy(true);
    try {
      const path = `${projectId}/companion.usdz`;
      const { error: upErr } = await supabase.storage
        .from("project-models")
        .upload(path, file, {
          contentType: "model/vnd.usdz+zip",
          upsert: true,
          cacheControl: "31536000, immutable",
        });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("projects")
        .update({ usdz_model_url: path })
        .eq("id", projectId);
      if (dbErr) throw dbErr;

      toast({ title: "USDZ companion added", description: "iPhone users can now open this in AR." });
      onChange();
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!usdzUrl) return;
    if (!confirm("Remove the USDZ companion? iPhone users will no longer be able to open this in AR.")) return;
    setBusy(true);
    try {
      await supabase.storage.from("project-models").remove([usdzUrl]);
      const { error: dbErr } = await supabase
        .from("projects")
        .update({ usdz_model_url: null })
        .eq("id", projectId);
      if (dbErr) throw dbErr;
      toast({ title: "USDZ companion removed" });
      onChange();
    } catch (err: any) {
      setError(err?.message || "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
        <div className="h-9 w-9 rounded-md bg-card flex items-center justify-center shrink-0">
          <Apple className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">iPhone AR companion</p>
            {hasUsdz ? (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <CheckCircle2 className="h-3 w-3" /> USDZ ready
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Optional</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasUsdz
              ? "iPhone users can open AR via Apple Quick Look."
              : "Without a USDZ file, iPhone users can't open AR — only Android works."}
          </p>
        </div>
        {hasUsdz ? (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={busy} className="text-destructive hover:text-destructive">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}
            Upload .usdz
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".usdz"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
};

export default UsdzCompanionUploader;
