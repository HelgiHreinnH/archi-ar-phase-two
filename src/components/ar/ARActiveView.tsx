import { useState } from "react";
import { Check, ChevronDown, Info, Camera, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface ARActiveViewProps {
  project: {
    name: string;
    description?: string | null;
  };
  onReset: () => void;
  onExit: () => void;
}

const ARActiveView = ({ project, onReset, onExit }: ARActiveViewProps) => {
  const [infoExpanded, setInfoExpanded] = useState(false);

  const handleScreenshot = () => {
    toast({ title: "Screenshot saved", description: "Image saved to your photo library." });
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Simulated AR camera feed with model */}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-700 to-zinc-800" />

      {/* Top bar */}
      <div className="relative z-10 p-4 pt-[env(safe-area-inset-top,16px)] flex items-start justify-between">
        {/* Glass-morphism info pill */}
        <button
          onClick={() => setInfoExpanded(!infoExpanded)}
          className={cn(
            "rounded-xl px-4 py-2.5 text-left transition-all max-w-[70%]",
            "bg-white/15 backdrop-blur-xl border border-white/20 shadow-lg"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-white/90 font-display text-sm font-medium truncate">{project.name}</span>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-white/60 shrink-0 transition-transform",
                infoExpanded && "rotate-180"
              )}
            />
          </div>
          {infoExpanded && project.description && (
            <p className="text-[11px] text-white/60 mt-1.5 leading-relaxed">{project.description}</p>
          )}
        </button>

        {/* Tracking status indicator */}
        <div className="h-10 w-10 rounded-full bg-green-500/20 backdrop-blur-xl border border-green-400/30 flex items-center justify-center">
          <Check className="h-4 w-4 text-green-400" />
        </div>
      </div>

      {/* Spacer — AR model renders here */}
      <div className="flex-1" />

      {/* Bottom controls */}
      <div className="relative z-10 p-4 pb-[env(safe-area-inset-bottom,24px)]">
        <div className="flex items-center justify-center gap-6">
          {/* Info */}
          <button
            onClick={() => setInfoExpanded(!infoExpanded)}
            className="h-12 w-12 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
          >
            <Info className="h-5 w-5 text-white/80" />
          </button>

          {/* Screenshot — primary */}
          <button
            onClick={handleScreenshot}
            className="h-16 w-16 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform"
          >
            <Camera className="h-6 w-6 text-white" />
          </button>

          {/* Reset */}
          <button
            onClick={onReset}
            className="h-12 w-12 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
          >
            <RotateCcw className="h-5 w-5 text-white/80" />
          </button>
        </div>

        {/* Exit hint */}
        <button
          onClick={onExit}
          className="w-full mt-4 text-center text-[11px] text-white/40 hover:text-white/60 transition-colors"
        >
          Tap to exit AR
        </button>
      </div>
    </div>
  );
};

export default ARActiveView;
