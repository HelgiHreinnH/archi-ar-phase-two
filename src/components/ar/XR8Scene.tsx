import { useEffect, useRef, useCallback, useState } from "react";
import { computeWorldTransform } from "@/lib/computeWorldTransform";
import {
  applyGyroCompensation,
  createGyroListener,
} from "@/lib/arGyro";
import type { MarkerPoint } from "@/lib/markerTypes";

interface XR8SceneProps {
  /** URL of the compiled .wtc image target file */
  imageTargetSrc: string;
  /** URL of the .glb model */
  modelUrl?: string | null;
  mode?: string;
  /** Number of image targets in the .wtc file */
  maxTrack?: number;
  onTargetFound?: (index: number) => void;
  onTargetLost?: (index: number) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  modelScale?: number;
  initialRotation?: number;
  markerData?: MarkerPoint[] | null;
  prefetchedModel?: ArrayBuffer | null;
}

/**
 * 8th Wall XR8 AR Scene — uses SLAM + Image Targets for stable model placement.
 *
 * Engine files must be self-hosted in /assets/:
 *   - /assets/xr8/xr8.js  (XR8 core)
 *   - /assets/xr8/xrextras.js  (XR Extras)
 *
 * These are loaded dynamically at AR runtime only.
 */

// Phase 2.3 — Self-hosted Three.js. Removes one external DNS+TLS hop and
// shares the same-origin HTTP cache with the XR8 engine bundle.
const THREE_ESM_URL = "/assets/three/three.module.js";
const GLTF_LOADER_URL = "/assets/three/jsm/loaders/GLTFLoader.js";
const DRACO_LOADER_URL = "/assets/three/jsm/loaders/DRACOLoader.js";
const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";

const MARKER_SIZE_MM = 150;
const FLOAT_ABOVE_MARKER = 0.267;
const STABLE_FRAME_THRESHOLD = 10;
const VARIANCE_THRESHOLD = 0.02;
const SOFT_CORRECTION_ALPHA = 0.05;
const GLB_MAGIC = 0x46546C67;

/** Dynamically load the self-hosted XR8 engine scripts */
async function loadXR8Engine(): Promise<void> {
  if ((window as any).XR8) return;

  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      // Reuse an existing tag if a preload/script for this src is already in flight.
      const existing = document.querySelector<HTMLScriptElement>(
        `script[data-archi-xr8="${src}"]`
      );
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
        } else {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
        }
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      // Force ordered execution even when dispatched in parallel.
      script.async = false;
      script.dataset.archiXr8 = src;
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

  // Load XR8 core, SLAM module, and extras in parallel.
  // Browser preserves <script> execution order automatically when appended in
  // sequence, so dispatch all three downloads at once and await completion.
  await Promise.all([
    loadScript("/assets/xr8/xr8.js"),
    loadScript("/assets/xr8/xr-slam.js"),
    loadScript("/assets/xr8/xrextras.js"),
  ]);

  if (!(window as any).XR8) {
    throw new Error("XR8 engine loaded but XR8 global not found");
  }
}

