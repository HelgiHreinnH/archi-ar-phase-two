import { lazy, Suspense, useState } from "react";
import ModelUploader from "@/components/ModelUploader";
import ModelPreview from "@/components/ModelPreview";
import { AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";

const ModelViewer3D = lazy(() => import("@/components/ModelViewer3D"));

type Project = Tables<"projects">;

interface StepModelProps {
  project: Project;
  onUpdate: () => void;
  onMarkersDetected?: (markers: MarkerPoint[]) => void;
}

const StepModel = ({ project, onUpdate, onMarkersDetected }: StepModelProps) => {
  const [showUploader, setShowUploader] = useState(false);

  // GLB is the only supported format. Older projects may still point at a
  // USDZ — MindAR/Three.js can't render it, so ask the owner to replace it.
  const isLegacyUsdz = !!project.model_url?.toLowerCase().split("?")[0].endsWith(".usdz");
  const showPreview = !!project.model_url && !isLegacyUsdz && !showUploader;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload your 3D model as a GLB file. The same file works on iPhone and Android.
      </p>

      {isLegacyUsdz && !showUploader && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p>
            This project uses a USDZ model, which is no longer supported. Replace it with a
            GLB export to use it in AR.
          </p>
        </div>
      )}

      {showPreview && (
        <Suspense fallback={<div className="aspect-video w-full rounded-lg bg-muted animate-pulse" />}>
          <ModelViewer3D
            key={project.model_url}
            modelUrl={project.model_url!}
            className="aspect-video w-full rounded-lg animate-in fade-in duration-500"
          />
        </Suspense>
      )}

      {project.model_url && !showUploader ? (
        <ModelPreview
          modelUrl={project.model_url}
          projectId={project.id}
          onReplace={() => setShowUploader(true)}
          onDelete={() => {
            onUpdate();
            setShowUploader(false);
          }}
        />
      ) : (
        <ModelUploader
          projectId={project.id}
          onUploadComplete={() => {
            onUpdate();
            setShowUploader(false);
          }}
          onMarkersDetected={onMarkersDetected}
        />
      )}
    </div>
  );
};

export default StepModel;
