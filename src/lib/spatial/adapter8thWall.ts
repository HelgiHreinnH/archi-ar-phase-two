/**
 * 8th Wall adapter for the Spatial lab (branch spatial-8thwall).
 *
 * Every Spatial marker (A, B, C…) becomes an 8th Wall image target inside SLAM
 * world tracking, with its printed width (150 mm) and scale "absolute", so the
 * world frame is metres and gravity-up. Each imagefound / imageupdated event
 * is passed on raw as a MarkerSighting; the viewer does the survey and fit.
 *
 * Engine loading, canvas sizing and the SLAM-origin sync reuse the patterns
 * proven in Tabletop/Wall (WorldLockScene.tsx). Licence: Niantic Spatial
 * Distributed Engine Binary — xr.js is loaded unmodified from jsDelivr and the
 * attribution below must stay on screen.
 */
import { loadXr8 } from "@/components/ar/tabletop/WorldLockScene";
import { Emitter, type MarkerSighting, type SpatialMarkerTarget, type SpatialScene, type SpatialStartOptions, type SpatialTracker, type TrackingState } from "./SpatialTracker";

const THREE_ESM_URL = "/assets/three/three.module.js";
const TARGET_W = 480;
const TARGET_H = 640;
const TARGET_PREFIX = "archi-marker-";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load a marker image for tracking."));
    img.src = src;
  });
}

/**
 * 8th Wall PLANAR target from a square marker image: 480×640 portrait,
 * greyscale, marker filling the width and centred (paper around it is white).
 * physicalWidthInMeters is the printed marker width → poses come out in metres.
 */
async function buildMarkerTarget(m: SpatialMarkerTarget): Promise<Any> {
  const img = await loadImage(m.imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, TARGET_W, TARGET_H);
  ctx.drawImage(img, 0, (TARGET_H - TARGET_W) / 2, TARGET_W, TARGET_W);
  const px = ctx.getImageData(0, 0, TARGET_W, TARGET_H);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(px, 0, 0);
  const now = Date.now();
  return {
    imagePath: canvas.toDataURL("image/png"),
    name: `${TARGET_PREFIX}${m.index}`,
    type: "PLANAR",
    metadata: null,
    physicalWidthInMeters: m.physicalWidthM,
    properties: {
      top: 0, left: 0, width: TARGET_W, height: TARGET_H,
      isRotated: false, originalWidth: TARGET_W, originalHeight: TARGET_H,
    },
    resources: {},
    created: now,
    updated: now,
  };
}

function mapStatus(status?: string): TrackingState {
  switch (status) {
    case "NORMAL": return "normal";
    case "LIMITED": return "limited";
    case "NOT_AVAILABLE": return "lost";
    default: return "initializing";
  }
}

export function create8thWallTracker(): SpatialTracker {
  const sightings = new Emitter<[MarkerSighting]>();
  const states = new Emitter<[TrackingState, string | undefined]>();
  let XR8: Any = null;
  let started = false;
  let onResize: (() => void) | null = null;
  const moduleName = "archi-spatial-lab";

  const emitSighting = (detail: Any) => {
    const name: string = detail?.name ?? "";
    if (!name.startsWith(TARGET_PREFIX) || !detail.position) return;
    const index = Number(name.slice(TARGET_PREFIX.length));
    if (!Number.isFinite(index)) return;
    sightings.emit({
      index,
      position: { x: detail.position.x, y: detail.position.y, z: detail.position.z },
      rotation: detail.rotation,
      at: performance.now(),
    });
  };

  return {
    engine: "8thwall",
    metricWorld: true,
    attribution: "AR engine: 8th Wall by Niantic Spatial · Distributed Engine Binary licence",

    async start({ canvas, markers }: SpatialStartOptions): Promise<SpatialScene> {
      if (!window.isSecureContext) throw new Error("Camera requires a secure (HTTPS) connection.");
      const T = await import(/* @vite-ignore */ THREE_ESM_URL);
      (window as Any).THREE = T; // XR8.Threejs reads the global
      XR8 = await loadXr8();
      const targets = await Promise.all(markers.map(buildMarkerTarget));

      const sizeCanvas = (orientation?: number) => {
        const ww = window.innerWidth, wh = window.innerHeight;
        const portrait = orientation === 0 || orientation === 180;
        const landscape = orientation === 90 || orientation === -90;
        if ((portrait && ww > wh) || (landscape && wh > ww)) {
          requestAnimationFrame(() => sizeCanvas(orientation));
          return;
        }
        canvas.width = ww;
        canvas.height = wh;
      };
      onResize = () => sizeCanvas();
      window.addEventListener("resize", onResize);

      XR8.XrController.configure({
        imageTargetData: targets,
        disableWorldTracking: false,
        scale: "absolute",
      });

      return new Promise<SpatialScene>((resolve, reject) => {
        XR8.addCameraPipelineModules([
          XR8.GlTextureRenderer.pipelineModule(),
          XR8.Threejs.pipelineModule(),
          XR8.XrController.pipelineModule(),
          {
            name: moduleName,
            onAttach: ({ orientation }: Any) => sizeCanvas(orientation),
            onDeviceOrientationChange: ({ orientation }: Any) => sizeCanvas(orientation),
            onStart: () => {
              const { scene, camera, renderer } = XR8.Threejs.xrScene();
              XR8.XrController.updateCameraProjectionMatrix({
                origin: camera.position,
                facing: camera.quaternion,
              });
              resolve({ THREE: T, scene, camera, renderer });
            },
            onCameraStatusChange: (e: Any) => {
              if (e?.status === "failed") {
                const why = e?.reason || e?.permission || "";
                reject(new Error(`Camera could not start${why ? ` (${why})` : ""}.`));
              }
            },
            onException: (e: Any) => console.error("[8thWall adapter] engine exception", e),
            listeners: [
              { event: "reality.imagefound", process: ({ detail }: Any) => emitSighting(detail) },
              { event: "reality.imageupdated", process: ({ detail }: Any) => emitSighting(detail) },
              {
                event: "reality.trackingstatus",
                process: ({ detail }: Any) => states.emit(mapStatus(detail?.status), detail?.reason),
              },
            ],
          },
        ]);
        XR8.run({ canvas });
        started = true;
      });
    },

    stop() {
      if (onResize) window.removeEventListener("resize", onResize);
      if (XR8 && started) { try { XR8.stop(); } catch { /* noop */ } }
      if (XR8) { try { XR8.clearCameraPipelineModules(); } catch { /* noop */ } }
      started = false;
      sightings.clear();
      states.clear();
    },

    onSighting: (cb) => sightings.on(cb),
    onTrackingState: (cb) => states.on((s, r) => cb(s, r)),
  };
}
