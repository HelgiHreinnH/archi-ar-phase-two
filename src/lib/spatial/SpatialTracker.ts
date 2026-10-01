/**
 * SpatialTracker — the one interface every Spatial engine implements.
 *
 * The lab viewer (and later the production Spatial viewer) only talks to this
 * interface, so 8th Wall, Zappar or Immersal can be swapped by writing one
 * adapter. The adapter owns the camera, the engine and the three.js renderer;
 * the viewer owns the model, the survey and the UI.
 *
 * Contract every adapter must honour (Tracking principle, Notion plan):
 *  - World frame: Y is gravity-up. Units are metres when the engine can do it
 *    (`metricWorld: true`); otherwise the fit solves scale.
 *  - Sightings are raw: no smoothing in the adapter. surveyFit does the
 *    robust estimate. After Lock the viewer ignores sightings.
 *  - Losing a marker or tracking never removes the scene; the adapter only
 *    reports it through onTrackingState.
 */
import type { Vec3 } from "./surveyFit";

export interface SpatialMarkerTarget {
  /** 1-based marker index (marker_A = 1). */
  index: number;
  /** Signed URL (or data URL) of the printed marker image. */
  imageUrl: string;
  /** Printed width in metres (Spatial markers are 150 mm). */
  physicalWidthM: number;
}

export interface MarkerSighting {
  index: number;
  /** Marker centre in the engine's world frame. */
  position: Vec3;
  /** Marker orientation in the world frame (unused by the fit, kept for logs). */
  rotation?: { x: number; y: number; z: number; w: number };
  /** performance.now() of the frame. */
  at: number;
}

export type TrackingState = "initializing" | "normal" | "limited" | "lost";

/** three.js handles the adapter creates. `THREE` is the module instance it rendered with. */
export interface SpatialScene {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scene: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  camera: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: any;
}

export interface SpatialStartOptions {
  canvas: HTMLCanvasElement;
  markers: SpatialMarkerTarget[];
}

export interface SpatialTracker {
  readonly engine: string;
  /** True when world units are metres (fit can run with scale fixed to 1). */
  readonly metricWorld: boolean;
  /** Licence attribution the engine requires on screen (8th Wall does). */
  readonly attribution?: string;
  /** Starts camera + tracking. Resolves once the scene exists and frames render. */
  start(opts: SpatialStartOptions): Promise<SpatialScene>;
  stop(): void;
  onSighting(cb: (s: MarkerSighting) => void): () => void;
  onTrackingState(cb: (state: TrackingState, reason?: string) => void): () => void;
}

/** Tiny listener set used by adapters. */
export class Emitter<T extends unknown[]> {
  private fns = new Set<(...args: T) => void>();
  on(fn: (...args: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(...args: T): void {
    this.fns.forEach((fn) => {
      try { fn(...args); } catch (e) { console.error("[SpatialTracker] listener error", e); }
    });
  }
  clear(): void { this.fns.clear(); }
}
