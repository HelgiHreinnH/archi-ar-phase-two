/**
 * Stale-deploy recovery (Oct 2026).
 *
 * Routes and heavy helpers (wizard, model preview, thumbnail renderer, GLB
 * optimizer) are code-split. Every deploy renames those chunks, so a tab that
 * was opened before a deploy asks for files that no longer exist. Netlify's
 * SPA fallback used to answer with index.html (200, text/html) — the import
 * then fails and the UI hangs: "New Experience" never opened, the model
 * preview stayed on "Preparing preview…", thumbnails were never rendered.
 *
 * Fix: on a chunk-load failure, reload once to pick up the new deploy. A
 * short guard stops a reload loop if the failure is real (offline, CDN down).
 * netlify.toml additionally returns a real 404 for missing /assets/* files.
 */
import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "archi:stale-deploy-reload-at";
const RELOAD_GUARD_MS = 15_000;
/** Set once a reload is under way, so nothing renders a half-loaded module meanwhile. */
let reloading = false;

/** Browser messages for a failed dynamic import / module preload. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|is not a valid JavaScript MIME type|Unable to preload CSS|ChunkLoadError/i.test(msg);
}

/**
 * Reload the page once to load the current deploy. Returns false (and does
 * nothing) if we already reloaded for this within the guard window.
 */
export function reloadForNewDeploy(now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = safeSession()): boolean {
  try {
    const last = Number(storage?.getItem(RELOAD_KEY) ?? 0);
    if (last && now - last < RELOAD_GUARD_MS) return false;
    storage?.setItem(RELOAD_KEY, String(now));
  } catch { /* storage blocked: still reload once */ }
  console.warn("[staleDeploy] a newer version is deployed — reloading");
  reloading = true;
  window.location.reload();
  return true;
}

function safeSession(): Storage | null {
  try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; }
}

/** React.lazy that reloads once into the new deploy instead of hanging on a missing chunk. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  const pending = () => new Promise<{ default: T }>(() => {}); // page is reloading
  return lazy(() =>
    factory().then(
      // After vite:preloadError was handled, the import resolves to undefined.
      (mod) => (mod?.default ? mod : reloading ? pending() : mod),
      (err) => {
        if (reloading || (isChunkLoadError(err) && reloadForNewDeploy())) return pending();
        throw err;
      },
    ),
  );
}

/**
 * Vite fires `vite:preloadError` when any dynamic import (or its preloaded
 * deps) fails to load — covers the non-route imports too (optimizer,
 * thumbnail renderer, 3D preview).
 */
export function installStaleDeployRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewDeploy()) event.preventDefault();
  });
}
