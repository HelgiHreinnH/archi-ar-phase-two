/**
 * Tabletop/Wall preload (Oct 2026): everything the camera view needs starts
 * downloading the moment the pre-camera screen shows, so the single tap lands
 * on warm assets instead of starting the downloads (4 Oct test: the engine
 * only began loading after the viewer mounted).
 *
 *  · the engine — 8th Wall xr.js + xr-slam.js, or MindAR + TF.js
 *  · three.js + GLTFLoader/Draco/meshopt modules (self-hosted)
 *  · the GLB (IndexedDB first, then a streamed download with progress)
 *  · the tracking target — the QR image target (8th Wall) or the .mind (MindAR)
 *
 * Every entry is memoised and shared: the viewer that mounts after the tap
 * picks up the same promise, so nothing downloads twice. Keys ignore the
 * signed-URL query string, so a re-signed URL still hits the preload.
 * A failed preload is forgotten, so the viewer's own call retries it.
 */
import { buildQrImageTarget, type Xr8ImageTargetData } from "@/lib/xr8QrTarget";
import { buildAssetKey, getCachedAsset, setCachedAsset } from "@/lib/assetCache";
import { loadXr8 } from "@/lib/xr8Engine";
import { loadMindAR } from "@/lib/mindarEngine";
import { markAR } from "@/lib/arTiming";

export type QrEngine = "8thwall" | "mindar";

/** Signed URL → stable key (path only; the token changes on every re-sign). */
export function assetKey(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

// ── GLB ──────────────────────────────────────────────────────────────

interface ModelEntry {
  promise: Promise<ArrayBuffer>;
  /** 0–1, or null when the size is unknown. */
  progress: number | null;
  listeners: Set<(p: number | null) => void>;
}

const models = new Map<string, ModelEntry>();

async function streamWithProgress(url: string, onProgress: (p: number | null) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new ModelHttpError(res.status);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || typeof res.body.getReader !== "function" || !total) {
    onProgress(null);
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    const f = Math.min(0.99, got / total);
    if (f - last >= 0.01) { last = f; onProgress(f); }
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

/** HTTP failure while downloading the model (e.g. an expired signed URL). */
export class ModelHttpError extends Error {
  constructor(public status: number) {
    super(`The 3D model could not be downloaded (HTTP ${status}).`);
  }
}

/**
 * IndexedDB key for a project's GLB — same scheme as MultipointViewer, so a
 * model cached by either viewer serves both. Changes on republish.
 */
export function modelCacheKeyFor(shareId: string, updatedAt: string | null | undefined): string {
  const token = (updatedAt ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9a-zA-Z]/g, "");
  return buildAssetKey(shareId, "model", token);
}

/**
 * Start (or join) the GLB download. `cacheKey` is the IndexedDB key
 * (assetCache.buildAssetKey) — a warm visit is served from there.
 */
export function preloadModel(url: string, cacheKey?: string | null): Promise<ArrayBuffer> {
  const key = assetKey(url);
  const existing = models.get(key);
  if (existing) return existing.promise;

  const entry: ModelEntry = { promise: null as unknown as Promise<ArrayBuffer>, progress: 0, listeners: new Set() };
  const report = (p: number | null) => {
    entry.progress = p;
    for (const l of entry.listeners) l(p);
  };
  entry.promise = (async () => {
    if (cacheKey) {
      const cached = await getCachedAsset(cacheKey).catch(() => null);
      if (cached) {
        markAR("glb-downloaded", "idb cache");
        report(1);
        return cached;
      }
    }
    const buf = await streamWithProgress(url, report);
    markAR("glb-downloaded");
    report(1);
    if (cacheKey) void setCachedAsset(cacheKey, buf).catch(() => { /* quota */ });
    return buf;
  })();
  entry.promise.catch(() => { models.delete(key); });
  models.set(key, entry);
  return entry.promise;
}

/** Follow a model download's progress (0–1, null = unknown size). */
export function subscribeModelProgress(url: string, l: (p: number | null) => void): () => void {
  const e = models.get(assetKey(url));
  if (!e) return () => {};
  l(e.progress);
  e.listeners.add(l);
  return () => { e.listeners.delete(l); };
}

// ── Tracking targets ─────────────────────────────────────────────────

const trackingFiles = new Map<string, Promise<ArrayBuffer>>();

/** The MindAR .mind file, fetched once (MindARScene validates it). */
export function preloadTrackingFile(url: string): Promise<ArrayBuffer> {
  const key = assetKey(url);
  let p = trackingFiles.get(key);
  if (!p) {
    p = fetch(url, { cache: "force-cache" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => { trackingFiles.delete(key); });
    trackingFiles.set(key, p);
  }
  return p;
}

/** A tracking file already being preloaded, or null. */
export function takePreloadedTrackingFile(url: string): Promise<ArrayBuffer> | null {
  return trackingFiles.get(assetKey(url)) ?? null;
}

const qrTargets = new Map<string, Promise<Xr8ImageTargetData>>();

/** The 8th Wall QR image target, built in the browser from qr_code.png. */
export function preloadQrTarget(
  qrUrl: string | null | undefined,
  shareId: string,
  qrSizeMm: number,
): Promise<Xr8ImageTargetData> {
  const key = `${shareId}:${qrSizeMm}`;
  let p = qrTargets.get(key);
  if (!p) {
    p = buildQrImageTarget(qrUrl, shareId, qrSizeMm);
    p.catch(() => { qrTargets.delete(key); });
    qrTargets.set(key, p);
  }
  return p;
}

// ── Engines + three modules ──────────────────────────────────────────

const THREE_MODULES = [
  "/assets/three/three.module.js",
  "/assets/three/jsm/loaders/GLTFLoader.js",
  "/assets/three/jsm/loaders/DRACOLoader.js",
  "/assets/three/jsm/libs/meshopt_decoder.module.js",
];

let threePreload: Promise<unknown> | null = null;

export function preloadEngine(engine: QrEngine): void {
  if (!threePreload) {
    threePreload = Promise.all(THREE_MODULES.map((u) => import(/* @vite-ignore */ u))).catch(() => {
      threePreload = null;
    });
  }
  // Errors here are not fatal: the scene's own load call reports them.
  if (engine === "8thwall") void loadXr8().catch(() => {});
  else void loadMindAR().catch(() => {});
}

export interface QrPreloadInput {
  engine: QrEngine;
  shareId: string;
  modelUrl: string | null;
  modelCacheKey: string | null;
  qrCodeUrl: string | null;
  mindFileUrl: string | null;
  qrSizeMm: number;
}

/** Everything for one Tabletop/Wall experience. Safe to call repeatedly. */
export function preloadQrExperience(i: QrPreloadInput): void {
  preloadEngine(i.engine);
  if (i.modelUrl) void preloadModel(i.modelUrl, i.modelCacheKey).catch(() => {});
  if (i.engine === "8thwall") {
    void preloadQrTarget(i.qrCodeUrl, i.shareId, i.qrSizeMm).catch(() => {});
  } else if (i.mindFileUrl) {
    void preloadTrackingFile(i.mindFileUrl).catch(() => {});
  }
}

/** Test hook. */
export function __resetARPreloadForTests(): void {
  models.clear();
  trackingFiles.clear();
  qrTargets.clear();
  threePreload = null;
}
