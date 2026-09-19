import { useState } from "react";
import MarkerCoordinateEditor from "@/components/MarkerCoordinateEditor";
import MarkerPlacementValidator from "@/components/ar/multipoint/MarkerPlacementValidator";
import { type MarkerPoint } from "@/lib/markerTypes";
import { CheckCircle2, ScanLine, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODE_COPY, type ExperienceMode } from "@/lib/modeCopy";
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

  // Tabletop and Wall share the single-QR path; only the surface differs.
  // Renders two grid items (2 + 1 columns) inside the flow grid.
  if (mode !== "multipoint") {
    const copy = MODE_COPY[mode];
    const ModeIcon = copy.icon;
    const isWall = mode === "wall";
    const placeSteps = isWall
      ? [
          "Download the print sheet once the experience is generated.",
          "Print at 100% (actual size) — the QR code must measure exactly 150 × 150 mm.",
          "Mount it flat against the wall where the model should appear.",
          "Scan it, tap Launch AR Camera, then point the camera back at the code.",
        ]
      : [
          "Download the print sheet once the experience is generated.",
          "Print at 100% (actual size) — the QR code must measure exactly 150 × 150 mm.",
          "Place it flat on the table where the model should appear.",
          "Scan it, tap Launch AR Camera, then point the camera back at the code.",
        ];

    return (
      <>
        <Card className="flow-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ModeIcon className="h-4 w-4 text-primary" />
              {copy.label} settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isWall
                ? "Your wall experience uses a single QR code mounted on the wall. The model loads anchored to the wall, at the centre of the code."
                : "Your tabletop experience uses a single QR code laid flat on the table. The model loads anchored on top of it."}
            </p>
            <div className="grid gap-4 grid-cols-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs">Scale</span>
                <span className="font-mono font-medium">{project.scale || "1:1"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">QR size</span>
                <span className="font-medium capitalize">{project.qr_size || "medium"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">Rotation</span>
                <span className="font-mono font-medium">{project.initial_rotation || 0}°</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{copy.label} mode — no additional marker setup needed</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Printer className="h-4 w-4 text-primary" />
              Print &amp; place
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2.5 text-sm">
              {placeSteps.map((text, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="h-5 w-5 shrink-0 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground leading-snug">{text}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </>
    );
  }

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
