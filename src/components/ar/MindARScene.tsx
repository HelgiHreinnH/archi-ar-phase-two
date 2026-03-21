import { useEffect, useRef, useCallback, useState } from "react";
import { computeWorldTransform } from "@/lib/computeWorldTransform";
import {
  deviceOrientationToQuaternion,
  applyGyroCompensation,
  createGyroListener,
} from "@/lib/arGyro";

interface MindARSceneProps {
  /** URL of the .mind compiled image target file */
  imageTargetSrc: string;
  /** URL of the .glb model to render on the anchor */
  modelUrl?: string | null;
  /**
   * "tabletop" — 1 marker, model floats above table surface.
   * "multipoint" (anything else) — N markers, 1:1 scale architectural registration.
   */
  mode?: string;
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
   * Scale denominator. Model assumed 1:1 in millimetres.
   * e.g. 1 = true size, 50 = 1:50, 100 = 1:100.
   */
  modelScale?: number;
  /** Initial Y rotation in degrees */
  initialRotation?: number;
  /** Rhino marker coordinates for multi-point triangulation */
  markerData?: import("@/lib/markerTypes").MarkerPoint[] | null;
  /** Pre-fetched GLB ArrayBuffer (Fix 8: prefetch during scanning) */
  prefetchedModel?: ArrayBuffer | null;
}

const THREE_ESM_URL =
  "https://unpkg.com/three@0.160.0/build/three.module.js";
const GLTF_LOADER_URL = "three/addons/loaders/GLTFLoader.js";
const MINDAR_THREE_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

/**
 * Physical size of the printed AR marker in millimetres.
 * 1 MindAR unit ≈ 1 marker width.
 */
const MARKER_SIZE_MM = 150;

/** Float height above marker plane for tabletop mode (in MindAR units). */
const FLOAT_ABOVE_MARKER = 0.267;

/** Number of stable frames before we consider locking */
const STABLE_FRAME_THRESHOLD = 10;

/**
 * Fix 3: Maximum standard deviation (in MindAR units) of anchor translation
 * over the last STABLE_FRAME_THRESHOLD frames before we allow locking.
 * ~3mm at 150mm marker size = 0.02 units.
 */
const VARIANCE_THRESHOLD = 0.02;

/**
 * Fix 7: Grace period in ms before resetting stable count on target lost.
 * Handles brief occlusions (person walking past a marker).
 */
const OCCLUSION_GRACE_MS = 500;

/**
 * Fix 4: Soft correction blend factor per frame.
 * 0 = ignore new data, 1 = jump to new pose. 0.05 = smooth 5% blend.
 */
