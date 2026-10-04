/**
 * Loading the MindAR runtime (MindAR 1.2.5 + TF.js, jsDelivr).
 *
 * Moved out of MindARScene.tsx unchanged (Oct 2026) so the Tabletop/Wall
 * pre-camera screen can start it while the client is still reading
 * (arPreload). Idempotent: a second call resolves at once.
 */
export const MINDAR_THREE_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

let inFlight: Promise<void> | null = null;

export function loadMindAR(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).MINDAR?.IMAGE?.MindARThree) return Promise.resolve();
  if (!inFlight) {
    inFlight = loadMindAROnce();
    inFlight.catch(() => { inFlight = null; });
  }
  return inFlight;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadMindAROnce(): Promise<void> {
  try {
    await import(/* @vite-ignore */ MINDAR_THREE_URL);
  } catch (err) {
    // Audit C-1: A failed dynamic import for the MindAR runtime is most often
    // either an SRI mismatch (the modulepreload integrity hash in index.html
    // no longer matches the CDN bytes) or a network/CORS issue. Disambiguate
    // by probing the URL so we can surface a precise, actionable error.
    const { MindARSRIError, isLikelySRIFailure, findBrokenModuleDependency } =
      await import("@/lib/sriError");

    // The runtime imports "three" and "three/addons/renderers/CSS3DRenderer.js"
    // through the import map. A missing self-hosted file is served as index.html
    // by the SPA, which fails module parsing and looks identical to an SRI
    // mismatch — check that first so the error names the real cause.
    const broken = await findBrokenModuleDependency([
      "/assets/three/three.module.js",
      "/assets/three/jsm/renderers/CSS3DRenderer.js",
    ]);
    if (broken) {
      throw new Error(`AR engine dependency is missing or not a module: ${broken}`);
    }

    const reachable = await isLikelySRIFailure(MINDAR_THREE_URL);
    if (reachable) {
      throw new MindARSRIError(MINDAR_THREE_URL,
        "MindAR runtime integrity check failed. The CDN file may have been updated upstream.");
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!(window as any).MINDAR?.IMAGE?.MindARThree) {
    throw new Error("MindAR module loaded but runtime not found on window.MINDAR");
  }
}

