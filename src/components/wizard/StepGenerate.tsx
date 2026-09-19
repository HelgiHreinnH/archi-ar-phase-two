import GenerateExperience from "@/components/GenerateExperience";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import type { MarkerPoint } from "@/lib/markerTypes";
import { MODE_COPY, type ExperienceMode } from "@/lib/modeCopy";

type Project = Tables<"projects">;

interface StepGenerateProps {
  project: Project;
  hasModel: boolean;
  hasValidMarkers: boolean;
  mode: ExperienceMode;
  markerData: MarkerPoint[] | null;
  onGenerated: () => void;
}

/** Renders two grid items: the generator (2 columns) and a summary (1 column). */
const StepGenerate = ({ project, hasModel, hasValidMarkers, mode, markerData, onGenerated }: StepGenerateProps) => {
  const copy = MODE_COPY[mode];
  const ModeIcon = copy.icon;
  const fileName = project.model_url?.split("/").pop() || "—";

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Model", value: fileName },
    ...(project.client_name ? [{ label: "Client", value: project.client_name }] : []),
    ...(project.location ? [{ label: "Location", value: project.location }] : []),
    ...(mode === "multipoint"
      ? [{ label: "Markers", value: `${markerData?.length ?? 0} points` }]
      : [
          { label: "Scale", value: project.scale || "1:1", mono: true },
          { label: "Rotation", value: `${project.initial_rotation || 0}°`, mono: true },
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Mode</span>
            <p className="font-medium flex items-center gap-1.5">
              <ModeIcon className="h-3.5 w-3.5 text-primary" />
              {copy.label}
            </p>
          </div>
          {rows.map((row) => (
            <div key={row.label}>
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{row.label}</span>
              <p className={`font-medium truncate ${row.mono ? "font-mono" : ""}`}>{row.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
};

export default StepGenerate;
