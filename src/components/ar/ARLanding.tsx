import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Box, Smartphone, Camera } from "lucide-react";

interface ARLandingProps {
  project: {
    name: string;
    description?: string | null;
    client_name?: string | null;
    mode: string;
    scale?: string | null;
    model_url?: string | null;
    marker_data?: unknown;
    /** Pre-signed model URL (multipoint path) — preloaded during dwell */
    signed_model_url?: string | null;
    tracking_format?: string | null;
    tracking_file_url?: string | null;
    mind_file_url?: string | null;
  };
  onLaunchAR: () => void;
}

const ARLanding = ({ project, onLaunchAR }: ARLandingProps) => {
  const isMultipoint = project.mode !== "tabletop";

  // ── Phase 1.2 — Preload heavy AR assets during landing-page dwell ──
  // The user typically reads the landing page for 2–4s. Use that time to
  // download the XR8 engine scripts and tracking/model assets so they're
  // already cached the moment they tap "Launch AR".
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    const addPreload = (href: string, as: "script" | "fetch", type?: string) => {
      if (!href) return;
      // Skip if already preloaded/loaded
      if (document.querySelector(`link[rel="preload"][href="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = as;
      link.href = href;
      if (as === "fetch") link.crossOrigin = "anonymous";
      if (type) link.type = type;
      document.head.appendChild(link);
      links.push(link);
    };

    // XR8 engine — only relevant for the 8thwall path, but caching them is harmless.
    if (isMultipoint) {
      addPreload("/assets/xr8/xr8.js", "script");
      addPreload("/assets/xr8/xr-slam.js", "script");
      addPreload("/assets/xr8/xrextras.js", "script");
    }

    // Tracking file (.mind or .wtc)
    const trackingUrl = project.tracking_file_url || project.mind_file_url;
    if (trackingUrl) addPreload(trackingUrl, "fetch");

    // GLB model — biggest single asset
    const modelHref = project.signed_model_url ?? null;
    if (modelHref) addPreload(modelHref, "fetch", "model/gltf-binary");

    return () => {
      // Don't remove on unmount: the browser cache should retain them for the
      // imminent navigation into the AR view.
    };
  }, [isMultipoint, project.tracking_file_url, project.mind_file_url, project.signed_model_url]);


  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Box className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-lg truncate">{project.name}</h1>
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {isMultipoint ? "Multi-Point" : "Tabletop"}
              </Badge>
            </div>
            {project.client_name && (
              <p className="text-xs text-muted-foreground truncate">For: {project.client_name}</p>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-lg mx-auto w-full p-5 space-y-5">
        {/* Description */}
        {project.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
        )}

        {/* AR Launch CTA */}
        <div className="rounded-xl border-2 border-dashed border-primary/30 p-8 text-center space-y-5">
          <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold mb-2">View in AR</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isMultipoint
                ? "Point your camera at the colored markers placed in the space to see the 3D design appear at full scale."
                : "View the 3D model with orbit controls, then tap 'View in AR' to place it on any surface using your device's built-in AR."}
            </p>
          </div>
          <Button size="lg" className="w-full gap-2" onClick={onLaunchAR}>
            <Camera className="h-4 w-4" />
            Launch AR Camera
          </Button>
        </div>

        {/* Metadata */}
        <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-medium">{isMultipoint ? "Multi-Point" : "Tabletop"}</span>
          </div>
          {isMultipoint && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Markers Required</span>
              <div className="flex gap-1.5">
                {["A", "B", "C"].map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-white"
                    style={{
                      backgroundColor:
                        id === "A" ? "hsl(0 100% 60%)" : id === "B" ? "hsl(145 63% 49%)" : "hsl(211 100% 50%)",
                    }}
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!isMultipoint && project.scale && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Scale</span>
              <span className="font-mono font-medium">{project.scale}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Model</span>
            <span className="font-medium">{project.model_url ? "✅ Loaded" : "⚠️ Not uploaded"}</span>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground pt-2">Powered by Archi AR</p>
      </main>
    </div>
  );
};

export default ARLanding;
