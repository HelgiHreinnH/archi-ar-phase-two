import {
  Crosshair,
  FolderPlus,
  Upload,
  MapPin,
  Share2,
  type LucideIcon,
} from "lucide-react";

export interface Step {
  icon: LucideIcon;
  title: string;
  shortTitle: string;
  description: string;
  tips: string[];
}

export const tabletopSteps: Step[] = [
  {
    icon: Crosshair,
    title: "Preparing Your 3D File",
    shortTitle: "Prepare File",
    description:
      "For tabletop mode, the model appears as a scaled miniature on a flat surface. Your model's origin (0,0,0) should be at the base center of the design — this is where the model will 'sit' on the surface.",
    tips: [
      "Set the origin at the center-bottom of your model so it sits naturally on the surface",
      "Choose your export scale to match your intended ratio (1:10 to 1:100) — the app handles the rest",
      "Use Y-up for GLB exports; the system interprets orientation automatically",
      "Keep the model compact — Tabletop mode is ideal for furniture, fixtures, or room vignettes",
      "Export as GLB with Draco compression for smaller file sizes",
    ],
  },
  {
    icon: FolderPlus,
    title: "Create an Experience",
    shortTitle: "Create Experience",
    description:
      'Start by creating a new experience from the Experiences page. Select "Tabletop" mode, give it a name, add your client\'s name, a short description, and the property address.',
    tips: [
      "Use clear naming like 'Lindgren Living Room — Concept A' so you can find it later",
      "Select a scale ratio (1:10 to 1:100) and QR code size (Small, Medium, or Large) during setup",
      "The client name and address help when managing presentations across multiple properties",
    ],
  },
  {
    icon: Upload,
    title: "Upload Your 3D Model",
    shortTitle: "Upload Model",
    description:
      "Open your experience and upload a GLB or USDZ file (up to 250 MB). You'll see a real-time progress bar during upload.",
    tips: [
      "GLB with Draco compression gives the best file size for web-based AR",
      "USDZ works best for iOS AR Quick Look previews",
      "If your file exceeds 250 MB, try lowering material textures to 2K or simplifying furniture geometry",
    ],
  },
  {
    icon: MapPin,
    title: "Generate & Share",
    shortTitle: "Generate",
    description:
      'Hit "Generate Experience" to create a QR code for your project. The pipeline generates a QR → uploads it → activates the experience in three quick steps. No marker images or .mind files are needed for tabletop mode.',
    tips: [
      "Print the QR code on heavy stock paper (200gsm+) with matte finish to reduce glare",
      "The model uses markerless SLAM placement via your device's native AR — no tracking marker required",
      "Adjust the initial rotation in the experience settings if the model faces the wrong direction",
    ],
  },
  {
    icon: Share2,
    title: "Share with Your Client",
    shortTitle: "Share",
    description:
      "Once generated, share the unique link with your client. They scan the QR or open the link, tap 'Launch AR Camera', and place the scaled model on any flat surface — no app install needed.",
    tips: [
      "The share link works on iOS Safari and Android Chrome with WebXR",
      "Clients can walk around and view the model from all angles at the configured scale",
      "You can regenerate the link anytime if you need to revoke access",
    ],
  },
];

export const multipointSteps: Step[] = [
  {
    icon: Crosshair,
    title: "Preparing Your 3D File",
    shortTitle: "Prepare File",
    description:
      "For 1:1 scale room overlays, your model must include named point layers that correspond to physical marker positions. The system detects marker_A, marker_B, marker_C (and more) from your GLB file automatically.",
    tips: [
      "Create point objects in Rhino on layers named exactly: marker_A, marker_B, marker_C — these names are required for automatic detection",
      "All markers are equal reference points — place them wherever is convenient and accessible (floor corners, wall edges, doorframes). No marker needs to sit at the model's origin",
      "Arrange the three markers to form a well-shaped triangle (avoid collinear/thin layouts). Minimum 1m edge length recommended for solid triangulation",
      "You can add up to 20 markers (marker_A through marker_T) for larger spaces",
      "Apply all transforms in Blender (Ctrl+A → All Transforms) before exporting to avoid scale/rotation issues",
      "Use Y-up for GLB (glTF standard) or Z-up if your software converts on export",
      "Export a small test cube first to verify orientation and scale match the room in AR",
    ],
  },
  {
    icon: FolderPlus,
    title: "Create an Experience",
    shortTitle: "Create Experience",
    description:
      'Start by creating a new experience and select "Multi-Point" mode. Add a name, client details, description, and property address.',
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
      "Upload your GLB file (up to 250 MB). The system automatically parses the file and extracts all marker point positions (marker_A, marker_B, marker_C, etc.) from the named layers.",
    tips: [
      "After upload, you'll see the detected marker coordinates displayed in the experience detail page",
      "If markers aren't detected, check that your Rhino layers are named exactly marker_A, marker_B, marker_C",
      "You can manually adjust marker coordinates after upload if needed",
    ],
  },
  {
    icon: MapPin,
    title: "Generate Experience",
    shortTitle: "Generate",
    description:
      'Hit "Generate Experience" to run the full pipeline: generate unique marker images for each point → compile them into a .mind tracking file → create a QR code → upload everything → activate. This typically takes 30–60 seconds.',
    tips: [
      "Each marker gets a unique, color-coded image (Red=A, Green=B, Blue=C, Yellow=D+)",
      "Download the branded A4 PDF print sheets (300 DPI) for each marker",
      "Print markers on heavy stock paper (200gsm+) and place them at the corresponding physical locations in the room",
      "The .mind file is compiled from all marker images for MindAR-based tracking",
    ],
  },
  {
    icon: Share2,
    title: "Share with Your Client",
    shortTitle: "Share",
    description:
      "Share the unique link with your client. They open it on their phone, tap 'Launch AR Camera', and point at the printed markers placed in the room. The system triangulates the model's position from detected markers and locks it in place.",
    tips: [
      "The AR experience uses variance-gated stabilization — the model locks after 10+ stable frames",
      "Once locked, soft correction keeps the model aligned even if markers are partially occluded",
      "Clients can walk around the room and see the full design overlaid at 1:1 scale",
      "Works on iOS Safari and Android Chrome — no app install needed",
    ],
  },
];
