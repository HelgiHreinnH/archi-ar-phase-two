import { useEffect, useRef, useCallback, useState } from "react";

interface MindARSceneProps {
  /** URL of the .mind compiled image target file */
  imageTargetSrc: string;
  /** URL of the .glb model to render on the anchor */
  modelUrl?: string | null;
  /** Number of image targets in the .mind file */
  maxTrack?: number;
  /** Called when a target is found (index) */
  onTargetFound?: (index: number) => void;
  /** Called when a target is lost (index) */
  onTargetLost?: (index: number) => void;
  /** Called when MindAR is ready and running */
  onReady?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Scale multiplier for the model */
  modelScale?: number;
  /** Initial Y rotation in degrees */
  initialRotation?: number;
}

/**
 * MindAR v1.2.5 ships as ES modules:
 *   - `mindar-image-three.prod.js`  imports `from "three"`
 *   - `mindar-image.prod.js`        imports `from "./controller-*.js"`
 *
 * To make these work in the browser we inject an **import-map** so the
 * bare-specifier `"three"` resolves to the Three.js r160 ES-module build
 * (the last version that still exposes `sRGBEncoding`, which MindAR needs).
 *
 * We then load the MindAR entry point with `<script type="module">` and
 * poll for `window.MINDAR.IMAGE.MindARThree` to become available.
 */

const THREE_ESM_URL =
  "https://unpkg.com/three@0.160.0/build/three.module.js";
const GLTF_LOADER_URL = "three/addons/loaders/GLTFLoader.js";
const MINDAR_THREE_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

/**
 * Load MindAR via dynamic import() so the browser's import-map (or the
 * es-module-shims polyfill) correctly resolves the bare "three" specifier.
 *
 * A dynamically-injected <script type="module"> is NOT intercepted by
 * es-module-shims, which is why the old approach timed out on Safari.
 */
async function loadMindAR(): Promise<void> {
  if ((window as any).MINDAR?.IMAGE?.MindARThree) return;

  // Dynamic import goes through the module graph → import map applies
  await import(/* @vite-ignore */ MINDAR_THREE_URL);

  // MindAR attaches itself to window.MINDAR after execution
  if (!(window as any).MINDAR?.IMAGE?.MindARThree) {
    throw new Error("MindAR module loaded but runtime not found on window.MINDAR");
  }
}

const MindARScene = ({
  imageTargetSrc,
  modelUrl,
  maxTrack = 1,
  onTargetFound,
  onTargetLost,
  onReady,
  onError,
  modelScale = 1,
  initialRotation = 0,
}: MindARSceneProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindarRef = useRef<any>(null);
  const [isStarting, setIsStarting] = useState(true);

  // Store callbacks in refs to avoid restarting MindAR on parent re-renders
  const onTargetFoundRef = useRef(onTargetFound);
  const onTargetLostRef = useRef(onTargetLost);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTargetFoundRef.current = onTargetFound;
    onTargetLostRef.current = onTargetLost;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onTargetFound, onTargetLost, onReady, onError]);

  const startAR = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      // Pre-flight: check secure context & getUserMedia support
      if (!window.isSecureContext) {
        throw new Error("Camera requires a secure (HTTPS) connection. Please access this page via HTTPS.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support camera access. Please use a modern browser like Safari, Chrome, or Firefox.");
      }

      await loadMindAR();

      const MINDAR = (window as any).MINDAR;
      const THREE = (window as any).THREE;

      // THREE might not be on window when loaded via import-map (it's an
      // ES module). We need to get it from the dynamic import instead.
      let ThreeLib = THREE;
      if (!ThreeLib) {
        ThreeLib = await import(/* @vite-ignore */ THREE_ESM_URL);
      }

      if (!MINDAR?.IMAGE?.MindARThree) {
        throw new Error("MindAR not available after loading");
      }

      const mindarThree = new MINDAR.IMAGE.MindARThree({
        container: containerRef.current,
        imageTargetSrc,
        maxTrack,
        uiLoading: "no",
        uiScanning: "no",
        uiError: "no",
      });

      mindarRef.current = mindarThree;

      const { renderer, scene, camera } = mindarThree;

      // Setup lighting
      const ambientLight = new ThreeLib.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);

      const directionalLight = new ThreeLib.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(5, 10, 7.5);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      // Create anchors for each target
      for (let i = 0; i < maxTrack; i++) {
        const anchor = mindarThree.addAnchor(i);

        anchor.onTargetFound = () => {
          onTargetFoundRef.current?.(i);
        };
        anchor.onTargetLost = () => {
          onTargetLostRef.current?.(i);
        };

        // Load GLB model onto the first anchor
        if (i === 0 && modelUrl) {
          try {
            const { GLTFLoader } = await import(
              /* @vite-ignore */ GLTF_LOADER_URL
            );
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl, resolve, undefined, reject);
            });
            const model = gltf.scene;

            // Calculate bounding box and normalize size
            const box = new ThreeLib.Box3().setFromObject(model);
            const size = box.getSize(new ThreeLib.Vector3());
            const center = box.getCenter(new ThreeLib.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const normalizedScale = (modelScale / maxDim) * 0.5;
            model.scale.set(normalizedScale, normalizedScale, normalizedScale);

            // Centre X/Z on marker; place model BASE at Y=0 (sits on marker)
            model.position.x = -center.x * normalizedScale;
            model.position.y = -box.min.y * normalizedScale;
            model.position.z = -center.z * normalizedScale;

            // Apply initial rotation
            if (initialRotation) {
              model.rotation.y = ThreeLib.MathUtils.degToRad(initialRotation);
            }

            anchor.group.add(model);
          } catch (loadError) {
            console.warn("Failed to load GLB model:", loadError);
          }
        }
      }

      // Start MindAR
      await mindarThree.start();
      setIsStarting(false);
      onReadyRef.current?.();

      // Force MindAR's internal canvas and video to fill the container
      // This fixes the black strip on iOS Safari caused by viewport miscalculation
      if (containerRef.current) {
        const canvas = containerRef.current.querySelector("canvas");
        const video = containerRef.current.querySelector("video");
        if (canvas) {
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.objectFit = "cover";
        }
        if (video) {
          video.style.width = "100%";
          video.style.height = "100%";
          video.style.objectFit = "cover";
        }
      }

      // Render loop
      renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
      });
    } catch (err) {
      console.error("MindAR initialization error:", err);
      setIsStarting(false);
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [imageTargetSrc, modelUrl, maxTrack, modelScale, initialRotation]);

  useEffect(() => {
    startAR();

    return () => {
      if (mindarRef.current) {
        try {
          mindarRef.current.stop();
        } catch {
          // Ignore cleanup errors
        }
        mindarRef.current = null;
      }
    };
  }, [startAR]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden"
      style={{ zIndex: 0, width: "100%", height: "100%" }}
    />
  );
};

export default MindARScene;
