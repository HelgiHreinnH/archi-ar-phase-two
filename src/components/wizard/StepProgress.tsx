import { Check } from "lucide-react";

interface Step {
  label: string;
  completed: boolean;
}

interface StepProgressProps {
  steps: Step[];
  /** Section currently in view. */
  currentStep: number;
  /** Highest section index the user has unlocked. */
  maxReachable: number;
  onStepClick: (index: number) => void;
}

const StepProgress = ({ steps, currentStep, maxReachable, onStepClick }: StepProgressProps) => {
  return (
    <nav aria-label="Upload progress" className="flex items-center justify-center w-full max-w-xl mx-auto">
      {steps.map((step, i) => {
        const isCompleted = step.completed;
        const isCurrent = i === currentStep;
        const isClickable = i <= maxReachable;

        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(i)}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-2 group rounded-full py-1 pl-1 pr-3 transition-colors ${
                isClickable ? "cursor-pointer hover:bg-muted" : "cursor-default"
              }`}
            >
              <span
                className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "border-2 border-primary bg-primary/10 text-primary"
                    : "border-2 border-border bg-muted text-muted-foreground"
                } ${isCurrent ? "ring-4 ring-primary/15" : ""}`}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={`hidden sm:inline text-xs font-medium whitespace-nowrap transition-colors ${
                  isCurrent ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </button>

            {i < steps.length - 1 && (
              <div className="flex-1 h-0.5 mx-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: step.completed ? "100%" : "0%" }}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
};

export default StepProgress;
