/**
 * SpatialLab — hidden test page for the Spatial engine bake-off (Oct 2026).
 *
 *   /lab/spatial/:shareId   (not linked anywhere in the UI)
 *
 * Walk A → B → C: every marker sighting from the engine goes into the
 * SurveyCollector; as soon as two markers are known the Rhino markers are
 * fitted onto them and the model appears. The fit error (mm) is shown live.
 * Lock freezes the placement — after that only the engine's world tracking
 * holds the model (Tracking principle). Export run stores the numbers in this
 * lab's own schema (lab_<engine>.test_runs) or downloads them as JSON.
 *
 * Engine-agnostic: the engine comes from loadSpatialAdapter(LAB.engine).
 * On main no adapter is wired in, so the page explains that and stops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LAB, labDb } from "@/lib/lab";
import { normalizeMarkerData, type MarkerPoint } from "@/lib/markerTypes";
import { getMarkerLabel } from "@/lib/spatial/markerLabels";
import { SurveyCollector, fitSurvey, type FitResult } from "@/lib/spatial/surveyFit";
import { loadSpatialAdapter } from "@/lib/spatial/adapters";
import type { SpatialTracker, TrackingState } from "@/lib/spatial/SpatialTracker";
import { applyRoomEnvironment, fetchWithProgress, tuneMaterialsForMobile } from "@/lib/prepareModelForAR";
import { measureModel, UNIT_GUESS_THRESHOLD } from "@/lib/modelPlacement";

const GLTF_LOADER_URL = "/assets/three/jsm/loaders/GLTFLoader.js";
const DRACO_LOADER_URL = "/assets/three/jsm/loaders/DRACOLoader.js";
const MESHOPT_DECODER_URL = "/assets/three/jsm/libs/meshopt_decoder.module.js";
const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";
const MARKER_WIDTH_M = 0.15;
const MIN_SIGHTINGS = 5;
const CHECK_POINTS = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface Project {
  id: string;
  name: string;
  model_url: string | null;
  marker_data: unknown;
  marker_image_urls: Record<string, string> | null;
}

type Phase = "loading" | "unsupported" | "ready" | "starting" | "surveying" | "locked" | "error";

export default function SpatialLab() {
  const { shareId } = useParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<SpatialTracker | null>(null);
  const collector = useRef(new SurveyCollector());
  const fitRef = useRef<FitResult | null>(null);
  const lockedRef = useRef(false);
  const modelRootRef = useRef<Any>(null);
  const dotsRef = useRef<Map<number, Any>>(new Map());
  const timings = useRef({ mount: performance.now(), camera: 0, lock: 0 });
  const lossCount = useRef(0);
  const fpsRef = useRef<number[]>([]);

  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [tracking, setTracking] = useState<TrackingState>("initializing");
  const [fit, setFit] = useState<FitResult | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [fps, setFps] = useState(0);
  const [modelProgress, setModelProgress] = useState(0);
  const [checkErrors, setCheckErrors] = useState<string[]>(Array(CHECK_POINTS).fill(""));
  const [driftErrors, setDriftErrors] = useState<string[]>(Array(CHECK_POINTS).fill(""));
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const markers: MarkerPoint[] = useMemo(
    () => (project ? normalizeMarkerData(project.marker_data) ?? [] : []),
    [project],
  );

  // ── Load project ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!LAB) { setPhase("unsupported"); setMessage("This page only runs on a Spatial lab site (8thwall / zappar / immersal.designingforusers.com)."); return; }
    if (!shareId) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke("get-public-project", { body: { shareId } });
      if (error || !data || data.project === null) { setPhase("error"); setMessage("Experience not found."); return; }
      setProject(data as Project);
      setPhase("ready");
    })();
  }, [shareId]);

  // ── Start engine ───────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!LAB || !project || !canvasRef.current) return;
    setPhase("starting");
    try {
      const tracker = await loadSpatialAdapter(LAB.engine);
      if (!tracker) {
        setPhase("unsupported");
        setMessage(`No ${LAB.engine} engine adapter in this build yet.`);
        return;
      }
      trackerRef.current = tracker;
      const urls = project.marker_image_urls ?? {};
      const targets = markers
        .filter((m) => urls[String(m.index)])
        .map((m) => ({ index: m.index, imageUrl: urls[String(m.index)], physicalWidthM: MARKER_WIDTH_M }));
      if (targets.length < 2) throw new Error("This project has fewer than two marker images. Generate the Spatial markers first.");

      tracker.onTrackingState((s) => {
        setTracking(s);
        if (s === "lost" || s === "limited") lossCount.current += 1;
      });
      tracker.onSighting((s) => {
        if (lockedRef.current) return;
        collector.current.add(s.index, s.position);
      });

      const { THREE: T, scene, renderer } = await tracker.start({ canvas: canvasRef.current, markers: targets });
      timings.current.camera = performance.now();
      setPhase("surveying");

      void applyRoomEnvironment(scene, renderer, T);
      scene.add(new T.AmbientLight(0xffffff, 0.4));
      const sun = new T.DirectionalLight(0xffffff, 1.2);
      sun.position.set(5, 10, 7.5);
      scene.add(sun);

      // Marker dots: show where the engine thinks each marker is.
      for (const m of markers) {
        const dot = new T.Mesh(
          new T.SphereGeometry(0.02, 16, 12),
          new T.MeshBasicMaterial({ color: 0xff3b30, depthTest: false }),
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
        if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status}).`);
        const gltf: Any = await new Promise((ok, fail) => loader.parse(res.buffer, "", ok, fail));
        const model = gltf.scene;
        tuneMaterialsForMobile(model, T, renderer);
        // Files are normally metres (Rhino glTF writer); a tiny max dimension means millimetres.
        const size = measureModel(model, T).getSize(new T.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim >= UNIT_GUESS_THRESHOLD) model.scale.setScalar(0.001);
        root.add(model);
      }
    } catch (e) {
      console.error("[SpatialLab]", e);
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [project, markers]);

  // ── Survey loop: refit ~4×/s while unlocked ─────────────────────────────
  useEffect(() => {
    if (phase !== "surveying" && phase !== "locked") return;
    const id = window.setInterval(() => {
      const c: Record<number, number> = {};
      for (const m of markers) c[m.index] = collector.current.count(m.index);
      setCounts(c);
      if (lockedRef.current) return;
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
      const root = modelRootRef.current;
      if (root && f) {
        root.matrix.fromArray(f.matrix);
        root.matrixWorldNeedsUpdate = true;
        root.visible = true;
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, markers]);

  // ── FPS meter ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "surveying" && phase !== "locked") return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      fpsRef.current.push(1000 / Math.max(1, now - last));
      if (fpsRef.current.length > 120) fpsRef.current.shift();
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const show = window.setInterval(() => {
      const a = fpsRef.current;
      setFps(a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    }, 1000);
    return () => { cancelAnimationFrame(raf); window.clearInterval(show); };
  }, [phase]);

  useEffect(() => () => trackerRef.current?.stop(), []);

  const lock = () => {
    if (!fitRef.current) return;
    lockedRef.current = true;
    timings.current.lock = performance.now();
    dotsRef.current.forEach((d) => (d.visible = false));
    setPhase("locked");
  };

  const resurvey = () => {
    lockedRef.current = false;
    collector.current.clear();
    timings.current.lock = 0;
    if (modelRootRef.current) modelRootRef.current.visible = false;
    setFit(null);
    setPhase("surveying");
  };

  const exportRun = async () => {
    const f = fitRef.current;
    const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
    const row = {
      project_id: project?.id ?? null,
      device: navigator.platform || null,
      user_agent: navigator.userAgent,
      time_to_camera_ms: timings.current.camera ? Math.round(timings.current.camera - timings.current.mount) : null,
      time_to_lock_ms: timings.current.lock ? Math.round(timings.current.lock - timings.current.camera) : null,
      markers_seen: f?.markersUsed ?? 0,
      fit_rms_mm: f ? Number(f.rmsMm.toFixed(1)) : null,
      fit_scale: f ? Number(f.scale.toFixed(4)) : null,
      checkpoint_errors_mm: checkErrors.map(num),
      drift_errors_mm: driftErrors.map(num),
      tracking_losses: lossCount.current,
      fps_avg: fps,
      notes: notes || null,
      raw: { engine: LAB?.engine, fit: f, estimates: collector.current.estimates() },
    };
    try {
      const { error } = await labDb().from("test_runs").insert(row);
      if (error) throw error;
      setSaved(`Saved to ${LAB?.schema}.test_runs`);
    } catch (e) {
      console.warn("[SpatialLab] save failed, downloading instead", e);
      const blob = new Blob([JSON.stringify(row, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `spatial-run-${LAB?.engine}-${new Date().toISOString().slice(0, 19)}.json`;
      a.click();
      setSaved("Not signed in on this site — run downloaded as JSON instead");
    }
  };

  const running = phase === "surveying" || phase === "locked";
  const rms = fit ? `${fit.rmsMm.toFixed(0)} mm` : "—";

  return (
    <div className="fixed inset-0 bg-black text-white">
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" />

      {!running && (
        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-xs uppercase tracking-widest text-white/60">Spatial lab · {LAB?.engine ?? "off"}</p>
          <h1 className="font-display text-xl font-bold">{project?.name ?? "Spatial lab"}</h1>
          {message && <p className="max-w-sm text-sm text-white/80">{message}</p>}
          {phase === "ready" && (
            <>
              <p className="max-w-sm text-sm text-white/70">
                Walk to each marker in turn ({markers.map((m) => getMarkerLabel(m.index)).join(" → ")}) and hold the
                camera on it until its dot turns green. Lock when the fit error is low.
              </p>
              <button onClick={start} className="rounded-full bg-white px-6 py-3 font-semibold text-black">
                Start camera
              </button>
            </>
          )}
          {phase === "starting" && <p className="text-sm text-white/70">Starting camera…</p>}
        </div>
      )}

      {running && (
        <>
          <div className="absolute inset-x-0 top-0 z-10 space-y-2 bg-gradient-to-b from-black/70 to-transparent p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-white/15 px-2 py-1">{LAB?.engine} · {tracking}</span>
              <span className="rounded-full bg-white/15 px-2 py-1">{fps} fps</span>
              {modelProgress > 0 && modelProgress < 1 && (
                <span className="rounded-full bg-white/15 px-2 py-1">model {Math.round(modelProgress * 100)}%</span>
              )}
            </div>
            <div className="flex gap-2">
              {markers.map((m) => {
                const n = counts[m.index] ?? 0;
                const res = fit?.residuals.find((r) => r.index === m.index);
                return (
                  <span key={m.index} className={`rounded-full px-3 py-1 ${n >= MIN_SIGHTINGS ? "bg-green-600" : "bg-white/15"}`}>
                    {getMarkerLabel(m.index)} {n >= MIN_SIGHTINGS ? (res ? `${res.errorMm.toFixed(0)} mm` : "✓") : `${n}/${MIN_SIGHTINGS}`}
                  </span>
                );
              })}
            </div>
            <div className="text-sm">
              Fit error <b>{rms}</b>
              {fit && <> · scale {fit.scale.toFixed(3)} · {fit.markersUsed} markers</>}
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/80 to-transparent p-3 text-sm">
            {trackerRef.current?.attribution && (
              <p className="text-center text-[10px] text-white/50">{trackerRef.current.attribution}</p>
            )}
            {phase === "surveying" ? (
              <button
                disabled={!fit}
                onClick={lock}
                className="w-full rounded-full bg-white py-3 font-semibold text-black disabled:opacity-40"
              >
                {fit ? `Lock (error ${rms})` : "Survey at least two markers"}
              </button>
            ) : (
              <details className="rounded-xl bg-black/60 p-3">
                <summary className="cursor-pointer font-semibold">Locked · record the run</summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-white/70">Tape-measure each check point: error right after lock, then after the 10 m walk (mm).</p>
                  {checkErrors.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-8 text-xs">P{i + 1}</span>
                      <input inputMode="decimal" placeholder="lock" value={v}
                        onChange={(e) => setCheckErrors((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                        className="w-full rounded bg-white/10 px-2 py-1" />
                      <input inputMode="decimal" placeholder="after walk" value={driftErrors[i]}
                        onChange={(e) => setDriftErrors((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                        className="w-full rounded bg-white/10 px-2 py-1" />
                    </div>
                  ))}
                  <textarea placeholder="Notes (swim, snaps, light, phone…)" value={notes}
                    onChange={(e) => setNotes(e.target.value)} className="w-full rounded bg-white/10 px-2 py-1" rows={2} />
                  <div className="flex gap-2">
                    <button onClick={exportRun} className="flex-1 rounded-full bg-white py-2 font-semibold text-black">Export run</button>
                    <button onClick={resurvey} className="rounded-full bg-white/15 px-4 py-2">Re-survey</button>
                  </div>
                  {saved && <p className="text-xs text-green-300">{saved}</p>}
                </div>
              </details>
            )}
          </div>
        </>
      )}
    </div>
  );
}
