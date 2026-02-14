import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FolderPlus,
  Upload,
  MapPin,
  Share2,
  Lightbulb,
  Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";

const steps = [
  {
    icon: Crosshair,
    title: "Preparing XYZ Coordinates in Your 3D File",
    description:
      "Before exporting your interior design model, make sure the origin point and coordinate system are set correctly. The AR system uses these coordinates to place furniture, fixtures, and finishes precisely in the client's room — if they're off in the file, they'll be off on-site.",
    tips: [
      "Set your model's origin (0,0,0) to the same real-world point you'll use as Marker A in the room (e.g. a corner or doorway)",
      "Use a consistent coordinate system: Y-up for GLB (glTF standard) or Z-up if your software converts on export",
      "In Rhino, use 'Set Origin' or move your geometry so the base point sits at the world origin",
      "In Revit, use 'Project Base Point' aligned to your survey point for accurate geo-positioning",
      "In Blender, apply all transforms (Ctrl+A → All Transforms) before exporting to avoid scale/rotation issues",
      "Export a small test cube first to verify orientation and scale match the room dimensions in the AR view",
    ],
  },
  {
    icon: FolderPlus,
    title: "Create an Experience",
    description:
      "Start by creating a new experience from the Experiences page. Give it a name, add your client's name, a short description, and the property address. This keeps everything organized per room or space.",
    tips: [
      "Use clear naming like 'Lindgren Living Room — Concept A' so you can find it later",
      "The client name and address help when managing presentations across multiple properties",
    ],
  },
  {
    icon: Upload,
    title: "Upload Your 3D Model",
    description:
      "Open your experience and upload a GLB or USDZ file (up to 250 MB). These are standard formats for AR-ready 3D interior models. You'll see a real-time progress bar during upload.",
    tips: [
      "Export your interior scene from Rhino, Revit, SketchUp, or Blender as GLB with Draco compression for smaller files",
      "USDZ works best for iOS AR Quick Look previews",
      "If your file exceeds 250 MB, try lowering material textures to 2K or simplifying furniture geometry",
    ],
  },
  {
    icon: MapPin,
    title: "Set Marker Coordinates",
    description:
      "Define three marker points (A, B, C) with X, Y, Z coordinates. Point A is the anchor, while B and C are reference points. These tell the AR system exactly where to place the interior design within the existing room.",
    tips: [
      "Point A (red) is the primary anchor — place it at a fixed, easy-to-identify spot in the room like a corner or door frame",
      "Points B and C (green, blue) triangulate the design's orientation and scale within the space",
      "Coordinates can be exported from Rhino/Grasshopper as JSON and pasted in",
    ],
  },
  {
    icon: Share2,
    title: "Share with Your Client",
    description:
      'Once your design is uploaded and markers are configured, hit the "Share" button to generate a unique link. Your client can open this on their phone or tablet to see the proposed interior overlaid in their actual room — no app install needed.',
    tips: [
      "The share link works on iOS Safari and Android Chrome with WebXR",
      "Clients can walk around the room and see furniture, materials, and layouts at true scale",
      "You can regenerate the link anytime if you need to revoke access",
    ],
  },
];

const HowItWorksPage = () => {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  return (
    <div className="space-y-8 animate-fade-in max-w-3xl">
      <div>
        <h1 className="font-display text-3xl font-bold">How It Works</h1>
        <p className="text-muted-foreground mt-1">
          A step-by-step guide to presenting interior designs in your client's space using AR.
        </p>
      </div>

      {/* Timeline */}
      <div className="relative pl-10">
        {/* Vertical line */}
        <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-border" />

        <div className="space-y-2">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === activeStep;

            return (
              <div key={i} className="relative">
                {/* Timeline dot */}
                <button
                  onClick={() => setActiveStep(isActive ? null : i)}
                  className={cn(
                    "absolute -left-10 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>

                {/* Content */}
                <button
                  onClick={() => setActiveStep(isActive ? null : i)}
                  className={cn(
                    "w-full text-left rounded-lg border p-4 transition-colors",
                    isActive
                      ? "border-primary/30 bg-primary/5"
                      : "border-transparent hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs shrink-0">
                      Step {i + 1}
                    </Badge>
                    <h3 className="font-display font-semibold text-base">{step.title}</h3>
                  </div>

                  {isActive && (
                    <div className="mt-3 space-y-4 animate-fade-in">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {step.description}
                      </p>

                      {step.tips.length > 0 && (
                        <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Lightbulb className="h-4 w-4 text-primary" />
                            Tips
                          </div>
                          <ul className="space-y-1.5">
                            {step.tips.map((tip, j) => (
                              <li key={j} className="text-sm text-muted-foreground flex gap-2">
                                <span className="text-primary mt-0.5">•</span>
                                {tip}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HowItWorksPage;
