import { useEffect, useRef, useState } from "react";
import { computeModelPlacement } from "@/lib/modelPlacement";
import { computeWorldTransform } from "@/lib/computeWorldTransform";
import {
  deviceOrientationToQuaternion,
  applyGyroCompensation,
  createGyroListener,
} from "@/lib/arGyro";
import { teardownThree, disposeScene } from "@/lib/threeDispose";
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
   * True while the parent is still streaming `prefetchedModel`. The scene then
   * waits for the buffer instead of starting a second download from
   * `modelUrl`; it falls back to the URL once this goes false with no buffer.
   */
  awaitPrefetch?: boolean;
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
// Models uploaded since Sep 2026 are meshopt-compressed in the browser.
const MESHOPT_DECODER_URL = "/assets/three/jsm/libs/meshopt_decoder.module.js";
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
 * Fix 3: Maximum standard deviation of anchor translation, in MARKER WIDTHS,
 * over the last STABLE_FRAME_THRESHOLD frames before we allow locking.
 * 0.02 marker widths = 3 mm on a 150 mm marker.
 *
 * Sept 2026: the samples used to be raw anchor-matrix translations, which are
 * in MindAR's world units — the compiled target's pixel width (600 for the QR,
 * 1200 for printed markers) per marker width. Against those, 0.02 meant 5
 * MICRONS of jitter, so the gate never passed, the lock never fired and the
 * model — hidden until the lock by design — never appeared, even though
 * tracking was green. recordPose now normalises by the anchor scale.
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

/**
 * Sept 2026: how hard a locked TABLETOP model follows the live QR pose while
 * the QR is in view (per tracked frame). MindAR already One-Euro filters the
 * anchor, so this only takes the edge off. Without it the locked model was
 * held by the gyroscope alone and froze on screen whenever motion access was
 * not granted (iOS asks separately, and only from a tap).
 */
const TABLETOP_FOLLOW_ALPHA = 0.5;

/**
 * Sept 2026: MindAR's addImageTargets() wraps an async executor in a Promise,
 * so a bad tracking file (404, an HTML page, an unsigned path) never rejects —
 * start() just never resolves and the UI sits on "Starting camera…" forever.
 * We now pre-download and validate the file ourselves, and bound start().
 */
const MINDAR_START_TIMEOUT_MS = 25_000;

/** Bug 4 fix: Detection stall timeout in ms — auto-degrade after this. */
const DETECTION_STALL_TIMEOUT_MS = 12_000;

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
    const { MindARSRIError, isLikelySRIFailure, findBrokenModuleDependency } =
      await import("@/lib/sriError");

    // The runtime imports "three" and "three/addons/renderers/CSS3DRenderer.js"
    // through the import map. A missing self-hosted file is served as index.html
    // by the SPA, which fails module parsing and looks identical to an SRI
    // mismatch — check that first so the error names the real cause.
    const broken = await findBrokenModuleDependency([
      "/assets/three/three.module.js",
      "/assets/three/jsm/renderers/CSS3DRenderer.js",
    ]);
    if (broken) {
      throw new Error(`AR engine dependency is missing or not a module: ${broken}`);
    }

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

/**
 * Handle published by the scene effect (Effect A) once the camera is live.
 * The model effect (Effect B) uses it to hand a parsed GLB to anchor 0
 * without restarting the camera or MindAR.
 */
