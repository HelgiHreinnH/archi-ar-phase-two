import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import UploadProgress from "@/components/UploadProgress";
import { parseGlbMarkers } from "@/lib/parseGlbMarkers";
import { isGlbFile, optimizeGlbTextures, storageSafeName } from "@/lib/glbFile";
import { thumbnailPath } from "@/lib/thumbnailPath";
import type { MarkerPoint } from "@/lib/markerTypes";
import {
  describeUploadError,
  tooLargeError,
  UploadError,
  STORAGE_MAX_UPLOAD_BYTES,
  type UploadErrorInfo,
} from "@/lib/uploadErrors";

const MAX_FILE_SIZE_MB = 250;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
// GLB only: every AR mode renders through MindAR + Three.js, which loads GLB
// on iOS and Android alike. USDZ is no longer accepted (3–10× heavier, and
// Three.js can't render it).
const ACCEPTED_EXTENSIONS = [".glb"];
/** Above this, warn that phones may load slowly / run out of memory. */
const SIZE_WARNING_MB = 40;

interface ModelUploaderProps {
  projectId: string;
  onUploadComplete: (modelUrl: string) => void;
  onMarkersDetected?: (markers: MarkerPoint[]) => void;
  /** Storage path of the model this upload replaces — removed after success. */
  previousModelPath?: string | null;
  /**
   * The architect's "Model quality" choice (ModelQualityCard, defaults to
   * true). false uploads the file exactly as exported — no texture cap, no
   * geometry pass, and no automatic server fallback either.
   */
  optimize?: boolean;
}

function validateFile(file: File): string | null {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return ext === ".usdz"
      ? "USDZ is no longer supported. Export your model as GLB (Rhino: File → Export → .glb, with “Z to glTF Y” on)."
      : "Invalid file type. Please upload a GLB file.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `oversized`;
  }
  return null;
}

function warnIfHeavy(bytes: number | undefined) {
  if (!bytes || bytes < SIZE_WARNING_MB * 1024 * 1024) return;
  toast({
    title: `Large model (${(bytes / (1024 * 1024)).toFixed(0)} MB)`,
    description: "It may load slowly on phones. Consider decimating geometry or removing hidden objects before export.",
  });
}

