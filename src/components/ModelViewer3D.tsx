import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment, Center } from "@react-three/drei";
import { supabase } from "@/integrations/supabase/client";

interface ModelViewer3DProps {
  modelUrl: string; // storage path e.g. "userId/file.glb"
  className?: string;
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return (
    <Center>
      <primitive object={scene} />
    </Center>
  );
}

const ModelViewer3D = ({ modelUrl, className = "" }: ModelViewer3DProps) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const isGlb = modelUrl.toLowerCase().endsWith(".glb");

  useEffect(() => {
    if (!isGlb) return;
    supabase.storage
      .from("project-models")
      .createSignedUrl(modelUrl, 600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedUrl(data.signedUrl);
      });
  }, [modelUrl, isGlb]);

  if (!isGlb) {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-lg ${className}`}>
        <p className="text-xs text-muted-foreground">USDZ preview not available</p>
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
      <Canvas
        camera={{ position: [3, 2, 3], fov: 45 }}
        style={{ width: "100%", height: "100%" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <Suspense fallback={null}>
          <Model url={signedUrl} />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          autoRotate
          autoRotateSpeed={1.5}
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 2}
        />
      </Canvas>
    </div>
  );
};

export default ModelViewer3D;
