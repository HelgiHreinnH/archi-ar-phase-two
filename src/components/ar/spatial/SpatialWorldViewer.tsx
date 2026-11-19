/**
 * SpatialWorldViewer — the client's Spatial experience on 8th Wall
 * (decision 17 Nov 2026: 8th Wall in every mode, MindAR off).
 *
 * Same engine path as the Spatial lab (`/lab/spatial/:shareId`), without the
 * lab's measuring form:
 *  - Every printed marker (A, B, C…) is an 8th Wall image target inside SLAM
 *    world tracking (`adapter8thWall.ts`), 180 mm wide, so the world is metres.
 *  - Sightings feed a SurveyCollector; as soon as two markers are known the
 *    Rhino marker coordinates are fitted onto them (`fitSurvey`) and the model
 *    appears. More sightings refine the fit; corrections blend, never snap
 *    (`PoseBlender`).
 *  - "Lock placement" freezes the fit. After that only world tracking holds
 *    the model (1 Oct 2026 rule: markers register, world tracking holds).
 *    Losing tracking never hides the model; a "tracking weak" chip shows.
 *  - Lock needs 3 markers and a fit error under the threshold (D9,
 *    `lockGuard.ts`); the pair distances are shown before Lock.
 *  - `?debug=1` shows the rotation isolation log (§6.4). Display only: after
 *    Lock it fits new sightings in the shadow and logs the heading drift; the
 *    model never uses them.
 *
 * Licence: the 8th Wall attribution from the adapter stays on screen.
 */
import { SPATIAL_MARKER_MM } from "@/lib/spatial/design";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Lock, RotateCcw, X } from "lucide-react";
import { normalizeMarkerData, type MarkerPoint } from "@/lib/markerTypes";
import { getMarkerLabel } from "@/lib/spatial/markerLabels";
import { SurveyCollector, fitSurvey, rhinoMmToModelM, type FitResult } from "@/lib/spatial/surveyFit";
import { PoseBlender } from "@/lib/spatial/poseBlend";
import { loadSpatialAdapter } from "@/lib/spatial/adapters";
import type { SpatialTracker, TrackingState } from "@/lib/spatial/SpatialTracker";
import { LOCK_MAX_RMS_MM, lockDecision, pairRows } from "@/lib/spatial/lockGuard";
import { RefitLog } from "@/lib/spatial/refitLog";
import RefitLogOverlay from "@/components/ar/spatial/RefitLogOverlay";
import { applyRoomEnvironment, fetchWithProgress, tuneMaterialsForMobile } from "@/lib/prepareModelForAR";
import { measureModel, UNIT_GUESS_THRESHOLD } from "@/lib/modelPlacement";

const GLTF_LOADER_URL = "/assets/three/jsm/loaders/GLTFLoader.js";
const DRACO_LOADER_URL = "/assets/three/jsm/loaders/DRACOLoader.js";
const MESHOPT_DECODER_URL = "/assets/three/jsm/libs/meshopt_decoder.module.js";
const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";
/** Printed Spatial marker width (the Ø180 mm circle, locked v11). */
const MARKER_WIDTH_M = SPATIAL_MARKER_MM / 1000;
/** Sightings a marker needs before it takes part in the fit. */
const MIN_SIGHTINGS = 5;
/** Refit ticks (250 ms) between shadow-fit log entries after Lock. */
const POST_LOCK_LOG_EVERY = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface SpatialWorldProject {
  id: string;
  name: string;
  model_url: string | null;
  marker_data: unknown;
  marker_image_urls: unknown;
}

interface SpatialWorldViewerProps {
  project: SpatialWorldProject;
  /** Called inside the Start tap, before the camera opens (iOS motion permission). */
  onStartTap?: () => void;
  onClose: () => void;
}

type Phase = "ready" | "starting" | "surveying" | "locked" | "error";

