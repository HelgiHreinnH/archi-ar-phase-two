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
      "Before exporting your interior design model, make sure the origin point, coordinate system, and layer naming are set correctly. How you prepare depends on whether you're using Tabletop or Multi-Point mode.",
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
          "No special layer naming required — just ensure the origin is set correctly before export",
        ],
      },
      {
        heading: "Multi-Point Mode (3 Markers)",
        detail:
          "For 1:1 scale room overlays, three physical markers (A, B, C) triangulate the design's position. Your model must include three named point layers that correspond to the physical marker positions.",
        tips: [
          "Create three point objects in Rhino on layers named exactly: marker_A, marker_B, and marker_C — these names are required for the system to link the 3D model to the physical QR codes",
          "marker_A is the primary anchor — place it at a fixed, identifiable spot (e.g. a corner or doorway). Set your model's origin (0,0,0) to this same location",
          "marker_B and marker_C are reference points — place them to form a well-shaped triangle (avoid collinear/thin triangles). Minimum 1m edge length recommended",
          "In Rhino, use Point3d for each marker: marker_A = Point3d(0, 0, 0), marker_B = Point3d(2000, 0, 0), marker_C = Point3d(0, 0, 1500)",
          "Apply all transforms in Blender (Ctrl+A → All Transforms) before exporting to avoid scale/rotation issues",
          "Use Y-up for GLB (glTF standard) or Z-up if your software converts on export",
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
    title: "Configure Placement",
    shortTitle: "Placement",
    description:
      "How the AR model is positioned depends on the mode you selected when creating the experience.",
    sections: [
      {
        heading: "Tabletop Mode (Single QR)",
        detail:
          "A single QR code is generated for your experience. Print it and place it on a table — the model will appear anchored to the QR position at the scale you configured (1:10 to 1:100).",
        tips: [
          "Print the QR marker on heavy stock paper (200gsm+) with matte finish to reduce glare",
          "Recommended print sizes: Small (10×10cm), Medium (15×15cm), or Large (20×20cm) — selectable when creating the experience",
          "The model's origin sits directly on the QR code, so the design 'stands up' from the table naturally",
          "Adjust the initial rotation in the experience settings if the model faces the wrong direction",
        ],
      },
      {
        heading: "Multi-Point Mode (3 Markers)",
        detail:
          "Enter the X, Y, Z coordinates for markers A, B, and C. These must match the marker_A, marker_B, and marker_C point layers you defined in your Rhino model. The system uses these three points to triangulate the model's exact position and orientation in the room.",
        tips: [
          "Point A (red) is the primary anchor — its coordinates should match your model's origin (0,0,0)",
          "Points B (green) and C (blue) define orientation and scale — ensure they form a well-shaped triangle, not a thin sliver",
          "Coordinates from Rhino/Grasshopper can be exported as JSON and pasted directly into the platform",
          'Use the format: { "A": {"x": 0, "y": 0, "z": 0}, "B": {"x": 2000, "y": 0, "z": 0}, "C": {"x": 0, "y": 0, "z": 1500} }',
          "All three markers must be printed (A4 recommended, 300 DPI minimum) and placed at the corresponding physical locations in the room",
        ],
      },
    ],
    tips: [],
  },
  {
    icon: Share2,
    title: "Share with Your Client",
    shortTitle: "Share",
    description:
      'Once your design is uploaded and placement is configured, hit the "Share" button to generate a unique link. Your client can open this on their phone or tablet to see the proposed interior overlaid in their actual room — no app install needed.',
    tips: [
      "The share link works on iOS Safari and Android Chrome with WebXR",
      "Clients can walk around the room and see furniture, materials, and layouts at true scale",
      "You can regenerate the link anytime if you need to revoke access",
    ],
  },
];

const HowItWorksPage = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [activeMode, setActiveMode] = useState<0 | 1>(0);
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

          {/* Mode-specific sections with toggle */}
          {"sections" in step && (step as any).sections && (() => {
            const sections = (step as any).sections as Array<{ heading: string; detail: string; tips: string[] }>;
            const section = sections[activeMode];
            return (
              <div className="space-y-4">
                <div className="inline-flex rounded-lg border bg-muted/50 p-1 gap-1">
                  {sections.map((s, si) => (
                    <button
                      key={si}
                      onClick={() => setActiveMode(si as 0 | 1)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                        activeMode === si
                          ? si === 0
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-warm text-warm-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {si === 0 ? <QrCode className="h-3.5 w-3.5" /> : <Triangle className="h-3.5 w-3.5" />}
                      {s.heading}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border p-4 space-y-3 animate-fade-in" key={activeMode}>
                  <p className="text-sm text-muted-foreground leading-relaxed">{section.detail}</p>
                  <ul className="space-y-1.5">
                    {section.tips.map((tip: string, ti: number) => (
                      <li key={ti} className="text-sm text-muted-foreground flex gap-2">
                        <span className={cn("mt-0.5 shrink-0", activeMode === 0 ? "text-primary" : "text-warm")}>•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })()}

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
