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

const steps = [
  {
    icon: Crosshair,
    title: "Preparing Your 3D File",
    shortTitle: "Prepare File",
    description:
      "Before exporting your interior design model, make sure the origin point and coordinate system are set correctly. How you prepare depends on whether you're using Tabletop or Multi-Point mode.",
    sections: [
      {
        heading: "Tabletop Mode (Single QR)",
        detail:
          "For scale models viewed on a table, the QR code acts as a single anchor point. Your model's origin (0,0,0) should be at the base center of the design — this is where the QR marker will sit.",
        tips: [
          "Set the origin at the center-bottom of your model so it 'sits' on the QR marker naturally",
          "Choose your export scale to match your intended ratio (1:10 to 1:100) — the app handles the rest",
          "Use Y-up for GLB exports; the app will interpret orientation automatically",
          "Keep the model compact — Tabletop mode is ideal for furniture, fixtures, or room vignettes",
        ],
      },
      {
        heading: "Multi-Point Mode (3 Markers)",
        detail:
          "For 1:1 scale room overlays, three physical markers (A, B, C) triangulate the design's position. Your model's world origin must match the real-world location where you'll place Marker A.",
        tips: [
          "Set your model's origin (0,0,0) to the same real-world point you'll use as Marker A (e.g. a corner or doorway)",
          "Use a consistent coordinate system: Y-up for GLB (glTF standard) or Z-up if your software converts on export",
          "In Rhino, use 'Set Origin' or move geometry so the base point sits at the world origin",
          "In Revit, align 'Project Base Point' to your survey point for accurate geo-positioning",
          "In Blender, apply all transforms (Ctrl+A → All Transforms) before exporting to avoid scale/rotation issues",
          "Export a small test cube first to verify orientation and scale match the room in AR",
        ],
      },
    ],
    tips: [],
  },
  {
    icon: FolderPlus,
    title: "Create an Experience",
    shortTitle: "Create Experience",
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
    shortTitle: "Upload Model",
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
    shortTitle: "Set Markers",
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
    shortTitle: "Share",
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
  const [activeStep, setActiveStep] = useState(0);
  const step = steps[activeStep];

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl">
      <div>
        <h1 className="font-display text-3xl font-bold">How It Works</h1>
        <p className="text-muted-foreground mt-1">
          A step-by-step guide to presenting interior designs in your client's space using AR.
        </p>
      </div>

      {/* Horizontal timeline */}
      <div className="relative">
        <div className="flex items-center justify-between">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === activeStep;
            const isPast = i < activeStep;

            return (
              <div key={i} className="flex flex-1 items-center">
                {/* Node */}
                <button
                  onClick={() => setActiveStep(i)}
                  className="relative z-10 flex flex-col items-center gap-2 group"
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all",
                      isActive
                        ? "border-warm bg-warm text-warm-foreground scale-110 shadow-md"
                        : isPast
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground group-hover:border-warm/50 group-hover:text-warm"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium text-center max-w-[90px] leading-tight hidden sm:block",
                      isActive ? "text-warm font-semibold" : isPast ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {s.shortTitle}
                  </span>
                </button>

                {/* Connector line */}
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

      {/* Step detail card */}
      <Card className="border-warm/20">
        <CardContent className="p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-warm/10 p-3 shrink-0">
              <step.icon className="h-6 w-6 text-warm" />
            </div>
            <div>
              <Badge className="mb-2 text-xs bg-warm/10 text-warm border-warm/20 hover:bg-warm/20">
                Step {activeStep + 1} of {steps.length}
              </Badge>
              <h2 className="font-display text-2xl font-semibold">{step.title}</h2>
              <p className="text-muted-foreground mt-2 leading-relaxed">{step.description}</p>
            </div>
          </div>

          {/* Mode-specific sections */}
          {"sections" in step && (step as any).sections && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(step as any).sections.map((section: any, si: number) => (
                <div key={si} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {si === 0 ? (
                      <QrCode className="h-4 w-4 text-primary" />
                    ) : (
                      <Triangle className="h-4 w-4 text-warm" />
                    )}
                    {section.heading}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{section.detail}</p>
                  <ul className="space-y-1.5">
                    {section.tips.map((tip: string, ti: number) => (
                      <li key={ti} className="text-sm text-muted-foreground flex gap-2">
                        <span className={cn("mt-0.5", si === 0 ? "text-primary" : "text-warm")}>•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {step.tips.length > 0 && (
            <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lightbulb className="h-4 w-4 text-warm" />
                Tips
              </div>
              <ul className="space-y-1.5">
                {step.tips.map((tip, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-warm mt-0.5">•</span>
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
              className="bg-warm text-warm-foreground hover:bg-warm/90"
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
