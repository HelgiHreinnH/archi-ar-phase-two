import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FolderPlus,
  Upload,
  MapPin,
  Share2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Lightbulb,
  Crosshair,
} from "lucide-react";

const steps = [
  {
    icon: FolderPlus,
    title: "Create a Project",
    description:
      "Start by creating a new project from the Projects page. Give it a name, add your client's name, a short description, and the project location. This keeps everything organized per site or building.",
    tips: [
      "Use clear naming like 'Villa Lindgren — Phase 2' so you can find it later",
      "The client name and location are optional but help when managing many projects",
    ],
  },
  {
    icon: Upload,
    title: "Upload Your 3D Model",
    description:
      "Open your project and upload a GLB or USDZ file (up to 250 MB). These are the standard formats for AR-ready 3D models. You'll see a real-time progress bar during upload.",
    tips: [
      "Export from Rhino, Revit, or Blender as GLB with Draco compression for smaller files",
      "USDZ works best for iOS AR Quick Look previews",
      "If your file exceeds 250 MB, try lowering textures to 2K or decimating polygon count",
    ],
  },
  {
    icon: Crosshair,
    title: "Preparing XYZ Coordinates in Your 3D File",
    description:
      "Before exporting, make sure your 3D model's origin point and coordinate system are set correctly. The AR system uses these coordinates to place and orient the model in real space — if they're off in the file, they'll be off on-site.",
    tips: [
      "Set your model's origin (0,0,0) to the same real-world point you'll use as Marker A on site",
      "Use a consistent coordinate system: Y-up for GLB (glTF standard) or Z-up if your software converts on export",
      "In Rhino, use 'Set Origin' or move your geometry so the base point sits at the world origin",
      "In Revit, use 'Project Base Point' aligned to your survey point for accurate geo-positioning",
      "In Blender, apply all transforms (Ctrl+A → All Transforms) before exporting to avoid scale/rotation issues",
      "Export a small test cube first to verify orientation and scale match your expectations in the AR view",
    ],
  },
  {
    icon: MapPin,
    title: "Set Marker Coordinates",
    description:
      "Define three marker points (A, B, C) with X, Y, Z coordinates. Point A is the anchor, while B and C are reference points. These tell the AR system exactly where to place the 3D model in the real world.",
    tips: [
      "Point A (red) is the primary anchor — place it at a fixed, easy-to-find spot on site",
      "Points B and C (green, blue) triangulate the model's orientation and scale",
      "Coordinates can be exported from Rhino/Grasshopper as JSON and pasted in",
    ],
  },
  {
    icon: Share2,
    title: "Share with Your Client",
    description:
      'Once your model is uploaded and markers are configured, hit the "Share" button to generate a unique link. Your client can open this on their phone or tablet to view the AR visualization on-site — no app install needed.',
    tips: [
      "The share link works on iOS Safari and Android Chrome with WebXR",
      "Clients can walk around the site and see the model anchored in real space",
      "You can regenerate the link anytime if you need to revoke access",
    ],
  },
];

const HowItWorksPage = () => {
  const [activeStep, setActiveStep] = useState(0);
  const step = steps[activeStep];
  const StepIcon = step.icon;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="font-display text-3xl font-bold">How It Works</h1>
        <p className="text-muted-foreground mt-1">
          A step-by-step guide to creating AR visualizations for your architectural projects.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === activeStep;
          const isCompleted = i < activeStep;
          return (
            <button
              key={i}
              onClick={() => setActiveStep(i)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isCompleted
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{s.title}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Active step detail */}
      <Card>
        <CardContent className="p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-primary/10 p-3 shrink-0">
              <StepIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <Badge variant="secondary" className="mb-2 text-xs">
                Step {activeStep + 1} of {steps.length}
              </Badge>
              <h2 className="font-display text-2xl font-semibold">{step.title}</h2>
              <p className="text-muted-foreground mt-2 leading-relaxed">{step.description}</p>
            </div>
          </div>

          {step.tips.length > 0 && (
            <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lightbulb className="h-4 w-4 text-primary" />
                Tips
              </div>
              <ul className="space-y-1.5">
                {step.tips.map((tip, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              onClick={() => setActiveStep((s) => s - 1)}
              disabled={activeStep === 0}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              onClick={() => setActiveStep((s) => s + 1)}
              disabled={activeStep === steps.length - 1}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default HowItWorksPage;
