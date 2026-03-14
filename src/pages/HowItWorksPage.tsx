import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  FolderPlus,
  Upload,
  MapPin,
  Share2,
  Lightbulb,
  Crosshair,
  ChevronLeft,
  ChevronRight,
  QrCode,
  Triangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import HowItWorksTimeline from "@/components/how-it-works/HowItWorksTimeline";
import HowItWorksStepCard from "@/components/how-it-works/HowItWorksStepCard";
import { tabletopSteps, multipointSteps } from "@/components/how-it-works/stepsData";

type Mode = "tabletop" | "multipoint";

const HowItWorksPage = () => {
  const [mode, setMode] = useState<Mode | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  const steps = mode === "tabletop" ? tabletopSteps : multipointSteps;
  const step = steps[activeStep];

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl">
      <div>
        <h1 className="font-display text-3xl font-bold">How It Works</h1>
        <p className="text-muted-foreground mt-1">
          A step-by-step guide to presenting interior designs in your client's space using AR.
        </p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => { setMode("tabletop"); setActiveStep(0); }}
          className={cn(
            "relative rounded-xl border-2 p-6 text-left transition-all",
            mode === "tabletop"
              ? "border-primary bg-primary/5 shadow-md"
              : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
          )}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center",
              mode === "tabletop" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              <QrCode className="h-5 w-5" />
            </div>
            <h3 className="font-display font-semibold text-lg">Tabletop</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            View a scaled-down model on any flat surface. Uses markerless SLAM — no printed markers needed for the AR experience.
          </p>
          {mode === "tabletop" && (
            <div className="absolute top-3 right-3">
              <Badge className="bg-primary text-primary-foreground text-[10px]">Selected</Badge>
            </div>
          )}
        </button>

        <button
          onClick={() => { setMode("multipoint"); setActiveStep(0); }}
          className={cn(
            "relative rounded-xl border-2 p-6 text-left transition-all",
            mode === "multipoint"
              ? "border-warm bg-warm/5 shadow-md"
              : "border-border bg-card hover:border-warm/40 hover:shadow-sm"
          )}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center",
              mode === "multipoint" ? "bg-warm text-warm-foreground" : "bg-muted text-muted-foreground"
            )}>
              <Triangle className="h-5 w-5" />
            </div>
            <h3 className="font-display font-semibold text-lg">Multi-Point</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Overlay a 1:1 scale design in the actual room using printed markers for precise spatial tracking.
          </p>
          {mode === "multipoint" && (
            <div className="absolute top-3 right-3">
              <Badge className="bg-warm text-warm-foreground text-[10px]">Selected</Badge>
            </div>
          )}
        </button>
      </div>

      {/* Steps content — only shown after mode selection */}
      {mode && (
        <>
          <HowItWorksTimeline
            steps={steps}
            activeStep={activeStep}
            onStepClick={setActiveStep}
            accentClass={mode === "multipoint" ? "warm" : "primary"}
          />

          <HowItWorksStepCard
            step={step}
            stepIndex={activeStep}
            totalSteps={steps.length}
            accentClass={mode === "multipoint" ? "warm" : "primary"}
            onPrevious={() => setActiveStep((s) => s - 1)}
            onNext={() => setActiveStep((s) => s + 1)}
          />
        </>
      )}
    </div>
  );
};

export default HowItWorksPage;
