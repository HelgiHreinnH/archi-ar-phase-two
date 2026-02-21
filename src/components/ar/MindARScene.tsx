import { useEffect, useRef, useCallback, useState } from "react";
import { computeWorldTransform } from "@/lib/computeWorldTransform";

interface MindARSceneProps {
  /** URL of the .mind compiled image target file */
  imageTargetSrc: string;
  /** URL of the .glb model to render on the anchor */
  modelUrl?: string | null;
  /**
   * "tabletop" — 1 marker, model floats above table surface.
   * "multipoint" (anything else) — 3 markers, model sits at floor level on anchor 0.
   */
  mode?: string;
  /** Number of image targets in the .mind file — derived from mode by caller */
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
  /** Rhino marker coordinates for multi-point triangulation */
  markerData?: import("@/lib/markerTypes").MarkerPoint[] | null;
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
 * Float height above the marker plane in MindAR scene units.
 * 1 MindAR unit = MARKER_SIZE_MM (150mm) in real space.
 * To float 40mm: 40 / 150 ≈ 0.267 units.
 */
const FLOAT_ABOVE_MARKER = 0.267;

/** Number of stable tracking frames before we lock the model */
const STABLE_FRAME_THRESHOLD = 10;

async function loadMindAR(): Promise<void> {
  if ((window as any).MINDAR?.IMAGE?.MindARThree) return;
  await import(/* @vite-ignore */ MINDAR_THREE_URL);
  if (!(window as any).MINDAR?.IMAGE?.MindARThree) {
    throw new Error("MindAR module loaded but runtime not found on window.MINDAR");
  }
}

/**
 * Convert deviceorientation alpha/beta/gamma to a quaternion.
 * Uses the standard ZXY Euler convention for device orientation.
 */
function deviceOrientationToQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
  ThreeLib: any
): any {
  const degToRad = Math.PI / 180;
  const euler = new ThreeLib.Euler(
    beta * degToRad,
    alpha * degToRad,
    -gamma * degToRad,
    "YXZ"
  );
  return new ThreeLib.Quaternion().setFromEuler(euler);
}

