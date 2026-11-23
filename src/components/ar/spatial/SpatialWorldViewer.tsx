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
 * After the first physical test (23 Nov 2026, kitchen; see
 * claude/user-test-2026-11-23-first-spatial-kitchen.md):
 *  - Sightings only count while tracking is NORMAL (they drift while SLAM settles),
 *    and a marker seen again after a pause uses its fresh look (surveyFit.ts).
 *  - Scale is the engine's metric world (s = 1). The marker-width scale tried in
 *    1efe39a swung by 2× in the second kitchen test (23 Nov 12:08), so it is only
 *    used with `?scale=width` and otherwise shown in `?debug=1`.
 *  - A free-scale fit runs next to it: when every distance is off by the same
 *    factor the copy says so (print scale / engine scale), instead of blaming one
 *    marker.
 *  - "Reset placement" starts the marker search over without closing AR
 *    (camera, room tracking and model stay).
 *  - The fit is told in words (surveyStatus.ts): which marker is off and by how
 *    much. Lock itself is still decided by lockGuard.ts (D9).
 *  - The model is a ghost until Lock is allowed, and when the camera is inside
 *    it ("step back"). Thin rings on the sheets instead of blue dots; a line to
 *    where the drawing expects a marker that is off.
 *  - ACES tone mapping (light wood clipped to white without it).
 *
 * Licence: the 8th Wall attribution from the adapter stays on screen.
 */
import { SPATIAL_MARKER_MM } from "@/lib/spatial/design";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Lock, RotateCcw, X } from "lucide-react";
import { normalizeMarkerData, type MarkerPoint } from "@/lib/markerTypes";
import { getMarkerLabel } from "@/lib/spatial/markerLabels";
import { SurveyCollector, applyFit, fitSurvey, rhinoMmToModelM, type FitResult } from "@/lib/spatial/surveyFit";
import { surveyStatus, type MarkerQuality, type Tone } from "@/lib/spatial/surveyStatus";
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
/** Opacity of the model while Lock is not allowed yet, or the camera is inside it. */
const GHOST_OPACITY = 0.35;
/** Margin around the model's box for "you are inside the model" (model metres). */
const INSIDE_MARGIN_M = 0.15;
/** Engine units per metre outside this range are treated as a bad width reading. */
const SCALE_SANE: [number, number] = [0.25, 4];
const TONE_MAPPING_EXPOSURE = 0.85;

const QUALITY_HEX: Record<MarkerQuality, number> = {
  missing: 0x9ca3af,
  found: 0x2f80ff,
  good: 0x22c55e,
  warn: 0xf59e0b,
  bad: 0xef4444,
};
const QUALITY_CHIP: Record<MarkerQuality, string> = {
  missing: "bg-white/15 text-white",
  found: "bg-primary text-primary-foreground",
  good: "bg-green-500 text-black",
  warn: "bg-amber-400 text-black",
  bad: "bg-red-500 text-white",
};
const TONE_TEXT: Record<Tone, string> = {
  info: "text-white/85",
  good: "text-green-300",
  warn: "text-amber-300",
  bad: "text-red-300",
};

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

interface SightingOverlay {
  ring: Any;
  error: Any;
  predicted: Any;
  rotation?: { x: number; y: number; z: number; w: number };
}