const ModelUploader = ({ projectId, onUploadComplete, onMarkersDetected, previousModelPath, optimize = true }: ModelUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareStage, setPrepareStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Classified server/network failure: message + repair tip + detail. */
  const [uploadError, setUploadError] = useState<UploadErrorInfo | null>(null);
  const [oversized, setOversized] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFileRef = useRef<File | null>(null);

  // Warm the (lazy) geometry compressor while the architect picks a file.
  useEffect(() => { void import("@/lib/compressGlbGeometry").catch(() => {}); }, []);

  const handleUpload = useCallback(async (selected: File) => {
    const validation = validateFile(selected);
    if (validation === "oversized") {
      setOversized(true);
      setError(null);
      return;
    }
    if (validation) {
      setError(validation);
      setOversized(false);
      return;
    }

    setError(null);
    setUploadError(null);
    setOversized(false);
    lastFileRef.current = selected;

    // Content check: a renamed USDZ/zip must never reach storage.
    if (!(await isGlbFile(selected))) {
      setError("This file isn't a valid GLB (binary glTF 2.0). Re-export it as .glb and try again.");
      return;
    }

    const t0 = performance.now();
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    let file = selected;
    let geometryCompressed = false;
    let drawCalls = "";
    let markersPromise: Promise<MarkerPoint[] | null> = Promise.resolve(null);

    // ── Prepare in the browser, BEFORE upload ──
    // Everything heavy happens locally so the upload is small and nothing
    // waits on a server round trip afterwards:
    //   1. markers read from the untouched original (textures skipped)
    //   2. textures resized to ≤2048 px
    //   3. geometry compressed (meshopt) — typically 5–10× smaller
    if (onMarkersDetected) {
      markersPromise = parseGlbMarkers(selected).catch(() => null);
    }

    if (optimize) {
      setIsPreparing(true);
      try {
        try {
          const tex = await optimizeGlbTextures(file);
          if (tex.changed) file = tex.file;
        } catch (texErr) {
          console.warn("[ModelUploader] Texture optimization skipped:", texErr);
        }

        try {
          const { compressGlbGeometry, STAGE_LABEL } = await import("@/lib/compressGlbGeometry");
          const geo = await compressGlbGeometry(file, (stage) => setPrepareStage(STAGE_LABEL[stage]));
          if (geo.changed) {
            file = geo.file;
            geometryCompressed = true;
            if (geo.before && geo.after) {
              drawCalls = `${geo.before.primitives.toLocaleString()} → ${geo.after.primitives.toLocaleString()} parts`;
            }
          }
        } catch (geoErr) {
          console.warn("[ModelUploader] Geometry compression skipped:", geoErr);
        }

        if (file !== selected) {
          toast({
            title: "Model optimized",
            description: `${mb(selected.size)} MB → ${mb(file.size)} MB${drawCalls ? ` · ${drawCalls}` : ""} — ready for phones`,
          });
        }
        console.log(`[ModelUploader] prepared in ${Math.round(performance.now() - t0)} ms: ${mb(selected.size)} → ${mb(file.size)} MB`);
      } finally {
        setIsPreparing(false);
        setPrepareStage(null);
      }
    } else {
      console.log(`[ModelUploader] optimization off — uploading ${mb(selected.size)} MB as exported`);
    }

    // Pre-check against the server's hard limit, so the architect doesn't
    // wait for a full upload only to be rejected (Storage answers 400/413).
    if (file.size > STORAGE_MAX_UPLOAD_BYTES) {
      const info = tooLargeError(file.size);
      console.warn("[ModelUploader] too large for storage:", info.detail);
      setUploadError(info);
      return;
    }

    setIsUploading(true);
    setProgress(0);
    setUploadedBytes(0);
    setTotalBytes(file.size);

    // Unique folder per upload: the file is cached as immutable, so re-using a
    // path (same file name re-uploaded) could serve the previous model.
    const uploadId = Date.now().toString(36);
    const filePath = `${projectId}/${uploadId}/${storageSafeName(file.name)}`;
    abortRef.current = new AbortController();

    try {
      // Use XMLHttpRequest for progress tracking since Supabase JS SDK v2 doesn't expose onUploadProgress
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new UploadError(describeUploadError(401, null, file.size));

      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/project-models/${filePath}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.setRequestHeader("content-type", "model/gltf-binary");
        // Long-lived CDN cache is safe: every upload gets a fresh path.
        xhr.setRequestHeader("cache-control", "public, max-age=31536000, immutable");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress((e.loaded / e.total) * 100);
            setUploadedBytes(e.loaded);
            setTotalBytes(e.total);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new UploadError(describeUploadError(xhr.status, xhr.responseText, file.size)));
        };
        xhr.onerror = () => {
          if (abortRef.current?.signal.aborted) reject(new Error("aborted"));
          else reject(new UploadError(describeUploadError(0, null, file.size)));
        };

        abortRef.current!.signal.addEventListener("abort", () => xhr.abort());

        xhr.send(file);
      });

      // Update project record
      const { error: dbError } = await supabase
        .from("projects")
        .update({ model_url: filePath })
        .eq("id", projectId);

      if (dbError) {
        throw new UploadError({
          kind: "server",
          message: "The model uploaded, but the project couldn't be updated.",
          tip: "Reload the page and upload again. If it keeps happening, contact support.",
          detail: `projects.update · ${dbError.code ?? ""} ${dbError.message}`,
        });
      }

      console.log(`[ModelUploader] uploaded in ${Math.round(performance.now() - t0)} ms total`);
      toast({ title: "Model uploaded successfully" });
      onUploadComplete(filePath);
      warnIfHeavy(file.size);

      // Remove the file this upload replaced (best effort, same project only).
      if (previousModelPath && previousModelPath !== filePath && previousModelPath.startsWith(`${projectId}/`)) {
        void supabase.storage.from("project-models").remove([previousModelPath]).catch(() => {});
      }

      // Project image: rendered once here (textures stripped) so the dashboard
      // never has to spin up WebGL on a heavy model just to show a preview.
      void (async () => {
        try {
          const { renderGlbThumbnail } = await import("@/lib/renderGlbThumbnail");
          const blob = await renderGlbThumbnail(file);
          if (!blob) return;
          await supabase.storage
            .from("project-assets")
            .upload(thumbnailPath(projectId), blob, {
              contentType: "image/jpeg",
              upsert: true,
              cacheControl: "60",
            });
          onUploadComplete(filePath);
        } catch (thumbErr) {
          console.warn("[ModelUploader] Thumbnail skipped:", thumbErr);
        }
      })();

      const markers = await markersPromise;
      if (markers && onMarkersDetected) {
        onMarkersDetected(markers);
        toast({ title: "Marker positions detected", description: `Found ${markers.length} marker points in your model.` });
      }

      // Fallback only: if in-browser compression couldn't run (e.g. the file
      // was already Draco-compressed or the browser failed), let the server
      // try — in the background, never blocking the architect. Never runs
      // when the architect explicitly asked for the original quality.
      if (optimize && !geometryCompressed) {
        void supabase.functions
          .invoke("optimize-model", { body: { projectId, inputPath: filePath } })
          .then(({ data }) => {
            if (data?.ok && data.optimizedPath) onUploadComplete(data.optimizedPath);
          })
          .catch((optErr) => console.warn("[ModelUploader] Server optimization failed:", optErr));
      }
    } catch (err: any) {
      if (err instanceof UploadError) {
        console.warn("[ModelUploader] upload failed:", err.info.detail);
        setUploadError(err.info);
      } else if (err?.message !== "aborted") {
        setError(err?.message || "Upload failed. Please try again.");
      }
    } finally {
      setIsUploading(false);
      abortRef.current = null;
    }
  }, [projectId, onUploadComplete, onMarkersDetected, previousModelPath, optimize]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsUploading(false);
    setProgress(0);
  };

  return (
    <div className="space-y-3">
      {isPreparing ? (
        <div className="border-2 border-dashed border-primary/30 rounded-lg p-5 text-center space-y-2">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
          <p className="text-sm font-medium">{prepareStage ?? "Optimizing model…"}</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Compressing geometry and textures on your computer so the upload is small. Heavy interiors can take up to a minute.
          </p>
        </div>
      ) : isUploading ? (
        <UploadProgress
          progress={progress}
          uploadedBytes={uploadedBytes}
          totalBytes={totalBytes}
          onCancel={handleCancel}
        />
      ) : oversized ? (
        <div className="border-2 border-dashed border-destructive/30 rounded-lg p-5 text-center space-y-2">
          <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
          <p className="text-sm font-medium">File exceeds {MAX_FILE_SIZE_MB} MB limit</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Try enabling <strong>Draco compression</strong> when exporting (reduces size ~90%), lowering textures to 2K, or decimating polygon count.
          </p>
          <Button variant="outline" size="sm" onClick={() => { setOversized(false); fileInputRef.current?.click(); }}>
            Try another file
          </Button>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-6 min-h-[220px] flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${
            isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground mb-1">
            Drag & drop or click to upload
          </p>
          <p className="text-xs text-muted-foreground">
            GLB · Max {MAX_FILE_SIZE_MB} MB · works on iPhone & Android
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-1 max-w-xs">
            Must be under {Math.round(STORAGE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB after optimizing
          </p>
        </div>
      )}

      {error && !oversized && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => { setError(null); fileInputRef.current?.click(); }}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {uploadError && !oversized && !isUploading && !isPreparing && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="font-medium">{uploadError.message}</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6">
            <span className="font-medium text-foreground">How to fix: </span>
            {uploadError.tip}
          </p>
          <div className="flex items-center gap-2 pl-6">
            <details className="text-[11px] text-muted-foreground/80">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <code className="block mt-1 break-all">{uploadError.detail}</code>
            </details>
            <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => {
              const fileFault = uploadError.kind === "too-large" || uploadError.kind === "file-type" || uploadError.kind === "bad-name";
              setUploadError(null);
              // Transient failures retry the same file; file problems need a new one.
              if (!fileFault && lastFileRef.current) void handleUpload(lastFileRef.current);
              else fileInputRef.current?.click();
            }}>
              <RefreshCw className="mr-1 h-3 w-3" />
              {uploadError.kind === "too-large" || uploadError.kind === "file-type" || uploadError.kind === "bad-name"
                ? "Choose another file"
                : "Retry"}
            </Button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
};

export default ModelUploader;
