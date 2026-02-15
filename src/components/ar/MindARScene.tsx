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
 * Loads the MindAR + Three.js bundle from CDN (avoids npm version conflict
 * with the project's three@0.170 which removed sRGBEncoding).
 * The CDN build bundles its own compatible Three.js internally.
 */
function loadMindARScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).__MINDAR_LOADED) {
      resolve();
      return;
    }

    // Load Three.js r160 (compatible with MindAR)
    const threeScript = document.createElement("script");
    threeScript.src = "https://unpkg.com/three@0.160.0/build/three.min.js";
    threeScript.onload = () => {
      // Load GLTFLoader
      const gltfScript = document.createElement("script");
      gltfScript.src = "https://unpkg.com/three@0.160.0/examples/js/loaders/GLTFLoader.js";
      gltfScript.onload = () => {
        // Load MindAR Three.js production build
        const mindScript = document.createElement("script");
        mindScript.src = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";
        mindScript.onload = () => {
          (window as any).__MINDAR_LOADED = true;
          resolve();
        };
        mindScript.onerror = () => reject(new Error("Failed to load MindAR script"));
        document.head.appendChild(mindScript);
      };
      gltfScript.onerror = () => reject(new Error("Failed to load GLTFLoader"));
      document.head.appendChild(gltfScript);
    };
    threeScript.onerror = () => reject(new Error("Failed to load Three.js"));
    document.head.appendChild(threeScript);
  });
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

  const startAR = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      await loadMindARScript();

      const MINDAR = (window as any).MINDAR;
      const THREE = (window as any).THREE;

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
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(5, 10, 7.5);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      // Create anchors for each target
      for (let i = 0; i < maxTrack; i++) {
        const anchor = mindarThree.addAnchor(i);

        anchor.onTargetFound = () => {
          onTargetFound?.(i);
        };
        anchor.onTargetLost = () => {
          onTargetLost?.(i);
        };

        // Load GLB model onto the first anchor
        if (i === 0 && modelUrl && THREE.GLTFLoader) {
          const loader = new THREE.GLTFLoader();
          try {
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl, resolve, undefined, reject);
            });
            const model = gltf.scene;

            // Calculate bounding box and normalize size
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = (modelScale / maxDim) * 0.5;
            model.scale.set(scale, scale, scale);

            // Center the model
            const center = box.getCenter(new THREE.Vector3());
            model.position.sub(center.multiplyScalar(scale));

            // Apply initial rotation
            if (initialRotation) {
              model.rotation.y = THREE.MathUtils.degToRad(initialRotation);
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
      onReady?.();

      // Render loop
      renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
      });
    } catch (err) {
      console.error("MindAR initialization error:", err);
      setIsStarting(false);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [imageTargetSrc, modelUrl, maxTrack, modelScale, initialRotation, onTargetFound, onTargetLost, onReady, onError]);

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
      className="absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    />
  );
};

export default MindARScene;
