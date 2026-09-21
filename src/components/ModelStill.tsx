import { lazy, Suspense, useEffect, useState } from "react";
import { Box, Rotate3d } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { thumbnailPath } from "@/lib/thumbnailPath";

const ModelViewer3D = lazy(() => import("@/components/ModelViewer3D"));

/**
 * Project image: a still render of the model, produced once at upload time.
 *
 * The interactive WebGL viewer is opt-in (the "View in 3D" button) because a
 * texture-heavy architectural model can need hundreds of megabytes of GPU
 * memory — enough to crash a browser tab. The dashboard shows an image by
 * default and only spins up WebGL when the architect asks for it.
 */
interface ModelStillProps {
  projectId: string;
  /** Storage path of the model, used by the on-demand 3D viewer. */
  modelUrl: string;
  className?: string;
}

const ModelStill = ({ projectId, modelUrl, className = "" }: ModelStillProps) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    setThumbUrl(null);
    supabase.storage
      .from("project-assets")
      .createSignedUrl(thumbnailPath(projectId), 60 * 60)
      .then(({ data }) => {
        if (cancelled) return;
        setThumbUrl(data?.signedUrl ?? null);
        setChecked(true);
      });
    return () => { cancelled = true; };
  }, [projectId, modelUrl]);

  // Projects uploaded before thumbnails existed get one generated on first
  // view: the render strips textures, so it costs a fraction of a live preview.
  useEffect(() => {
    if (!checked || thumbUrl || building || !modelUrl) return;
    let cancelled = false;
    setBuilding(true);
    (async () => {
      try {
        const { data } = await supabase.storage.from("project-models").createSignedUrl(modelUrl, 300);
        if (!data?.signedUrl || cancelled) return;
        const blob = await fetch(data.signedUrl).then((r) => r.blob());
        const { renderGlbThumbnail } = await import("@/lib/renderGlbThumbnail");
        const thumb = await renderGlbThumbnail(new File([blob], "model.glb"));
        if (!thumb || cancelled) return;
        await supabase.storage.from("project-assets").upload(thumbnailPath(projectId), thumb, {
          contentType: "image/jpeg", upsert: true, cacheControl: "60",
        });
        const signed = await supabase.storage
          .from("project-assets")
          .createSignedUrl(thumbnailPath(projectId), 60 * 60);
        if (!cancelled) setThumbUrl(signed.data?.signedUrl ?? null);
      } catch (err) {
        console.warn("[ModelStill] Could not build preview image:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [checked, thumbUrl, building, modelUrl, projectId]);

  if (show3D) {
    return (
      <Suspense fallback={<div className={`rounded-lg bg-muted animate-pulse ${className}`} />}>
        <ModelViewer3D key={modelUrl} modelUrl={modelUrl} className={className} />
      </Suspense>
    );
  }

  return (
    <div className={`relative rounded-lg overflow-hidden border bg-muted/50 ${className}`}>
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt="Model preview"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setThumbUrl(null)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Box className="h-7 w-7 opacity-40" />
          <p className="text-[11px]">{checked && !building ? "No preview image" : "Preparing preview…"}</p>
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="absolute bottom-2 right-2 h-7 gap-1.5 text-xs bg-background/85 backdrop-blur"
        onClick={() => setShow3D(true)}
      >
        <Rotate3d className="h-3.5 w-3.5" />
        View in 3D
      </Button>
    </div>
  );
};

export default ModelStill;