export default function SpatialWorldViewer({ project, onStartTap, onClose }: SpatialWorldViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<SpatialTracker | null>(null);
  const collector = useRef(new SurveyCollector());
  const fitRef = useRef<FitResult | null>(null);
  const lockedRef = useRef(false);
  const modelRootRef = useRef<Any>(null);
  const dotsRef = useRef<Map<number, Any>>(new Map());
  const blender = useRef(new PoseBlender());
  // Debug only (§6.4): log + a shadow collector fed after Lock, never applied.
  const debug = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("debug") === "1"; } catch { return false; }
  }, []);
  const refitLog = useRef(new RefitLog(400, performance.now(), debug));
  const shadow = useRef(new SurveyCollector());
  const trackingRef = useRef<TrackingState>("initializing");
  const tickRef = useRef(0);
  const [logTick, setLogTick] = useState(0);

  const [phase, setPhase] = useState<Phase>("ready");
  const [message, setMessage] = useState("");
  const [tracking, setTracking] = useState<TrackingState>("initializing");
  const [fit, setFit] = useState<FitResult | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [modelProgress, setModelProgress] = useState(0);
  const [attribution, setAttribution] = useState<string | undefined>();

  const markers: MarkerPoint[] = useMemo(() => normalizeMarkerData(project.marker_data) ?? [], [project.marker_data]);
  const markerUrls = useMemo(
    () => (project.marker_image_urls && typeof project.marker_image_urls === "object"
      ? (project.marker_image_urls as Record<string, string>)
      : {}),
    [project.marker_image_urls],
  );
  useEffect(() => {
    blender.current.setPoints(markers.map(rhinoMmToModelM));
  }, [markers]);

  // ── Start engine (from the tap) ─────────────────────────────────────────
  const start = useCallback(async () => {
    if (!canvasRef.current) return;
    onStartTap?.();
    setPhase("starting");
    setMessage("");
    try {
      const targets = markers
        .filter((m) => markerUrls[String(m.index)])
        .map((m) => ({ index: m.index, imageUrl: markerUrls[String(m.index)], physicalWidthM: MARKER_WIDTH_M }));
      if (targets.length < 2) {
        throw new Error("This experience has fewer than two marker images. The architect needs to generate the Spatial markers again.");
      }
      const tracker = await loadSpatialAdapter("8thwall");
      if (!tracker) throw new Error("The 8th Wall engine is not available in this build.");
      trackerRef.current = tracker;
      setAttribution(tracker.attribution);

      tracker.onTrackingState((state) => {
        trackingRef.current = state;
        setTracking(state);
        refitLog.current.record("tracking", fitRef.current, state, performance.now(), lockedRef.current ? "after lock" : undefined);
      });
      tracker.onCameraRestart?.((reason) => {
        refitLog.current.record("camera-restart", fitRef.current, trackingRef.current, performance.now(), reason);
      });
      tracker.onSighting((s) => {
        // After Lock the placement ignores sightings; the shadow copy is for the log only.
        if (lockedRef.current) { shadow.current.add(s.index, s.position); return; }
        collector.current.add(s.index, s.position);
      });

      const { THREE: T, scene, renderer } = await tracker.start({ canvas: canvasRef.current, markers: targets });
      setPhase("surveying");

      void applyRoomEnvironment(scene, renderer, T);
      scene.add(new T.AmbientLight(0xffffff, 0.4));
      const sun = new T.DirectionalLight(0xffffff, 1.2);
      sun.position.set(5, 10, 7.5);
      scene.add(sun);

      // Small dots where the engine sees each marker, until the placement is locked.
      for (const m of markers) {
        const dot = new T.Mesh(
          new T.SphereGeometry(0.02, 16, 12),
          new T.MeshBasicMaterial({ color: 0x2f80ff, depthTest: false }),
        );
        dot.visible = false;
        dot.renderOrder = 999;
        scene.add(dot);
        dotsRef.current.set(m.index, dot);
      }

      // Model root: world = fit.matrix · (unitScale · file coords).
      const root = new T.Group();
      root.matrixAutoUpdate = false;
      root.visible = false;
      scene.add(root);
      modelRootRef.current = root;

      if (project.model_url) {
        const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
        const { DRACOLoader } = await import(/* @vite-ignore */ DRACO_LOADER_URL);
        const { MeshoptDecoder } = await import(/* @vite-ignore */ MESHOPT_DECODER_URL);
        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        draco.setDecoderPath(DRACO_DECODER_PATH);
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        const res = await fetchWithProgress(project.model_url, setModelProgress);
        if (!res.ok) throw new Error(`The 3D model could not be downloaded (HTTP ${res.status}).`);
        const gltf: Any = await new Promise((ok, fail) => loader.parse(res.buffer, "", ok, fail));
        const model = gltf.scene;
        // Marker proxy spheres from the Rhino export are geometry, not part of the design.
        model.traverse((o: Any) => { if (typeof o.name === "string" && o.name.endsWith("_proxy")) o.visible = false; });
        tuneMaterialsForMobile(model, T, renderer);
        // Files are normally metres (Rhino glTF writer); a large max dimension means millimetres.
        const size = measureModel(model, T).getSize(new T.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim >= UNIT_GUESS_THRESHOLD) model.scale.setScalar(0.001);
        root.add(model);
      }
    } catch (e) {
      console.error("[SpatialWorldViewer]", e);
      trackerRef.current?.stop();
      trackerRef.current = null;
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [markers, markerUrls, onStartTap, project.model_url]);

  // ── Survey loop: refit ~4×/s while unlocked ─────────────────────────────
  useEffect(() => {
    if (phase !== "surveying" && phase !== "locked") return;
    const id = window.setInterval(() => {
      const c: Record<number, number> = {};
      for (const m of markers) c[m.index] = collector.current.count(m.index);
      setCounts(c);
      tickRef.current++;
      if (lockedRef.current) {
        if (tickRef.current % POST_LOCK_LOG_EVERY === 0) {
          const sf = fitSurvey(markers, shadow.current, {
            minSightings: MIN_SIGHTINGS,
            solveScale: !(trackerRef.current?.metricWorld ?? false),
          });
          if (sf) refitLog.current.record("post-lock", sf, trackingRef.current);
          if (debug) setLogTick(tickRef.current);
        }
        return;
      }
      for (const e of collector.current.estimates()) {
        const dot = dotsRef.current.get(e.index);
        if (dot) { dot.position.set(e.position.x, e.position.y, e.position.z); dot.visible = e.count >= MIN_SIGHTINGS; }
      }
      const f = fitSurvey(markers, collector.current, {
        minSightings: MIN_SIGHTINGS,
        solveScale: !(trackerRef.current?.metricWorld ?? false),
      });
      fitRef.current = f;
      setFit(f);
      if (f) {
        blender.current.setTarget({ yaw: f.yaw, scale: f.scale, translation: f.translation }, performance.now());
        refitLog.current.record("refit", f, trackingRef.current);
        if (debug) setLogTick(tickRef.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, markers, debug]);

  // ── Frame loop: write the blended pose onto the model root ──────────────
  useEffect(() => {
    if (phase !== "surveying" && phase !== "locked") return;
    let raf = 0;
    const tick = () => {
      const root = modelRootRef.current;
      if (root && blender.current.hasPose()) {
        root.matrix.fromArray(blender.current.matrix(performance.now()));
        root.matrixWorldNeedsUpdate = true;
        root.visible = true;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => () => trackerRef.current?.stop(), []);

  const lock = () => {
    if (!lockDecision(fitRef.current).ok) return;
    refitLog.current.record("lock", fitRef.current, trackingRef.current);
    shadow.current.clear();
    lockedRef.current = true;
    dotsRef.current.forEach((d) => (d.visible = false));
    setPhase("locked");
  };

  const replace = () => {
    refitLog.current.record("replace", fitRef.current, trackingRef.current);
    lockedRef.current = false;
    collector.current.clear();
    shadow.current.clear();
    blender.current.reset();
    if (modelRootRef.current) modelRootRef.current.visible = false;
    fitRef.current = null;
    setFit(null);
    setPhase("surveying");
  };

  const close = () => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    onClose();
  };

  const running = phase === "surveying" || phase === "locked";
  const found = markers.filter((m) => (counts[m.index] ?? 0) >= MIN_SIGHTINGS).length;
  const order = markers.map((m) => getMarkerLabel(m.index)).join(" → ");
  const guard = lockDecision(fit);
  const pairs = pairRows(fit);

  return (
    <div className="fixed inset-0 bg-[#0a0d12] text-white">
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" />

      {/* Before the camera: one tap is the floor (camera + motion need a gesture). */}
      {!running && (
        <div className="relative z-10 flex h-full flex-col">
          <div className="flex items-center justify-between px-6 pt-[max(env(safe-area-inset-top),20px)]">
            <p className="font-display text-xs font-medium uppercase tracking-[0.18em] text-white/45">Archi AR · Spatial</p>
            <button type="button" onClick={close} aria-label="Close" className="rounded-full bg-white/10 p-2">
              <X className="h-4 w-4" />
            </button>
          </div>
          <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <h1 className="font-display text-2xl font-semibold leading-tight">{project.name}</h1>
            {phase === "error" ? (
              <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/70">{message}</p>
            ) : (
              <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/65">
                Point the camera at each printed marker in turn ({order}) and hold it there until the letter turns
                blue. The model appears after two markers.
              </p>
            )}
          </main>
          <div className="px-6 pb-[max(env(safe-area-inset-bottom),20px)]">
            <button
              type="button"
              onClick={start}
              disabled={phase === "starting"}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {phase === "starting" ? <Loader2 className="h-5 w-5 animate-spin" /> : phase === "error" ? <RotateCcw className="h-5 w-5" /> : null}
              {phase === "starting" ? "Starting camera…" : phase === "error" ? "Try again" : "Launch AR Camera"}
            </button>
          </div>
        </div>
      )}

      {running && (
        <>
          <div className="absolute inset-x-0 top-0 z-10 space-y-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-[max(env(safe-area-inset-top),12px)] text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {markers.map((m) => {
                  const ok = (counts[m.index] ?? 0) >= MIN_SIGHTINGS;
                  return (
                    <span key={m.index} className={`rounded-full px-3 py-1 font-semibold ${ok ? "bg-primary text-primary-foreground" : "bg-white/15"}`}>
                      {getMarkerLabel(m.index)}{ok ? " ✓" : ""}
                    </span>
                  );
                })}
              </div>
              <button type="button" onClick={close} aria-label="Close" className="rounded-full bg-white/15 p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            {modelProgress > 0 && modelProgress < 1 && (
              <p className="text-white/70">Loading model · {Math.round(modelProgress * 100)}%</p>
            )}
            {(tracking === "limited" || tracking === "lost") && (
              <div className="rounded-full bg-amber-500/90 px-3 py-1 text-center font-semibold text-black">
                Tracking weak · move slowly, aim at textured surfaces
              </div>
            )}
          </div>

          {debug && <RefitLogOverlay log={refitLog.current} tick={logTick} />}

          <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-8 text-sm">
            {phase === "surveying" && (
              <p className="text-center text-white/80">
                {found < 2
                  ? `Find the markers (${found}/${markers.length})`
                  : guard.ok
                    ? `Model placed · ${guard.message} Lock when it sits right.`
                    : guard.message}
              </p>
            )}
            {phase === "surveying" && pairs.length > 0 && (
              <div className="mx-auto max-w-sm rounded-xl bg-black/40 px-3 py-2 font-mono text-[11px] text-white/80">
                {pairs.slice(0, 4).map((p) => (
                  <div key={p.label} className="flex justify-between gap-3">
                    <span>{p.label}</span>
                    <span>
                      model {Math.round(p.modelMm)} · seen {Math.round(p.observedMm)} mm{" "}
                      <span className={Math.abs(p.deltaMm) > LOCK_MAX_RMS_MM ? "text-amber-300" : "text-white/60"}>
                        ({p.deltaMm >= 0 ? "+" : ""}{Math.round(p.deltaMm)})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {phase === "surveying" ? (
              <button
                type="button"
                disabled={!guard.ok}
                onClick={lock}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-black disabled:opacity-40"
              >
                <Lock className="h-4 w-4" />
                Lock placement
              </button>
            ) : (
              <button
                type="button"
                onClick={replace}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/15 font-semibold"
              >
                <RotateCcw className="h-4 w-4" />
                Re-place model
              </button>
            )}
            {attribution && <p className="text-center text-[10px] text-white/50">{attribution}</p>}
          </div>
        </>
      )}
    </div>
  );
}