interface ScaleDebug {
  ignored: number;
  widths: number;
  enginePerMetre?: number;
  rmsEngine?: number;
  rmsWidth?: number;
  freeScale?: number;
  rmsFree?: number;
}

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
  const overlaysRef = useRef<Map<number, SightingOverlay>>(new Map());
  const blender = useRef(new PoseBlender());
  const threeRef = useRef<{ T: Any; camera: Any } | null>(null);
  const modelRef = useRef<Any>(null);
  /** Model box in root space (model metres), for "camera inside the model". */
  const modelBoxRef = useRef<Any>(null);
  const ghostRef = useRef<boolean | null>(null);
  const ghostWantedRef = useRef(true);
  const insideRef = useRef(false);
  const ignoredRef = useRef(0);
  const widthsRef = useRef<number[]>([]);
  const scaleRef = useRef<number | undefined>(undefined);
  // Opt-in only since the 23 Nov 12:08 test: the marker-width scale swung by 2×.
  const useWidthScale = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("scale") === "width"; } catch { return false; }
  }, []);
  // Debug only (§6.4): log + a shadow collector fed after Lock, never applied.
  const debug = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("debug") === "1"; } catch { return false; }
  }, []);
  const refitLog = useRef(new RefitLog(400, performance.now(), debug));
  const shadow = useRef(new SurveyCollector());
  const trackingRef = useRef<TrackingState>("initializing");
  const tickRef = useRef(0);
  const [logTick, setLogTick] = useState(0);
  const [inside, setInside] = useState(false);
  const [scaleDebug, setScaleDebug] = useState<ScaleDebug>({ ignored: 0, widths: 0 });
  const [freeFit, setFreeFit] = useState<{ scale: number; rmsMm: number } | null>(null);

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

      let sawStatus = false;
      tracker.onTrackingState((state) => {
        sawStatus = true;
        trackingRef.current = state;
        setTracking(state);
        refitLog.current.record("tracking", fitRef.current, state, performance.now(), lockedRef.current ? "after lock" : undefined);
      });
      tracker.onCameraRestart?.((reason) => {
        refitLog.current.record("camera-restart", fitRef.current, trackingRef.current, performance.now(), reason);
      });
      tracker.onSighting((s) => {
        // 23 Nov 2026: sightings taken while SLAM is still settling land in a
        // frame that moves afterwards. Count them only once tracking is NORMAL
        // (or when the engine never reports a state, see below).
        if (sawStatus && trackingRef.current !== "normal") {
          ignoredRef.current += 1;
          return;
        }
        // After Lock the placement ignores sightings; the shadow copy is for the log only.
        if (lockedRef.current) { shadow.current.add(s.index, s.position, s.at); return; }
        collector.current.add(s.index, s.position, s.at);
        if (s.widthWorld) {
          widthsRef.current.push(s.widthWorld);
          if (widthsRef.current.length > 120) widthsRef.current.shift();
        }
        const o = overlaysRef.current.get(s.index);
        if (o && s.rotation) o.rotation = s.rotation;
      });

      const { THREE: T, scene, camera, renderer } = await tracker.start({ canvas: canvasRef.current, markers: targets });
      threeRef.current = { T, camera };
      setPhase("surveying");

      // Light wood clipped to white without tone mapping (23 Nov 2026 test);
      // the desktop preview already uses ACES (ModelViewer3D).
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
      void applyRoomEnvironment(scene, renderer, T);
      scene.add(new T.AmbientLight(0xffffff, 0.4));
      const sun = new T.DirectionalLight(0xffffff, 1.2);
      sun.position.set(5, 10, 7.5);
      scene.add(sun);

      // Per marker, until the placement is locked: a thin ring flat on the sheet
      // where the engine sees it (coloured by how well it agrees with the
      // drawing) and, when it is off, a line to where the drawing expects it.
      // Replaces the 2 cm blue spheres that filled the screen up close.
      for (const m of markers) {
        const overlayMat = (color: number) =>
          new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9, side: T.DoubleSide, toneMapped: false });
        const r = MARKER_WIDTH_M / 2;
        const ring = new T.Mesh(new T.RingGeometry(r * 0.9, r * 1.02, 48), overlayMat(QUALITY_HEX.found));
        const predicted = new T.Mesh(new T.SphereGeometry(0.012, 12, 8), overlayMat(QUALITY_HEX.bad));
        const lineGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
        const error = new T.Line(lineGeo, new T.LineBasicMaterial({ color: QUALITY_HEX.bad, depthTest: false, transparent: true, toneMapped: false }));
        for (const o of [ring, predicted, error]) {
          o.visible = false;
          o.renderOrder = 999;
          scene.add(o);
        }
        overlaysRef.current.set(m.index, { ring, predicted, error });
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
        // Measured before it joins the root, so the box is in root (model-metre) space.
        modelBoxRef.current = measureModel(model, T).expandByScalar(INSIDE_MARGIN_M);
        root.add(model);
        modelRef.current = model;
        ghostRef.current = null; // force the first ghost state to apply
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
            fixedScale: useWidthScale ? scaleRef.current : undefined,
          });
          if (sf) refitLog.current.record("post-lock", sf, trackingRef.current);
          if (debug) setLogTick(tickRef.current);
        }
        return;
      }
      // World units per metre from the printed marker's own width (as
      // Tabletop/Wall do with the QR). 1.00 when the engine world is metres.
      const widths = widthsRef.current;
      const perMetre = widths.length >= MIN_SIGHTINGS ? median(widths) / MARKER_WIDTH_M : undefined;
      const sane = perMetre !== undefined && perMetre >= SCALE_SANE[0] && perMetre <= SCALE_SANE[1];
      scaleRef.current = sane ? perMetre : undefined;

      const fEngine = fitSurvey(markers, collector.current, {
        minSightings: MIN_SIGHTINGS,
        solveScale: !(trackerRef.current?.metricWorld ?? false),
      });
      const fWidth = sane ? fitSurvey(markers, collector.current, { minSightings: MIN_SIGHTINGS, fixedScale: perMetre }) : null;
      const f = useWidthScale && fWidth ? fWidth : fEngine;
      // Free scale, for the diagnosis only: never moves the model.
      const fFree = fitSurvey(markers, collector.current, { minSightings: MIN_SIGHTINGS, solveScale: true });
      setFreeFit(fFree && fFree.markersUsed >= 3 ? { scale: fFree.scale, rmsMm: fFree.rmsMm } : null);
      if (debug) {
        setScaleDebug({
          ignored: ignoredRef.current,
          widths: widths.length,
          enginePerMetre: perMetre,
          rmsEngine: fEngine?.rmsMm,
          rmsWidth: fWidth?.rmsMm,
          freeScale: fFree?.scale,
          rmsFree: fFree?.rmsMm,
        });
      }
      fitRef.current = f;
      setFit(f);
      if (f) {
        blender.current.setTarget({ yaw: f.yaw, scale: f.scale, translation: f.translation }, performance.now());
        refitLog.current.record("refit", f, trackingRef.current);
        if (debug) setLogTick(tickRef.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, markers, debug, useWidthScale]);

  // ── What to tell the user: plain words, which marker is off ─────────────
  const foundSet = useMemo(
    () => new Set(markers.filter((m) => (counts[m.index] ?? 0) >= MIN_SIGHTINGS).map((m) => m.index)),
    [markers, counts],
  );
  const status = useMemo(
    () => surveyStatus({ order: markers.map((m) => m.index), found: foundSet, fit, freeFit, trackingReady: tracking === "normal" }),
    [markers, foundSet, fit, freeFit, tracking],
  );

  // Ghost until Lock is allowed; full materials once it is, and after Lock.
  useEffect(() => {
    ghostWantedRef.current = phase !== "locked" && !status.lockReady;
  }, [phase, status.lockReady]);

  // Sighting rings and error lines follow the survey (hidden once locked).
  useEffect(() => {
    if (!threeRef.current) return;
    const locked = phase === "locked";
    for (const m of markers) {
      const o = overlaysRef.current.get(m.index);
      if (!o) continue;
      const e = collector.current.estimate(m.index);
      const shown = !locked && !!e && e.count >= MIN_SIGHTINGS;
      o.ring.visible = shown;
      const q = status.quality[m.index] ?? "found";
      o.ring.material.color.setHex(QUALITY_HEX[q]);
      if (!shown || !e) {
        o.error.visible = o.predicted.visible = false;
        continue;
      }
      o.ring.position.set(e.position.x, e.position.y, e.position.z);
      o.ring.scale.setScalar(useWidthScale ? scaleRef.current ?? 1 : 1);
      if (o.rotation) o.ring.quaternion.set(o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.w);
      const off = !!fit && (q === "bad" || q === "warn");
      o.error.visible = o.predicted.visible = off;
      if (off && fit) {
        const p = applyFit(fit.yaw, fit.scale, fit.translation, rhinoMmToModelM(m));
        o.predicted.position.set(p.x, p.y, p.z);
        o.predicted.material.color.setHex(QUALITY_HEX[q]);
        o.error.material.color.setHex(QUALITY_HEX[q]);
        const pos = o.error.geometry.attributes.position;
        pos.setXYZ(0, e.position.x, e.position.y, e.position.z);
        pos.setXYZ(1, p.x, p.y, p.z);
        pos.needsUpdate = true;
        o.error.geometry.computeBoundingSphere();
      }
    }
  }, [counts, fit, status, phase, markers, useWidthScale]);

  // ── Frame loop: write the blended pose onto the model root ──────────────
  useEffect(() => {
    if (phase !== "surveying" && phase !== "locked") return;
    let raf = 0;
    let camLocal: Any = null;
    let inv: Any = null;
    const tick = () => {
      const root = modelRootRef.current;
      const three = threeRef.current;
      if (root && blender.current.hasPose()) {
        root.matrix.fromArray(blender.current.matrix(performance.now()));
        root.matrixWorldNeedsUpdate = true;
        root.visible = true;

        // Camera inside the model's box → ghost it and say "step back"
        // (23 Nov 2026: up to 20 s of white planks filling the screen).
        let isInside = false;
        if (three && modelBoxRef.current) {
          camLocal ??= new three.T.Vector3();
          inv ??= new three.T.Matrix4();
          three.camera.getWorldPosition(camLocal);
          camLocal.applyMatrix4(inv.copy(root.matrix).invert());
          isInside = modelBoxRef.current.containsPoint(camLocal);
        }
        if (isInside !== insideRef.current) {
          insideRef.current = isInside;
          setInside(isInside);
        }
        const ghost = ghostWantedRef.current || isInside;
        if (modelRef.current && ghost !== ghostRef.current) {
          ghostRef.current = ghost;
          setGhost(modelRef.current, ghost);
        }
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
    overlaysRef.current.forEach((o) => { o.ring.visible = o.error.visible = o.predicted.visible = false; });
    setPhase("locked");
  };

  /** "Reset placement": forget the survey and the fit, keep the AR session running. */
  const replace = () => {
    refitLog.current.record("replace", fitRef.current, trackingRef.current);
    lockedRef.current = false;
    collector.current.clear();
    shadow.current.clear();
    widthsRef.current = [];
    scaleRef.current = undefined;
    blender.current.reset();
    if (modelRootRef.current) modelRootRef.current.visible = false;
    fitRef.current = null;
    setFit(null);
    setFreeFit(null);
    setCounts({});
    overlaysRef.current.forEach((o) => { o.ring.visible = o.error.visible = o.predicted.visible = false; });
    setPhase("surveying");
  };

  const close = () => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    onClose();
  };

  const running = phase === "surveying" || phase === "locked";
  const first = markers.length ? getMarkerLabel(markers[0].index) : "A";
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
                First scan the room slowly from 2–3 m away. Then find each printed marker in turn ({order}), 1–1.5 m
                away and straight on, until its letter turns blue. Finish back at {first}, then lock.
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
                  const q = status.quality[m.index] ?? "missing";
                  const mark = q === "missing" ? "" : q === "bad" ? " !" : q === "warn" ? " ~" : " ✓";
                  return (
                    <span key={m.index} className={`rounded-full px-3 py-1 font-semibold ${QUALITY_CHIP[q]}`}>
                      {getMarkerLabel(m.index)}{mark}
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
            {inside && (
              <div className="rounded-full bg-white/90 px-3 py-1 text-center font-semibold text-black">
                You are inside the model · step back to see it
              </div>
            )}
            {debug && (
              <pre className="whitespace-pre-wrap rounded-lg bg-black/70 p-2 font-mono text-[10px] leading-snug text-white/90">
                {scaleDebugText(tracking, scaleDebug, fit, useWidthScale)}
              </pre>
            )}
          </div>

          {debug && <RefitLogOverlay log={refitLog.current} tick={logTick} />}

          <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-8 text-sm">
            {/* Dark panel: the text sat on the white ghost model and could not be read (23 Nov 12:08). */}
            {phase === "surveying" && (
              <div className="mx-auto max-w-sm space-y-2 rounded-2xl bg-black/75 px-3 py-2.5 shadow-lg backdrop-blur-sm">
                <p className={`text-center leading-snug ${TONE_TEXT[status.tone]}`}>{status.text}</p>
                {pairs.length > 0 && (
              <div className="rounded-xl bg-white/5 px-3 py-2 font-mono text-[11px] text-white/85">
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
              </div>
            )}
            {phase === "surveying" ? (
              <div className="flex gap-2">
                {/* Start the marker search over without closing AR (Helgi, 23 Nov 2026):
                    camera, room tracking and model stay; no new room scan. */}
                {foundSet.size > 0 && (
                  <button
                    type="button"
                    onClick={replace}
                    className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-black/60 px-4 font-semibold text-white backdrop-blur-sm"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset placement
                  </button>
                )}
                <button
                  type="button"
                  disabled={!guard.ok}
                  onClick={lock}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-black disabled:opacity-40"
                >
                  <Lock className="h-4 w-4" />
                  Lock placement
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={replace}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black/60 font-semibold text-white backdrop-blur-sm"
              >
                <RotateCcw className="h-4 w-4" />
                Reset placement
              </button>
            )}
            {attribution && <p className="text-center text-[10px] text-white/50">{attribution}</p>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Ghost the model (transparent, no depth writes) or restore its own materials.
 * Originals are kept on each material, so shared materials are handled once.
 */
function setGhost(model: Any, on: boolean): void {
  const seen = new Set<Any>();
  model.traverse((o: Any) => {
    if (!o.isMesh || !o.visible) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const orig = (m.userData.archiGhost ??= { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
      if (on) {
        m.transparent = true;
        m.opacity = Math.min(orig.opacity, GHOST_OPACITY);
        m.depthWrite = false;
      } else {
        m.transparent = orig.transparent;
        m.opacity = orig.opacity;
        m.depthWrite = orig.depthWrite;
      }
      m.needsUpdate = true;
    }
  });
}

/** `?debug=1`: enough to tell an engine-scale problem from a misplaced sheet. */
function scaleDebugText(tracking: TrackingState, info: ScaleDebug, fit: FitResult | null, widthScale: boolean): string {
  const f = (v: number | undefined, d = 0) => (v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));
  const lines = [
    `tracking ${tracking} · sightings ignored while settling ${info.ignored}`,
    `marker width → ${f(info.enginePerMetre, 3)} world units/m (${info.widths} readings; 1.000 = metric)`,
    `rms with engine scale ${f(info.rmsEngine)} mm · with width scale ${f(info.rmsWidth)} mm · using ${widthScale ? "width" : "engine"}`,
    `free scale ${f(info.freeScale, 3)} (observed / drawn) · rms ${f(info.rmsFree)} mm`,
  ];
  if (fit) {
    for (const r of fit.residuals) {
      lines.push(`${getMarkerLabel(r.index)} residual ${f(r.errorMm)} mm${r.offMm !== undefined ? ` · off ${f(r.offMm)} mm (others)` : ""}`);
    }
  }
  return lines.join("\n");
}
