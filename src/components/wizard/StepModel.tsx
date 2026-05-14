import { useState } from "react";
import ModelUploader from "@/components/ModelUploader";
import ModelPreview from "@/components/ModelPreview";
import UsdzCompanionUploader from "@/components/UsdzCompanionUploader";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";

type Project = Tables<"projects">;

interface StepModelProps {
  project: Project;
  onUpdate: () => void;
  onMarkersDetected?: (markers: MarkerPoint[]) => void;
}

const StepModel = ({ project, onUpdate, onMarkersDetected }: StepModelProps) => {
  const [showUploader, setShowUploader] = useState(false);

  // USDZ companion is only meaningful for the tabletop path, which goes through
  // <model-viewer> + iOS Quick Look. Multipoint uses XR8 and renders GLB
  // directly, so iOS works there regardless of USDZ.
  const isTabletop = project.mode === "tabletop";
  const primaryIsGlb = project.model_url?.toLowerCase().endsWith(".glb");
  const showUsdzCompanion =
    isTabletop && !!project.model_url && !!primaryIsGlb && !showUploader;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload a 3D model file (GLB or USDZ) for your AR experience.
      </p>

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

      {showUsdzCompanion && (
        <UsdzCompanionUploader
          projectId={project.id}
          usdzUrl={project.usdz_model_url}
          onChange={onUpdate}
        />
      )}
    </div>
  );
};

export default StepModel;
