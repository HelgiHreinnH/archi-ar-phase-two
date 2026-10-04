/**
 * Loading the 8th Wall engine binary (Niantic Spatial "Distributed Engine
 * Binary" 1.0.0, jsDelivr, loaded unmodified — never rehost an altered build).
 *
 * Moved out of WorldLockScene.tsx unchanged (Oct 2026) so the Tabletop/Wall
 * pre-camera screen can start the download (xr.js + the 5.5 MB xr-slam.js
 * chunk) while the client is still reading (arPreload). Idempotent.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const XR8_ENGINE_URL =
  "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js";

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