const XR8Scene = ({
  imageTargetSrc,
  modelUrl,
  mode = "multipoint",
  maxTrack = 1,
  onTargetFound,
  onTargetLost,
  onReady,
  onError,
  modelScale = 1,
  initialRotation = 0,
  markerData,
  prefetchedModel,
}: XR8SceneProps) => {
  const isTabletop = mode === "tabletop";
  const floatAboveMarker = isTabletop ? FLOAT_ABOVE_MARKER : 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

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
    if (!containerRef.current || !canvasRef.current) return;

    try {
      if (!window.isSecureContext) {
        throw new Error("Camera requires a secure (HTTPS) connection.");
      }

      await loadXR8Engine();

      const XR8 = (window as any).XR8;
      const XRExtras = (window as any).XRExtras;

      let ThreeLib = (window as any).THREE;
      if (!ThreeLib) {
        ThreeLib = await import(/* @vite-ignore */ THREE_ESM_URL);
      }

      // ── DeviceOrientation gyroscope listener ──
      const deviceQuaternionRef = { current: null as any };
      const hasGyroRef = { current: false };
      const cleanupGyro = createGyroListener(deviceQuaternionRef, hasGyroRef, ThreeLib);

      // ── Three.js scene setup ──
      const scene = new ThreeLib.Scene();
      const camera = new ThreeLib.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
      scene.add(camera);

      const renderer = new ThreeLib.WebGLRenderer({
        canvas: canvasRef.current,
        alpha: true,
        antialias: true,
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      // Cap pixel ratio at 2: halves GPU fill rate on 3× Retina iPhones with no visible quality loss.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // Lighting
      const ambientLight = new ThreeLib.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);
      const directionalLight = new ThreeLib.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(5, 10, 7.5);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      // ── State machine ──
      type AnchorState = "tracking" | "locked";
      let anchorState: AnchorState = "tracking";
      let lockedMatrix: any = null;
      let lockedDeviceQuat: any = null;
      let modelRef: any = null;
      let modelGroup: any = null; // anchor group for the model

      // Per-anchor tracking
      const poseHistories: { x: number; y: number; z: number }[][] = Array.from(
        { length: maxTrack }, () => []
      );
      const stableFrameCounts = new Array(maxTrack).fill(0);
      const anchorPoseMatrices: (any | null)[] = new Array(maxTrack).fill(null);
      const anchorGroups: any[] = [];

      // Create anchor groups in the scene
      for (let i = 0; i < maxTrack; i++) {
        const group = new ThreeLib.Group();
        group.visible = false;
        scene.add(group);
        anchorGroups.push(group);
      }
      modelGroup = anchorGroups[0];

      // ── Load GLB model ──
      if (modelUrl || prefetchedModel) {
        const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
        const loader = new GLTFLoader();

        let gltf: any;
        if (prefetchedModel) {
          const isValidGlb = prefetchedModel.byteLength >= 4 &&
            new DataView(prefetchedModel).getUint32(0, true) === GLB_MAGIC;
          if (isValidGlb) {
            gltf = await new Promise<any>((resolve, reject) => {
              loader.parse(prefetchedModel, "", resolve, reject);
            });
          } else if (modelUrl) {
            gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl!, resolve, undefined, reject);
            });
          } else {
            throw new Error("Prefetched model is invalid and no URL fallback");
          }
        } else {
          gltf = await new Promise<any>((resolve, reject) => {
            loader.load(modelUrl!, resolve, undefined, reject);
          });
        }

        const model = gltf.scene;
        modelRef = model;

        // Rhino Z-up → Three.js Y-up
        model.rotation.x = -Math.PI / 2;
        model.updateMatrixWorld(true);

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

        modelGroup.add(model);
      }

      // ── Variance helpers ──
      function hasLowVariance(idx: number): boolean {
        const history = poseHistories[idx];
        if (history.length < STABLE_FRAME_THRESHOLD) return false;
        const recent = history.slice(-STABLE_FRAME_THRESHOLD);
        const mean = { x: 0, y: 0, z: 0 };
        for (const p of recent) { mean.x += p.x; mean.y += p.y; mean.z += p.z; }
        mean.x /= recent.length; mean.y /= recent.length; mean.z /= recent.length;
        let sumSq = 0;
        for (const p of recent) {
          sumSq += (p.x - mean.x) ** 2 + (p.y - mean.y) ** 2 + (p.z - mean.z) ** 2;
        }
        return Math.sqrt(sumSq / recent.length) < VARIANCE_THRESHOLD;
      }

      function recordPose(idx: number, matrix: any) {
        const pos = { x: matrix.elements[12], y: matrix.elements[13], z: matrix.elements[14] };
        poseHistories[idx].push(pos);
        if (poseHistories[idx].length > 30) poseHistories[idx].shift();
      }

      function lockModel(model: any, worldMatrix: any) {
        lockedDeviceQuat = deviceQuaternionRef.current?.clone() ?? null;
        lockedMatrix = worldMatrix.clone();

        // Move model from anchor group to scene root
        if (model.parent !== scene) {
          model.parent?.remove(model);
          scene.add(model);
        }

        model.matrix.copy(lockedMatrix);
        model.matrixAutoUpdate = false;
        anchorState = "locked";
        console.log("[XR8Scene] Model locked.", hasGyroRef.current ? "Gyro active." : "No gyro.");
      }

      function applySoftCorrection() {
        if (!modelRef || !lockedMatrix || !markerData) return;
        const visible = Array.from({ length: maxTrack }, (_, i) => i)
          .filter((i) => anchorPoseMatrices[i])
          .map((i) => ({
            index: markerData![i]?.index ?? (i + 1),
            matrix: new Float32Array(anchorPoseMatrices[i].elements),
          }));
        if (visible.length === 0) return;
        const corrected = computeWorldTransform(visible, markerData!, MARKER_SIZE_MM);
        if (!corrected) return;

        const corrMat = new ThreeLib.Matrix4().fromArray(corrected);
        const lPos = new ThreeLib.Vector3(), lQuat = new ThreeLib.Quaternion(), lScl = new ThreeLib.Vector3();
        const cPos = new ThreeLib.Vector3(), cQuat = new ThreeLib.Quaternion(), cScl = new ThreeLib.Vector3();
        lockedMatrix.decompose(lPos, lQuat, lScl);
        corrMat.decompose(cPos, cQuat, cScl);
        lPos.lerp(cPos, SOFT_CORRECTION_ALPHA);
        lQuat.slerp(cQuat, SOFT_CORRECTION_ALPHA);
        lockedMatrix.compose(lPos, lQuat, lScl);
      }

      // ── XR8 Custom Pipeline Module ──
      const imageTargetPipelineModule = {
        name: "archi-ar-image-targets",
        listeners: [
          {
            event: "reality.imagefound",
            process: ({ detail }: any) => {
              const idx = detail.name ? parseInt(detail.name.replace(/\D/g, "")) : 0;
              if (idx >= maxTrack) return;

              const group = anchorGroups[idx];
              if (group) {
                group.visible = true;
                // Apply XR8 pose to the group
                const { position, rotation } = detail;
                group.position.set(position.x, position.y, position.z);
                group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
                group.updateMatrix();
                group.updateMatrixWorld(true);
              }

              if (anchorState === "tracking") {
                stableFrameCounts[idx]++;
                recordPose(idx, group.matrix);
                anchorPoseMatrices[idx] = group.matrix.clone();
              }

              onTargetFoundRef.current?.(idx);
            },
          },
          {
            event: "reality.imageupdated",
            process: ({ detail }: any) => {
              const idx = detail.name ? parseInt(detail.name.replace(/\D/g, "")) : 0;
              if (idx >= maxTrack) return;

              const group = anchorGroups[idx];
              if (group) {
                const { position, rotation } = detail;
                group.position.set(position.x, position.y, position.z);
                group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
                group.updateMatrix();
                group.updateMatrixWorld(true);
              }

              if (anchorState === "tracking") {
                stableFrameCounts[idx]++;
                recordPose(idx, group.matrix);
                anchorPoseMatrices[idx] = group.matrix.clone();

                // Check for lock
                if (idx === 0 && modelRef) {
                  const allStable = Array.from({ length: maxTrack }, (_, i) => i)
                    .every((i) => stableFrameCounts[i] >= STABLE_FRAME_THRESHOLD && hasLowVariance(i) && anchorPoseMatrices[i]);

                  if (allStable) {
                    if (isTabletop || !markerData) {
                      modelRef.updateMatrix();
                      const worldMat = new ThreeLib.Matrix4();
                      worldMat.copy(group.matrix).multiply(modelRef.matrix);
                      lockModel(modelRef, worldMat);
                    } else {
                      // Multi-point: use computeWorldTransform
                      const anchors = Array.from({ length: maxTrack }, (_, i) => i)
                        .filter((i) => anchorPoseMatrices[i])
                        .map((i) => ({
                          index: markerData![i]?.index ?? (i + 1),
                          matrix: new Float32Array(anchorPoseMatrices[i].elements),
                        }));
                      const result = computeWorldTransform(anchors, markerData!, MARKER_SIZE_MM);
                      if (result) {
                        lockModel(modelRef, new ThreeLib.Matrix4().fromArray(result));
                      }
                    }
                  }
                }
              }

              // Soft correction while locked
              if (anchorState === "locked") {
                anchorPoseMatrices[idx] = group.matrix.clone();
                applySoftCorrection();
              }
            },
          },
          {
            event: "reality.imagelost",
            process: ({ detail }: any) => {
              const idx = detail.name ? parseInt(detail.name.replace(/\D/g, "")) : 0;
              if (idx >= maxTrack) return;

              const group = anchorGroups[idx];
              if (group) group.visible = false;

              if (anchorState === "tracking") {
                stableFrameCounts[idx] = 0;
                poseHistories[idx] = [];
              }

              onTargetLostRef.current?.(idx);
            },
          },
        ],
      };

      // ── Render loop module ──
      const renderModule = {
        name: "archi-ar-render",
        onUpdate: () => {
          // Gyro compensation while locked
          if (anchorState === "locked" && modelRef && lockedMatrix && lockedDeviceQuat && deviceQuaternionRef.current) {
            const framePose = lockedMatrix.clone();
            applyGyroCompensation(framePose, lockedDeviceQuat, deviceQuaternionRef.current, modelRef, ThreeLib);
            lockedMatrix.copy(framePose);
          }
          renderer.render(scene, camera);
        },
      };

      // ── Start XR8 ──
      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.XrController.pipelineModule({
          scale: "absolute",
          enableWorldPoints: true,
        }),
        XRExtras?.AlmostThere?.pipelineModule() ?? null,
        XRExtras?.Loading?.pipelineModule() ?? null,
        imageTargetPipelineModule,
        renderModule,
      ].filter(Boolean));

      // Configure image targets from .wtc file
      XR8.XrController.configure({
        imageTargets: imageTargetSrc ? [imageTargetSrc] : [],
      });

      XR8.run({ canvas: canvasRef.current });

      onReadyRef.current?.();

      // Store cleanup function
      cleanupRef.current = () => {
        cleanupGyro();
        try {
          XR8.stop();
          XR8.clearCameraPipelineModules();
        } catch {
          // Ignore cleanup errors
        }
        renderer.dispose();
      };
    } catch (err) {
      console.error("[XR8Scene] Initialization error:", err);
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [imageTargetSrc, modelUrl, mode, maxTrack, modelScale, initialRotation, markerData, isTabletop, floatAboveMarker, prefetchedModel]);

  useEffect(() => {
    startAR();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [startAR]);

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", overflow: "hidden", zIndex: 0 }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
      />
    </div>
  );
};

export default XR8Scene;
