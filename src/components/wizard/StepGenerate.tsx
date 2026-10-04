import GenerateExperience from "@/components/GenerateExperience";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, Printer } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";
import { MODE_COPY, rotationLabel, type ExperienceMode } from "@/lib/modeCopy";

type Project = Tables<"projects">;

interface StepGenerateProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: ExperienceMode;
  markerData: MarkerPoint[] | null;
  onGenerated: () => void;
}

const PLACE_STEPS: Record<"tabletop" | "wall", string[]> = {
  tabletop: [
    "Generate the experience, then download the print sheet.",
    "Print at 100% (actual size) — the QR code must measure exactly 150 × 150 mm.",
    "Place it flat on the table where the model should appear.",
    "Scan it, tap Launch AR Camera, then point the camera back at the code.",
  ],
  wall: [
    "Generate the experience, then download the print sheet.",
    "Print at 100% (actual size) — the QR code must measure exactly 150 × 150 mm.",
    "Mount it flat against the wall where the model should appear.",
    "Scan it, tap Launch AR Camera, then point the camera back at the code.",
  ],
};

/**
 * Final step. Renders two grid items: the generator (2 columns) and a right
 * column with the summary — plus, for Tabletop/Wall, the Print & place steps
 * (Oct 2026 UI review: the old single-QR "Markers" step merged in here; it
 * only restated settings and printing instructions). Client/location are
 * project details and live on the dashboard card, not here.
 */
const StepGenerate = ({ project, hasModel, hasValidMarkers, mode, markerData, onGenerated }: StepGenerateProps) => {
  const copy = MODE_COPY[mode];
  const ModeIcon = copy.icon;
  const fileName = project.model_url?.split("/").pop()?.split("?")[0] || "—";

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Model", value: fileName },
    ...(mode === "multipoint"
      ? [{ label: "Markers", value: `${markerData?.length ?? 0} points` }]
      : [
          { label: "Scale", value: project.scale || "1:1", mono: true },
          { label: "Rotation", value: rotationLabel(project.initial_rotation, mode), mono: true },
          { label: "QR code", value: "150 × 150 mm", mono: true },
        ]),
  ];

  return (
    <>
      <div className="flow-span-2 [&>*]:h-full">
        <GenerateExperience
          project={project}
          hasModel={hasModel}
          hasValidMarkers={hasValidMarkers}
          mode={mode}
          markerData={markerData}
          onGenerated={onGenerated}
        />
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Mode</span>
              <p className="font-medium flex items-center gap-1.5">
                <ModeIcon className="h-3.5 w-3.5 text-primary" />
                {copy.label}
              </p>
            </div>
            {rows.map((row) => (
              <div key={row.label} className={row.label === "Model" ? "col-span-2 min-w-0" : "min-w-0"}>
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{row.label}</span>
                <p className={`font-medium truncate ${row.mono ? "font-mono" : ""}`} title={row.value}>{row.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {mode !== "multipoint" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="h-4 w-4 text-primary" />
                Print &amp; place
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5 text-sm">
                {PLACE_STEPS[mode].map((text, i) => (
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
        )}
      </div>
    </>
  );
};

export default StepGenerate;