const MindARScene = ({
  imageTargetSrc,
  modelUrl,
  mode = "tabletop",
  maxTrack = 1,
  onTargetFound,
  onTargetLost,
  onReady,
  onError,
  modelScale = 1,
  initialRotation = 0,
  markerData,
}: MindARSceneProps) => {
  const isTabletop = mode === "tabletop";
  const floatAboveMarker = isTabletop ? FLOAT_ABOVE_MARKER : 0;

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

      // ── DeviceOrientation gyroscope listener ──────────────────────────
      // Captures the phone's rotation for gyro-compensated world anchoring.
      const deviceQuaternionRef = { current: null as any };
      let hasGyro = false;

      const onDeviceOrientation = (event: DeviceOrientationEvent) => {
        if (event.alpha != null && event.beta != null && event.gamma != null) {
          hasGyro = true;
          deviceQuaternionRef.current = deviceOrientationToQuaternion(
            event.alpha,
            event.beta,
            event.gamma,
            ThreeLib
          );
        }
      };

      window.addEventListener("deviceorientation", onDeviceOrientation, true);

      // Assign a stable ID so our injected CSS can target it
      const containerId = "mindar-ar-container";
      containerRef.current.id = containerId;

      // ─── Inject persistent CSS to override MindAR's inline pixel styles ───
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

      // ── 3-state machine for world anchoring ───────────────────────────
      // 'tracking' — model inside anchor.group, follows marker live
      // 'locked'   — model in scene root, gyro-compensated each frame
      // 'reanchoring' — marker re-detected while locked; return to tracking
      type AnchorState = "tracking" | "locked" | "reanchoring";
      let anchorState: AnchorState = "tracking";

      // Gyro lock state
      let lockedMatrix: any = null;       // THREE.Matrix4
      let lockedDeviceQuat: any = null;   // THREE.Quaternion at lock time
      let modelRef: any = null;           // The loaded GLB scene
      let localPos: any = null;           // Saved local position
      let localQuat: any = null;          // Saved local quaternion
      let localScale: any = null;         // Saved local scale

      // Per-anchor stable frame counts (for multi-point)
      const stableFrameCounts = [0, 0, 0];
      const anchorPoseMatrices: (any | null)[] = [null, null, null];

      // ── Create anchors ────────────────────────────────────────────────
      for (let i = 0; i < maxTrack; i++) {
        const anchor = mindarThree.addAnchor(i);

        // Load GLB model onto anchor 0 only
        if (i === 0 && modelUrl) {
          try {
            const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl, resolve, undefined, reject);
            });
            const model = gltf.scene;
            modelRef = model;

            // ── Scale calculation ────────────────────────────────────────
            const box = new ThreeLib.Box3().setFromObject(model);
            const size = box.getSize(new ThreeLib.Vector3());
            const center = box.getCenter(new ThreeLib.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const normalizedScale = (MARKER_SIZE_MM / modelScale) / maxDim;

            model.scale.set(normalizedScale, normalizedScale, normalizedScale);

            model.position.x = -center.x * normalizedScale;
            model.position.y = -box.min.y * normalizedScale + floatAboveMarker;
            model.position.z = -center.z * normalizedScale;

            if (initialRotation) {
              model.rotation.y = ThreeLib.MathUtils.degToRad(initialRotation);
            }

            // Save local-space transform for restoration on re-anchor
            localPos = model.position.clone();
            localQuat = model.quaternion.clone();
            localScale = model.scale.clone();

            anchor.group.add(model);

            // ── onTargetUpdate: fires every frame with valid pose ────────
            anchor.onTargetUpdate = () => {
              if (!model) return;

              if (anchorState === "tracking") {
                stableFrameCounts[0]++;

                model.updateMatrix();

                // Capture the camera-relative world matrix
                const worldMatrix = new ThreeLib.Matrix4();
                worldMatrix.copy(anchor.group.matrix).multiply(model.matrix);

                anchorPoseMatrices[0] = anchor.group.matrix.clone();

                // ── Check if we should lock ──────────────────────────────
                if (stableFrameCounts[0] >= STABLE_FRAME_THRESHOLD) {
                  if (isTabletop || !markerData) {
                    // Tabletop mode OR multi-point without markerData: lock on anchor 0 only
                    if (!isTabletop && !markerData) {
                      console.warn("[MindARScene] Multi-point mode but no markerData — falling back to anchor-A-only placement");
                    }
                    lockModel(model, worldMatrix, anchor, scene, ThreeLib);
                  } else {
                    // Multi-point with markerData: wait for all 3 anchors
                    tryMultiPointLock(model, anchor, scene, ThreeLib);
                  }
                }
              }
            };

            // ── onTargetFound: re-anchor if locked ──────────────────────
            anchor.onTargetFound = () => {
              if (model && anchorState === "locked") {
                // Return model to anchor group for live tracking
                scene.remove(model);
                model.matrixAutoUpdate = true;
                anchor.group.add(model);

                model.position.set(localPos.x, localPos.y, localPos.z);
                model.quaternion.copy(localQuat);
                model.scale.set(localScale.x, localScale.y, localScale.z);
                model.updateMatrix();

                anchorState = "tracking";
                stableFrameCounts[0] = 0;
                stableFrameCounts[1] = 0;
                stableFrameCounts[2] = 0;
                lockedMatrix = null;
                lockedDeviceQuat = null;
              }
              onTargetFoundRef.current?.(i);
            };

            // ── onTargetLost ────────────────────────────────────────────
            anchor.onTargetLost = () => {
              // In the new system, we don't freeze on loss — the model
              // is already locked via gyro if it was stable enough.
              // If it wasn't stable enough (anchorState === 'tracking'),
              // the model disappears with the anchor group (acceptable).
              stableFrameCounts[0] = 0;
              onTargetLostRef.current?.(i);
            };

          } catch (loadError) {
            console.warn("Failed to load GLB model:", loadError);
            anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
            anchor.onTargetLost = () => onTargetLostRef.current?.(i);
          }
        } else {
          // Anchors 1 (B) and 2 (C) — multi-point tracking-only
          anchor.onTargetUpdate = () => {
            if (anchorState === "tracking") {
              stableFrameCounts[i]++;
              anchorPoseMatrices[i] = anchor.group.matrix.clone();
            }
          };

          anchor.onTargetFound = () => {
            onTargetFoundRef.current?.(i);
          };

          anchor.onTargetLost = () => {
            stableFrameCounts[i] = 0;
            onTargetLostRef.current?.(i);
          };
        }
      }

      // ── Lock helper: move model to scene root with gyro compensation ──
      function lockModel(
        model: any,
        worldMatrix: any,
        _anchor: any,
        targetScene: any,
        T: any
      ) {
        // Capture the current gyro quaternion at lock time
        lockedDeviceQuat = deviceQuaternionRef.current
          ? deviceQuaternionRef.current.clone()
          : null;
        lockedMatrix = worldMatrix.clone();

        // Move model from anchor group to scene root
        _anchor.group.remove(model);
        targetScene.add(model);

        model.matrix.copy(lockedMatrix);
        model.matrixAutoUpdate = false;
        anchorState = "locked";

        console.log(
          "[MindARScene] Model locked.",
          hasGyro ? "Gyro compensation active." : "No gyro — static freeze."
        );
      }

      // ── Multi-point lock: all 3 anchors must be stable ────────────────
      function tryMultiPointLock(
        model: any,
        anchorA: any,
        targetScene: any,
        T: any
      ) {
        if (
          stableFrameCounts[0] < STABLE_FRAME_THRESHOLD ||
          stableFrameCounts[1] < STABLE_FRAME_THRESHOLD ||
          stableFrameCounts[2] < STABLE_FRAME_THRESHOLD
        ) {
          return; // Not all anchors stable yet
        }

        if (!anchorPoseMatrices[0] || !anchorPoseMatrices[1] || !anchorPoseMatrices[2]) {
          return;
        }

        // Extract VisibleAnchor objects for computeWorldTransform
        const visibleAnchors = [0, 1, 2]
          .filter((idx) => anchorPoseMatrices[idx])
          .map((idx) => ({
            index: markerData![idx]?.index ?? (idx + 1),
            matrix: new Float32Array(anchorPoseMatrices[idx].elements),
          }));

        const result = computeWorldTransform(visibleAnchors, markerData!, MARKER_SIZE_MM);

        if (!result) {
          console.warn("[MindARScene] computeWorldTransform returned null — falling back to anchor-A-only");
          // Fall back to anchor-A-only
          model.updateMatrix();
          const fallbackMatrix = new T.Matrix4();
          fallbackMatrix.copy(anchorA.group.matrix).multiply(model.matrix);
          lockModel(model, fallbackMatrix, anchorA, targetScene, T);
          return;
        }

        // Use the computed world transform as the locked matrix
        const worldMat = new T.Matrix4();
        worldMat.fromArray(result);
        lockModel(model, worldMat, anchorA, targetScene, T);
      }

      // Start MindAR
      await mindarThree.start();
      setIsStarting(false);
      onReadyRef.current?.();

      // ── Render loop with gyro compensation ────────────────────────────
      renderer.setAnimationLoop(() => {
        // When locked and gyro is available, compensate for device rotation
        if (
          anchorState === "locked" &&
          modelRef &&
          lockedMatrix &&
          lockedDeviceQuat &&
          deviceQuaternionRef.current
        ) {
          // deltaQuat = inverse(lockedDeviceQuat) * currentDeviceQuat
          const deltaQuat = lockedDeviceQuat
            .clone()
            .invert()
            .multiply(deviceQuaternionRef.current.clone());

          // Build a rotation matrix from deltaQuat, then invert it
          // (we want to cancel the device rotation, not apply it)
          const deltaMatrix = new ThreeLib.Matrix4().makeRotationFromQuaternion(deltaQuat);
          deltaMatrix.invert();

          // Apply: model.matrix = deltaMatrix * lockedMatrix
          const compensated = new ThreeLib.Matrix4();
          compensated.multiplyMatrices(deltaMatrix, lockedMatrix);
          modelRef.matrix.copy(compensated);
        }

        renderer.render(scene, camera);
      });

      // Store cleanup for the deviceorientation listener
      mindarRef.current._cleanupGyro = () => {
        window.removeEventListener("deviceorientation", onDeviceOrientation, true);
      };

    } catch (err) {
      console.error("MindAR initialization error:", err);
      setIsStarting(false);
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [imageTargetSrc, modelUrl, mode, maxTrack, modelScale, initialRotation, markerData, isTabletop, floatAboveMarker]);

  useEffect(() => {
    startAR();

    return () => {
      // Clean up injected style tag
      document.getElementById("mindar-fill-style")?.remove();

      if (mindarRef.current) {
        try {
          mindarRef.current._cleanupGyro?.();
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
