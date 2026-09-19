import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import UploadProgress from "@/components/UploadProgress";
import { parseGlbMarkers } from "@/lib/parseGlbMarkers";
import { isGlbFile, optimizeGlbTextures } from "@/lib/glbFile";
import type { MarkerPoint } from "@/lib/markerTypes";

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

const ModelUploader = ({ projectId, onUploadComplete, onMarkersDetected }: ModelUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [oversized, setOversized] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFileRef = useRef<File | null>(null);

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
    setOversized(false);

    // Content check: a renamed USDZ/zip must never reach storage.
    if (!(await isGlbFile(selected))) {
      setError("This file isn't a valid GLB (binary glTF 2.0). Re-export it as .glb and try again.");
      return;
    }

    // Shrink oversized textures in the browser before upload (≤2048 px,
    // JPEG for opaque maps). Geometry is Draco-compressed server-side after.
    let file = selected;
    setIsPreparing(true);
    try {
      const res = await optimizeGlbTextures(selected);
      if (res.changed) {
        file = res.file;
        const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
        toast({
          title: "Textures optimized",
          description: `${res.texturesProcessed} texture${res.texturesProcessed === 1 ? "" : "s"} resized · ${mb(res.originalSize)} MB → ${mb(res.optimizedSize)} MB`,
        });
      }
    } catch (texErr) {
      console.warn("[ModelUploader] Texture optimization skipped:", texErr);
    } finally {
      setIsPreparing(false);
    }

    setIsUploading(true);
    setProgress(0);
    setUploadedBytes(0);
    setTotalBytes(file.size);

    const filePath = `${projectId}/${file.name}`;
    abortRef.current = new AbortController();

    try {
      // Use XMLHttpRequest for progress tracking since Supabase JS SDK v2 doesn't expose onUploadProgress
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/project-models/${filePath}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("x-upsert", "true");
        // Track A — long-lived CDN cache. Storage paths include projectId+filename
        // so any republish writes to a new path; we never need to invalidate.
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
          else reject(new Error(`Upload failed with status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));

        abortRef.current!.signal.addEventListener("abort", () => xhr.abort());

        xhr.send(file);
      });

      // Update project record
      const { error: dbError } = await supabase
        .from("projects")
        .update({ model_url: filePath })
        .eq("id", projectId);

      if (dbError) throw dbError;

      toast({ title: "Model uploaded successfully" });
      onUploadComplete(filePath);

      // Try to auto-detect marker positions from GLB files
      if (onMarkersDetected) {
        try {
          const markers = await parseGlbMarkers(file);
          if (markers) {
            onMarkersDetected(markers);
            toast({ title: "Marker positions detected", description: `Found ${markers.length} marker points in your model.` });
          }
        } catch {
          // Silently ignore — user can enter markers manually
        }
      }

      // Phase 5.2 — Server-side GLB (Draco) optimization. Never blocks.
      {
        setIsOptimizing(true);
        try {
          const { data, error: optErr } = await supabase.functions.invoke("optimize-model", {
            body: { projectId, inputPath: filePath },
          });
          if (optErr) throw optErr;
          if (data?.ok && data.optimizedPath) {
            const before = (data.originalSize / (1024 * 1024)).toFixed(1);
            const after = (data.optimizedSize / (1024 * 1024)).toFixed(1);
            toast({
              title: "Model optimized",
              description: `${before} MB → ${after} MB (${data.ratio}× smaller)`,
            });
            onUploadComplete(data.optimizedPath);
            warnIfHeavy(data.optimizedSize);
          } else if (data?.skipped) {
            // No gain — keep original
            warnIfHeavy(file.size);
          } else {
            toast({
              title: "Optimization skipped",
              description: "Using original model — performance may be slower.",
              variant: "destructive",
            });
          }
        } catch (optErr) {
          console.warn("[ModelUploader] Optimization failed:", optErr);
          toast({
            title: "Optimization skipped",
            description: "Using original model — performance may be slower.",
          });
        } finally {
          setIsOptimizing(false);
        }
      }
    } catch (err: any) {
      if (err?.message !== "Network error during upload" || !abortRef.current?.signal.aborted) {
        setError(err?.message || "Upload failed. Please try again.");
      }
    } finally {
      setIsUploading(false);
      abortRef.current = null;
    }
  }, [projectId, onUploadComplete]);

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
          <p className="text-sm font-medium">Preparing model…</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Checking the file and resizing large textures for phones.
          </p>
        </div>
      ) : isOptimizing ? (
        <div className="border-2 border-dashed border-primary/30 rounded-lg p-5 text-center space-y-2">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
          <p className="text-sm font-medium">Optimizing model…</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Compressing geometry for faster AR loading. This usually takes 15–60 seconds.
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
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
            isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-1">
            Drag & drop or click to upload
          </p>
          <p className="text-xs text-muted-foreground">
            GLB · Max {MAX_FILE_SIZE_MB} MB · works on iPhone & Android
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
