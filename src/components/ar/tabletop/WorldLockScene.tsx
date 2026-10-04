import { useEffect, useRef } from "react";
import { placeModelOnQr, qrOffsetMm } from "@/lib/modelPlacement";
import { disposeScene } from "@/lib/threeDispose";
import { ModelLoadError } from "@/lib/modelLoadError";
import type { Xr8ImageTargetData } from "@/lib/xr8QrTarget";
import { QrPoseFilter, STEADY_FRAMES, STEADY_MAX_SD } from "@/lib/qrPoseFilter";
import { applyRoomEnvironment, freezeModelMatrices, tuneMaterialsForMobile } from "@/lib/prepareModelForAR";
import { ModelHttpError, preloadModel, subscribeModelProgress } from "@/lib/arPreload";
import { markAR } from "@/lib/arTiming";
import { waitForCameraGrant } from "@/lib/arLaunch";
import { loadXr8 } from "@/lib/xr8Engine";

/**
 * Tabletop / wall AR on the 8th Wall engine: image target + SLAM.
 *
 * Why not MindAR here: MindAR is image tracking only. It knows where the QR is
 * while it can see it, and nothing else — so a model can never stay put in the
 * room once the QR leaves the frame. 8th Wall runs world tracking (SLAM) and
 * reports the QR's pose in that same world space. We place the model on the
 * QR's world pose; after that the SLAM camera moves and the model stays where
 * it is in the room — walk around it, look away, come back.
 *
 * Lock (Oct 2026, automatic): while unlocked the model follows fresh QR
 * sightings (placing). Once the model is in and the QR readings are steady
 * (QrPoseFilter.isSteady: 8 readings within 3 mm, tracking NORMAL) the scene
 * locks by itself and reports onLocked — the ONLY thing that may show the
 * "placed" copy. If the readings never settle, it locks anyway after
 * LOCK_FALLBACK_MS of continuous sightings. `replaceSignal` unlocks
 * ("Re-place"): the model follows the QR again and re-locks when steady.
 *
 * Engine: @8thwall/engine-binary (free Distributed Engine Binary, Niantic
 * Spatial). Attribution is required by its licence — see WorldLockViewer.
 */

const THREE_ESM_URL = "/assets/three/three.module.js";
const GLTF_LOADER_URL = "/assets/three/jsm/loaders/GLTFLoader.js";
const DRACO_LOADER_URL = "/assets/three/jsm/loaders/DRACOLoader.js";
const MESHOPT_DECODER_URL = "/assets/three/jsm/libs/meshopt_decoder.module.js";
const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";

/** Printed QR width. Must match the print sheet (see MindARScene). */
export const QR_SIZE_MM = 150;
const GLB_MAGIC = 0x46546c67;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * If the engine hasn't reached onStart this long after XR8.run, give up and
 * let the viewer fall back to MindAR (e.g. a device 8th Wall can't run SLAM
 * on: it throws "No valid session manager" and never starts — the viewer sat
 * on "Starting…" forever).
 */
const ENGINE_START_TIMEOUT_MS = 20_000;

/** Lock anyway after this long placing with the QR in view (never stuck on "Hold steady"). */
const LOCK_FALLBACK_MS = 2500;

/** ?steady=<mm> tunes the lock gate on the phone (default 3 mm on the 150 mm QR). */
function steadyGate(): number {
  const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("steady") : null;
  const mm = raw ? Number(raw) : NaN;
  return Number.isFinite(mm) && mm > 0 && mm < 100 ? mm / QR_SIZE_MM : STEADY_MAX_SD;
}

/** Restyle 8th Wall's own motion-permission prompt to match Archi AR. */
function injectPromptStyle() {
  if (document.getElementById("archi-xr8-prompt-style")) return;
  const st = document.createElement("style");
  st.id = "archi-xr8-prompt-style";
  st.textContent = `
    .prompt-box-8w { font-family: inherit !important; border-radius: 16px !important; font-size: 16px !important; }
    .prompt-box-8w * { font-family: inherit !important; }
    .button-primary-8w { background-color: hsl(220 80% 50%) !important; }
    .prompt-button-8w { border-radius: 10px !important; padding: 0.6em !important; }
  `;
  document.head.appendChild(st);
}

