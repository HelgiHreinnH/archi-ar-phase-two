import { useEffect, useRef } from "react";
import { placeModelOnQr } from "@/lib/modelPlacement";
import { disposeScene } from "@/lib/threeDispose";
import { ModelLoadError } from "@/lib/modelLoadError";
import type { Xr8ImageTargetData } from "@/lib/xr8QrTarget";
import { QrPoseFilter } from "@/lib/qrPoseFilter";
import { applyRoomEnvironment, fetchWithProgress, freezeModelMatrices, tuneMaterialsForMobile } from "@/lib/prepareModelForAR";

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
 * `locked`: while false the model keeps following fresh QR sightings (so the
 * first placement can settle); when true, QR updates are ignored and the model
 * is fixed in the room.
 *
 * Engine: @8thwall/engine-binary (free Distributed Engine Binary, Niantic
 * Spatial). Attribution is required by its licence — see WorldLockViewer.
 */

export const XR8_ENGINE_URL =
  "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js";
const THREE_ESM_URL = "/assets/three/three.module.js";
const GLTF_LOADER_URL = "/assets/three/jsm/loaders/GLTFLoader.js";
const DRACO_LOADER_URL = "/assets/three/jsm/loaders/DRACOLoader.js";
const MESHOPT_DECODER_URL = "/assets/three/jsm/libs/meshopt_decoder.module.js";
const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";

/** Printed QR width. Must match the print sheet (see MindARScene). */
export const QR_SIZE_MM = 150;
/** Tabletop float above the paper, in QR widths (same as MindAR). */
const FLOAT_ABOVE_MARKER = 0.267;
const GLB_MAGIC = 0x46546c67;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let enginePromise: Promise<Any> | null = null;

/** Load the 8th Wall engine once (with the SLAM chunk) and resolve XR8. */
export function loadXr8(): Promise<Any> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<Any>((resolve, reject) => {
    const w = window as Any;
    const ready = async () => {
      try {
        if (!w.XR8.XrController && w.XR8.loadChunk) await w.XR8.loadChunk("slam");
        if (!w.XR8.XrController) throw new Error("8th Wall SLAM module did not load.");
        resolve(w.XR8);
      } catch (e) {
        reject(e);
      }
    };
    if (w.XR8) { void ready(); return; }
    window.addEventListener("xrloaded", () => void ready(), { once: true });
    const s = document.createElement("script");
    s.src = XR8_ENGINE_URL;
    s.async = true;
    s.crossOrigin = "anonymous";
    // Read by xr.js from document.currentScript: world tracking + image targets.
    s.setAttribute("data-preload-chunks", "slam");
    s.onerror = () => reject(new Error("Could not load the AR engine. Check your connection."));
    document.head.appendChild(s);
  });
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
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
  mode: string;
  modelScale: number;
  initialRotation?: number;
  locked: boolean;
  onReady?: () => void;
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
  mode,
  modelScale,
  initialRotation = 0,
  locked,
  onReady,
  onTargetFound,
  onTargetLost,
  onPlaced,
  onModelLoaded,
  onModelProgress,
  onTrackingStatus,
  onError,
}: WorldLockSceneProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lockedRef = useRef(locked);
  const cb = useRef({ onReady, onTargetFound, onTargetLost, onPlaced, onModelLoaded, onModelProgress, onTrackingStatus, onError });
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => {
    cb.current = { onReady, onTargetFound, onTargetLost, onPlaced, onModelLoaded, onModelProgress, onTrackingStatus, onError };
  }, [onReady, onTargetFound, onTargetLost, onPlaced, onModelLoaded, onModelProgress, onTrackingStatus, onError]);

  // Latest model URL without restarting the engine when it is re-signed.
  const modelUrlRef = useRef(modelUrl);
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
        const setPose = (detail: Any) => {
          if (!anchor || lockedRef.current) return;
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

          const res = await fetchWithProgress(url, (f) => cb.current.onModelProgress?.(f));
          if (!res.ok) throw new ModelLoadError(`The 3D model could not be downloaded (HTTP ${res.status}).`);
          const buf = res.buffer;
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
            floatAboveMarker: mode === "tabletop" ? FLOAT_ABOVE_MARKER : 0,
          });
          console.log(`[WorldLock] model ${placement.realSizeM.toFixed(2)} m, 1:${modelScale}`);
          freezeModelMatrices(model);
          anchor.add(model);
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
            onCameraStatusChange: (e: Any) => {
              console.log("[WorldLock] camera status", e?.status, e?.reason ?? "", e?.permission ?? "");
              if (e?.status === "failed") {
                const why = e?.reason || e?.permission || "";
                cb.current.onError?.(new Error(`Camera could not start${why ? ` (${why})` : ""}.`));
              }
            },
            onException: (e: Any) => {
              console.error("[WorldLock] engine exception", e);
            },
            listeners: [
              { event: "reality.imageloading", process: () => console.log("[WorldLock] QR target loading") },
              { event: "reality.imagescanning", process: () => console.log("[WorldLock] QR target ready — scanning") },
              { event: "reality.imagefound", process: ({ detail }: Any) => {
                console.log("[WorldLock] QR found", JSON.stringify({ p: detail.position, s: detail.scale, w: detail.scaledWidth }));
                setPose(detail); cb.current.onTargetFound?.();
              } },
              { event: "reality.imageupdated", process: ({ detail }: Any) => setPose(detail) },
              // The model stays put in the room: SLAM keeps it there.
              { event: "reality.imagelost", process: () => cb.current.onTargetLost?.() },
              {
                event: "reality.trackingstatus",
                process: ({ detail }: Any) => {
                  console.log("[WorldLock] tracking", detail?.status, detail?.reason);
                  cb.current.onTrackingStatus?.(detail?.status, detail?.reason);
                },
              },
            ],
          },
        ]);

        XR8.run({ canvas: canvasRef.current });
        started = true;
      } catch (err) {
        if (cancelled) return;
        console.error("[WorldLock] init error", err);
        cb.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      requestModelRef.current = null;
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
