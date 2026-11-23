/**
 * surveyStatus.ts — what the Spatial viewer tells the user while surveying
 * (23 Nov 2026 kitchen test, findings F2/F3).
 *
 * The test showed "Model placed · fit 1374 mm. Find more markers…" with Lock
 * enabled: a number with no judgement, advice that could not be followed, and
 * a lock that let a kitchen float a metre off the floor. This turns the fit
 * into plain words and names the marker that is off. Whether Lock is allowed
 * stays with lockGuard.ts (D9); `lockReady` mirrors it. Pure logic, no React.
 */
import type { FitResult, MarkerResidual } from "./surveyFit";
import { bestPairErrorMm, pairErrorMm, worstMarker } from "./surveyFit";
import { getMarkerLabel } from "./markerLabels";
import { LOCK_MAX_RMS_MM, LOCK_MIN_MARKERS } from "./lockGuard";

/**
 * A marker within this many mm of the drawing is OK. Same number as the Lock
 * guard (D9, LOCK_MAX_RMS_MM) so "green" and "Lock is allowed" never disagree.
 */
export const GOOD_MM = LOCK_MAX_RMS_MM;
/** Above this a marker is clearly off (red). Between GOOD and WARN: amber. */
export const WARN_MM = 150;
/**
 * Uniform scale error (23 Nov 2026, second kitchen test): every distance off by
 * the same factor. Flagged when a free-scale fit explains the markers within
 * WARN_MM and its scale is off by more than this fraction.
 */
export const SCALE_OFF_FRACTION = 0.05;

export type Tone = "info" | "good" | "warn" | "bad";
export type MarkerQuality = "missing" | "found" | "good" | "warn" | "bad";

export interface SurveyStatusInput {
  /** Marker indices in the order the user should scan them (A, B, C…). */
  order: number[];
  /** Markers with enough sightings to take part in the fit. */
  found: Set<number>;
  fit: FitResult | null;
  /** Same markers fitted with free scale (3+ markers): scale = observed / drawn. */
  freeFit?: { scale: number; rmsMm: number } | null;
  /** False while the engine still reports weak / initialising tracking. */
  trackingReady: boolean;
}

export interface SurveyStatus {
  text: string;
  tone: Tone;
  /** Placement is checked and good; matches lockDecision(fit).ok (D9). */
  lockReady: boolean;
  quality: Record<number, MarkerQuality>;
  /** The marker to look at, when one is off. */
  worst?: number;
}

/** 340 → "340 mm", 1374 → "1.4 m". Rounded so the copy doesn't twitch every refit. */
export function formatDistance(mm: number): string {
  if (!Number.isFinite(mm)) return "—";
  if (mm < 1000) return `${Math.max(10, Math.round(mm / 10) * 10)} mm`;
  return `${(mm / 1000).toFixed(1)} m`;
}

function formatMetres(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

export function residualMm(r: MarkerResidual): number {
  return r.offMm ?? r.errorMm;
}

function gradeMm(mm: number): MarkerQuality {
  if (mm <= GOOD_MM) return "good";
  if (mm <= WARN_MM) return "warn";
  return "bad";
}

export function surveyStatus({ order, found, fit, freeFit, trackingReady }: SurveyStatusInput): SurveyStatus {
  const L = getMarkerLabel;
  const total = order.length;
  const required = LOCK_MIN_MARKERS;
  const next = order.find((i) => !found.has(i));

  const quality: Record<number, MarkerQuality> = {};
  for (const i of order) quality[i] = found.has(i) ? "found" : "missing";

  // Nothing found yet and the engine is still settling: sightings are being
  // ignored on purpose (they drift), so ask for the room scan first.
  if (found.size === 0 && !trackingReady) {
    return {
      text: "Scan the room first: move the phone slowly from side to side until this message changes.",
      tone: "info",
      lockReady: false,
      quality,
    };
  }

  if (!fit || found.size < 2) {
    const hint = trackingReady ? "" : " Move slowly, tracking is still settling.";
    return {
      text: `Find marker ${next !== undefined ? L(next) : "?"} (${found.size}/${total}). Hold the phone 1–1.5 m away, straight on, until it turns blue.${hint}`,
      tone: "info",
      lockReady: false,
      quality,
    };
  }

  // Grade markers. With 3+ markers each marker gets its leave-one-out offset;
  // with exactly two there is one distance to compare, shared by both.
  // A marker is as good as its best-agreeing distance to another marker: a
  // single bad sheet turns only its own chip red, not its neighbours'.
  for (const r of fit.residuals) quality[r.index] = gradeMm(bestPairErrorMm(fit, r.index));
  const culprit = fit.markersUsed >= 3 ? worstMarker(fit) : null;
  if (culprit && fit.rmsMm > GOOD_MM) {
    // With three markers every pair touches two of them; make sure the one we
    // name is the one shown in red.
    quality[culprit.index] = gradeMm(Math.max(residualMm(culprit), GOOD_MM + 1));
  }

  // Fewer markers than Lock needs: compare the distance(s) we have.
  if (fit.markersUsed < required) {
    const p = fit.pairs[0];
    const diff = p ? pairErrorMm(p) : 0;
    if (p && diff > WARN_MM) {
      return {
        text: `${L(p.a)}–${L(p.b)}: drawing ${formatMetres(p.modelMm)}, measured ${formatMetres(p.observedMm)}. Check that both sheets sit where the drawing puts them, then scan ${L(p.a)} again.`,
        tone: "bad",
        lockReady: false,
        quality,
        worst: p.a,
      };
    }
    if (next === undefined) {
      return {
        text: `Model placed, but Lock needs ${required} markers and this project has ${total}. Add a marker in Rhino.`,
        tone: "warn",
        lockReady: false,
        quality,
      };
    }
    return {
      text: `Model placed. Now find marker ${L(next)} to check it.`,
      tone: "info",
      lockReady: false,
      quality,
    };
  }

  const worst = worstMarker(fit);
  const worstMm = worst ? residualMm(worst) : 0;

  // Every distance off by the same factor: the sheets agree with each other and
  // with the drawing up to a scale. That is a print-size or engine-scale
  // problem, not a misplaced sheet, so no single marker gets the blame.
  if (
    fit.rmsMm > GOOD_MM &&
    freeFit &&
    freeFit.rmsMm <= WARN_MM &&
    Math.abs(freeFit.scale - 1) > SCALE_OFF_FRACTION
  ) {
    const pct = Math.round(Math.abs(freeFit.scale - 1) * 100);
    const dir = freeFit.scale < 1 ? "shorter" : "longer";
    for (const r of fit.residuals) quality[r.index] = "warn";
    return {
      text: `All distances are about ${pct} % ${dir} than the drawing, so the sheets agree with each other. Check one circle measures 180 mm (printed at 100 %). If it does, tap Reset placement and start with a slow room scan.`,
      tone: "warn",
      lockReady: false,
      quality,
    };
  }

  if (fit.rmsMm <= GOOD_MM) {
    const more = next !== undefined ? ` (marker ${L(next)} is optional)` : "";
    return {
      text: `Placement checked: within ${formatDistance(Math.max(fit.rmsMm, worstMm))}. Lock it${more}.`,
      tone: "good",
      lockReady: true,
      quality,
    };
  }

  return {
    text: `Marker ${L(worst!.index)} is about ${formatDistance(worstMm)} from where the drawing puts it. Check that sheet, or scan it again from closer.`,
    tone: worstMm > WARN_MM ? "bad" : "warn",
    lockReady: false,
    quality,
    worst: worst!.index,
  };
}
