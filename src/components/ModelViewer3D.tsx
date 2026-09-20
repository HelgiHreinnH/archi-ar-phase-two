import { useEffect, useRef, useState } from "react";
import { Box, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight GLB preview (desktop + iOS/macOS Safari + Android).
 *
 * Replaces Google's <model-viewer> (~1 MB, bundles its own three.js and pulls
 * decoders from gstatic) with the three.js we already ship: GLTFLoader +
 * self-hosted Draco decoder + Meshopt decoder, orbit controls, neutral room
 * lighting for PBR materials. Renders on demand only (idle = no GPU work),
 * pauses when scrolled off-screen, caps pixel ratio at 2 for iOS memory, and
 * disposes everything on unmount.
 */

interface ModelViewer3DProps {
  modelUrl: string; // storage path e.g. "projectId/abc123/file.glb"
  className?: string;
}

const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";

// Signed URLs are reused within the session so the browser can cache the GLB.
// Model paths are unique per upload, so a cached URL never points at a stale model.
const SIGNED_URL_TTL_SEC = 60 * 60 * 24;
const SIGNED_URL_CACHE_MS = (SIGNED_URL_TTL_SEC - 60) * 1000;

function readCache(path: string): string | null {
  try {
    const raw = sessionStorage.getItem(`archi-mv3d::${path}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url: string; at: number };
    if (Date.now() - parsed.at < SIGNED_URL_CACHE_MS) return parsed.url;
  } catch { /* ignore */ }
  return null;
}

function writeCache(path: string, url: string) {
  try {
    sessionStorage.setItem(`archi-mv3d::${path}`, JSON.stringify({ url, at: Date.now() }));
  } catch { /* quota — ignore */ }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      m.dispose();
    }
  });
}

type LoadState = "signing" | "loading" | "ready" | "error";

const ModelViewer3D = ({ modelUrl, className = "" }: ModelViewer3DProps) => {
  const isUsdz = modelUrl.toLowerCase().split("?")[0].endsWith(".usdz");
  const containerRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("signing");
  const [progress, setProgress] = useState(0);

  // ── Resolve a signed URL for the private bucket ──
  useEffect(() => {
    if (isUsdz) return;
    setState("signing");
    const cached = readCache(modelUrl);
    if (cached) {
      setSignedUrl(cached);
      return;
    }
    setSignedUrl(null);
    let cancelled = false;
    supabase.storage
      .from("project-models")
      .createSignedUrl(modelUrl, SIGNED_URL_TTL_SEC)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setState("error");
        } else {
          writeCache(modelUrl, data.signedUrl);
          setSignedUrl(data.signedUrl);
        }
      });
    return () => { cancelled = true; };
  }, [modelUrl, isUsdz]);

  // ── Three.js scene ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !signedUrl) return;

    setState("loading");
    setProgress(0);
    let disposed = false;
    let frame = 0;
    let visible = true;
    let autoRotate = true;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 0.6;

    // Render loop runs only while something moves (damping / auto-rotate).
    const tick = () => {
      frame = 0;
      if (disposed || !visible) return;
      controls.autoRotate = autoRotate;
      const moved = controls.update();
      renderer.render(scene, camera);
      if (moved || autoRotate) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(tick);
    };

    const stopAutoRotate = () => { autoRotate = false; };
    controls.addEventListener("start", stopAutoRotate);
    controls.addEventListener("change", wake);

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
    });
    io.observe(container);

    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    draco.setWorkerLimit(2);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);

    let model: THREE.Object3D | null = null;

    loader.load(
      signedUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        model = gltf.scene;
        scene.add(model);

        // Frame the model: orbit around its centre, distance from its size.
        const box = new THREE.Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 1e-3);
        const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
        const dir = new THREE.Vector3(1, 0.75, 1.2).normalize();

        camera.near = Math.max(radius / 1000, 0.001);
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
        controls.minDistance = radius * 0.2;
        controls.maxDistance = radius * 10;

        resetRef.current = () => {
          controls.target.copy(sphere.center);
          camera.position.copy(sphere.center).addScaledVector(dir, dist);
          controls.update();
          autoRotate = true;
          wake();
        };
        resetRef.current();
        setState("ready");
      },
      (e) => {
        if (e.lengthComputable && e.total > 0) setProgress(Math.round((e.loaded / e.total) * 100));
      },
      (err) => {
        console.error("[ModelViewer3D] Failed to load model:", err);
        if (!disposed) setState("error");
      },
    );

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      controls.removeEventListener("start", stopAutoRotate);
      controls.removeEventListener("change", wake);
      controls.dispose();
      if (model) disposeObject(model);
      envTexture.dispose();
      draco.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      resetRef.current = () => {};
    };
  }, [signedUrl]);

  // Legacy USDZ uploads can't render in the browser (or in MindAR AR) —
  // prompt the owner to replace them with a GLB.
  if (isUsdz) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-muted/50 border rounded-lg p-4 ${className}`}>
        <Box className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-xs font-medium text-muted-foreground">USDZ · no longer supported</p>
        <p className="text-[10px] text-muted-foreground/60 text-center">
          Replace this model with a GLB export to preview it and use it in AR
        </p>
      </div>
    );
  }

  return (
    <div className={`relative rounded-lg overflow-hidden bg-muted/50 border ${className}`}>
      <div ref={containerRef} className="absolute inset-0" aria-label="3D model preview" role="img" />

      {(state === "signing" || state === "loading") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60">
          <p className="text-xs text-muted-foreground">
            {progress > 0 ? `Loading model… ${progress}%` : "Loading model…"}
          </p>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <p className="text-xs text-muted-foreground">Could not load model preview</p>
        </div>
      )}

      {state === "ready" && (
        <button
          type="button"
          onClick={() => resetRef.current()}
          className="absolute bottom-2 right-2 rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
          aria-label="Reset view"
          title="Reset view"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export default ModelViewer3D;
