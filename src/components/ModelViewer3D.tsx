import { useEffect, useState, useRef } from "react";
import { Box } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Phase 3.3 — Lazy-load <model-viewer> below in a useEffect.

interface ModelViewer3DProps {
  modelUrl: string; // storage path e.g. "userId/file.glb"
  className?: string;
}

// Track A — bump TTL from 10min to 24h so internal navigation reuses the same
// signed URL and the Supabase Storage edge can actually cache the GLB. The
// path always includes projectId+filename so republishes get a fresh path.
const SIGNED_URL_TTL_SEC = 60 * 60 * 24;
const SIGNED_URL_CACHE_MS = (SIGNED_URL_TTL_SEC - 60) * 1000; // refresh 1min before expiry

interface CachedSigned { url: string; at: number }

function readCache(path: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`archi-mv3d::${path}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSigned;
    if (Date.now() - parsed.at < SIGNED_URL_CACHE_MS) return parsed.url;
  } catch { /* ignore */ }
  return null;
}

function writeCache(path: string, url: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`archi-mv3d::${path}`, JSON.stringify({ url, at: Date.now() } satisfies CachedSigned));
  } catch { /* quota — ignore */ }
}

const ModelViewer3D = ({ modelUrl, className = "" }: ModelViewer3DProps) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [mvReady, setMvReady] = useState(typeof window !== "undefined" && !!customElements.get("model-viewer"));
  const isUsdz = modelUrl.toLowerCase().endsWith(".usdz");
  const mvRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mvReady) return;
    let cancelled = false;
    import("@google/model-viewer").then(() => { if (!cancelled) setMvReady(true); });
    return () => { cancelled = true; };
  }, [mvReady]);

  useEffect(() => {
    setError(false);
    const cached = readCache(modelUrl);
    if (cached) { setSignedUrl(cached); return; }
    setSignedUrl(null);
    let cancelled = false;
    supabase.storage
      .from("project-models")
      .createSignedUrl(modelUrl, SIGNED_URL_TTL_SEC)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data?.signedUrl) {
          setError(true);
        } else {
          writeCache(modelUrl, data.signedUrl);
          setSignedUrl(data.signedUrl);
        }
      });
    return () => { cancelled = true; };
  }, [modelUrl]);

  // Track A — Three.js dispose on unmount. <model-viewer> internally creates
  // a renderer + scene per element; clearing the src and removing the node
  // is what actually triggers its disposeScene path.
  useEffect(() => {
    return () => {
      const el = mvRef.current as (HTMLElement & { src?: string }) | null;
      if (!el) return;
      try { el.removeAttribute("src"); } catch { /* noop */ }
    };
  }, []);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-lg ${className}`}>
        <p className="text-xs text-muted-foreground">Could not load model preview</p>
      </div>
    );
  }

  if (!signedUrl || !mvReady) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-lg animate-pulse ${className}`}>
        <p className="text-xs text-muted-foreground">Loading model…</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg overflow-hidden bg-muted/50 border ${className}`}>
      <model-viewer
        ref={mvRef as React.MutableRefObject<any>}
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
