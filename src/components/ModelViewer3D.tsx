import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import "@google/model-viewer";

interface ModelViewer3DProps {
  modelUrl: string; // storage path e.g. "userId/file.glb"
  className?: string;
}

const ModelViewer3D = ({ modelUrl, className = "" }: ModelViewer3DProps) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isGlb = modelUrl.toLowerCase().endsWith(".glb");
  const isUsdz = modelUrl.toLowerCase().endsWith(".usdz");

  useEffect(() => {
    setError(false);
    setSignedUrl(null);
    supabase.storage
      .from("project-models")
      .createSignedUrl(modelUrl, 600)
      .then(({ data, error: err }) => {
        if (err || !data?.signedUrl) {
          setError(true);
        } else {
          setSignedUrl(data.signedUrl);
        }
      });
  }, [modelUrl]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-lg ${className}`}>
        <p className="text-xs text-muted-foreground">Could not load model preview</p>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-lg animate-pulse ${className}`}>
        <p className="text-xs text-muted-foreground">Loading model…</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg overflow-hidden bg-muted/50 border ${className}`}>
      <model-viewer
        src={signedUrl}
        ios-src={isUsdz ? signedUrl : undefined}
        alt="3D model preview"
        auto-rotate=""
        camera-controls=""
        shadow-intensity="1"
        exposure="0.8"
        camera-orbit="45deg 55deg 105%"
        field-of-view="45deg"
        interaction-prompt="none"
        loading="eager"
        style={{ width: "100%", height: "100%", minHeight: "inherit" }}
      />
    </div>
  );
};

export default ModelViewer3D;