interface WorldLockSceneProps {
  target: Xr8ImageTargetData;
  modelUrl: string | null;
  /** IndexedDB key for the GLB (arPreload.modelCacheKeyFor). */
  modelCacheKey?: string | null;
  mode: string;
  modelScale: number;
  initialRotation?: number;
  /** Bump to unlock and re-place: follow the QR again, re-lock when steady. */
  replaceSignal?: number;
  /** The engine fixed the model in the room (steady QR → lock). */
  onLocked?: () => void;
  onUnlocked?: () => void;
  onReady?: () => void;
  /** The QR image target is loaded and the engine is scanning for it. */
  onScanning?: () => void;
  onTargetFound?: () => void;
  onTargetLost?: () => void;
  /** First time the model is placed on the QR. */
  onPlaced?: () => void;
  /** Model download progress, 0–1. */
  onModelProgress?: (fraction: number) => void;
  onModelLoaded?: (info: { displayedSizeM?: { width: number; depth: number; height: number } }) => void;
  onTrackingStatus?: (status: string, reason: string) => void;
  onError?: (err: Error) => void;
}

const WorldLockScene = ({
  target,
  modelUrl,
  modelCacheKey = null,
  mode,
  modelScale,
  initialRotation = 0,
  replaceSignal = 0,
  onLocked,
  onUnlocked,
  onReady,
  onScanning,
  onTargetFound,
  onTargetLost,
  onPlaced,
  onModelLoaded,
  onModelProgress,
  onTrackingStatus,
  onError,
}: WorldLockSceneProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cb = useRef({ onReady, onScanning, onTargetFound, onTargetLost, onPlaced, onModelLoaded, onModelProgress, onTrackingStatus, onError, onLocked, onUnlocked });
  useEffect(() => {
    cb.current = { onReady, onScanning, onTargetFound, onTargetLost, onPlaced, onModelLoaded, onModelProgress, onTrackingStatus, onError, onLocked, onUnlocked };
  }, [onReady, onScanning, onTargetFound, onTargetLost, onPlaced, onModelLoaded, onModelProgress, onTrackingStatus, onError, onLocked, onUnlocked]);

  // Set by the engine effect: drop the lock and follow the QR again.
  const unlockRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (replaceSignal) unlockRef.current?.();
  }, [replaceSignal]);

  // Latest model URL without restarting the engine when it is re-signed.
  const modelUrlRef = useRef(modelUrl);
  const modelCacheKeyRef = useRef(modelCacheKey);
  modelCacheKeyRef.current = modelCacheKey;
  // Set by the engine effect once the scene is live; loads the model if it
  // isn't loaded yet (the URL can arrive after the camera has started).
  const requestModelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    modelUrlRef.current = modelUrl;
    if (modelUrl) requestModelRef.current?.();
  }, [modelUrl]);

  useEffect(() => {
    let cancelled = false;
    let XR8: Any = null;
    let started = false;
    let model: Any = null;
    let onResize: (() => void) | null = null;
    let engineStarted = false;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    const failStart = (why: string) => {
      if (cancelled || engineStarted) return;
      engineStarted = true; // report once
      if (startTimer) clearTimeout(startTimer);
      cb.current.onError?.(new Error(why));
    };
    const moduleName = "archi-world-lock";

    (async () => {
      try {
        if (!window.isSecureContext) throw new Error("Camera requires a secure (HTTPS) connection.");
        injectPromptStyle();
        const T = await import(/* @vite-ignore */ THREE_ESM_URL);
        // XR8.Threejs reads the global. Same module instance as GLTFLoader's
        // "three" import (import map), so geometry types match.
        (window as Any).THREE = T;
        XR8 = await loadXr8();
        markAR("engine-script", "8thwall");
        if (cancelled || !canvasRef.current) return;

        const sizeCanvas = (orientation?: number) => {
          const c = canvasRef.current;
          if (!c) return;
          const ww = window.innerWidth, wh = window.innerHeight;
          // Wait for an orientation change to settle before resizing.
          const portrait = orientation === 0 || orientation === 180;
          const landscape = orientation === 90 || orientation === -90;
          if ((portrait && ww > wh) || (landscape && wh > ww)) {
            requestAnimationFrame(() => sizeCanvas(orientation));
            return;
          }
          c.width = ww;
          c.height = wh;
        };
        onResize = () => sizeCanvas();
        window.addEventListener("resize", onResize);

        let anchor: Any = null;
        let placed = false;
        let modelLoading = false;
        let sizeLogged = false;

        // Gravity-aligned, outlier-rejecting, smoothed QR pose (qrPoseFilter).
        const filter = new QrPoseFilter(T, mode);
        const steadyMaxSd = steadyGate();
        let locked = false;
        let placingSince = 0;
        let trackingOk = true;
        unlockRef.current = () => {
          if (!locked) return;
          locked = false;
          placingSince = 0;
          filter.reset();
          console.log("[WorldLock] unlocked — re-placing on the QR");
          cb.current.onUnlocked?.();
        };
        const setPose = (detail: Any) => {
          if (!anchor || locked) return;
          // 1 local unit = the QR's width in the scene. For a 3:4 portrait
          // target, scale = its height and scaledWidth = 0.75, so
          // scaledWidth × scale = the printed QR width (it fills the width).
          const qrWidth = (detail.scaledWidth ?? 0.75) * (detail.scale ?? 1);
          const pose = filter.push({ position: detail.position, rotation: detail.rotation, width: qrWidth });
          if (!pose) return; // outlier (steep angle / glare / half in frame)
          anchor.position.copy(pose.position);
          anchor.quaternion.copy(pose.quaternion);
          anchor.scale.setScalar(pose.width);
          anchor.visible = true;
          if (!placed && model) {
            placed = true;
            cb.current.onPlaced?.();
          }
          // Automatic lock: model in, readings steady, SLAM tracking normal.
          if (model) {
            const t = performance.now();
            if (!placingSince) placingSince = t;
            const steady = trackingOk && filter.isSteady(STEADY_FRAMES, steadyMaxSd);
            const fallback = t - placingSince > LOCK_FALLBACK_MS && filter.accepted >= STEADY_FRAMES * 2;
            if (steady || fallback) {
              locked = true;
              markAR("model-locked", steady ? "8thwall steady" : "8thwall fallback");
              console.log(`[WorldLock] locked (${steady ? "steady" : "fallback"}) after ${filter.accepted} readings, ${filter.rejected} rejected`);
              cb.current.onLocked?.();
            }
          }
          if (model && !sizeLogged) {
            sizeLogged = true;
            anchor.updateMatrixWorld(true);
            const span = new T.Box3().setFromObject(model).getSize(new T.Vector3());
            const qrs = Math.max(span.x, span.y, span.z) / pose.width;
            console.log(`[WorldLock] size check: model spans ${qrs.toFixed(2)} QR widths = ${(qrs * QR_SIZE_MM / 1000).toFixed(2)} m on a ${QR_SIZE_MM} mm QR (1:${modelScale})`);
          }
        };

        const loadModel = async () => {
          const url = modelUrlRef.current;
          if (!url || model || modelLoading || !anchor) return;
          modelLoading = true;
          const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
          const { DRACOLoader } = await import(/* @vite-ignore */ DRACO_LOADER_URL);
          const { MeshoptDecoder } = await import(/* @vite-ignore */ MESHOPT_DECODER_URL);
          const loader = new GLTFLoader();
          const draco = new DRACOLoader();
          draco.setDecoderPath(DRACO_DECODER_PATH);
          draco.setWorkerLimit(2);
          loader.setDRACOLoader(draco);
          loader.setMeshoptDecoder(MeshoptDecoder);

          // Usually already downloading since the pre-camera screen (arPreload).
          const pending = preloadModel(url, modelCacheKeyRef.current);
          const unsub = subscribeModelProgress(url, (f) => cb.current.onModelProgress?.(f ?? 0));
          let buf: ArrayBuffer;
          try {
            buf = await pending;
          } catch (e) {
            throw new ModelLoadError(e instanceof ModelHttpError ? e.message : "The 3D model could not be downloaded.");
          } finally {
            unsub();
          }
          if (buf.byteLength < 4 || new DataView(buf).getUint32(0, true) !== GLB_MAGIC) {
            throw new ModelLoadError("The 3D model file is not a valid GLB.");
          }
          const gltf: Any = await new Promise((ok, fail) => loader.parse(buf, "", ok, fail));
          if (cancelled) { disposeScene(gltf.scene); return; }
          model = gltf.scene;
          const { renderer: xrRenderer } = XR8.Threejs.xrScene();
          tuneMaterialsForMobile(model, T, xrRenderer);
          const placement = placeModelOnQr(model, T, {
            mode,
            modelScale,
            initialRotation,
            markerSizeMm: QR_SIZE_MM,
            offsetMm: qrOffsetMm(mode),
          });
          console.log(`[WorldLock] model ${placement.realSizeM.toFixed(2)} m, 1:${modelScale}`);
          freezeModelMatrices(model);
          anchor.add(model);
          markAR("model-parsed", "8thwall");
          cb.current.onModelLoaded?.({ displayedSizeM: placement.displayedSizeM });
          // If the QR was already seen before the model arrived, it's placed now.
          if (anchor.visible && !placed) { placed = true; cb.current.onPlaced?.(); }
        };

        XR8.XrController.configure({
          imageTargetData: [target],
          disableWorldTracking: false,
        });

        XR8.addCameraPipelineModules([
          XR8.GlTextureRenderer.pipelineModule(),
          XR8.Threejs.pipelineModule(),
          XR8.XrController.pipelineModule(),
          {
            name: moduleName,
            // Our own full-window sizing. XR8.FullWindowCanvas is deprecated
            // and moves the canvas onto <body>, above the React UI overlay.
            onAttach: ({ orientation }: Any) => sizeCanvas(orientation),
            onDeviceOrientationChange: ({ orientation }: Any) => sizeCanvas(orientation),
            onStart: () => {
              engineStarted = true;
              if (startTimer) clearTimeout(startTimer);
              markAR("engine-ready", "8thwall");
              const { scene, camera, renderer } = XR8.Threejs.xrScene();
              // Environment lighting carries most of the look now; the
              // ambient is only a floor for unlit corners.
              void applyRoomEnvironment(scene, renderer, T);
              scene.add(new T.AmbientLight(0xffffff, 0.4));
              const sun = new T.DirectionalLight(0xffffff, 1.2);
              sun.position.set(5, 10, 7.5);
              scene.add(sun);
              anchor = new T.Group();
              anchor.visible = false;
              scene.add(anchor);
              // Sync the SLAM origin with the three.js camera.
              XR8.XrController.updateCameraProjectionMatrix({
                origin: camera.position,
                facing: camera.quaternion,
              });
              cb.current.onReady?.();
              requestModelRef.current = () => {
                loadModel().catch((e) => {
                  modelLoading = false;
                  if (cancelled) return;
                  cb.current.onError?.(e instanceof Error ? e : new ModelLoadError(String(e)));
                });
              };
              requestModelRef.current();
            },
            // Phase 0: first frame drawn with the model on screen.
            onRender: () => {
              if (anchor?.visible && model) markAR("model-visible", "8thwall");
            },
            onCameraStatusChange: (e: Any) => {
              console.log("[WorldLock] camera status", e?.status, e?.reason ?? "", e?.permission ?? "");
              if (e?.status === "hasVideo") markAR("camera-live", "8thwall");
              if (e?.status === "failed") {
                const why = e?.reason || e?.permission || "";
                cb.current.onError?.(new Error(`Camera could not start${why ? ` (${why})` : ""}.`));
              }
            },
            onException: (e: Any) => {
              console.error("[WorldLock] engine exception", e);
              // Before onStart an exception means the engine can't run here.
              failStart(`The AR engine could not start (${e?.message ?? e}).`);
            },
            listeners: [
              { event: "reality.imageloading", process: () => console.log("[WorldLock] QR target loading") },
              { event: "reality.imagescanning", process: () => {
                console.log("[WorldLock] QR target ready — scanning");
                markAR("target-ready", "8thwall");
                cb.current.onScanning?.();
              } },
              { event: "reality.imagefound", process: ({ detail }: Any) => {
                console.log("[WorldLock] QR found", JSON.stringify({ p: detail.position, s: detail.scale, w: detail.scaledWidth }));
                markAR("qr-seen", "8thwall");
                setPose(detail); cb.current.onTargetFound?.();
              } },
              { event: "reality.imageupdated", process: ({ detail }: Any) => setPose(detail) },
              // The model stays put in the room: SLAM keeps it there.
              { event: "reality.imagelost", process: () => cb.current.onTargetLost?.() },
              {
                event: "reality.trackingstatus",
                process: ({ detail }: Any) => {
                  console.log("[WorldLock] tracking", detail?.status, detail?.reason);
                  trackingOk = detail?.status !== "LIMITED";
                  cb.current.onTrackingStatus?.(detail?.status, detail?.reason);
                },
              },
            ],
          },
        ]);

        // The tap already asked for the camera; let that prompt be answered
        // before XR8 asks again.
        await waitForCameraGrant();
        if (cancelled || !canvasRef.current) return;
        XR8.run({ canvas: canvasRef.current });
        started = true;
        startTimer = setTimeout(() => failStart("The AR engine did not start in time."), ENGINE_START_TIMEOUT_MS);
      } catch (err) {
        if (cancelled) return;
        console.error("[WorldLock] init error", err);
        cb.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      if (startTimer) clearTimeout(startTimer);
      requestModelRef.current = null;
      unlockRef.current = null;
      if (onResize) window.removeEventListener("resize", onResize);
      if (XR8 && started) {
        try { XR8.stop(); } catch { /* noop */ }
      }
      if (XR8) {
        try { XR8.clearCameraPipelineModules(); } catch { /* noop */ }
      }
      if (model) {
        try { model.parent?.remove(model); disposeScene(model); } catch { /* noop */ }
      }
    };
    // The engine restarts only for a different target / model identity.
  }, [target, mode, modelScale, initialRotation]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0 }}
    />
  );
};

export default WorldLockScene;
