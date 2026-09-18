import { useState } from "react";
import MarkerCoordinateEditor from "@/components/MarkerCoordinateEditor";
import MarkerPlacementValidator from "@/components/ar/multipoint/MarkerPlacementValidator";
import { type MarkerPoint } from "@/lib/markerTypes";
import { Grid3X3, CheckCircle2, ScanLine } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

interface StepMarkersProps {
  project: Project;
  mode: "tabletop" | "wall" | "multipoint";
  markerData: MarkerPoint[] | null;
  onUpdate: () => void;
}

const StepMarkers = ({ project, mode, markerData, onUpdate }: StepMarkersProps) => {
  // Fix 6: architect placement validator overlay (multipoint only).
  const [validating, setValidating] = useState(false);
  const canValidate = !!project.mind_file_url && (markerData?.length ?? 0) >= 3;

  // Wall mode (added on main) takes the same single-QR path as tabletop.
  if (mode !== "multipoint") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your tabletop experience uses a single QR marker. Review your settings below.
        </p>
        <div className="rounded-lg border bg-muted/30 p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-primary" />
            Tabletop Settings
          </h3>
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs">Scale</span>
              <span className="font-mono font-medium">{project.scale || "1:20"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">QR Size</span>
              <span className="font-medium capitalize">{project.qr_size || "medium"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Rotation</span>
              <span className="font-mono font-medium">{project.initial_rotation || 0}°</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" />
          <span>Tabletop mode — no additional marker setup needed</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      {/* Fix 6 · Architect placement validator — verify printed markers match Rhino coords */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
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
      </div>

      {validating && markerData && (
        <MarkerPlacementValidator
          project={project}
          markerData={markerData}
          onClose={() => setValidating(false)}
        />
      )}
    </div>
  );
};

export default StepMarkers;
