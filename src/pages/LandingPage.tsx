import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Box,
  Camera,
  Upload,
  Share2,
  QrCode,
  Triangle,
  Smartphone,
  ArrowRight,
  CheckCircle2,
  Crosshair,
  FolderPlus,
  MapPin,
  Zap,
  Globe,
  Shield,
} from "lucide-react";

import heroImg from "@/assets/hero-ar.jpg";
import tabletopImg from "@/assets/ar-tabletop.jpg";
import multipointImg from "@/assets/ar-multipoint.jpg";
import dashboardImg from "@/assets/screenshots/dashboard.png";

const steps = [
  {
    icon: Crosshair,
    title: "Prepare Your 3D Model",
    description:
      "Export your interior design as a GLB file from Rhino, Blender, or SketchUp. Set the origin correctly and the platform handles the rest.",
  },
  {
    icon: FolderPlus,
    title: "Create an Experience",
    description:
      "Choose Tabletop or Multi-Point mode, add your client details, and configure the scale and settings for your presentation.",
  },
  {
    icon: Upload,
    title: "Upload & Generate",
    description:
      "Upload your model (up to 250 MB). The platform auto-generates QR codes, tracking files, and a shareable link in seconds.",
  },
  {
    icon: Share2,
    title: "Share with Your Client",
    description:
      "Send the link or QR code. Your client opens it on their phone — no app install needed — and sees your design in AR instantly.",
  },
];

const features = [
  {
    icon: Zap,
    title: "Instant Setup",
    description: "Go from 3D file to shareable AR experience in under two minutes. No coding, no plugins.",
  },
  {
    icon: Globe,
    title: "Works Everywhere",
    description: "Browser-based AR on iOS Safari and Android Chrome. Your clients never install an app.",
  },
  {
    icon: Shield,
    title: "Professional Grade",
    description: "Supports models up to 250 MB with Draco compression, multi-marker tracking, and gyro-stabilized anchoring.",
  },
];

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-lg">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Box className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold">Archi AR</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="sm" className="gap-1.5">
                Get Started <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-warm/5" />
        <div className="container relative mx-auto px-4 py-20 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-8">
              <div>
                <Badge variant="secondary" className="mb-4 gap-1.5 px-3 py-1 text-xs font-medium">
                  <Camera className="h-3 w-3" />
                  Augmented Reality for Interior Design
                </Badge>
                <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                  Present designs{" "}
                  <span className="text-gradient">in your client's space</span>
                </h1>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
                  Archi AR lets interior designers overlay 3D models in real rooms using a phone camera. No app install, no VR headset — just share a link.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to="/auth">
                  <Button size="lg" className="gap-2 text-base">
                    Start Free <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <a href="#how-it-works">
                  <Button variant="outline" size="lg" className="text-base">
                    See How It Works
                  </Button>
                </a>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {["No app install required", "iOS & Android", "GLB & USDZ support"].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative flex items-center justify-center">
              <img
                src={heroImg}
                alt="Interior designer using Archi AR to present 3D model in augmented reality"
                width={640}
                height={640}
                className="w-full max-w-md"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Two Modes */}
      <section className="border-t bg-card/50 py-20 lg:py-28" id="modes">
        <div className="container mx-auto px-4">
          <div className="mb-14 text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Two Modes, Every Scenario</h2>
            <p className="mt-3 text-muted-foreground">
              Choose the right AR presentation method for your project.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            {/* Tabletop */}
            <Card className="overflow-hidden border-2 transition-shadow hover:shadow-lg">
              <div className="aspect-[4/3] overflow-hidden">
                <img
                  src={tabletopImg}
                  alt="Tabletop AR mode showing a scaled 3D furniture model on a surface"
                  loading="lazy"
                  width={640}
                  height={640}
                  className="h-full w-full object-cover"
                />
              </div>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <QrCode className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-display text-xl font-semibold">Tabletop Mode</h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  View a scaled-down model on any flat surface. Uses your device's native AR — no printed markers needed.
                  Perfect for furniture, fixtures, or room vignettes at 1:10 to 1:100 scale.
                </p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {["Markerless SLAM placement", "Orbit, zoom & rotate with touch", "Works on any table or surface"].map(
                    (t) => (
                      <li key={t} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {t}
                      </li>
                    )
                  )}
                </ul>
              </CardContent>
            </Card>

            {/* Multi-Point */}
            <Card className="overflow-hidden border-2 transition-shadow hover:shadow-lg">
              <div className="aspect-[4/3] overflow-hidden">
                <img
                  src={multipointImg}
                  alt="Multi-Point AR mode showing 1:1 scale design overlay in a real room"
                  loading="lazy"
                  width={640}
                  height={640}
                  className="h-full w-full object-cover"
                />
              </div>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warm/10">
                    <Triangle className="h-5 w-5 text-warm" />
                  </div>
                  <h3 className="font-display text-xl font-semibold">Multi-Point Mode</h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Overlay a full-scale design in the actual room using printed color-coded markers.
                  The system triangulates position from detected markers and locks the model in physical space.
                </p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {[
                    "1:1 scale room overlays",
                    "Up to 20 markers for large spaces",
                    "Gyro-stabilized anchoring",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-warm" />
                      {t}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 lg:py-28" id="how-it-works">
        <div className="container mx-auto px-4">
          <div className="mb-14 text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">How It Works</h2>
            <p className="mt-3 text-muted-foreground">
              From 3D file to shareable AR experience in four simple steps.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="relative">
                  <div className="space-y-4 rounded-xl border bg-card p-6">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                    </div>
                    <h3 className="font-display text-lg font-semibold">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                  </div>
                  {i < steps.length - 1 && (
                    <div className="absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 lg:block">
                      <ArrowRight className="h-5 w-5 text-border" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Platform Preview */}
      <section className="border-t bg-card/50 py-20 lg:py-28">
        <div className="container mx-auto px-4">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-6">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                A dashboard built for designers
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Manage all your AR experiences in one place. Create projects, upload models, generate QR codes,
                and share links — all from a clean, intuitive interface designed for interior design professionals.
              </p>
              <ul className="space-y-3">
                {features.map((f) => {
                  const Icon = f.icon;
                  return (
                    <li key={f.title} className="flex gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-display font-semibold">{f.title}</h4>
                        <p className="text-sm text-muted-foreground">{f.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="overflow-hidden rounded-2xl border shadow-xl">
              <img
                src={dashboardImg}
                alt="Archi AR dashboard showing experience management interface"
                loading="lazy"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-warm/5 p-10 text-center lg:p-14">
            <Smartphone className="mx-auto mb-6 h-12 w-12 text-primary" />
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Ready to present in AR?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Create your first AR experience in minutes. Free to get started — no credit card required.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/auth">
                <Button size="lg" className="gap-2 text-base">
                  Create Free Account <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto flex flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Box className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-semibold">Archi AR</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Archi AR. Built for interior designers.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
