import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { type MarkerPoint, normalizeMarkerData } from "@/lib/markerTypes";
import { supabase } from "@/integrations/supabase/client";
import StepProgress from "@/components/wizard/StepProgress";
import StepDetails from "@/components/wizard/StepDetails";
import StepModel from "@/components/wizard/StepModel";
import StepMarkers from "@/components/wizard/StepMarkers";
import StepGenerate from "@/components/wizard/StepGenerate";

type Project = Tables<"projects">;

interface ExperienceWizardProps {
  project: Project;
  onProjectUpdate: () => void;
}

const STEP_LABELS = ["Details", "3D Model", "Markers", "Generate"];

const ExperienceWizard = ({ project, onProjectUpdate }: ExperienceWizardProps) => {
  const mode = (project.mode === "tabletop" ? "tabletop" : "multipoint") as "tabletop" | "multipoint";
  const markerData = normalizeMarkerData(project.marker_data);
  const hasModel = !!project.model_url;
  const hasValidMarkers = mode === "tabletop" || (
    !!markerData && markerData.length >= 3 &&
    markerData.some((m) => m.x !== 0 || m.y !== 0 || m.z !== 0)
  );

  const initialStep = useMemo(() => {
    const hasDetails = !!(project.client_name || project.location || project.description);
    if (!hasDetails) return 0;
    if (!hasModel) return 1;
    if (!hasValidMarkers) return 2;
    return 3;
  }, []);

  const [currentStep, setCurrentStep] = useState(initialStep);

  const steps = useMemo(() => {
    const hasDetails = !!(project.client_name || project.location || project.description);
    return STEP_LABELS.map((label, i) => ({
      label,
      completed: i === 0 ? hasDetails
        : i === 1 ? hasModel
        : i === 2 ? hasValidMarkers
        : project.status === "active",
    }));
  }, [project, hasModel, hasValidMarkers]);

  const handleContinue = useCallback(() => {
    if (currentStep === 0) {
      window.dispatchEvent(new Event("wizard-save-details"));
      return;
    }
    if (currentStep < 3) {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep]);

  const handleDetailsSaved = useCallback(() => {
    onProjectUpdate();
    setCurrentStep(1);
  }, [onProjectUpdate]);

  const handleMarkersDetected = useCallback(async (markers: MarkerPoint[]) => {
    await supabase
      .from("projects")
      .update({ marker_data: markers as any })
      .eq("id", project.id);
    onProjectUpdate();
  }, [project.id, onProjectUpdate]);

  const isLastStep = currentStep === 3;
  const canContinue = currentStep === 0 ? true
    : currentStep === 1 ? hasModel
    : currentStep === 2 ? hasValidMarkers
    : false;

  return (
    <div className="space-y-6">
      <StepProgress
        steps={steps}
        currentStep={currentStep}
        onStepClick={setCurrentStep}
      />

      <Card>
        <CardContent className="pt-6">
          {currentStep === 0 && (
            <StepDetails
              project={project}
              mode={mode}
              onSaved={handleDetailsSaved}
            />
          )}
          {currentStep === 1 && (
            <StepModel
              project={project}
              onUpdate={onProjectUpdate}
              onMarkersDetected={mode === "multipoint" ? handleMarkersDetected : undefined}
            />
          )}
          {currentStep === 2 && (
            <StepMarkers
              project={project}
              mode={mode}
              markerData={markerData}
              onUpdate={onProjectUpdate}
            />
          )}
          {currentStep === 3 && (
            <StepGenerate
              project={project}
              hasModel={hasModel}
              hasValidMarkers={hasValidMarkers}
              mode={mode}
              markerData={markerData}
              onGenerated={onProjectUpdate}
            />
          )}
        </CardContent>
      </Card>

      {!isLastStep && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={handleContinue} disabled={!canContinue}>
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
      {isLastStep && (
        <div className="flex justify-start">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(2)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      )}
    </div>
  );
};

export default ExperienceWizard;
