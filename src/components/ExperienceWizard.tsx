import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDown, Box, Loader2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import { type MarkerPoint, normalizeMarkerData } from "@/lib/markerTypes";
import { supabase } from "@/integrations/supabase/client";
import { preloadMindCompiler } from "@/lib/compileMindFile";
import { MODE_COPY, toExperienceMode, type ExperienceMode } from "@/lib/modeCopy";
import StepProgress from "@/components/wizard/StepProgress";
import StepDetails, { type StepDetailsHandle } from "@/components/wizard/StepDetails";
import StepModel from "@/components/wizard/StepModel";
import ModelQualityCard from "@/components/wizard/ModelQualityCard";
import PresentationConfigCard, { type PresentationConfigHandle } from "@/components/wizard/PresentationConfigCard";
import StepMarkers from "@/components/wizard/StepMarkers";
import StepGenerate from "@/components/wizard/StepGenerate";

type Project = Tables<"projects">;

interface ExperienceWizardProps {
  project: Project;
  onProjectUpdate: () => void;
}

type SectionKey = "setup" | "model" | "markers" | "generate";

const SECTION_LABELS: Record<SectionKey, string> = {
  setup: "Scale & Quality",
  model: "3D Model & Details",
  markers: "Markers",
  generate: "Generate",
};

/**
 * Oct 2026: Tabletop/Wall start with "Scale & Quality" — presentation config +
 * Model quality — BEFORE the upload, because the optimize choice is applied
 * in the browser at upload time. Spatial has no presentation config, so it
 * keeps the 3-step flow with Model quality beside Details.
 */
const sectionOrder = (mode: ExperienceMode): SectionKey[] =>
  mode === "multipoint" ? ["model", "markers", "generate"] : ["setup", "model", "markers", "generate"];

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Space kept clear above a section for the sticky progress bar (px). */
const SECTION_SCROLL_OFFSET = 76;

/** Nearest scrolling ancestor, or null when the window itself scrolls. */
function getScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Eased scroll that brings `el` to the top of the viewport (below the sticky
 * progress bar). Duration scales gently with distance so a one-screen hop and
 * a jump back to the top both feel deliberate. Jumps when reduced motion is on.
 */
function animateScrollTo(el: HTMLElement, onDone?: () => void) {
  const parent = getScrollParent(el);
  const getY = () => (parent ? parent.scrollTop : window.scrollY);
  const setY = (y: number) => (parent ? (parent.scrollTop = y) : window.scrollTo(0, y));
  const parentTop = parent ? parent.getBoundingClientRect().top : 0;
  const start = getY();
  const target = Math.max(0, start + el.getBoundingClientRect().top - parentTop - SECTION_SCROLL_OFFSET);
  const distance = target - start;

  if (prefersReducedMotion() || Math.abs(distance) < 2) {
    setY(target);
    onDone?.();
    return;
  }

  const duration = Math.min(1100, Math.max(650, Math.abs(distance) * 0.6));
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    setY(start + distance * easeInOutCubic(t));
    if (t < 1) requestAnimationFrame(step);
    else onDone?.();
  };
  requestAnimationFrame(step);
}

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

// ── One full-screen section of the upload flow ──
interface FlowSectionProps {
  index: number;
  title: string;
  description: string;
  sectionRef: (el: HTMLElement | null) => void;
  children: ReactNode;
  cta?: ReactNode;
}

const FlowSection = ({ index, title, description, sectionRef, children, cta }: FlowSectionProps) => (
  <section
    ref={sectionRef}
    data-section={index}
    aria-labelledby={`flow-section-${index}`}
    style={{ scrollMarginTop: SECTION_SCROLL_OFFSET }}
    // Each section fills the viewport (minus the sticky progress bar). Heading,
    // boxes and CTA sit together as one group, centred vertically, so spare
    // height splits evenly above and below. Taller content simply grows.
    className="min-h-[calc(100dvh-5.5rem)] flex flex-col pt-6 pb-10"
  >
    <div className="flex-1 flex flex-col justify-center animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
      <header className="flex items-start gap-3 mb-6">
        <span className="mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold bg-primary text-primary-foreground">
          {index + 1}
        </span>
        <div>
          <h2
            id={`flow-section-${index}`}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>

      <div className="flow-grid">{children}</div>

      {cta && <div className="flex flex-col items-center gap-2 pt-8">{cta}</div>}
    </div>
  </section>
);

interface NextButtonProps {
  label: string;
  onClick: () => void;
  /** When set, the step isn't complete yet: the button stays clickable and explains what's missing. */
  blockedReason?: string;
  busy?: boolean;
}