const SOFT_CORRECTION_ALPHA = 0.05;

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
  mode = "tabletop",
  maxTrack = 1,
  onTargetFound,
  onTargetLost,
  onReady,
  onError,
  modelScale = 1,
  initialRotation = 0,
  markerData,
  prefetchedModel,
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

      // ── DeviceOrientation gyroscope listener ──
      const deviceQuaternionRef = { current: null as any };
      const hasGyroRef = { current: false };
      const cleanupGyro = createGyroListener(deviceQuaternionRef, hasGyroRef, ThreeLib);

      const containerId = "mindar-ar-container";
      containerRef.current.id = containerId;

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

      // Lighting
      const ambientLight = new ThreeLib.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);
      const directionalLight = new ThreeLib.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(5, 10, 7.5);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      // ── State machine ─────────────────────────────────────────────
      // 'tracking' — model inside anchor.group, follows marker live
      // 'locked'   — model in scene root, gyro-compensated each frame
      type AnchorState = "tracking" | "locked";
      let anchorState: AnchorState = "tracking";

      // Gyro lock state
      let lockedMatrix: any = null;
      let lockedDeviceQuat: any = null;
      let modelRef: any = null;
      let localPos: any = null;
      let localQuat: any = null;
      let localScale: any = null;

      // ── Fix 3: Per-anchor pose history for variance gate ──────────
      const poseHistories: { x: number; y: number; z: number }[][] = Array.from(
        { length: maxTrack },
        () => []
      );
      const stableFrameCounts = new Array(maxTrack).fill(0);
      const anchorPoseMatrices: (any | null)[] = new Array(maxTrack).fill(null);

      // ── Fix 7: Occlusion grace timers ─────────────────────────────
      const occlusionTimers: (ReturnType<typeof setTimeout> | null)[] = new Array(maxTrack).fill(null);

      // ── Fix 4: Track which anchors are currently visible while locked
      const anchorVisibleWhileLocked: boolean[] = new Array(maxTrack).fill(false);

      /**
       * Fix 3: Check if an anchor's recent pose history has low enough variance.
       */
      function hasLowVariance(anchorIdx: number): boolean {
        const history = poseHistories[anchorIdx];
        if (history.length < STABLE_FRAME_THRESHOLD) return false;

        const recent = history.slice(-STABLE_FRAME_THRESHOLD);
        const mean = { x: 0, y: 0, z: 0 };
        for (const p of recent) {
          mean.x += p.x;
          mean.y += p.y;
          mean.z += p.z;
        }
        mean.x /= recent.length;
        mean.y /= recent.length;
        mean.z /= recent.length;

        let sumSq = 0;
        for (const p of recent) {
          sumSq += (p.x - mean.x) ** 2 + (p.y - mean.y) ** 2 + (p.z - mean.z) ** 2;
        }
        const sd = Math.sqrt(sumSq / recent.length);
        return sd < VARIANCE_THRESHOLD;
      }

      /**
       * Record a pose sample for variance tracking.
       */
      function recordPose(anchorIdx: number, matrix: any) {
        const pos = { x: matrix.elements[12], y: matrix.elements[13], z: matrix.elements[14] };
        const history = poseHistories[anchorIdx];
        history.push(pos);
        // Keep only last 30 samples
        if (history.length > 30) history.shift();
      }

      // ── Create anchors ────────────────────────────────────────────
      for (let i = 0; i < maxTrack; i++) {
        const anchor = mindarThree.addAnchor(i);

        // Load GLB model onto anchor 0 only
        if (i === 0 && (modelUrl || prefetchedModel)) {
          try {
            const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
            const loader = new GLTFLoader();

            let gltf: any;
            if (prefetchedModel) {
              // Fix 8: Use prefetched ArrayBuffer
              gltf = await new Promise<any>((resolve, reject) => {
                loader.parse(prefetchedModel, "", resolve, reject);
              });
            } else {
              gltf = await new Promise<any>((resolve, reject) => {
                loader.load(modelUrl!, resolve, undefined, reject);
              });
            }

            const model = gltf.scene;
            modelRef = model;

            // Rhino Z-up → Three.js Y-up axis correction
            model.rotation.x = -Math.PI / 2;
            model.updateMatrixWorld(true);

            // Scale calculation
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

            // Save local-space transform for restoration
            localPos = model.position.clone();
            localQuat = model.quaternion.clone();
            localScale = model.scale.clone();

            anchor.group.add(model);

            // ── onTargetUpdate: fires every frame with valid pose ────
            anchor.onTargetUpdate = () => {
              if (!model) return;

              if (anchorState === "tracking") {
                stableFrameCounts[0]++;
                recordPose(0, anchor.group.matrix);
                anchorPoseMatrices[0] = anchor.group.matrix.clone();

                model.updateMatrix();

                // Check if we should lock (with variance gate)
                if (
                  stableFrameCounts[0] >= STABLE_FRAME_THRESHOLD &&
                  hasLowVariance(0)
                ) {
                  if (isTabletop || !markerData) {
                    if (!isTabletop && !markerData) {
                      console.warn("[MindARScene] Multi-point mode but no markerData — falling back to anchor-A-only placement");
                    }
                    const worldMatrix = new ThreeLib.Matrix4();
                    worldMatrix.copy(anchor.group.matrix).multiply(model.matrix);
                    lockModel(model, worldMatrix, anchor, scene, ThreeLib);
                  } else {
                    tryMultiPointLock(model, anchor, scene, ThreeLib);
                  }
                }
              }

              // ── Fix 4: Continuous soft correction while locked ─────
              if (anchorState === "locked" && modelRef) {
                anchorVisibleWhileLocked[0] = true;
                anchorPoseMatrices[0] = anchor.group.matrix.clone();
                applySoftCorrection(ThreeLib);
              }
            };

            // ── Fix 2: onTargetFound — DON'T reset when locked ──────
            anchor.onTargetFound = () => {
              if (anchorState === "locked") {
                // Mark anchor as visible for soft correction (Fix 4)
                anchorVisibleWhileLocked[0] = true;
                anchorPoseMatrices[0] = anchor.group.matrix.clone();
                console.log("[MindARScene] Anchor 0 re-detected while locked — using for soft correction");
              }
              onTargetFoundRef.current?.(i);
            };

            // ── Fix 7: onTargetLost with grace period ───────────────
            anchor.onTargetLost = () => {
              if (anchorState === "tracking") {
                // Start grace period instead of immediate reset
                if (occlusionTimers[0]) clearTimeout(occlusionTimers[0]);
                occlusionTimers[0] = setTimeout(() => {
                  if (anchorState === "tracking") {
                    stableFrameCounts[0] = 0;
                    poseHistories[0] = [];
                  }
                  occlusionTimers[0] = null;
                }, OCCLUSION_GRACE_MS);
              }
              if (anchorState === "locked") {
                anchorVisibleWhileLocked[0] = false;
              }
              onTargetLostRef.current?.(i);
            };

          } catch (loadError) {
            console.warn("Failed to load GLB model:", loadError);
            anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
            anchor.onTargetLost = () => onTargetLostRef.current?.(i);
          }
        } else {
          // Anchors 1+ — multi-point tracking-only
          anchor.onTargetUpdate = () => {
            if (anchorState === "tracking") {
              stableFrameCounts[i]++;
              recordPose(i, anchor.group.matrix);
              anchorPoseMatrices[i] = anchor.group.matrix.clone();
            }
            // Fix 4: Track pose while locked for soft correction
            if (anchorState === "locked") {
              anchorVisibleWhileLocked[i] = true;
              anchorPoseMatrices[i] = anchor.group.matrix.clone();
            }
          };

          anchor.onTargetFound = () => {
            if (anchorState === "locked") {
              anchorVisibleWhileLocked[i] = true;
            }
            onTargetFoundRef.current?.(i);
          };

          // Fix 7: Grace period for non-primary anchors too
          anchor.onTargetLost = () => {
            if (anchorState === "tracking") {
              if (occlusionTimers[i]) clearTimeout(occlusionTimers[i]);
              occlusionTimers[i] = setTimeout(() => {
                if (anchorState === "tracking") {
                  stableFrameCounts[i] = 0;
                  poseHistories[i] = [];
                }
                occlusionTimers[i] = null;
              }, OCCLUSION_GRACE_MS);
            }
            if (anchorState === "locked") {
              anchorVisibleWhileLocked[i] = false;
            }
            onTargetLostRef.current?.(i);
          };
        }
      }

      // ── Lock helper: move model to scene root with gyro ───────────
      function lockModel(
        model: any,
        worldMatrix: any,
        _anchor: any,
        targetScene: any,
        T: any
      ) {
        lockedDeviceQuat = deviceQuaternionRef.current
          ? deviceQuaternionRef.current.clone()
          : null;
        lockedMatrix = worldMatrix.clone();

        _anchor.group.remove(model);
        targetScene.add(model);

        model.matrix.copy(lockedMatrix);
        model.matrixAutoUpdate = false;
        anchorState = "locked";

        console.log(
          "[MindARScene] Model locked.",
          hasGyroRef.current ? "Gyro compensation active." : "No gyro — static freeze."
        );
      }

      // ── Multi-point lock: all anchors must be stable + low variance ─
      function tryMultiPointLock(
        model: any,
        anchorA: any,
        targetScene: any,
        T: any
      ) {
        // Check all anchors have enough stable frames AND low variance
        for (let idx = 0; idx < maxTrack; idx++) {
          if (stableFrameCounts[idx] < STABLE_FRAME_THRESHOLD) return;
          if (!hasLowVariance(idx)) return;
          if (!anchorPoseMatrices[idx]) return;
        }

        const visibleAnchors = Array.from({ length: maxTrack }, (_, idx) => idx)
          .filter((idx) => anchorPoseMatrices[idx])
          .map((idx) => ({
            index: markerData![idx]?.index ?? (idx + 1),
            matrix: new Float32Array(anchorPoseMatrices[idx].elements),
          }));

        const result = computeWorldTransform(visibleAnchors, markerData!, MARKER_SIZE_MM);

        if (!result) {
          console.warn("[MindARScene] computeWorldTransform returned null — falling back to anchor-A-only");
          model.updateMatrix();
          const fallbackMatrix = new T.Matrix4();
          fallbackMatrix.copy(anchorA.group.matrix).multiply(model.matrix);
          lockModel(model, fallbackMatrix, anchorA, targetScene, T);
          return;
        }

        const worldMat = new T.Matrix4();
        worldMat.fromArray(result);
        lockModel(model, worldMat, anchorA, targetScene, T);
      }

      // ── Fix 4: Soft correction — blend toward new pose data ───────
      function applySoftCorrection(T: any) {
        if (!modelRef || !lockedMatrix || !markerData) return;

        // Collect currently visible anchors
        const visibleAnchors = Array.from({ length: maxTrack }, (_, idx) => idx)
          .filter((idx) => anchorVisibleWhileLocked[idx] && anchorPoseMatrices[idx])
          .map((idx) => ({
            index: markerData![idx]?.index ?? (idx + 1),
            matrix: new Float32Array(anchorPoseMatrices[idx].elements),
          }));

        if (visibleAnchors.length === 0) return;

        const corrected = computeWorldTransform(visibleAnchors, markerData!, MARKER_SIZE_MM);
        if (!corrected) return;

        const correctedMat = new T.Matrix4();
        correctedMat.fromArray(corrected);

        // Decompose both matrices
        const lockedPos = new T.Vector3();
        const lockedQuat = new T.Quaternion();
        const lockedScl = new T.Vector3();
        lockedMatrix.decompose(lockedPos, lockedQuat, lockedScl);

        const corrPos = new T.Vector3();
        const corrQuat = new T.Quaternion();
        const corrScl = new T.Vector3();
        correctedMat.decompose(corrPos, corrQuat, corrScl);

        // Blend position and rotation toward corrected
        lockedPos.lerp(corrPos, SOFT_CORRECTION_ALPHA);
        lockedQuat.slerp(corrQuat, SOFT_CORRECTION_ALPHA);

        // Recompose into lockedMatrix (this updates the reference for gyro loop)
        lockedMatrix.compose(lockedPos, lockedQuat, lockedScl);
      }

      // Start MindAR
      await mindarThree.start();
      setIsStarting(false);
      onReadyRef.current?.();

      // ── Render loop with gyro compensation ────────────────────────
      renderer.setAnimationLoop(() => {
        if (
          anchorState === "locked" &&
          modelRef &&
          lockedMatrix &&
          lockedDeviceQuat &&
          deviceQuaternionRef.current
        ) {
          // Bug 2 fix: Snapshot lockedMatrix to prevent mid-frame mutation
          // from onTargetUpdate soft correction callback
          const framePose = lockedMatrix.clone();

          applyGyroCompensation(
            framePose,
            lockedDeviceQuat,
            deviceQuaternionRef.current,
            modelRef,
            ThreeLib
          );

          // Flush the gyro-compensated pose back
          lockedMatrix.copy(framePose);
        }

        renderer.render(scene, camera);
      });

      // Store cleanup
      mindarRef.current._cleanupGyro = cleanupGyro;
      mindarRef.current._occlusionTimers = occlusionTimers;

    } catch (err) {
      console.error("MindAR initialization error:", err);
      setIsStarting(false);
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [imageTargetSrc, modelUrl, mode, maxTrack, modelScale, initialRotation, markerData, isTabletop, floatAboveMarker, prefetchedModel]);

  useEffect(() => {
    startAR();

    return () => {
      document.getElementById("mindar-fill-style")?.remove();

      if (mindarRef.current) {
        try {
          mindarRef.current._cleanupGyro?.();
          // Clear occlusion timers
          const timers = mindarRef.current._occlusionTimers;
          if (timers) {
            for (const t of timers) {
              if (t) clearTimeout(t);
            }
          }
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
