import { useEffect, useRef, useCallback, useState } from "react";
import { computeWorldTransform } from "@/lib/computeWorldTransform";
import {
  deviceOrientationToQuaternion,
  applyGyroCompensation,
  createGyroListener,
} from "@/lib/arGyro";
import { teardownThree } from "@/lib/threeDispose";
import { ModelLoadError } from "@/lib/modelLoadError";
// Type-only import — erased at build, so it does not pull the npm three package
// at runtime (the scene loads a self-hosted three.module.js). Used to type the
// Fix 5/6 guidance helper without adding to the file's `any` surface.
import type * as THREE from "three";

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
  /**
   * Fix 5 (Jul 2026): live guidance toward not-yet-found markers during the
   * scanning phase. Positions are projected from the currently-visible
   * reference anchor's pose. Emitted ~5×/s; empty array once none remain.
   */
  onScanGuidance?: (hints: ScanHint[]) => void;
  /**
   * Fix 6 (Jul 2026): raw camera-space positions of currently-visible anchors,
   * emitted ~5×/s. Used by the architect placement validator to compare
   * observed inter-marker distances against the Rhino coordinate definitions.
   */
  onAnchorSample?: (samples: AnchorSample[]) => void;
}

/** A single directional hint toward an undetected marker (Fix 5). */
export interface ScanHint {
  /** Marker index (1-based, matches MarkerPoint.index). */
  index: number;
  /** Normalized screen X in [0,1], left→right. */
  x: number;
  /** Normalized screen Y in [0,1], top→bottom. */
  y: number;
  /** True when the projected point falls within the viewport and in front of camera. */
  onScreen: boolean;
}

/** Observed camera-space position of a visible anchor (Fix 6). */
export interface AnchorSample {
  index: number;
  x: number;
  y: number;
  z: number;
}

// Phase 2.3 — Self-hosted Three.js. See XR8Scene.tsx for rationale.
const THREE_ESM_URL = "/assets/three/three.module.js";
const GLTF_LOADER_URL = "/assets/three/jsm/loaders/GLTFLoader.js";
const DRACO_LOADER_URL = "/assets/three/jsm/loaders/DRACOLoader.js";
const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";
const MINDAR_THREE_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

/**
 * Physical size of the printed AR marker in millimetres.
 * 1 MindAR unit ≈ 1 marker width.
 */
export const MARKER_SIZE_MM = 150;

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

/**
 * Multipoint finalize (Jul 2026): minimum number of simultaneously-visible
 * anchors required before soft correction is allowed to move the locked model.
 *
 * With a single visible anchor, computeWorldTransform can only return a
 * translation-only (1-marker) solution, which can *tug* a correctly-locked
 * model toward one marker's noise. Requiring ≥2 anchors keeps at least a
 * rotation constraint in the correction. When only 2 are visible (pair
 * solution, no full plane) we further halve the blend so a partial solution
 * nudges rather than yanks; a full 3-anchor Procrustes solution gets full alpha.
 */
const SOFT_CORRECTION_MIN_ANCHORS = 2;

/** Bug 4 fix: Detection stall timeout in ms — auto-degrade after this. */
const DETECTION_STALL_TIMEOUT_MS = 30_000;

/** Fix 5/6: emit scan guidance + validator samples every N render frames (~5×/s @30fps). */
const GUIDANCE_THROTTLE_FRAMES = 6;

/** Fix 5/6: frames since an anchor's last update within which it still counts as "visible now". */
const ANCHOR_VISIBLE_WINDOW = 4;

/** GLB magic number: ASCII "glTF" = 0x676C5446 (little-endian: 0x46546C67) */
const GLB_MAGIC = 0x46546C67;

