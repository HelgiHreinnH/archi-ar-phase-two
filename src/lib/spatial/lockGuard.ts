/**
 * Lock guard for Spatial (D9, LOCKED by Helgi 19 Nov 2026; contract §6.3–6.4).
 *
 * "Lock placement" freezes the fit; after that only world tracking holds the
 * model. Locking on two markers can't reveal two swapped sheets (same
 * distance, heading flips — R2), and a large residual means a misplaced sheet
 * or a wrong print scale (R5). So Lock needs at least three markers in the fit
 * and an rms residual under a threshold.
 *
 * Constants live here only. The threshold is a starting value, tuned in the
 * kitchen phone test (D13): change LOCK_MAX_RMS_MM, nothing else.
 */
import type { FitResult } from "./surveyFit";
import { getMarkerLabel } from "./markerLabels";

export const LOCK_MIN_MARKERS = 3;
/** Starting value (contract §6.4). Tune on the kitchen test. */
export const LOCK_MAX_RMS_MM = 30;

export type LockBlock = "no-fit" | "too-few-markers" | "residual-too-high";

export interface LockDecision {
  ok: boolean;
  reason?: LockBlock;
  /** One line for the button area. */
  message: string;
}

/** Pure decision, unit-tested. */
export function lockDecision(
  fit: Pick<FitResult, "markersUsed" | "rmsMm"> | null,
  limits: { minMarkers?: number; maxRmsMm?: number } = {},
): LockDecision {
  const minMarkers = limits.minMarkers ?? LOCK_MIN_MARKERS;
  const maxRms = limits.maxRmsMm ?? LOCK_MAX_RMS_MM;
  if (!fit) return { ok: false, reason: "no-fit", message: "Find at least two markers to place the model." };
  if (fit.markersUsed < minMarkers) {
    return {
      ok: false,
      reason: "too-few-markers",
      message: `Find ${minMarkers - fit.markersUsed} more marker${minMarkers - fit.markersUsed > 1 ? "s" : ""} to lock (${fit.markersUsed}/${minMarkers}). Two markers can't show a swapped sheet.`,
    };
  }
  if (!(fit.rmsMm <= maxRms)) {
    return {
      ok: false,
      reason: "residual-too-high",
      message: `Fit error ${fit.rmsMm.toFixed(0)} mm is above ${maxRms} mm. Check the distances below: a sheet may be misplaced, swapped or printed at the wrong size.`,
    };
  }
  return { ok: true, message: `Fit error ${fit.rmsMm.toFixed(0)} mm with ${fit.markersUsed} markers.` };
}

export interface PairRow {
  label: string;
  modelMm: number;
  observedMm: number;
  /** observed − model, mm. */
  deltaMm: number;
}

/** Model vs observed distance per marker pair, largest disagreement first. */
export function pairRows(fit: Pick<FitResult, "pairs"> | null): PairRow[] {
  return (fit?.pairs ?? [])
    .map((p) => ({
      label: `${getMarkerLabel(p.a)}–${getMarkerLabel(p.b)}`,
      modelMm: p.modelMm,
      observedMm: p.observedMm,
      deltaMm: p.observedMm - p.modelMm,
    }))
    .sort((a, b) => Math.abs(b.deltaMm) - Math.abs(a.deltaMm));
}
