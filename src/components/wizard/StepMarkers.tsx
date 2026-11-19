import MarkerCoordinateEditor from "@/components/MarkerCoordinateEditor";
import { markersFromRhino, type MarkerPoint } from "@/lib/markerTypes";
import RhinoMarkerTable from "@/components/wizard/RhinoMarkerTable";
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
  // Spatial only. Tabletop/Wall have no marker step since the Oct 2026 UI
  // review — their single-QR "Print & place" guidance lives in StepGenerate.
  if (mode !== "multipoint") return null;
  // D18: markers read from the GLB are shown read-only. The editor stays for
  // legacy files without marker nodes (and projects saved before 19 Nov 2026).
  const fromRhino = markersFromRhino(markerData);

  return (
    <>
    <Card className="flow-span-2">
    <CardContent className="pt-6 space-y-4">
      {fromRhino ? (
        <RhinoMarkerTable markers={markerData!} />
      ) : (
      <>
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
      </>
      )}

    </CardContent>
    </Card>

      {/* The MindAR placement validator ("Verify physical placement") was
          archived with MindAR on 18 Nov 2026 (archive/mindar/). A placement
          check on 8th Wall can come back as its own feature. */}
    </>
  );
};

export default StepMarkers;
