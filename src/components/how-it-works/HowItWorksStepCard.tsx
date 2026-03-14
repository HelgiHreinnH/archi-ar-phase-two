import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Step } from "./stepsData";

interface HowItWorksStepCardProps {
  step: Step;
  stepIndex: number;
  totalSteps: number;
  accentClass: "primary" | "warm";
  onPrevious: () => void;
  onNext: () => void;
}

const HowItWorksStepCard = ({
  step,
  stepIndex,
  totalSteps,
  accentClass,
  onPrevious,
  onNext,
}: HowItWorksStepCardProps) => {
  const isWarm = accentClass === "warm";

  return (
    <Card className={cn("border", isWarm ? "border-warm/20" : "border-primary/20")}>
      <CardContent className="p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className={cn("rounded-xl p-3 shrink-0", isWarm ? "bg-warm/10" : "bg-primary/10")}>
            <step.icon className={cn("h-6 w-6", isWarm ? "text-warm" : "text-primary")} />
          </div>
          <div>
            <Badge
              className={cn(
                "mb-2 text-xs border hover:bg-opacity-20",
                isWarm
                  ? "bg-warm/10 text-warm border-warm/20 hover:bg-warm/20"
                  : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
              )}
            >
              Step {stepIndex + 1} of {totalSteps}
            </Badge>
            <h2 className="font-display text-2xl font-semibold">{step.title}</h2>
            <p className="text-muted-foreground mt-2 leading-relaxed">{step.description}</p>
          </div>
        </div>

        {step.tips.length > 0 && (
          <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className={cn("h-4 w-4", isWarm ? "text-warm" : "text-primary")} />
              Tips
            </div>
            <ul className="space-y-1.5">
              {step.tips.map((tip, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2">
                  <span className={cn("mt-0.5", isWarm ? "text-warm" : "text-primary")}>•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" onClick={onPrevious} disabled={stepIndex === 0}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            onClick={onNext}
            disabled={stepIndex === totalSteps - 1}
            className={cn(
              isWarm
                ? "bg-warm text-warm-foreground hover:bg-warm/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default HowItWorksStepCard;