async function loadMindAR(): Promise<void> {
  if ((window as any).MINDAR?.IMAGE?.MindARThree) return;
  try {
    await import(/* @vite-ignore */ MINDAR_THREE_URL);
  } catch (err) {
    // Audit C-1: A failed dynamic import for the MindAR runtime is most often
    // either an SRI mismatch (the modulepreload integrity hash in index.html
    // no longer matches the CDN bytes) or a network/CORS issue. Disambiguate
    // by probing the URL so we can surface a precise, actionable error.
    const { MindARSRIError, isLikelySRIFailure } = await import("@/lib/sriError");
    const reachable = await isLikelySRIFailure(MINDAR_THREE_URL);
    if (reachable) {
      throw new MindARSRIError(MINDAR_THREE_URL,
        "MindAR runtime integrity check failed. The CDN file may have been updated upstream.");
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
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
  onScanGuidance,
  onAnchorSample,
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
  const onScanGuidanceRef = useRef(onScanGuidance);
  const onAnchorSampleRef = useRef(onAnchorSample);

  useEffect(() => {
    onTargetFoundRef.current = onTargetFound;
    onTargetLostRef.current = onTargetLost;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onScanGuidanceRef.current = onScanGuidance;
    onAnchorSampleRef.current = onAnchorSample;
  }, [onTargetFound, onTargetLost, onReady, onError, onScanGuidance, onAnchorSample]);

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

      console.log(
        `[MindARScene] init imageTargetSrc=${(imageTargetSrc || "").slice(0, 80)} maxTrack=${maxTrack}`
      );
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
      // Cap pixel ratio at 2 to halve GPU fill rate on 3× Retina iPhones.
      try { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); } catch { /* ignore */ }


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

      // ── Fix 5/6: Scanning-phase guidance + validator sampling state ──
      // foundOnce[i]     — anchor i has fired onTargetFound at least once
      // lastPoseFrame[i] — render-loop frame index of anchor i's last update
      // frameCount       — monotonic render-loop counter (drives visibility + throttle)
      const foundOnce: boolean[] = new Array(maxTrack).fill(false);
      const lastPoseFrame: number[] = new Array(maxTrack).fill(-999);
      let frameCount = 0;

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
            const { DRACOLoader } = await import(/* @vite-ignore */ DRACO_LOADER_URL);
            const loader = new GLTFLoader();
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
            dracoLoader.setWorkerLimit(2);
            loader.setDRACOLoader(dracoLoader);

            let gltf: any;
            if (prefetchedModel) {
              // Bug 3 fix: Validate GLB magic number before parsing
              const isValidGlb = prefetchedModel.byteLength >= 4 &&
                new DataView(prefetchedModel).getUint32(0, true) === GLB_MAGIC;

              if (isValidGlb) {
                gltf = await new Promise<any>((resolve, reject) => {
                  loader.parse(prefetchedModel, "", resolve, reject);
                });
              } else {
                console.warn("[MindARScene] Prefetched buffer is not a valid GLB (bad magic bytes), falling back to URL loading");
                if (modelUrl) {
                  gltf = await new Promise<any>((resolve, reject) => {
                    loader.load(modelUrl!, resolve, undefined, reject);
                  });
                } else {
                  throw new Error("Prefetched model is invalid and no URL fallback available");
                }
              }
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
            // Markers-only placement: keep model hidden until Procrustes lock fires
            // so its first visible frame is its correct, locked position.
            model.visible = false;

            // ── onTargetUpdate: fires every frame with valid pose ────
            anchor.onTargetUpdate = () => {
              if (!model) return;

              if (anchorState === "tracking") {
                stableFrameCounts[0]++;
                lastPoseFrame[0] = frameCount;
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
              foundOnce[0] = true;
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
            // Multipoint finalize (Jul 2026): a GLB load failure used to be
            // swallowed here — anchors kept tracking but no model ever appeared,
            // leaving the client at a silent dead-end. Surface a typed error so
            // ARViewer can route to the ModelUnavailableRecovery flow (which
            // re-signs the URL and retries) instead of failing invisibly.
            console.warn("Failed to load GLB model:", loadError);
            anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
            anchor.onTargetLost = () => onTargetLostRef.current?.(i);
            onErrorRef.current?.(
              new ModelLoadError(
                "The 3D model failed to load. The link may have expired.",
                loadError
              )
            );
          }
        } else {
          // Anchors 1+ — multi-point tracking-only
          anchor.onTargetUpdate = () => {
            if (anchorState === "tracking") {
              stableFrameCounts[i]++;
              lastPoseFrame[i] = frameCount;
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
            foundOnce[i] = true;
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
        // Reveal the model now — first visible frame = correct locked frame.
        model.visible = true;
        anchorState = "locked";

        console.log(
          "[MindARScene] Model locked.",
          hasGyroRef.current ? `Gyro compensation active (source=${(deviceQuaternionRef as any).source ?? "unknown"}).` : "No gyro — static freeze."
        );

        // Schedule a one-time check 3 s after lock — warn user if no gyro data ever arrived
        setTimeout(() => {
          if (!hasGyroRef.current) {
            import("@/hooks/use-toast").then(({ toast }) => {
              toast({
                title: "Gyroscope unavailable",
                description: "Model may drift if you walk around. Tap Reset to re-anchor.",
              });
            });
          }
        }, 3000);
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

        // Multipoint finalize (Jul 2026): require ≥2 visible anchors so a lone
        // marker's translation-only solution can't drag a good lock off-target.
        if (visibleAnchors.length < SOFT_CORRECTION_MIN_ANCHORS) return;

        // Scale the blend by how well-constrained the correction is:
        // 3+ anchors → full Procrustes (full alpha); 2 anchors → half.
        const alpha = visibleAnchors.length >= 3
          ? SOFT_CORRECTION_ALPHA
          : SOFT_CORRECTION_ALPHA * 0.5;

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

        // Blend position and rotation toward corrected (alpha scaled by anchor count)
        lockedPos.lerp(corrPos, alpha);
        lockedQuat.slerp(corrQuat, alpha);

        // Recompose into lockedMatrix (this updates the reference for gyro loop)
        lockedMatrix.compose(lockedPos, lockedQuat, lockedScl);
      }

      // ── Fix 5/6: scanning-phase guidance + validator sampling ─────
      // An anchor counts as "visible now" if it updated within the last few
      // frames and we hold a pose matrix for it.
      function isAnchorVisibleNow(idx: number): boolean {
        return frameCount - lastPoseFrame[idx] <= ANCHOR_VISIBLE_WINDOW && !!anchorPoseMatrices[idx];
      }

      function emitGuidanceAndSamples(T: typeof THREE, cam: THREE.Camera) {
        if (!markerData) return;

        // ── Fix 6: raw camera-space anchor positions for the placement validator ──
        if (onAnchorSampleRef.current) {
          const samples: AnchorSample[] = [];
          for (let idx = 0; idx < maxTrack; idx++) {
            if (!isAnchorVisibleNow(idx)) continue;
            const m = anchorPoseMatrices[idx];
            samples.push({
              index: markerData[idx]?.index ?? (idx + 1),
              x: m.elements[12],
              y: m.elements[13],
              z: m.elements[14],
            });
          }
          onAnchorSampleRef.current(samples);
        }

        // ── Fix 5: directional hints toward not-yet-found markers ──
        if (!onScanGuidanceRef.current) return;

        // Reference anchor = currently-visible anchor with the most stable frames.
        let refIdx = -1;
        for (let idx = 0; idx < maxTrack; idx++) {
          if (!isAnchorVisibleNow(idx)) continue;
          if (refIdx === -1 || stableFrameCounts[idx] > stableFrameCounts[refIdx]) refIdx = idx;
        }
        if (refIdx === -1) { onScanGuidanceRef.current([]); return; }

        const refMarker = markerData[refIdx];
        const refM = anchorPoseMatrices[refIdx];
        if (!refMarker || !refM) { onScanGuidanceRef.current([]); return; }

        const hints: ScanHint[] = [];
        for (let idx = 0; idx < maxTrack; idx++) {
          if (idx === refIdx || foundOnce[idx]) continue; // only guide toward unfound markers
          const tm = markerData[idx];
          if (!tm) continue;

          // Rhino delta → marker-plane units. Coplanar assumption: markers lie
          // flat with Rhino Z as the plane normal, so Rhino XY maps to the marker
          // plane. Adequate for edge-arrow *direction* even when markers sit on
          // different surfaces — the arrow points roughly the right way.
          const dx = (tm.x - refMarker.x) / MARKER_SIZE_MM;
          const dy = (tm.y - refMarker.y) / MARKER_SIZE_MM;
          const dz = (tm.z - refMarker.z) / MARKER_SIZE_MM;

          const world = new T.Vector3(dx, dy, dz).applyMatrix4(refM);
          // Three cameras look down -z in view space; z<0 means in front.
          const camSpace = world.clone().applyMatrix4(cam.matrixWorldInverse);
          const inFront = camSpace.z < 0;

          let x: number, y: number, onScreen: boolean;
          if (inFront) {
            const ndc = world.clone().project(cam); // [-1,1]
            x = ndc.x * 0.5 + 0.5;
            y = 1 - (ndc.y * 0.5 + 0.5);
            onScreen = x >= 0 && x <= 1 && y >= 0 && y <= 1;
            x = Math.max(0, Math.min(1, x));
            y = Math.max(0, Math.min(1, y));
          } else {
            // Behind the camera: keep the left/right sense, park low to say "turn around".
            x = camSpace.x >= 0 ? 0.9 : 0.1;
            y = 0.85;
            onScreen = false;
          }
          hints.push({ index: tm.index, x, y, onScreen });
        }
        onScanGuidanceRef.current(hints);
      }

      // Start MindAR
      await mindarThree.start();
      setIsStarting(false);
      onReadyRef.current?.();

      // ── Bug 4 fix: Detection stall timeout — auto-degrade after 30s ──
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      if (!isTabletop && markerData && maxTrack > 1) {
        stallTimer = setTimeout(() => {
          if (anchorState !== "tracking" || !modelRef) return;

          // Count anchors with any stable frames
          const stableAnchors = Array.from({ length: maxTrack }, (_, idx) => idx)
            .filter((idx) => stableFrameCounts[idx] > 0 && anchorPoseMatrices[idx]);

          console.warn(
            `[MindARScene] Detection stall timeout — ${stableAnchors.length}/${maxTrack} anchors have data`
          );

          if (stableAnchors.length >= 2) {
            // Attempt partial lock with available anchors
            const visibleAnchors = stableAnchors.map((idx) => ({
              index: markerData![idx]?.index ?? (idx + 1),
              matrix: new Float32Array(anchorPoseMatrices[idx].elements),
            }));
            const result = computeWorldTransform(visibleAnchors, markerData!, MARKER_SIZE_MM);
            if (result) {
              const worldMat = new ThreeLib.Matrix4();
              worldMat.fromArray(result);
              const anchorA = mindarThree.anchorEntities?.[0] ?? { group: { matrix: new ThreeLib.Matrix4(), remove: () => {} } };
              lockModel(modelRef, worldMat, anchorA, scene, ThreeLib);
              console.log(`[MindARScene] Stall fallback: locked with ${stableAnchors.length} anchors`);
              return;
            }
          }

          if (stableAnchors.length >= 1) {
            // Single anchor fallback — translation only
            const idx = stableAnchors[0];
            const anchorA = mindarThree.anchorEntities?.[0] ?? { group: { matrix: anchorPoseMatrices[idx], remove: () => {} } };
            modelRef.updateMatrix();
            const fallbackMatrix = new ThreeLib.Matrix4();
            fallbackMatrix.copy(anchorPoseMatrices[idx]).multiply(modelRef.matrix);
            lockModel(modelRef, fallbackMatrix, anchorA, scene, ThreeLib);
            console.warn("[MindARScene] Stall fallback: 1-anchor lock (translation only)");
            return;
          }

          // No anchors detected at all — surface error
          console.error("[MindARScene] Stall timeout: no anchors detected");
          onErrorRef.current?.(new Error("Could not detect any markers. Please check lighting and marker visibility."));
        }, DETECTION_STALL_TIMEOUT_MS);
      }

      // ── Render loop with gyro compensation ────────────────────────
      renderer.setAnimationLoop(() => {
        frameCount++;

        // Fix 5/6: during scanning, emit guidance toward unfound markers and
        // raw anchor samples for the validator. Best-effort — never break render.
        if (
          anchorState === "tracking" &&
          frameCount % GUIDANCE_THROTTLE_FRAMES === 0 &&
          (onScanGuidanceRef.current || onAnchorSampleRef.current)
        ) {
          try { emitGuidanceAndSamples(ThreeLib, camera); } catch { /* guidance is non-critical */ }
        }

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
      mindarRef.current._stallTimer = stallTimer;
      mindarRef.current._scene = scene;
      mindarRef.current._renderer = renderer;

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
          // Clear stall timer
          if (mindarRef.current._stallTimer) {
            clearTimeout(mindarRef.current._stallTimer);
          }
          // Halt render loop before disposing GL resources
          try { mindarRef.current._renderer?.setAnimationLoop?.(null); } catch { /* noop */ }
          mindarRef.current.stop();
        } catch {
          // Ignore cleanup errors
        }
        // Track A — release Three.js GPU resources to prevent the 98%-heap leak
        // documented in the May 12 audit.
        try {
          teardownThree(mindarRef.current._scene, mindarRef.current._renderer);
        } catch { /* noop */ }
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