const NextButton = ({ label, onClick, blockedReason, busy }: NextButtonProps) => {
  const [nudge, setNudge] = useState(0);
  const handleClick = () => {
    if (blockedReason) {
      setNudge((n) => n + 1);
      toast({ title: blockedReason });
      return;
    }
    onClick();
  };
  return (
    <>
      <Button
        size="lg"
        onClick={handleClick}
        disabled={busy}
        aria-disabled={!!blockedReason}
        className={`group rounded-full px-8 gap-2 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
          blockedReason ? "opacity-70" : ""
        }`}
      >
        {label}
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
        )}
      </Button>
      {blockedReason && (
        <p
          key={nudge}
          className={`text-xs flex items-center gap-1 ${
            nudge > 0 ? "text-amber-600 animate-in fade-in slide-in-from-top-1 duration-300" : "text-muted-foreground"
          }`}
        >
          {nudge > 0 && <AlertCircle className="h-3.5 w-3.5" />}
          {blockedReason}
        </p>
      )}
    </>
  );
};

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

  const order = useMemo(() => sectionOrder(mode), [mode]);
  const idx = useCallback((key: SectionKey) => order.indexOf(key), [order]);

  // Returning projects open with every section they've already completed unlocked.
  const initialUnlocked = useMemo(() => {
    const hasDetails = !!(project.client_name || project.location || project.description);
    if (!hasDetails && !hasModel) return 0;
    if (!hasDetails || !hasModel) return idx("model");
    if (!hasValidMarkers) return idx("markers");
    return idx("generate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [unlocked, setUnlocked] = useState(initialUnlocked);

  // Warm the MindAR compiler while the architect fills in details/uploads, so
  // "Generate" starts compiling immediately instead of downloading ~2 MB first.
  useEffect(() => { preloadMindCompiler(); }, []);
  const [activeSection, setActiveSection] = useState(0);
  const [pendingScroll, setPendingScroll] = useState<number | null>(null);
  const sectionEls = useRef<(HTMLElement | null)[]>([]);
  const detailsRef = useRef<StepDetailsHandle>(null);
  const configRef = useRef<PresentationConfigHandle>(null);

  const steps = useMemo(() => order.map((key, i) => ({
    label: SECTION_LABELS[key],
    completed:
      key === "setup" ? unlocked > i :
      key === "model" ? hasModel && unlocked > i :
      key === "markers" ? hasValidMarkers && unlocked > i :
      project.status === "active",
  })), [order, hasModel, hasValidMarkers, unlocked, project.status]);

  // Scroll once the target section has rendered (it may have just unlocked).
  useEffect(() => {
    if (pendingScroll === null) return;
    const el = sectionEls.current[pendingScroll];
    setPendingScroll(null);
    if (!el) return;
    // Wait a frame so a just-unlocked section is laid out before measuring.
    requestAnimationFrame(() => {
      animateScrollTo(el, () => {
        el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      });
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

  const handleSetupSectionNext = useCallback(() => {
    // Autosaving card: flush a pending edit in the background, never wait on it.
    void configRef.current?.save().catch((err) => console.warn("[ExperienceWizard] config save failed:", err));
    goTo(idx("model"));
  }, [goTo, idx]);

  const handleModelSectionNext = useCallback(() => {
    // Details are optional and autosave: flush any pending edit in the
    // background and move on straight away, so the CTA never waits on the network.
    void detailsRef.current?.save().catch((err) => console.warn("[ExperienceWizard] details save failed:", err));
    goTo(idx("markers"));
  }, [goTo, idx]);

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
    <div className="flow-container pb-10">
      {/* Solid strip behind the pill so content never peeks through above it. */}
      <div className="sticky top-0 z-30 bg-background pt-2 pb-1">
      <div className="rounded-full border bg-card shadow-sm px-3 py-1.5">
        <StepProgress
          steps={steps}
          currentStep={activeSection}
          maxReachable={unlocked}
          onStepClick={(i) => setPendingScroll(i)}
        />
      </div>
      </div>

      {/* Tabletop/Wall · Scale & Quality — config (2 columns) + Model quality (1 column) */}
      {mode !== "multipoint" && (
      <FlowSection
        index={idx("setup")}
        title={SECTION_LABELS.setup}
        description={`Set how the model appears on the ${surface} and how it's prepared for phones — before you upload.`}
        sectionRef={setSectionRef(idx("setup"))}
        cta={<NextButton label="Continue to 3D model" onClick={handleSetupSectionNext} />}
      >
        <ModeBanner mode={mode} />
        <PresentationConfigCard ref={configRef} className="flow-span-2" project={project} mode={mode} onUpdate={onProjectUpdate} />
        <ModelQualityCard project={project} onUpdate={onProjectUpdate} />
      </FlowSection>
      )}

      {/* 3D model (2 columns) + details (1 column) */}
      {unlocked >= idx("model") && (
      <FlowSection
        index={idx("model")}
        title={SECTION_LABELS.model}
        description={
          mode === "wall"
            ? "Upload the model that will hang on the wall, and describe the project."
            : "Upload your model and describe the project."
        }
        sectionRef={setSectionRef(idx("model"))}
        cta={
          <NextButton
            label="Continue to markers"
            onClick={handleModelSectionNext}
            blockedReason={hasModel ? undefined : "Upload a GLB model to continue"}
          />
        }
      >
        {mode === "multipoint" && <ModeBanner mode={mode} />}
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
        {mode === "multipoint" && <ModelQualityCard className="flow-col-3" project={project} onUpdate={onProjectUpdate} />}
      </FlowSection>
      )}

      {/* Markers — rendered once reached */}
      {unlocked >= idx("markers") && (
      <FlowSection
        index={idx("markers")}
        title={SECTION_LABELS.markers}
        description={
          mode === "multipoint"
            ? "Set where each printed marker sits in the room."
            : `Review how the QR code on the ${surface} anchors your model.`
        }
        sectionRef={setSectionRef(idx("markers"))}
        cta={
          <NextButton
            label="Continue to generate"
            onClick={() => goTo(idx("generate"))}
            blockedReason={hasValidMarkers ? undefined : "Enter coordinates for at least 3 markers to continue"}
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
      )}

      {/* Generate — rendered once reached */}
      {unlocked >= idx("generate") && (
      <FlowSection
        index={idx("generate")}
        title={SECTION_LABELS.generate}
        description="Check the list and generate your AR experience."
        sectionRef={setSectionRef(idx("generate"))}
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
      )}
    </div>
  );
};

export default ExperienceWizard;