interface SceneHandle {
  ThreeLib: any;
  attachModel: (model: any) => void;
  detachModel: (model: any) => void;
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
  awaitPrefetch = false,
  onScanGuidance,
  onAnchorSample,
}: MindARSceneProps) => {
  const isTabletop = mode === "tabletop";
  const isTabletopMode = isTabletop;
  const floatAboveMarker = isTabletop ? FLOAT_ABOVE_MARKER : 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const [, setIsStarting] = useState(true);

  // Live scene handle (null while the camera is starting or torn down) and an
  // epoch counter that bumps each time a fresh scene goes live, so Effect B
  // re-attaches the model to the new scene after a camera restart.
  const sceneRef = useRef<SceneHandle | null>(null);
  const [sceneEpoch, setSceneEpoch] = useState(0);

  const onTargetFoundRef = useRef(onTargetFound);
  const onTargetLostRef = useRef(onTargetLost);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onScanGuidanceRef = useRef(onScanGuidance);
  const onAnchorSampleRef = useRef(onAnchorSample);
  // Data the long-lived scene reads at call time. Held in refs so a new array
  // identity (ARViewer re-derives markerData on every render) or a re-signed
  // model URL never tears down the camera.
  const markerDataRef = useRef(markerData);
  const modelUrlRef = useRef(modelUrl);

  useEffect(() => {
    onTargetFoundRef.current = onTargetFound;
    onTargetLostRef.current = onTargetLost;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onScanGuidanceRef.current = onScanGuidance;
    onAnchorSampleRef.current = onAnchorSample;
    markerDataRef.current = markerData;
    modelUrlRef.current = modelUrl;
  }, [onTargetFound, onTargetLost, onReady, onError, onScanGuidance, onAnchorSample, markerData, modelUrl]);

  // ════════════════════════════════════════════════════════════════════
  // Effect A — camera, MindAR tracking, anchors, lock state machine.
  // Keyed only on what genuinely requires a new MindAR instance. The model is
  // NOT a dependency: it arrives later through the SceneHandle (Effect B).
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;
    let tornDown = false;
    let instance: any = null;
    let cleanupGyro: (() => void) | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let occlusionTimers: (ReturnType<typeof setTimeout> | null)[] = [];
    let trackingBlobUrl: string | null = null;

    const tabletop = mode === "tabletop";
    // Tabletop and wall are the same single-QR experience — one printed QR is
    // the anchor, only the model's orientation/offset differs (see Effect B).
    // Everything about locking and holding the model keys off this, not
    // `tabletop`, so the two modes can't drift apart again.
    const singleQr = tabletop || mode === "wall";

    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      sceneRef.current = null;
      document.getElementById("mindar-fill-style")?.remove();
      try { cleanupGyro?.(); } catch { /* noop */ }
      for (const t of occlusionTimers) if (t) clearTimeout(t);
      if (stallTimer) clearTimeout(stallTimer);
      if (trackingBlobUrl) { try { URL.revokeObjectURL(trackingBlobUrl); } catch { /* noop */ } trackingBlobUrl = null; }
      if (!instance) return;
      try {
        // Halt render loop before disposing GL resources
        try { instance.renderer?.setAnimationLoop?.(null); } catch { /* noop */ }
        instance.stop();
      } catch {
        // Ignore cleanup errors
      }
      // Track A — release Three.js GPU resources to prevent the 98%-heap leak
      // documented in the May 12 audit.
      try { teardownThree(instance.scene, instance.renderer); } catch { /* noop */ }
      instance = null;
    };

    (async () => {
      if (!containerRef.current) return;

      try {
        if (!window.isSecureContext) {
          throw new Error("Camera requires a secure (HTTPS) connection.");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Your browser does not support camera access.");
        }

        await loadMindAR();
        if (cancelled) return;

        const MINDAR = (window as any).MINDAR;
        let ThreeLib = (window as any).THREE;
        if (!ThreeLib) {
          ThreeLib = await import(/* @vite-ignore */ THREE_ESM_URL);
          if (cancelled) return;
        }

        if (!MINDAR?.IMAGE?.MindARThree) {
          throw new Error("MindAR not available after loading");
        }
        if (!containerRef.current) return;

        // ── DeviceOrientation gyroscope listener ──
        const deviceQuaternionRef = { current: null as any };
        const hasGyroRef = { current: false };
        cleanupGyro = createGyroListener(deviceQuaternionRef, hasGyroRef, ThreeLib);

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

        // Pre-download + validate the tracking file (see MINDAR_START_TIMEOUT_MS).
        // The viewer already warmed it with force-cache, so this is normally a
        // cache hit; MindAR then reads it from a blob URL — one download, and a
        // bad file fails loudly here instead of hanging start().
        let trackingRes: Response;
        try {
          trackingRes = await fetch(imageTargetSrc, { cache: "force-cache" });
        } catch {
          throw new Error("Could not download the AR tracking file. Check your connection and try again.");
        }
        if (!trackingRes.ok) {
          throw new Error(`The AR tracking file could not be downloaded (HTTP ${trackingRes.status}). The link may have expired — reload the page.`);
        }
        const trackingBuf = await trackingRes.arrayBuffer();
        if (cancelled) return;
        const firstByte = trackingBuf.byteLength > 0 ? new Uint8Array(trackingBuf)[0] : -1;
        if (trackingBuf.byteLength < 16 || firstByte === 0x3c /* "<" — an HTML page, not a .mind */) {
          throw new Error("The AR tracking file is invalid. Ask the designer to regenerate this experience.");
        }
        trackingBlobUrl = URL.createObjectURL(new Blob([trackingBuf], { type: "application/octet-stream" }));
        if (!containerRef.current) return;

        const mindarThree = new MINDAR.IMAGE.MindARThree({
          container: containerRef.current,
          imageTargetSrc: trackingBlobUrl,
          maxTrack,
          uiLoading: "no",
          uiScanning: "no",
          uiError: "no",
        });
        instance = mindarThree;

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
        // 'tracking' — model (if attached) inside anchor 0's group, hidden
        // 'locked'   — model in scene root, gyro-compensated each frame
        type AnchorState = "tracking" | "locked";
        let anchorState: AnchorState = "tracking";

        // Gyro lock state
        let lockedMatrix: any = null;
        let lockedDeviceQuat: any = null;
        // The attached model. Null until Effect B hands one over — tracking,
        // pose history and scan guidance all run without it.
        let model: any = null;
        // Tabletop: the model's pose relative to anchor 0 at lock time, so the
        // locked model can keep following the QR while it is in view.
        let modelLocalMatrix: any = null;

        // ── Fix 3: Per-anchor pose history for variance gate ──────────
        const poseHistories: { x: number; y: number; z: number }[][] = Array.from(
          { length: maxTrack },
          () => []
        );
        const stableFrameCounts = new Array(maxTrack).fill(0);
        const anchorPoseMatrices: (any | null)[] = new Array(maxTrack).fill(null);

        // ── Fix 7: Occlusion grace timers ─────────────────────────────
        occlusionTimers = new Array(maxTrack).fill(null);

        // ── Fix 4: Track which anchors are currently visible while locked
        const anchorVisibleWhileLocked: boolean[] = new Array(maxTrack).fill(false);

        // ── Fix 5/6: Scanning-phase guidance + validator sampling state ──
        const foundOnce: boolean[] = new Array(maxTrack).fill(false);
        const lastPoseFrame: number[] = new Array(maxTrack).fill(-999);
        let frameCount = 0;

        // Bug 4: set when the stall timer fired before a model was attached;
        // the fallback then runs the moment the model lands.
        let stallPending = false;

        /** Fix 3: Check if an anchor's recent pose history has low enough variance. */
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

        /** Record a pose sample (in marker widths) for variance tracking. */
        function recordPose(anchorIdx: number, matrix: any) {
          const e = matrix.elements;
          // The anchor matrix carries MindAR's postMatrix scale: one marker
          // width in world units. Normalise so variance is scale-independent.
          const unit = Math.hypot(e[0], e[1], e[2]) || 1;
          const pos = { x: e[12] / unit, y: e[13] / unit, z: e[14] / unit };
          const history = poseHistories[anchorIdx];
          history.push(pos);
          // Keep only last 30 samples
          if (history.length > 30) history.shift();
        }

        // ── Create anchors ────────────────────────────────────────────
        // Every anchor tracks from the first frame, model or not. Anchor 0 also
        // drives the lock once a model is attached.
        const anchors: any[] = [];
        for (let i = 0; i < maxTrack; i++) {
          const anchor = mindarThree.addAnchor(i);
          anchors.push(anchor);

          anchor.onTargetUpdate = () => {
            if (anchorState === "tracking") {
              stableFrameCounts[i]++;
              lastPoseFrame[i] = frameCount;
              recordPose(i, anchor.group.matrix);
              anchorPoseMatrices[i] = anchor.group.matrix.clone();

              // Check if we should lock (with variance gate) — anchor 0 only,
              // and only once there is a model to place.
              if (
                i === 0 &&
                model &&
                stableFrameCounts[0] >= STABLE_FRAME_THRESHOLD &&
                hasLowVariance(0)
              ) {
                model.updateMatrix();
                const md = markerDataRef.current;
                if (singleQr || !md) {
                  if (!singleQr && !md) {
                    console.warn("[MindARScene] Multi-point mode but no markerData — falling back to anchor-A-only placement");
                  }
                  const worldMatrix = new ThreeLib.Matrix4();
                  worldMatrix.copy(anchor.group.matrix).multiply(model.matrix);
                  modelLocalMatrix = model.matrix.clone();
                  lockModel(worldMatrix);
                } else {
                  tryMultiPointLock(anchor);
                }
              }
            } else if (anchorState === "locked") {
              // Fix 4: Track pose while locked for soft correction
              anchorVisibleWhileLocked[i] = true;
              anchorPoseMatrices[i] = anchor.group.matrix.clone();
              if (i === 0) {
                if (singleQr) followQrWhileVisible(anchor);
                else applySoftCorrection(ThreeLib);
              }
            }
          };

          // Fix 2: onTargetFound — DON'T reset when locked
          anchor.onTargetFound = () => {
            foundOnce[i] = true;
            if (anchorState === "locked") {
              anchorVisibleWhileLocked[i] = true;
              anchorPoseMatrices[i] = anchor.group.matrix.clone();
              if (i === 0) console.log("[MindARScene] Anchor 0 re-detected while locked — using for soft correction");
            }
            onTargetFoundRef.current?.(i);
          };

          // Fix 7: onTargetLost with grace period
          anchor.onTargetLost = () => {
            if (anchorState === "tracking") {
              if (occlusionTimers[i]) clearTimeout(occlusionTimers[i]!);
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

        // ── Lock helper: move model to scene root with gyro ───────────
        function lockModel(worldMatrix: any) {
          if (!model) return;
          lockedDeviceQuat = deviceQuaternionRef.current
            ? deviceQuaternionRef.current.clone()
            : null;
          lockedMatrix = worldMatrix.clone();

          model.parent?.remove(model);
          scene.add(model);

          model.matrix.copy(lockedMatrix);
          model.matrixAutoUpdate = false;
          // Required with matrixAutoUpdate=false, or matrixWorld stays stale.
          model.matrixWorldNeedsUpdate = true;
          // Reveal the model now — first visible frame = correct locked frame.
          model.visible = true;
          anchorState = "locked";

          console.log(
            "[MindARScene] Model locked.",
            hasGyroRef.current ? `Gyro compensation active (source=${(deviceQuaternionRef as any).source ?? "unknown"}).` : "No gyro — static freeze."
          );

          // Schedule a one-time check 3 s after lock — warn user if no gyro data ever arrived
          setTimeout(() => {
            if (tornDown) return;
            // Tabletop follows the QR directly, so a missing gyro only matters
            // once the QR leaves the frame — not worth interrupting for.
            if (!hasGyroRef.current && !singleQr) {
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
        function tryMultiPointLock(anchorA: any) {
          const md = markerDataRef.current;
          if (!model || !md) return;
          // Check all anchors have enough stable frames AND low variance
          for (let idx = 0; idx < maxTrack; idx++) {
            if (stableFrameCounts[idx] < STABLE_FRAME_THRESHOLD) return;
            if (!hasLowVariance(idx)) return;
            if (!anchorPoseMatrices[idx]) return;
          }

          const visibleAnchors = Array.from({ length: maxTrack }, (_, idx) => idx)
            .filter((idx) => anchorPoseMatrices[idx])
            .map((idx) => ({
              index: md[idx]?.index ?? (idx + 1),
              matrix: new Float32Array(anchorPoseMatrices[idx].elements),
            }));

          const result = computeWorldTransform(visibleAnchors, md, MARKER_SIZE_MM);

          if (!result) {
            console.warn("[MindARScene] computeWorldTransform returned null — falling back to anchor-A-only");
            model.updateMatrix();
            const fallbackMatrix = new ThreeLib.Matrix4();
            fallbackMatrix.copy(anchorA.group.matrix).multiply(model.matrix);
            lockModel(fallbackMatrix);
            return;
          }

          const worldMat = new ThreeLib.Matrix4();
          worldMat.fromArray(result);
          lockModel(worldMat);
        }

        // ── Fix 4: Soft correction — blend toward new pose data ───────
        /**
         * Tabletop, locked, QR in view: pull the locked pose toward the live QR
         * pose and re-base the gyro reference on it. The QR is the ground truth
         * whenever it is visible; the gyro only carries the model while it isn't.
         */
        function followQrWhileVisible(anchor: any) {
          if (!model || !lockedMatrix || !modelLocalMatrix) return;
          const T = ThreeLib;
          const target = new T.Matrix4().copy(anchor.group.matrix).multiply(modelLocalMatrix);
          const lp = new T.Vector3(), lq = new T.Quaternion(), ls = new T.Vector3();
          const tp = new T.Vector3(), tq = new T.Quaternion(), ts = new T.Vector3();
          lockedMatrix.decompose(lp, lq, ls);
          target.decompose(tp, tq, ts);
          lp.lerp(tp, TABLETOP_FOLLOW_ALPHA);
          lq.slerp(tq, TABLETOP_FOLLOW_ALPHA);
          ls.lerp(ts, TABLETOP_FOLLOW_ALPHA);
          lockedMatrix.compose(lp, lq, ls);
          // The new pose is "now", so the gyro delta restarts from here.
          lockedDeviceQuat = deviceQuaternionRef.current ? deviceQuaternionRef.current.clone() : null;
          model.matrix.copy(lockedMatrix);
          model.matrixWorldNeedsUpdate = true;
        }

        function applySoftCorrection(T: any) {
          const md = markerDataRef.current;
          if (!model || !lockedMatrix || !md) return;

          // Collect currently visible anchors
          const visibleAnchors = Array.from({ length: maxTrack }, (_, idx) => idx)
            .filter((idx) => anchorVisibleWhileLocked[idx] && anchorPoseMatrices[idx])
            .map((idx) => ({
              index: md[idx]?.index ?? (idx + 1),
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

          const corrected = computeWorldTransform(visibleAnchors, md, MARKER_SIZE_MM);
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
          const md = markerDataRef.current;
          if (!md) return;

          // ── Fix 6: raw camera-space anchor positions for the placement validator ──
          if (onAnchorSampleRef.current) {
            const samples: AnchorSample[] = [];
            for (let idx = 0; idx < maxTrack; idx++) {
              if (!isAnchorVisibleNow(idx)) continue;
              const m = anchorPoseMatrices[idx];
              samples.push({
                index: md[idx]?.index ?? (idx + 1),
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

          const refMarker = md[refIdx];
          const refM = anchorPoseMatrices[refIdx];
          if (!refMarker || !refM) { onScanGuidanceRef.current([]); return; }

          const hints: ScanHint[] = [];
          for (let idx = 0; idx < maxTrack; idx++) {
            if (idx === refIdx || foundOnce[idx]) continue; // only guide toward unfound markers
            const tm = md[idx];
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

        // ── Bug 4: detection-stall fallback (partial lock) ────────────
        function stableAnchorIndices(): number[] {
          return Array.from({ length: maxTrack }, (_, idx) => idx)
            .filter((idx) => stableFrameCounts[idx] > 0 && anchorPoseMatrices[idx]);
        }

        function runStallFallback() {
          const md = markerDataRef.current;
          if (anchorState !== "tracking" || !model || !md) return;
          const stableAnchors = stableAnchorIndices();

          if (stableAnchors.length >= 2) {
            // Attempt partial lock with available anchors
            const visibleAnchors = stableAnchors.map((idx) => ({
              index: md[idx]?.index ?? (idx + 1),
              matrix: new Float32Array(anchorPoseMatrices[idx].elements),
            }));
            const result = computeWorldTransform(visibleAnchors, md, MARKER_SIZE_MM);
            if (result) {
              const worldMat = new ThreeLib.Matrix4();
              worldMat.fromArray(result);
              lockModel(worldMat);
              console.log(`[MindARScene] Stall fallback: locked with ${stableAnchors.length} anchors`);
              return;
            }
          }

          if (stableAnchors.length >= 1) {
            // Single anchor fallback — translation only
            const idx = stableAnchors[0];
            model.updateMatrix();
            const fallbackMatrix = new ThreeLib.Matrix4();
            fallbackMatrix.copy(anchorPoseMatrices[idx]).multiply(model.matrix);
            lockModel(fallbackMatrix);
            console.warn("[MindARScene] Stall fallback: 1-anchor lock (translation only)");
          }
        }

        // ── Model hand-over (called by Effect B) ──────────────────────
        function attachModel(m: any) {
          if (model && model !== m) detachModel(model);
          model = m;
          anchorState = "tracking";
          lockedMatrix = null;
          lockedDeviceQuat = null;
          anchorVisibleWhileLocked.fill(false);
          // Markers-only placement: keep model hidden until the lock fires so
          // its first visible frame is its correct, locked position. If anchor
          // 0 is already stable the lock fires on its very next update.
          m.visible = false;
          m.matrixAutoUpdate = true;
          anchors[0]?.group.add(m);
          console.log(
            `[MindARScene] Model attached to live scene (anchor 0 stable frames: ${stableFrameCounts[0] ?? 0}).`
          );
          if (stallPending) {
            stallPending = false;
            runStallFallback();
          }
        }

        function detachModel(m: any) {
          if (model !== m) return;
          m.parent?.remove(m);
          model = null;
          modelLocalMatrix = null;
          anchorState = "tracking";
          lockedMatrix = null;
          lockedDeviceQuat = null;
          anchorVisibleWhileLocked.fill(false);
        }

        // Start MindAR — camera feed goes live here, before any model exists.
        let startTimer: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            mindarThree.start(),
            new Promise((_, reject) => {
              startTimer = setTimeout(
                () => reject(new Error("The AR engine did not start. Reload the page to try again.")),
                MINDAR_START_TIMEOUT_MS,
              );
            }),
          ]);
        } finally {
          if (startTimer) clearTimeout(startTimer);
        }
        if (cancelled) { teardown(); return; }
        setIsStarting(false);
        onReadyRef.current?.();

        // Bug 4 fix: Detection stall timeout — auto-degrade after 30s
        if (!singleQr && markerDataRef.current && maxTrack > 1) {
          stallTimer = setTimeout(() => {
            if (anchorState !== "tracking") return;
            const stableAnchors = stableAnchorIndices();
            console.warn(
              `[MindARScene] Detection stall timeout — ${stableAnchors.length}/${maxTrack} anchors have data`
            );
            if (stableAnchors.length === 0) {
              // No anchors detected at all — surface error
              console.error("[MindARScene] Stall timeout: no anchors detected");
              onErrorRef.current?.(new Error("Could not detect any markers. Please check lighting and marker visibility."));
              return;
            }
            if (!model) {
              // Model still downloading — run the fallback the moment it lands.
              stallPending = true;
              return;
            }
            runStallFallback();
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

          // ── Locked pose → screen, every frame ──
          // Tabletop with the QR in view: the QR is ground truth
          // (followQrWhileVisible already wrote the pose). Otherwise hold the
          // locked pose in the room by counter-rotating it with the gyro; with
          // no gyro, hold it as locked (soft correction may still move it).
          if (anchorState === "locked" && model && lockedMatrix) {
            const qrInView = singleQr && anchorVisibleWhileLocked[0];
            const devQ = deviceQuaternionRef.current;
            // Motion access may be granted after the lock (first tap): start
            // compensating from the moment gyro data appears.
            if (devQ && !lockedDeviceQuat) lockedDeviceQuat = devQ.clone();
            if (!qrInView && devQ && lockedDeviceQuat) {
              // Bug 2 fix: snapshot so an onTargetUpdate mid-frame can't mutate it.
              applyGyroCompensation(lockedMatrix.clone(), lockedDeviceQuat, devQ, model, ThreeLib);
            } else {
              model.matrix.copy(lockedMatrix);
              model.matrixWorldNeedsUpdate = true;
            }
          }

          renderer.render(scene, camera);
        });

        // Publish the live scene so Effect B can hand over the model.
        sceneRef.current = { ThreeLib, attachModel, detachModel };
        setSceneEpoch((e) => e + 1);
      } catch (err) {
        if (cancelled) return;
        console.error("MindAR initialization error:", err);
        setIsStarting(false);
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [imageTargetSrc, maxTrack, mode]);

  // ════════════════════════════════════════════════════════════════════
  // Effect B — load the GLB and attach it to anchor 0 of the live scene.
  // Runs when the scene goes live (sceneEpoch) or the model source changes;
  // never restarts the camera. A prefetched buffer wins; while the viewer is
  // still streaming one (awaitPrefetch) we don't start a second download.
  // ════════════════════════════════════════════════════════════════════
  const modelSource: ArrayBuffer | string | null =
    prefetchedModel ?? (awaitPrefetch ? null : modelUrl ?? null);

  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle || !modelSource) return;

    let cancelled = false;
    let attached: any = null;

    (async () => {
      try {
        const T = handle.ThreeLib;
        const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
        const { DRACOLoader } = await import(/* @vite-ignore */ DRACO_LOADER_URL);
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
        dracoLoader.setWorkerLimit(2);
        loader.setDRACOLoader(dracoLoader);
        const { MeshoptDecoder } = await import(/* @vite-ignore */ MESHOPT_DECODER_URL);
        loader.setMeshoptDecoder(MeshoptDecoder);

        const loadFromUrl = (url: string) =>
          new Promise<any>((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
          });

        let gltf: any;
        if (typeof modelSource !== "string") {
          // Bug 3 fix: Validate GLB magic number before parsing
          const isValidGlb = modelSource.byteLength >= 4 &&
            new DataView(modelSource).getUint32(0, true) === GLB_MAGIC;

          if (isValidGlb) {
            gltf = await new Promise<any>((resolve, reject) => {
              loader.parse(modelSource, "", resolve, reject);
            });
          } else {
            console.warn("[MindARScene] Prefetched buffer is not a valid GLB (bad magic bytes), falling back to URL loading");
            const fallbackUrl = modelUrlRef.current;
            if (!fallbackUrl) throw new Error("Prefetched model is invalid and no URL fallback available");
            gltf = await loadFromUrl(fallbackUrl);
          }
        } else {
          gltf = await loadFromUrl(modelSource);
        }

        const model = gltf.scene;
        if (cancelled || sceneRef.current !== handle) {
          disposeScene(model);
          return;
        }

        // ── Orientation ──────────────────────────────────────────────
        // The GLB is exported Y-up ("Z to glTF Y" on in Rhino). In MindAR's
        // anchor space the target image spans X/Y and +Z points out of it:
        //  · wall  — the image is vertical, so +Y is already up: no rotation.
        //  · table — the image is horizontal, so up is +Z: tip the model by 90°.
        // initialRotation stays a spin about the model's own up axis (applied
        // before the tip, because three composes rotations X·Y·Z).
        if (initialRotation) {
          model.rotation.y = T.MathUtils.degToRad(initialRotation);
        }
        model.rotation.x = isTabletopMode ? Math.PI / 2 : 0;
        model.updateMatrixWorld(true);

        // ── Real-world size ──────────────────────────────────────────
        // One unit in anchor space is one marker width (150 mm), so the model
        // must be scaled by its real size, not normalised to a fixed number of
        // units. glTF is metres by spec, but Rhino writes document units, so a
        // model measuring in the hundreds or thousands is millimetres.
        const box = new T.Box3().setFromObject(model);
        const size = box.getSize(new T.Vector3());
        const center = box.getCenter(new T.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const placement = computeModelPlacement(maxDim, MARKER_SIZE_MM, modelScale);
        const normalizedScale = placement.scale;

        console.log(
          `[MindARScene] Model ${placement.realSizeM.toFixed(2)} m ` +
          `(${placement.unitMm === 1000 ? "metres" : "millimetres"} in file), scale 1:${modelScale} → ` +
          `${(maxDim * normalizedScale).toFixed(2)} marker widths ` +
          `(${(maxDim * normalizedScale * MARKER_SIZE_MM / 1000).toFixed(2)} m on the marker)`,
        );

        model.scale.set(normalizedScale, normalizedScale, normalizedScale);
        if (isTabletopMode) {
          // Sit on the table, centred on the marker.
          model.position.x = -center.x * normalizedScale;
          model.position.y = -center.y * normalizedScale;
          model.position.z = -box.min.z * normalizedScale + floatAboveMarker;
        } else {
          // Wall: the model's centre locks onto the centre of the printed QR.
          model.position.x = -center.x * normalizedScale;
          model.position.y = -center.y * normalizedScale;
          model.position.z = -center.z * normalizedScale;
        }

        handle.attachModel(model);
        attached = model;
      } catch (loadError) {
        if (cancelled) return;
        // Multipoint finalize (Jul 2026): a GLB load failure used to be
        // swallowed — anchors kept tracking but no model ever appeared,
        // leaving the client at a silent dead-end. Surface a typed error so
        // ARViewer can route to the ModelUnavailableRecovery flow (which
        // re-signs the URL and retries) instead of failing invisibly.
        console.warn("Failed to load GLB model:", loadError);
        onErrorRef.current?.(
          new ModelLoadError(
            "The 3D model failed to load. The link may have expired.",
            loadError
          )
        );
      }
    })();

    return () => {
      cancelled = true;
      if (attached) {
        try { handle.detachModel(attached); } catch { /* scene may already be gone */ }
        try { disposeScene(attached); } catch { /* noop */ }
      }
    };
  }, [sceneEpoch, modelSource, modelScale, initialRotation, floatAboveMarker, isTabletopMode]);

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
