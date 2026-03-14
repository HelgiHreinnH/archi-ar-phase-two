import { cn } from "@/lib/utils";
import type { Step } from "./stepsData";

interface HowItWorksTimelineProps {
  steps: Step[];
  activeStep: number;
  onStepClick: (index: number) => void;
  accentClass: "primary" | "warm";
}

const HowItWorksTimeline = ({ steps, activeStep, onStepClick, accentClass }: HowItWorksTimelineProps) => {
  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === activeStep;
          const isPast = i < activeStep;

          return (
            <div key={i} className="flex flex-1 items-center">
              <button
                onClick={() => onStepClick(i)}
                className="relative z-10 flex flex-col items-center gap-2 group"
              >
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all",
                    isActive
                      ? accentClass === "warm"
                        ? "border-warm bg-warm text-warm-foreground scale-110 shadow-md"
                        : "border-primary bg-primary text-primary-foreground scale-110 shadow-md"
                      : isPast
                      ? "border-primary bg-primary/10 text-primary"
                      : cn(
                          "border-border bg-card text-muted-foreground",
                          accentClass === "warm"
                            ? "group-hover:border-warm/50 group-hover:text-warm"
                            : "group-hover:border-primary/50 group-hover:text-primary"
                        )
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={cn(
                    "text-xs font-medium text-center max-w-[90px] leading-tight hidden sm:block",
                    isActive
                      ? accentClass === "warm"
                        ? "text-warm font-semibold"
                        : "text-primary font-semibold"
                      : isPast
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {s.shortTitle}
                </span>
              </button>

              {i < steps.length - 1 && (
                <div className="flex-1 mx-1">
                  <div
                    className={cn(
                      "h-0.5 w-full transition-colors",
                      i < activeStep ? "bg-primary" : "bg-border"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HowItWorksTimeline;
