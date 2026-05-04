import MarkerCoordinateEditor from "@/components/MarkerCoordinateEditor";
import { type MarkerPoint } from "@/lib/markerTypes";
import { Grid3X3, CheckCircle2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

interface StepMarkersProps {
  project: Project;
  mode: "tabletop" | "multipoint";
  markerData: MarkerPoint[] | null;
  onUpdate: () => void;
}

const StepMarkers = ({ project, mode, markerData, onUpdate }: StepMarkersProps) => {
  if (mode === "tabletop") {
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
    </div>
  );
};

export default StepMarkers;
