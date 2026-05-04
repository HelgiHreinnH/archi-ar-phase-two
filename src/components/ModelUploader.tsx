import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import UploadProgress from "@/components/UploadProgress";
import { parseGlbMarkers } from "@/lib/parseGlbMarkers";
import type { MarkerPoint } from "@/lib/markerTypes";

const MAX_FILE_SIZE_MB = 250;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".glb", ".usdz"];
const ACCEPTED_MIME_TYPES = ["model/gltf-binary", "model/vnd.usdz+zip", "application/octet-stream"];

interface ModelUploaderProps {
  projectId: string;
  onUploadComplete: (modelUrl: string) => void;
  onMarkersDetected?: (markers: MarkerPoint[]) => void;
}

function validateFile(file: File): string | null {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `Invalid file type. Please upload a GLB or USDZ file.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `oversized`;
  }
  return null;
}

const ModelUploader = ({ projectId, onUploadComplete, onMarkersDetected }: ModelUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [oversized, setOversized] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFileRef = useRef<File | null>(null);

  const handleUpload = useCallback(async (file: File) => {
    const validation = validateFile(file);
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

      // Phase 5.2 — Server-side GLB optimization. Skip USDZ; never block.
      if (file.name.toLowerCase().endsWith(".glb")) {
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
          } else if (data?.skipped) {
            // No-gain or non-glb — silently keep original
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
      {isOptimizing ? (
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
            GLB or USDZ · Max {MAX_FILE_SIZE_MB} MB
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
        accept=".glb,.usdz"
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
