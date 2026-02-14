import { Check } from "lucide-react";

interface Step {
  label: string;
  completed: boolean;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

const StepProgress = ({ steps, currentStep, onStepClick }: StepProgressProps) => {
  return (
    <div className="flex items-center justify-center gap-0 w-full max-w-xl mx-auto py-2">
      {steps.map((step, i) => {
        const isCompleted = step.completed;
        const isCurrent = i === currentStep;
        const isClickable = isCompleted || i <= currentStep;

        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            {/* Step circle + label */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(i)}
              className={`flex flex-col items-center gap-1.5 group ${
                isClickable ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <div
                className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "border-2 border-primary bg-primary/10 text-primary"
                    : "border-2 border-border bg-muted text-muted-foreground"
                } ${isClickable ? "group-hover:scale-110" : ""}`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  isCurrent
                    ? "text-primary"
                    : isCompleted
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 mt-[-1.25rem] ${
                  step.completed ? "bg-primary" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default StepProgress;
