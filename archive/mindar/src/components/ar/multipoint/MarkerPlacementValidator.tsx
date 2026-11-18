import { useState, useEffect, useRef, useCallback } from "react";
import { X, CheckCircle2, AlertTriangle, Loader2, Crosshair, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import MindARScene, { type AnchorSample, MARKER_SIZE_MM } from "./MindARScene";
import { type MarkerPoint, getMarkerColor } from "@/lib/markerTypes";

/**
 * Fix 6 (Jul 2026) — Architect marker-placement validator.
 *
 * Closes the physical-placement error loop described in the March "Stability &
 * UX Research" doc (§4.6): if a printed marker is set even 50mm off its Rhino
 * coordinate, the client's model locks in the wrong place with no feedback to
 * anyone.
 *
 * Approach: rather than overlay crosshairs (which needs a full pose alignment
 * and is ambiguous from partial views), we compare *observed inter-marker
 * distances* against the Rhino coordinate definitions. Distances are invariant
 * to the camera pose, so this is mathematically robust from any viewpoint and
 * needs no Procrustes lock. The architect simply scans the markers; each pair's
 * measured spacing is checked against Rhino, and the marker whose pairs are
 * consistently off is flagged as the likely misplacement.
 *
 * Architect-only — mounted from the dashboard wizard (StepMarkers), never on
 * the public viewer.
 */

const BUCKET = "project-assets";
/** Acceptable spacing error before a pair is flagged (mm). */
const TOLERANCE_MM = 30;
/** Exponential moving-average weight for smoothing observed anchor positions. */
const EMA_ALPHA = 0.2;

interface ValidatorProject {
  id: string;
  name: string;
  /** Storage path (within project-assets) of the compiled .mind file, or a full URL. */
  mind_file_url: string | null;
}

interface MarkerPlacementValidatorProps {
  project: ValidatorProject;
  markerData: MarkerPoint[];
  onClose: () => void;
}

interface PairResult {
  a: number;
  b: number;
  observedMM: number;
  expectedMM: number;
  errorMM: number;
  ok: boolean;
}

interface Results {
  seen: number[];
  pairs: PairResult[];
  /** Per-marker average absolute pair error (mm). */
  markerError: Record<number, number>;
  worst: { index: number; errorMM: number } | null;
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const MarkerPlacementValidator = ({ project, markerData, onClose }: MarkerPlacementValidatorProps) => {
  const [signedMind, setSignedMind] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [arReady, setArReady] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Smoothed observed camera-space positions per marker index (MindAR units).
  const observedRef = useRef<Map<number, { x: number; y: number; z: number }>>(new Map());

  // ── Sign the compiled .mind file (private bucket) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const path = project.mind_file_url;
      if (!path) {
        setSignError("This project has no compiled tracking file yet. Generate the experience first.");
        return;
      }
      // Already a full URL (defensive — normally a storage path is stored).
      if (/^https?:\/\//i.test(path)) {
        if (!cancelled) setSignedMind(path);
        return;
      }
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 900);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setSignError(error?.message || "Could not load the tracking file.");
        return;
      }
      setSignedMind(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [project.mind_file_url]);

  const markerByIndex = useRef(new Map(markerData.map((m) => [m.index, m])));
  useEffect(() => {
    markerByIndex.current = new Map(markerData.map((m) => [m.index, m]));
  }, [markerData]);

  const recompute = useCallback(() => {
    const seen = [...observedRef.current.keys()].sort((a, b) => a - b);
    const pairs: PairResult[] = [];
    const errAccum: Record<number, { sum: number; n: number }> = {};

    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const ia = seen[i], ib = seen[j];
        const ma = markerByIndex.current.get(ia);
        const mb = markerByIndex.current.get(ib);
        const oa = observedRef.current.get(ia);
        const ob = observedRef.current.get(ib);
        if (!ma || !mb || !oa || !ob) continue;

        const observedMM = dist3(oa, ob) * MARKER_SIZE_MM;
        const expectedMM = dist3(ma, mb);
        const errorMM = observedMM - expectedMM;
        const ok = Math.abs(errorMM) <= TOLERANCE_MM;
        pairs.push({ a: ia, b: ib, observedMM, expectedMM, errorMM, ok });

        for (const idx of [ia, ib]) {
          errAccum[idx] = errAccum[idx] || { sum: 0, n: 0 };
          errAccum[idx].sum += Math.abs(errorMM);
          errAccum[idx].n += 1;
        }
      }
    }

    const markerError: Record<number, number> = {};
    let worst: { index: number; errorMM: number } | null = null;
    for (const [idxStr, { sum, n }] of Object.entries(errAccum)) {
      const idx = Number(idxStr);
      const avg = n > 0 ? sum / n : 0;
      markerError[idx] = avg;
      if (avg > TOLERANCE_MM && (!worst || avg > worst.errorMM)) {
        worst = { index: idx, errorMM: avg };
      }
    }

    setResults({ seen, pairs, markerError, worst });
  }, []);

  const handleSamples = useCallback((samples: AnchorSample[]) => {
    if (samples.length === 0) return;
    for (const s of samples) {
      const prev = observedRef.current.get(s.index);
      if (!prev) {
        observedRef.current.set(s.index, { x: s.x, y: s.y, z: s.z });
      } else {
        observedRef.current.set(s.index, {
          x: prev.x * (1 - EMA_ALPHA) + s.x * EMA_ALPHA,
          y: prev.y * (1 - EMA_ALPHA) + s.y * EMA_ALPHA,
          z: prev.z * (1 - EMA_ALPHA) + s.z * EMA_ALPHA,
        });
      }
    }
    recompute();
  }, [recompute]);

  const handleResetSamples = () => {
    observedRef.current.clear();
    setResults(null);
  };

  const seenCount = results?.seen.length ?? 0;
  const allOk = !!results && results.pairs.length > 0 && results.pairs.every((p) => p.ok);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {signedMind && (
        <MindARScene
          imageTargetSrc={signedMind}
          modelUrl={null}
          mode="multipoint"
          maxTrack={markerData.length}
          markerData={markerData}
          onAnchorSample={handleSamples}
          onReady={() => setArReady(true)}
          onError={(err) => setSignError(err.message)}
        />
      )}

      {/* Sign / load / error states */}
      {!signedMind && !signError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="h-7 w-7 animate-spin text-white/70 mx-auto" />
            <p className="text-white/60 text-sm">Loading tracking file…</p>
          </div>
        </div>
      )}
      {signError && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="text-center space-y-4 max-w-sm">
            <AlertTriangle className="h-10 w-10 text-destructive/80 mx-auto" />
            <p className="text-sm text-white/80 leading-relaxed">{signError}</p>
            <button onClick={onClose} className="text-sm text-white/60 hover:text-white/90 underline">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="relative z-10 p-4 pt-[env(safe-area-inset-top,16px)] flex items-start justify-between">
        <div className="rounded-xl px-4 py-2.5 bg-white/15 backdrop-blur-xl border border-white/20 shadow-lg">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-white/90" />
            <span className="text-white/90 font-display text-sm font-medium">Placement Check</span>
          </div>
          <p className="text-[11px] text-white/60 mt-0.5">{project.name}</p>
        </div>
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 flex items-center justify-center active:scale-95 transition-transform"
        >
          <X className="h-4 w-4 text-white/80" />
        </button>
      </div>

      <div className="flex-1" />

      {/* Bottom results panel */}
      {signedMind && !signError && (
        <div className="relative z-10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
          <div className="rounded-xl border bg-white/95 backdrop-blur-sm shadow-lg p-4 space-y-3">
            {/* Marker chips */}
            <div className="flex gap-2.5 justify-center flex-wrap">
              {markerData.map((m) => {
                const color = getMarkerColor(m.index);
                const isSeen = results?.seen.includes(m.index);
                const err = results?.markerError[m.index];
                const flagged = err != null && err > TOLERANCE_MM;
                return (
                  <div key={m.index} className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        "h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                        isSeen ? "text-white shadow-md" : "bg-muted text-muted-foreground",
                        flagged && "ring-2 ring-destructive ring-offset-1"
                      )}
                      style={isSeen ? { backgroundColor: color.bg } : undefined}
                    >
                      {isSeen ? <CheckCircle2 className="h-4 w-4" /> : m.index}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{color.name}</span>
                  </div>
                );
              })}
            </div>

            {/* Verdict */}
            {!arReady ? (
              <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting camera…
              </p>
            ) : seenCount < 2 ? (
              <p className="text-xs text-center text-muted-foreground">
                Point the camera at at least two markers to check their spacing.
              </p>
            ) : allOk ? (
              <p className="text-xs text-center text-green-700 font-medium flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                All measured spacings match the Rhino layout within ±{TOLERANCE_MM}mm.
              </p>
            ) : results?.worst ? (
              <p className="text-xs text-center text-destructive font-medium flex items-center justify-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Marker #{results.worst.index} ({getMarkerColor(results.worst.index).name}) looks ~
                {Math.round(results.worst.errorMM)}mm off — check its placement.
              </p>
            ) : (
              <p className="text-xs text-center text-amber-700 font-medium">
                Some spacings are off — keep all markers in view to localize the error.
              </p>
            )}

            {/* Pairwise detail */}
            {results && results.pairs.length > 0 && (
              <div>
                <button
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="w-full flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Measured distances
                  <ChevronDown className={cn("h-3 w-3 transition-transform", detailsOpen && "rotate-180")} />
                </button>
                {detailsOpen && (
                  <div className="mt-2 space-y-1">
                    {results.pairs.map((p) => (
                      <div
                        key={`${p.a}-${p.b}`}
                        className="flex items-center justify-between text-[11px] font-mono rounded-md bg-muted/40 px-2 py-1"
                      >
                        <span className="text-muted-foreground">
                          #{p.a}↔#{p.b}
                        </span>
                        <span>
                          {Math.round(p.observedMM)} / {Math.round(p.expectedMM)}mm
                        </span>
                        <span className={cn("font-semibold", p.ok ? "text-green-600" : "text-destructive")}>
                          {p.errorMM >= 0 ? "+" : ""}
                          {Math.round(p.errorMM)}mm
                        </span>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground/70 text-center pt-1">
                      measured / expected · tolerance ±{TOLERANCE_MM}mm
                    </p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleResetSamples}
              className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset measurements
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarkerPlacementValidator;
