import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDown, Box, Loader2, Lock } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { type MarkerPoint, normalizeMarkerData } from "@/lib/markerTypes";
import { supabase } from "@/integrations/supabase/client";
import { MODE_COPY, toExperienceMode, type ExperienceMode } from "@/lib/modeCopy";
import StepProgress from "@/components/wizard/StepProgress";
import StepDetails, { type StepDetailsHandle } from "@/components/wizard/StepDetails";
import StepModel from "@/components/wizard/StepModel";
import StepMarkers from "@/components/wizard/StepMarkers";
import StepGenerate from "@/components/wizard/StepGenerate";

type Project = Tables<"projects">;

interface ExperienceWizardProps {
  project: Project;
  onProjectUpdate: () => void;
}

const SECTION_LABELS = ["3D Model & Details", "Markers", "Generate"];

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ── Mode banner — states up front what kind of experience is being built ──
const MODE_BANNER: Record<ExperienceMode, { title: string; body: string }> = {
  tabletop: {
    title: "Tabletop experience",
    body: "The printed QR code lies flat on a table and the model loads anchored on top of it.",
  },
  wall: {
    title: "Wall-mounted experience",
    body: "The printed QR code is mounted flat on a wall and the model loads anchored to the wall, at the centre of the code. Set the scale and rotation for how it should appear on the wall.",
  },
  multipoint: {
    title: "Spatial experience",
    body: "Three or more printed markers placed in the room at your Rhino coordinates position the model at full scale.",
  },
};

const ModeBanner = ({ mode }: { mode: ExperienceMode }) => {
  const Icon = MODE_COPY[mode].icon;
  const { title, body } = MODE_BANNER[mode];
  return (
    <div className="flow-span-3 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="rounded-lg bg-primary/10 p-2 shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
};

// ── One vertical section of the upload flow ──
interface FlowSectionProps {
  index: number;
  title: string;
  description: string;
  locked: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  children: ReactNode;
  cta?: ReactNode;
}

const FlowSection = ({ index, title, description, locked, sectionRef, children, cta }: FlowSectionProps) => (
  <section
    ref={sectionRef}
    data-section={index}
    aria-labelledby={`flow-section-${index}`}
    className={`scroll-mt-24 ${index > 0 ? "border-t pt-10" : ""}`}
  >
    <header className="flex items-start gap-3 mb-5">
      <span
        className={`mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
          locked ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"
        }`}
      >
        {index + 1}
      </span>
      <div>
        <h2 id={`flow-section-${index}`} className={`text-lg font-semibold ${locked ? "text-muted-foreground" : ""}`}>
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </header>

    {locked ? (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" />
        Complete the section above to continue
      </div>
    ) : (
      <div className="animate-in fade-in slide-in-from-bottom-6 duration-700 ease-out">
        <div className="flow-grid">{children}</div>
        {cta && <div className="flex flex-col items-center gap-2 pt-8">{cta}</div>}
      </div>
    )}
  </section>
);

interface NextButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
}

const NextButton = ({ label, onClick, disabled, busy, hint }: NextButtonProps) => (
  <>
    <Button
      size="lg"
      onClick={onClick}
      disabled={disabled || busy}
      className="group rounded-full px-8 gap-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
    >
      {label}
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ArrowDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
      )}
    </Button>
    {disabled && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </>
);

