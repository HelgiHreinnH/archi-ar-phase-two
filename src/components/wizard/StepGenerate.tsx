import GenerateExperience from "@/components/GenerateExperience";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerData } from "@/components/MarkerCoordinateEditor";

type Project = Tables<"projects">;

interface StepGenerateProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: "tabletop" | "multipoint";
  markerData: MarkerData | null;
  onGenerated: () => void;
}

const StepGenerate = ({ project, hasModel, hasValidMarkers, mode, markerData, onGenerated }: StepGenerateProps) => {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review the checklist below and generate your AR experience when ready.
      </p>
      <GenerateExperience
        project={project}
        hasModel={hasModel}
        hasValidMarkers={hasValidMarkers}
        mode={mode}
        markerData={markerData}
        onGenerated={onGenerated}
      />
    </div>
  );
};

export default StepGenerate;
