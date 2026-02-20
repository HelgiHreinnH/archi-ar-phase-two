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
  /**
   * Scale denominator. The model is assumed to be built 1:1 in millimetres.
   * e.g. 1 = true size, 50 = 1:50 scale, 100 = 1:100 scale.
   */
  modelScale?: number;
  /** Initial Y rotation in degrees */
  initialRotation?: number;
}

const THREE_ESM_URL =
  "https://unpkg.com/three@0.160.0/build/three.module.js";
const GLTF_LOADER_URL = "three/addons/loaders/GLTFLoader.js";
const MINDAR_THREE_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

/**
 * Physical size of the printed AR marker in millimetres.
 * 1 MindAR unit ≈ 1 marker width. Used to convert real-world mm to scene units.
 */
const MARKER_SIZE_MM = 150;

/**
 * Float height above the marker plane in MindAR scene units (metres ≈ units here).
 * 0.04 ≈ 40 mm above the printed marker.
 */
const FLOAT_ABOVE_MARKER = 0.04;

async function loadMindAR(): Promise<void> {
  if ((window as any).MINDAR?.IMAGE?.MindARThree) return;
  await import(/* @vite-ignore */ MINDAR_THREE_URL);
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
      if (!window.isSecureContext) {
        throw new Error("Camera requires a secure (HTTPS) connection.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support camera access.");
      }

      await loadMindAR();

      const MINDAR = (window as any).MINDAR;
      let ThreeLib = (window as any).THREE;
      if (!ThreeLib) {
        ThreeLib = await import(/* @vite-ignore */ THREE_ESM_URL);
      }

      if (!MINDAR?.IMAGE?.MindARThree) {
        throw new Error("MindAR not available after loading");
      }

      // Assign a stable ID so our injected CSS can target it
      const containerId = "mindar-ar-container";
      containerRef.current.id = containerId;

      // ─── Inject persistent CSS to override MindAR's inline pixel styles ───
      // MindAR sets width/height in pixels via JS style attributes.
      // A <style> tag with !important beats inline styles in all browsers.
      const styleTag = document.createElement("style");
      styleTag.id = "mindar-fill-style";
      styleTag.textContent = `
        #${containerId} { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; overflow: hidden !important; }
        #${containerId} canvas { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; object-fit: cover !important; }
        #${containerId} video  { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; object-fit: cover !important; }
      `;
      document.head.appendChild(styleTag);

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

        // Load GLB model onto the first anchor only
        if (i === 0 && modelUrl) {
          let model: any = null;
          let worldPlaced = false;

          try {
            const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl, resolve, undefined, reject);
            });
            model = gltf.scene;

            // ── Scale calculation ──────────────────────────────────────────
            // Models are built 1:1 in millimetres.
            // MindAR unit ≈ MARKER_SIZE_MM (physical marker width in mm).
            // At scale 1:N, real dimensions shrink by factor N.
            // normalizedScale converts mm model units → MindAR scene units at the chosen scale.
            const box = new ThreeLib.Box3().setFromObject(model);
            const size = box.getSize(new ThreeLib.Vector3());
            const center = box.getCenter(new ThreeLib.Vector3());
            // maxDim is in model units (mm if built 1:1 in Rhino)
            const maxDim = Math.max(size.x, size.y, size.z);
            // normalizedScale: converts model mm → MindAR units, then applies scale ratio
            // e.g. modelScale=1 (1:1): full size relative to marker
            //      modelScale=50 (1:50): 50× smaller
            const normalizedScale = (MARKER_SIZE_MM / modelScale) / maxDim;

            model.scale.set(normalizedScale, normalizedScale, normalizedScale);

            // Position: base of model at Y=0 (marker plane), centred X/Z
            model.position.x = -center.x * normalizedScale;
            model.position.y = -box.min.y * normalizedScale + FLOAT_ABOVE_MARKER;
            model.position.z = -center.z * normalizedScale;

            // Apply initial rotation (compass direction)
            if (initialRotation) {
              model.rotation.y = ThreeLib.MathUtils.degToRad(initialRotation);
            }

            anchor.group.add(model);
          } catch (loadError) {
            console.warn("Failed to load GLB model:", loadError);
          }

          // ── World-anchor placement ─────────────────────────────────────
          // On first target detection: capture world-space transform,
          // detach model from the anchor group and attach to scene root.
          // After this, the model is visible regardless of where the camera points.
          anchor.onTargetFound = () => {
            if (model && !worldPlaced) {
              model.updateWorldMatrix(true, false);
              const worldMatrix = model.matrixWorld.clone();

              anchor.group.remove(model);
              scene.add(model);

              // Decompose the captured world matrix back into position/quat/scale
              model.matrix.copy(worldMatrix);
              model.matrix.decompose(model.position, model.quaternion, model.scale);

              worldPlaced = true;
            }
            onTargetFoundRef.current?.(i);
          };

          anchor.onTargetLost = () => {
            // Model stays visible — do NOT hide it
            onTargetLostRef.current?.(i);
          };
        } else {
          anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
          anchor.onTargetLost = () => onTargetLostRef.current?.(i);
        }
      }

      // Start MindAR (requests camera, loads target)
      await mindarThree.start();
      setIsStarting(false);
      onReadyRef.current?.();

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
      // Clean up injected style tag
      document.getElementById("mindar-fill-style")?.remove();

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
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        zIndex: 0,
      }}
    />
  );
};

export default MindARScene;