// ── The single-page upload flow ──
const ExperienceWizard = ({ project, onProjectUpdate }: ExperienceWizardProps) => {
  const mode = toExperienceMode(project.mode);
  const markerData = normalizeMarkerData(project.marker_data);
  // GLB only — a legacy USDZ model can't be rendered by MindAR/Three.js, so it
  // doesn't count as "uploaded" until it's replaced.
  const hasModel = !!project.model_url && !project.model_url.toLowerCase().split("?")[0].endsWith(".usdz");
  const hasValidMarkers = mode !== "multipoint" || (
    !!markerData && markerData.length >= 3 &&
    markerData.some((m) => m.x !== 0 || m.y !== 0 || m.z !== 0)
  );

  // Returning projects open with every section they've already completed unlocked.
  const initialUnlocked = useMemo(() => {
    const hasDetails = !!(project.client_name || project.location || project.description);
    if (!hasDetails || !hasModel) return 0;
    if (!hasValidMarkers) return 1;
    return 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [activeSection, setActiveSection] = useState(0);
  const [pendingScroll, setPendingScroll] = useState<number | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const sectionEls = useRef<(HTMLElement | null)[]>([]);
  const detailsRef = useRef<StepDetailsHandle>(null);

  const steps = useMemo(() => [
    { label: SECTION_LABELS[0], completed: hasModel && unlocked > 0 },
    { label: SECTION_LABELS[1], completed: hasValidMarkers && unlocked > 1 },
    { label: SECTION_LABELS[2], completed: project.status === "active" },
  ], [hasModel, hasValidMarkers, unlocked, project.status]);

  // Scroll once the target section has rendered (it may have just unlocked).
  useEffect(() => {
    if (pendingScroll === null) return;
    const el = sectionEls.current[pendingScroll];
    setPendingScroll(null);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  }, [pendingScroll, unlocked]);

  // Highlight the section currently in view in the progress bar.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(Number((entry.target as HTMLElement).dataset.section));
          }
        }
      },
      { rootMargin: "-35% 0px -60% 0px" },
    );
    sectionEls.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [unlocked]);

  const goTo = useCallback((index: number) => {
    setUnlocked((u) => Math.max(u, index));
    setPendingScroll(index);
  }, []);

  const handleModelSectionNext = useCallback(async () => {
    setSavingDetails(true);
    const ok = (await detailsRef.current?.save()) ?? true;
    setSavingDetails(false);
    if (ok) goTo(1);
  }, [goTo]);

  const handleMarkersDetected = useCallback(async (markers: MarkerPoint[]) => {
    await supabase
      .from("projects")
      .update({ marker_data: markers as any })
      .eq("id", project.id);
    onProjectUpdate();
  }, [project.id, onProjectUpdate]);

  const setSectionRef = (i: number) => (el: HTMLElement | null) => {
    sectionEls.current[i] = el;
  };

  const surface = MODE_COPY[mode].surface;

  return (
    <div className="flow-container space-y-8 pb-24">
      <div className="sticky top-2 z-30 rounded-full border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75 shadow-sm px-3 py-1.5">
        <StepProgress
          steps={steps}
          currentStep={activeSection}
          maxReachable={unlocked}
          onStepClick={(i) => setPendingScroll(i)}
        />
      </div>

      {/* 1 · 3D model (2 columns) + details (1 column) */}
      <FlowSection
        index={0}
        title="3D Model & Details"
        description={
          mode === "wall"
            ? "Upload the model that will hang on the wall, and describe the project."
            : "Upload your model and describe the project."
        }
        locked={false}
        sectionRef={setSectionRef(0)}
        cta={
          <NextButton
            label="Continue to markers"
            onClick={handleModelSectionNext}
            disabled={!hasModel}
            busy={savingDetails}
            hint="Upload a GLB model to continue"
          />
        }
      >
        <ModeBanner mode={mode} />
        <Card className="flow-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Box className="h-4 w-4 text-primary" />
              3D model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepModel
              project={project}
              onUpdate={onProjectUpdate}
              onMarkersDetected={mode === "multipoint" ? handleMarkersDetected : undefined}
            />
          </CardContent>
        </Card>
        <StepDetails ref={detailsRef} project={project} mode={mode} onUpdate={onProjectUpdate} />
      </FlowSection>

      {/* 2 · Markers */}
      <FlowSection
        index={1}
        title="Markers"
        description={
          mode === "multipoint"
            ? "Set where each printed marker sits in the room."
            : `Review how the QR code on the ${surface} anchors your model.`
        }
        locked={unlocked < 1}
        sectionRef={setSectionRef(1)}
        cta={
          <NextButton
            label="Continue to generate"
            onClick={() => goTo(2)}
            disabled={!hasValidMarkers}
            hint="Enter coordinates for at least 3 markers to continue"
          />
        }
      >
        <StepMarkers
          project={project}
          mode={mode}
          markerData={markerData}
          onUpdate={onProjectUpdate}
        />
      </FlowSection>

      {/* 3 · Generate */}
      <FlowSection
        index={2}
        title="Generate"
        description="Check the list and generate your AR experience."
        locked={unlocked < 2}
        sectionRef={setSectionRef(2)}
      >
        <StepGenerate
          project={project}
          hasModel={hasModel}
          hasValidMarkers={hasValidMarkers}
          mode={mode}
          markerData={markerData}
          onGenerated={onProjectUpdate}
        />
      </FlowSection>
    </div>
  );
};

export default ExperienceWizard;
