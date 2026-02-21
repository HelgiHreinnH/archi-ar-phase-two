import { useState } from "react";
import ModelUploader from "@/components/ModelUploader";
import ModelPreview from "@/components/ModelPreview";
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
    </div>
  );
};

export default StepModel;
