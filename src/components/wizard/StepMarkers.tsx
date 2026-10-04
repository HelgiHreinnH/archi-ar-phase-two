import { useState } from "react";
import MarkerCoordinateEditor from "@/components/MarkerCoordinateEditor";
import MarkerPlacementValidator from "@/components/ar/multipoint/MarkerPlacementValidator";
import { type MarkerPoint } from "@/lib/markerTypes";
import { ScanLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExperienceMode } from "@/lib/modeCopy";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

interface StepMarkersProps {
  project: Project;
  mode: ExperienceMode;
  markerData: MarkerPoint[] | null;
  onUpdate: () => void;
}

const StepMarkers = ({ project, mode, markerData, onUpdate }: StepMarkersProps) => {
  // Fix 6: architect placement validator overlay (multipoint only).
  const [validating, setValidating] = useState(false);
  const canValidate = !!project.mind_file_url && (markerData?.length ?? 0) >= 3;

  // Spatial only. Tabletop/Wall have no marker step since the Oct 2026 UI
  // review — their single-QR "Print & place" guidance lives in StepGenerate.
  if (mode !== "multipoint") return null;

  return (
    <>
    <Card className="flow-span-2">
    <CardContent className="pt-6 space-y-4">
      <p className="text-sm text-muted-foreground">
        Set the XYZ coordinates for each reference marker. Together they define the coordinate frame the AR model is placed within — no marker is the origin.
      </p>
      {markerData && markerData.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            <strong>{markerData.length} marker points</strong> configured.
            Min inter-marker spacing:{" "}
            <span className="font-mono">
              {Math.round(
                Math.min(
                  ...markerData.flatMap((a, i) =>
                    markerData.slice(i + 1).map((b) =>
                      Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2)
                    )
                  )
                )
              )}{" "}
              mm
            </span>
          </p>
        </div>
      )}
      <MarkerCoordinateEditor
        projectId={project.id}
        markerData={markerData}
        onUpdate={onUpdate}
      />

    </CardContent>
    </Card>

      {/* Fix 6 · Architect placement validator — verify printed markers match Rhino coords */}
      <Card>
      <CardContent className="pt-6 space-y-2">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Verify physical placement</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          After printing and placing your markers, scan them here to confirm the real spacing
          matches your Rhino coordinates. Catches placement errors before a client ever sees the model.
        </p>
        <button
          type="button"
          disabled={!canValidate}
          onClick={() => setValidating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ScanLine className="h-4 w-4" />
          Validate placement in AR
        </button>
        {!canValidate && (
          <p className="text-[11px] text-muted-foreground/70">
            Generate the experience (with at least 3 markers) to enable placement checking.
          </p>
        )}
      </CardContent>
      </Card>

      {validating && markerData && (
        <MarkerPlacementValidator
          project={project}
          markerData={markerData}
          onClose={() => setValidating(false)}
        />
      )}
    </>
  );
};

export default StepMarkers;
