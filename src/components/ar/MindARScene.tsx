import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
      // Dynamic import to avoid SSR issues and reduce bundle size
      const { MindARThree } = await import(
        /* @vite-ignore */
        "mind-ar/dist/mindar-image-three.prod.js"
      );

      const mindarThree = new MindARThree({
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
        if (i === 0 && modelUrl) {
          const loader = new GLTFLoader();
          try {
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl, resolve, undefined, reject);
            });
            const model = gltf.scene;
            
            // Calculate bounding box and normalize size
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = (modelScale / maxDim) * 0.5; // Normalize to ~0.5 units then apply scale
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
      // Cleanup MindAR on unmount
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
